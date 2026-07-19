import argparse
import csv
import hashlib
import html as html_module
import json
from json import JSONDecodeError
import re
import shutil
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Optional


def _flatten_caption_and_link(message: dict[str, Any]) -> tuple[str, str]:
    link = ""
    parts: list[str] = []

    entities = message.get("text_entities")
    if isinstance(entities, list):
        for e in entities:
            if isinstance(e, dict):
                et = e.get("type")
                tx = e.get("text")
                if (et == "link" or et == "text_link") and isinstance(tx, str):
                    if not link and tx.strip().lower().startswith("http"):
                        link = tx.strip()
                else:
                    if isinstance(tx, str):
                        parts.append(tx)
            elif isinstance(e, str):
                parts.append(e)

    if not parts:
        text = message.get("text")
        if isinstance(text, str):
            parts.append(text)
        elif isinstance(text, list):
            for item in text:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    if item.get("type") == "link":
                        tx = item.get("text")
                        if (
                            not link
                            and isinstance(tx, str)
                            and tx.strip().lower().startswith("http")
                        ):
                            link = tx.strip()
                    else:
                        tx = item.get("text")
                        if isinstance(tx, str):
                            parts.append(tx)

    caption = "".join(parts).strip()
    caption = re.sub(r"^\s*\n+", "", caption).strip()
    return caption, link


def _safe_slug(text: str, max_len: int = 80) -> str:
    invalid = set('\\/:*?"<>|')

    t = (text or "").strip()
    t = re.sub(r"\s+", " ", t)
    t = t.replace("—->", "-").replace("->", "-")
    t = re.sub(r"[\U00010000-\U0010FFFF]", "", t)
    t = re.sub(r"[^\w\s\-]+", "", t, flags=re.UNICODE)
    t = re.sub(r"\s+", "_", t).strip("_-")
    t = t or "sem-descricao"
    t = "".join("_" if ch in invalid else ch for ch in t).strip(" .")
    return t[:max_len] if len(t) > max_len else t


_PRICE_RE = re.compile(
    r"(?:(?:—->|->|—>|=>)\s*)?"
    r"(?:"
    r"(?:\d+[\.,]?\d*\s*(?:€|eur|euro|euros)\b)"
    r"|(?:€\s*\d+[\.,]?\d*)"
    r"|(?:(?:eur|euro|euros)\s*\d+[\.,]?\d*)"
    r")"
    r"(?:\s*(?:-|/|a)\s*(?:€\s*)?\d+[\.,]?\d*\s*(?:€|eur|euro|euros)\b)?",
    re.IGNORECASE,
)

_STORE_NAME_RE = re.compile(r"\b(?:yep\s*express|yepexpress|yepex|hacoo)\b", re.IGNORECASE)
_PROMO_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"como pedir",
        r"perfil de hacoo",
        r"primeros pedidos",
        r"90%\s*de\s*descuento",
        r"\bc[oó]digos?\b",
        r"seguirnos",
        r"\btutorial\b",
        r"todos los enlaces",
        r"novedades",
        r"v[áa]lido para",
    )
]


def _is_catalog_promo(caption: str) -> bool:
    text = re.sub(r"\s+", " ", (caption or "").strip().lower())
    if not text:
        return False
    return any(pattern.search(text) for pattern in _PROMO_PATTERNS)


def _clean_product_name(caption: str) -> str:
    s = (caption or "").replace("\r", "").strip()
    if not s:
        return ""

    lines = [ln.strip() for ln in s.split("\n")]
    lines = [ln for ln in lines if ln and not ln.lower().startswith("http")]
    s = " ".join(lines).strip()

    if not s:
        return ""

    s = s.replace("💎", " ").replace("🔥", " ").replace("❤", " ").replace("✅", " ")
    s = s.replace("⭐", " ").replace("✨", " ").replace("🔗", " ")
    s = _STORE_NAME_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()

    if "—->" in s:
        s = s.split("—->", 1)[0].strip()
    if "->" in s:
        s = s.split("->", 1)[0].strip()
    if "—>" in s:
        s = s.split("—>", 1)[0].strip()
    if "=>" in s:
        s = s.split("=>", 1)[0].strip()

    s = _PRICE_RE.sub("", s)
    s = re.sub(r"\s+", " ", s).strip(" -–—")
    return s


def _infer_category(name: str) -> str:
    n = (name or "").strip().lower()
    if not n:
        return "outros"

    def has(*needles: str) -> bool:
        return any(x in n for x in needles)

    if has(
        "bolsa",
        "bag",
        "purse",
        "mochila",
        "backpack",
        "minibag",
        "mini bag",
        "bandolera",
        "pochete",
        "crossbody",
        "tote",
        "handbag",
        "sling",
        "kanken",
        "longchamp",
        "polene",
        "goyard",
        "jacquemus",
    ):
        return "bolsas"
    if has("oculos", "óculos", "rayban", "ray-ban", "ray ban"):
        return "oculos"
    if has(
        "fone",
        "headphone",
        "headphones",
        "airpods",
        "earpods",
        "earbuds",
        "beats",
    ):
        return "fones"
    if has("bone", "boné", "new era", "newera") or re.search(r"\bcap\b", n):
        return "bones"
    if has("relogio", "relógio", "watch"):
        return "relogios"
    if has("capa", "case"):
        return "capas"
    if has("chinelo", "slide", "sliders"):
        return "chinelos"

    if has(
        "camiseta",
        "tshirt",
        "t-shirt",
        "jersey",
        "hoodie",
        "shorts",
        "pantal",
        "pantalón",
        "chaqueta",
        "chandal",
        "chándal",
        "mundial",
        "conjunto",
        "sudadera",
        "jacket",
        "coat",
        "polo",
        "detroit",
        "stone island",
        "stussy",
        "carhartt",
        "ralph lauren",
        "moncler",
        "essentials",
        "sp5der",
        "corteiz",
        "palace",
        "fear of god",
        "the north face",
        "north face",
    ):
        return "roupas"

    if has(
        "airpods",
        "iphone",
        "magsafe",
        "watch",
        "apple",
        "jbl",
        "marshall",
        "dyson",
        "proyector",
        "android",
        "4k",
        "wifi",
    ):
        return "tecnologia"

    return "outros"


def _slug_dash(text: str, max_len: int = 60) -> str:
    return _safe_slug(text, max_len=max_len).lower().replace("_", "-")


def _infer_sneaker_fields(name: str) -> Optional[dict[str, str]]:
    s = (name or "").strip()
    if not s:
        return None

    n = s.lower()
    if any(
        k in n
        for k in (
            "chandal",
            "chándal",
            "conjunto",
            "hoodie",
            "camiseta",
            "tshirt",
            "t-shirt",
            "jersey",
            "jaqueta",
            "chaqueta",
            "jacket",
            "polo",
            "sudadera",
            "mundial",
        )
    ):
        return None

    brand_slug = ""
    brand_label = ""
    if "adidas" in n:
        brand_slug, brand_label = "adidas", "Adidas"
    elif "nike" in n:
        brand_slug, brand_label = "nike", "Nike"
    elif "new balance" in n or "newbalance" in n:
        brand_slug, brand_label = "newbalance", "New Balance"
    elif "asics" in n:
        brand_slug, brand_label = "asics", "ASICS"
    elif "vans" in n:
        brand_slug, brand_label = "vans", "Vans"
    elif "converse" in n:
        brand_slug, brand_label = "converse", "Converse"
    else:
        return None

    model = s
    if brand_slug == "newbalance":
        model = re.sub(r"(?i)\bnew\s*balance\b", "", model).strip()
    else:
        model = re.sub(rf"(?i)\b{re.escape(brand_label)}\b", "", model).strip()
        model = re.sub(rf"(?i)\b{re.escape(brand_slug)}\b", "", model).strip()

    model = re.sub(r"\s+", " ", model).strip(" -–—")
    if not model:
        return None

    return {
        "category": "sneakers",
        "brandSlug": brand_slug,
        "brandLabel": brand_label,
        "modelSlug": _slug_dash(model),
        "modelLabel": model,
    }


def _message_timestamp(message: dict[str, Any]) -> int:
    ts = message.get("date_unixtime")
    try:
        return int(ts)
    except Exception:
        return 0


def _build_export_catalog(
    messages: list[dict[str, Any]],
    *,
    max_products: int,
) -> list[dict[str, Any]]:
    by_name: dict[str, list[dict[str, Any]]] = {}
    last_name = ""
    last_ts = 0

    for msg in messages:
        if not isinstance(msg, dict):
            continue
        rel = msg.get("photo")
        if not rel:
            continue
        caption, link = _flatten_caption_and_link(msg)
        if _is_catalog_promo(caption):
            continue
        cleaned = _clean_product_name(caption)
        ts = _message_timestamp(msg)
        if cleaned:
            last_name = cleaned
            last_ts = ts
            name = cleaned
        else:
            if last_name and ts and last_ts and abs(ts - last_ts) <= 300:
                name = last_name
            else:
                name = "Sem descrição"

        item = dict(msg)
        item["_buy_link"] = link
        by_name.setdefault(name, []).append(item)

    names_sorted = sorted(
        by_name.keys(),
        key=lambda n: max((_message_timestamp(m) for m in by_name[n]), default=0),
        reverse=True,
    )[: max_products if max_products > 0 else len(by_name)]

    used_slugs: dict[str, int] = {}
    products: list[dict[str, Any]] = []

    for name in names_sorted:
        slug = _safe_slug(name, max_len=60).lower()
        if not slug:
            continue
        if slug in used_slugs:
            used_slugs[slug] += 1
            slug = f"{slug}-{used_slugs[slug]}"
        else:
            used_slugs[slug] = 1

        msgs = sorted(by_name[name], key=_message_timestamp, reverse=True)
        latest_ts = max((_message_timestamp(m) for m in msgs), default=0)
        buy_link = ""
        for msg in msgs:
            maybe_link = str(msg.get("_buy_link") or "").strip()
            if maybe_link:
                buy_link = maybe_link
                break

        product: dict[str, Any] = {
            "slug": slug,
            "name": name,
            "latestTs": latest_ts,
            "buyLink": buy_link,
            "hasBuyLink": bool(buy_link),
            "messages": msgs,
        }
        sneaker = _infer_sneaker_fields(name)
        if sneaker:
            product.update(sneaker)
        else:
            product["category"] = _infer_category(name)
        products.append(product)

    return products


class _TelegramHTMLExportParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.messages: list[dict[str, Any]] = []
        self._in_message = False
        self._div_depth = 0
        self._in_text = False
        self._current: dict[str, Any] = {}

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, Optional[str]]]
    ) -> None:
        attrs_map = {k: (v or "") for k, v in attrs}
        if tag == "div":
            cls = attrs_map.get("class", "")
            if not self._in_message and "message" in cls and "default" in cls and "clearfix" in cls:
                mid = attrs_map.get("id", "")
                m = re.match(r"message(\d+)", mid)
                self._in_message = True
                self._div_depth = 1
                self._in_text = False
                self._current = {
                    "id": int(m.group(1)) if m else None,
                    "photo": "",
                    "date_unixtime": 0,
                    "text_parts": [],
                }
                return

            if self._in_message:
                self._div_depth += 1
                if cls.strip() == "text":
                    self._in_text = True
                    return
                if "date" in cls and "details" in cls:
                    title = attrs_map.get("title", "")
                    if title:
                        ts = _parse_html_export_timestamp(title)
                        if ts:
                            self._current["date_unixtime"] = ts

        if self._in_message and tag == "a":
            cls = attrs_map.get("class", "")
            if "photo_wrap" in cls:
                href = attrs_map.get("href", "")
                if href:
                    self._current["photo"] = href

        if self._in_message and self._in_text and tag == "br":
            self._current["text_parts"].append("\n")

    def handle_endtag(self, tag: str) -> None:
        if not self._in_message:
            return
        if tag == "div":
            if self._in_text:
                self._in_text = False
            self._div_depth -= 1
            if self._div_depth <= 0:
                photo = str(self._current.get("photo") or "")
                text = "".join(self._current.get("text_parts") or []).strip()
                if photo:
                    self.messages.append(
                        {
                            "id": self._current.get("id"),
                            "photo": photo,
                            "date_unixtime": int(self._current.get("date_unixtime") or 0),
                            "text": text,
                        }
                    )
                self._in_message = False
                self._div_depth = 0
                self._in_text = False
                self._current = {}

    def handle_data(self, data: str) -> None:
        if self._in_message and self._in_text and data:
            self._current["text_parts"].append(data)


def _parse_html_export_timestamp(title: str) -> int:
    s = (title or "").strip()
    m = re.match(
        r"^(?P<date>\d{2}\.\d{2}\.\d{4})\s+(?P<time>\d{2}:\d{2}:\d{2})\s+UTC(?P<off>[+-]\d{2}:\d{2})$",
        s,
    )
    if not m:
        return 0
    dt = datetime.strptime(f"{m.group('date')} {m.group('time')}", "%d.%m.%Y %H:%M:%S")
    off = m.group("off")
    sign = 1 if off.startswith("+") else -1
    hh, mm = off[1:].split(":")
    tz = timezone(sign * timedelta(hours=int(hh), minutes=int(mm)))
    return int(dt.replace(tzinfo=tz).timestamp())


def _load_export_messages(export_dir: Path) -> list[dict[str, Any]]:
    json_path = export_dir / "result.json"
    if json_path.exists():
        try:
            with json_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            messages = data.get("messages", [])
            if not isinstance(messages, list):
                raise ValueError("result.json inesperado: 'messages' não é lista")
            return messages
        except JSONDecodeError:
            raw = json_path.read_text(encoding="utf-8", errors="ignore")
            recovered = _recover_messages_from_broken_result_json(raw)
            if recovered:
                return recovered

    html_path = export_dir / "messages.html"
    if html_path.exists():
        raw = html_path.read_text(encoding="utf-8", errors="ignore")
        raw = html_module.unescape(raw)
        parser = _TelegramHTMLExportParser()
        parser.feed(raw)
        return parser.messages

    raise FileNotFoundError(
        f"Não encontrei export válido em {export_dir} (preciso de result.json ou messages.html)"
    )


def _recover_messages_from_broken_result_json(raw: str) -> list[dict[str, Any]]:
    marker = '"messages":'
    start = raw.find(marker)
    if start < 0:
        return []

    array_start = raw.find("[", start)
    if array_start < 0:
        return []

    decoder = json.JSONDecoder()
    messages: list[dict[str, Any]] = []
    i = array_start + 1
    n = len(raw)

    while i < n:
        while i < n and raw[i] in " \r\n\t,":
            i += 1
        if i >= n or raw[i] == "]":
            break
        if raw[i] != "{":
            i += 1
            continue
        try:
            obj, end = decoder.raw_decode(raw, i)
        except JSONDecodeError:
            i += 1
            continue
        if isinstance(obj, dict):
            messages.append(obj)
        i = end

    return messages



def _write_site_manifest_from_export(
    export_dir: Path,
    out_images_dir: Path,
    *,
    products: list[dict[str, Any]],
    max_images_per_product: int,
) -> dict[str, Any]:
    out_images_dir.mkdir(parents=True, exist_ok=True)
    manifest_products: list[dict[str, Any]] = []

    for item in products:
        slug = str(item.get("slug") or "").strip()
        name = str(item.get("name") or "").strip()
        msgs = list(item.get("messages") or [])
        if not slug or not name or not msgs:
            continue
        dest_dir = out_images_dir / slug
        dest_dir.mkdir(parents=True, exist_ok=True)

        images: list[str] = []
        seen_in_product: set[str] = set()
        count = 0
        for msg in msgs:
            if max_images_per_product > 0 and count >= max_images_per_product:
                break
            rel = msg.get("photo")
            if not rel:
                continue
            src = export_dir / rel
            if not src.exists():
                continue
            h = hashlib.sha1()
            with src.open("rb") as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    h.update(chunk)
            digest = h.hexdigest()
            if digest in seen_in_product:
                continue
            ext = src.suffix.lower() or ".jpg"
            dst = dest_dir / f"{slug}_{count + 1:02d}{ext}"
            if not dst.exists():
                shutil.copy2(src, dst)
            images.append(
                str(Path("imagens") / "telegram" / slug / dst.name).replace("\\", "/")
            )
            seen_in_product.add(digest)
            count += 1

        if images:
            latest_ts = max((_message_timestamp(m) for m in msgs), default=0)
            product: dict[str, Any] = {
                "slug": slug,
                "name": name,
                "images": images,
                "latestTs": latest_ts,
                # O site publico nunca deve expor o fluxo de compra final.
                "hasBuyLink": False,
            }
            if item.get("category") == "sneakers":
                product.update(
                    {
                        "category": "sneakers",
                        "brandSlug": item.get("brandSlug", ""),
                        "brandLabel": item.get("brandLabel", ""),
                        "modelSlug": item.get("modelSlug", ""),
                        "modelLabel": item.get("modelLabel", ""),
                    }
                )
            else:
                product["category"] = item.get("category", "outros")
            manifest_products.append(product)

    return {"products": manifest_products}


def _write_google_sheets_links_csv(
    products: list[dict[str, Any]],
    out_csv_path: Path,
) -> None:
    out_csv_path.parent.mkdir(parents=True, exist_ok=True)
    with out_csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "slug",
                "name",
                "category",
                "brandSlug",
                "brandLabel",
                "modelSlug",
                "modelLabel",
                "buyLink",
                "active",
                "latestTs",
            ],
        )
        writer.writeheader()
        for product in products:
            writer.writerow(
                {
                    "slug": product.get("slug", ""),
                    "name": product.get("name", ""),
                    "category": product.get("category", ""),
                    "brandSlug": product.get("brandSlug", ""),
                    "brandLabel": product.get("brandLabel", ""),
                    "modelSlug": product.get("modelSlug", ""),
                    "modelLabel": product.get("modelLabel", ""),
                    "buyLink": product.get("buyLink", ""),
                    "active": "TRUE" if product.get("hasBuyLink") else "FALSE",
                    "latestTs": product.get("latestTs", 0),
                }
            )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--export-dir",
        required=True,
        help="Pasta do ChatExport do Telegram (contendo result.json e /photos).",
    )
    parser.add_argument(
        "--out-dir",
        required=True,
        help="Pasta de saída para fotos renomeadas + captions.csv.",
    )
    parser.add_argument(
        "--copy",
        action="store_true",
        help="Copiar fotos para a pasta de saída (se não usar, só gera captions.csv).",
    )
    parser.add_argument(
        "--sync-site",
        action="store_true",
        help="Cria um manifest só com nome do produto (sem preços) e copia fotos para o site.",
    )
    parser.add_argument(
        "--max-products",
        type=int,
        default=0,
        help="Máximo de produtos para adicionar ao site (0 = sem limite).",
    )
    parser.add_argument(
        "--max-images-per-product",
        type=int,
        default=4,
        help="Máximo de imagens por produto no site.",
    )
    args = parser.parse_args()

    export_dir = Path(args.export_dir)
    if not export_dir.exists():
        raise FileNotFoundError(f"Não encontrei: {export_dir}")

    out_root = Path(args.out_dir)
    out_photos = out_root / "photos"
    out_root.mkdir(parents=True, exist_ok=True)
    if args.copy:
        out_photos.mkdir(parents=True, exist_ok=True)

    messages = _load_export_messages(export_dir)

    rows: list[dict[str, Any]] = []
    photo_count = 0
    copied = 0
    missing = 0

    for msg in messages:
        if not isinstance(msg, dict):
            continue
        rel = msg.get("photo")
        if not rel:
            continue
        photo_count += 1
        src = export_dir / rel
        if not src.exists():
            missing += 1
            continue

        caption, link = _flatten_caption_and_link(msg)
        slug = _safe_slug(caption)
        msg_id = msg.get("id")

        dst_rel = ""
        if args.copy:
            ext = src.suffix.lower()
            base = f"msg{msg_id}_{slug}" if msg_id is not None else slug
            dst = out_photos / f"{base}{ext}"
            k = 2
            while dst.exists():
                dst = out_photos / f"{base}_{k}{ext}"
                k += 1
            shutil.copy2(src, dst)
            copied += 1
            dst_rel = str(dst.relative_to(out_root)).replace("\\", "/")

        rows.append(
            {
                "message_id": msg_id,
                "date": msg.get("date", ""),
                "src_relative": rel,
                "extracted_file": dst_rel,
                "link": link,
                "caption": caption,
            }
        )

    csv_path = out_root / "captions.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "message_id",
                "date",
                "src_relative",
                "extracted_file",
                "link",
                "caption",
            ],
        )
        w.writeheader()
        w.writerows(rows)

    catalog_products = _build_export_catalog(
        messages,
        max_products=args.max_products if args.sync_site else 0,
    )
    buy_links_csv_path = out_root / "google_sheets_buy_links.csv"
    _write_google_sheets_links_csv(catalog_products, buy_links_csv_path)

    site_manifest: Optional[dict[str, Any]] = None
    if args.sync_site:
        site_images_dir = Path(r"C:\SmartThings\imagens\telegram")
        site_manifest = _write_site_manifest_from_export(
            export_dir,
            site_images_dir,
            products=catalog_products,
            max_images_per_product=args.max_images_per_product,
        )
        manifest_path = Path(r"C:\SmartThings\imagens\telegram_manifest.json")
        manifest_path.write_text(
            json.dumps(site_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    print("OK")
    print(f"- mensagens com foto: {photo_count}")
    print(f"- copiadas: {copied}" if args.copy else "- copiadas: (desativado)")
    print(f"- ficheiros em falta: {missing}")
    print(f"- CSV: {csv_path}")
    print(f"- Google Sheets CSV: {buy_links_csv_path}")
    if site_manifest is not None:
        print(
            f"- site: {len(site_manifest.get('products', []))} produtos em C:\\SmartThings\\imagens\\telegram"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
