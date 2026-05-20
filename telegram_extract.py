import argparse
import csv
import json
import re
import shutil
from pathlib import Path
from typing import Any


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
    r"(?:(?:—->|->|—>|=>)\s*)?(?:\d+[\.,]?\d*)\s*€(?:\s*\d+[\.,]?\d*\s*€)*",
    re.IGNORECASE,
)


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


def _write_site_manifest_from_export(
    export_dir: Path,
    out_images_dir: Path,
    *,
    max_products: int,
    max_images_per_product: int,
) -> dict[str, Any]:
    json_path = export_dir / "result.json"
    with json_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    messages = data.get("messages", [])
    if not isinstance(messages, list):
        raise ValueError("result.json inesperado: 'messages' não é lista")

    by_name: dict[str, list[dict[str, Any]]] = {}
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        rel = msg.get("photo")
        if not rel:
            continue
        caption, _ = _flatten_caption_and_link(msg)
        name = _clean_product_name(caption)
        if not name:
            continue
        by_name.setdefault(name, []).append(msg)

    def msg_time(m: dict[str, Any]) -> int:
        ts = m.get("date_unixtime")
        try:
            return int(ts)
        except Exception:
            return 0

    names_sorted = sorted(
        by_name.keys(),
        key=lambda n: max((msg_time(m) for m in by_name[n]), default=0),
        reverse=True,
    )[: max_products if max_products > 0 else len(by_name)]

    out_images_dir.mkdir(parents=True, exist_ok=True)

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

        msgs = sorted(by_name[name], key=msg_time, reverse=True)
        dest_dir = out_images_dir / slug
        dest_dir.mkdir(parents=True, exist_ok=True)

        images: list[str] = []
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
            ext = src.suffix.lower() or ".jpg"
            dst = dest_dir / f"{slug}_{count + 1:02d}{ext}"
            if not dst.exists():
                shutil.copy2(src, dst)
            images.append(
                str(Path("imagens") / "telegram" / slug / dst.name).replace("\\", "/")
            )
            count += 1

        if images:
            products.append({"slug": slug, "name": name, "images": images})

    return {"products": products}


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
        default=50,
        help="Máximo de produtos para adicionar ao site (mais recentes).",
    )
    parser.add_argument(
        "--max-images-per-product",
        type=int,
        default=4,
        help="Máximo de imagens por produto no site.",
    )
    args = parser.parse_args()

    export_dir = Path(args.export_dir)
    json_path = export_dir / "result.json"
    if not json_path.exists():
        raise FileNotFoundError(f"Não encontrei: {json_path}")

    out_root = Path(args.out_dir)
    out_photos = out_root / "photos"
    out_root.mkdir(parents=True, exist_ok=True)
    if args.copy:
        out_photos.mkdir(parents=True, exist_ok=True)

    with json_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    messages = data.get("messages", [])
    if not isinstance(messages, list):
        raise ValueError("result.json inesperado: 'messages' não é lista")

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

    site_manifest: dict[str, Any] | None = None
    if args.sync_site:
        site_images_dir = Path(r"C:\SmartThings\imagens\telegram")
        site_manifest = _write_site_manifest_from_export(
            export_dir,
            site_images_dir,
            max_products=args.max_products,
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
    if site_manifest is not None:
        print(
            f"- site: {len(site_manifest.get('products', []))} produtos em C:\\SmartThings\\imagens\\telegram"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
