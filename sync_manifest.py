import json
import re
import time
import unicodedata
from pathlib import Path
from typing import Any, Optional

PROJECT_ROOT = Path(__file__).resolve().parent
IMG_DIR = PROJECT_ROOT / "imagens" / "telegram"
MANIFEST_PATH = PROJECT_ROOT / "imagens" / "telegram_manifest.json"


MOJIBAKE_MAP = {
    "ß": "a", "à": "a", "á": "a", "â": "a", "ã": "a", "ä": "a", "å": "a", "æ": "ae",
    "þ": "c", "ç": "c", "ð": "d",
    "è": "e", "é": "e", "ê": "e", "ë": "e",
    "ì": "i", "í": "i", "î": "i", "ï": "i",
    "±": "n", "ñ": "n",
    "ò": "o", "ó": "o", "ô": "o", "õ": "o", "ö": "o", "ø": "o", "¾": "o",
    "·": "u", "ù": "u", "ú": "u", "û": "u", "ü": "u",
    "Ú": "e", "Ý": "i", "ý": "y", "ÿ": "y",
}


def _deep_fix_mojibake(text: str) -> str:
    if not text:
        return text
    result = []
    for ch in text:
        low = ch.lower()
        if low in MOJIBAKE_MAP:
            fixed = MOJIBAKE_MAP[low]
            if ch.isupper() and fixed.isalpha() and len(fixed) == 1:
                result.append(fixed.upper())
            else:
                result.append(fixed)
        else:
            result.append(ch)
    return "".join(result)


def _strip_accents(text: str) -> str:
    if not text:
        return text
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in nfkd if unicodedata.category(ch) != "Mn")


def _sanitize_slug_strong(text: str, max_len: int = 120) -> str:
    s = _deep_fix_mojibake(text or "")
    s = _strip_accents(s)
    s = s.lower()
    s = re.sub(r"[\U00010000-\U0010FFFF]", "", s)
    s = re.sub(r"[^a-z0-9_\-]+", "_", s)
    s = re.sub(r"_+", "_", s)
    s = s.strip(" _-")
    s = s or "produto-sem-nome"
    if len(s) > max_len:
        s = s[:max_len].rstrip("_-")
    return s


def _clean_display_name(text: str) -> str:
    s = _deep_fix_mojibake(text or "")
    s = s.replace("\u00a0", " ").replace("\r", " ").replace("\n", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def _infer_category(name: str) -> str:
    n_raw = (name or "").strip()
    n_clean = _clean_display_name(n_raw)
    variants = {n_raw.lower(), n_clean.lower(), _strip_accents(n_clean).lower()}
    candidates = " ".join(variants)
    if not candidates:
        return "outros"

    def has(*needles: str) -> bool:
        return any(x in candidates for x in needles)

    if has(
        "bolsa", "bag", "purse", "mochila", "backpack", "minibag", "mini bag",
        "bandolera", "pochete", "crossbody", "tote", "handbag", "sling",
        "kanken", "longchamp", "polene", "goyard", "jacquemus",
    ):
        return "bolsas"
    if has("oculos", "rayban", "ray-ban", "ray ban"):
        return "oculos"
    if has("fone", "headphone", "headphones", "airpods", "earpods", "earbuds", "beats"):
        return "fones"
    if has("bone", "new era", "newera") or re.search(r"\bcap\b", candidates):
        return "bones"
    if has("relogio", "watch"):
        return "relogios"
    if has("capa", "case"):
        return "capas"
    if has("chinelo", "slide", "sliders"):
        return "chinelos"
    if has(
        "camiseta", "tshirt", "t-shirt", "jersey", "hoodie", "shorts", "pantal",
        "chaqueta", "chandal", "mundial", "conjunto",
        "sudadera", "jacket", "coat", "polo", "detroit", "stone island", "stussy",
        "carhartt", "ralph lauren", "moncler", "essentials", "sp5der", "corteiz",
        "palace", "fear of god", "the north face", "north face",
    ):
        return "roupas"
    if has(
        "airpods", "iphone", "magsafe", "apple", "jbl", "marshall", "dyson",
        "dayson", "proyector", "android", "4k", "wifi", "cargador",
    ):
        return "tecnologia"
    return "outros"


def _slug_dash(text: str, max_len: int = 60) -> str:
    base = _sanitize_slug_strong(text, max_len=max_len)
    return base.replace("_", "-")


def _infer_sneaker_fields(name: str) -> Optional[dict[str, str]]:
    s = _clean_display_name(name or "").strip()
    if not s:
        return None
    n = s.lower()
    variants = " ".join({n, _strip_accents(n)})
    if any(
        k in variants for k in (
            "chandal", "conjunto", "hoodie", "camiseta", "tshirt",
            "t-shirt", "jersey", "jaqueta", "chaqueta", "jacket", "polo",
            "sudadera", "mundial", "banador",
        )
    ):
        return None

    brand_slug = ""
    brand_label = ""
    if "adidas" in variants:
        brand_slug, brand_label = "adidas", "Adidas"
    elif "nike" in variants:
        brand_slug, brand_label = "nike", "Nike"
    elif "new balance" in variants or "newbalance" in variants:
        brand_slug, brand_label = "newbalance", "New Balance"
    elif "asics" in variants:
        brand_slug, brand_label = "asics", "ASICS"
    elif "vans" in variants:
        brand_slug, brand_label = "vans", "Vans"
    elif "converse" in variants:
        brand_slug, brand_label = "converse", "Converse"
    else:
        return None

    model = s
    if brand_slug == "newbalance":
        model = re.sub(r"(?i)\bnew\s*balance\b", "", model).strip()
    else:
        model = re.sub(rf"(?i)\b{re.escape(brand_label)}\b", "", model).strip()
        model = re.sub(rf"(?i)\b{re.escape(brand_slug)}\b", "", model).strip()

    model = re.sub(r"\s+", " ", model).strip(" -–—_.,()\"'")
    if not model:
        return None

    return {
        "category": "sneakers",
        "brandSlug": brand_slug,
        "brandLabel": brand_label,
        "modelSlug": _slug_dash(model),
        "modelLabel": model,
    }


def _slug_to_human_name(slug: str) -> str:
    s = _clean_display_name(slug or "")
    s = s.replace("-", " ").replace("_", " ")
    s = re.sub(r"\s+", " ", s).strip()
    words = s.split()
    if not words:
        return "Sem nome"
    stopwords = {
        "de", "do", "da", "dos", "das", "e", "ou", "para", "com", "sem", "em",
        "no", "na", "nos", "nas", "por", "a", "o", "as", "os", "um", "uma",
        "uns", "umas",
    }
    result = []
    for w in words:
        low = w.lower()
        if low in stopwords and result:
            result.append(low)
        else:
            result.append(w.capitalize())
    return " ".join(result)


def _list_images(folder: Path) -> list[str]:
    exts = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
    files = []
    for f in sorted(folder.iterdir()):
        if f.is_file() and f.suffix.lower() in exts:
            files.append(f)
    return files


def load_existing_manifest() -> dict[str, dict[str, Any]]:
    if not MANIFEST_PATH.exists():
        return {}
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    products = data.get("products", []) if isinstance(data, dict) else []
    by_slug: dict[str, dict[str, Any]] = {}
    for p in products:
        if isinstance(p, dict):
            slug = str(p.get("slug", "")).strip().lower()
            if slug:
                by_slug[slug] = p
    return by_slug


def build_new_product(slug: str, folder: Path) -> dict[str, Any]:
    existing_images = _list_images(folder)
    images_rel = [
        str(Path("imagens") / "telegram" / folder.name / f.name).replace("\\", "/")
        for f in existing_images
    ]
    if not images_rel:
        return None

    name = _slug_to_human_name(slug)
    latest_ts = int(max((f.stat().st_mtime for f in existing_images), default=time.time()))
    sneaker = _infer_sneaker_fields(name)

    product: dict[str, Any] = {
        "slug": slug.lower(),
        "name": name,
        "images": images_rel,
        "latestTs": latest_ts,
        "hasBuyLink": False,
    }
    if sneaker:
        product.update(sneaker)
    else:
        product["category"] = _infer_category(name)
    return product


def sync_manifest(dry_run: bool = False) -> dict[str, Any]:
    existing_by_slug = load_existing_manifest()
    print(f"Produtos existentes no manifest: {len(existing_by_slug)}")

    # Build fallback lookups by cleaned variants (accent-insensitive, mojibake-fixed)
    existing_by_clean = {}
    for slug_key, prod in existing_by_slug.items():
        variants = {
            slug_key,
            _sanitize_slug_strong(slug_key),
            _strip_accents(_clean_display_name(slug_key)).lower().replace("-", "_"),
        }
        for v in variants:
            if v and v not in existing_by_clean:
                existing_by_clean[v] = prod

    folders = [d for d in IMG_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")]
    print(f"Pastas encontradas: {len(folders)}")

    new_products: list[dict[str, Any]] = []
    added = 0
    updated = 0
    unchanged = 0
    missing_images = 0
    used_slugs = set()

    def _unique(desired: str) -> str:
        if desired not in used_slugs:
            used_slugs.add(desired)
            return desired
        i = 2
        while True:
            candidate = f"{desired}_{i}"
            if candidate not in used_slugs:
                used_slugs.add(candidate)
                return candidate
            i += 1

    for folder in sorted(folders, key=lambda d: d.name.lower()):
        raw_slug = folder.name.strip()
        clean_slug = _sanitize_slug_strong(raw_slug)

        images = _list_images(folder)
        if not images:
            missing_images += 1
            continue

        images_rel = [
            str(Path("imagens") / "telegram" / folder.name / f.name).replace("\\", "/")
            for f in images
        ]

        # Lookup existing product by multiple variants
        existing = None
        for lookup_key in (
            raw_slug.lower(),
            clean_slug,
            _strip_accents(_clean_display_name(raw_slug)).lower().replace("-", "_"),
        ):
            if lookup_key in existing_by_slug:
                existing = existing_by_slug[lookup_key]
                break
            if lookup_key in existing_by_clean:
                existing = existing_by_clean[lookup_key]
                break

        if existing is not None:
            final_slug = _unique(existing.get("slug") or clean_slug)
            old_changed = False
            if str(existing.get("slug", "")) != final_slug:
                existing["slug"] = final_slug
                old_changed = True
            old_name = str(existing.get("name", ""))
            clean_name = _clean_display_name(old_name) or _slug_to_human_name(clean_slug)
            if clean_name and clean_name != old_name:
                existing["name"] = clean_name
                old_changed = True
            old_images = list(existing.get("images", []))
            if sorted(old_images) != sorted(images_rel):
                existing["images"] = images_rel
                old_changed = True
            # Also sanitize sneaker slugs/labels for consistency
            for field in ("brandSlug", "modelSlug"):
                if field in existing and isinstance(existing[field], str):
                    orig = existing[field]
                    sanitized = _slug_dash(orig) if field.endswith("Slug") else _sanitize_slug_strong(orig)
                    if sanitized != orig:
                        existing[field] = sanitized
                        old_changed = True
            for field in ("brandLabel", "modelLabel", "category"):
                if field in existing and isinstance(existing[field], str):
                    orig = existing[field]
                    cleaned = _clean_display_name(orig)
                    if cleaned and cleaned != orig:
                        existing[field] = cleaned
                        old_changed = True
            if old_changed:
                updated += 1
            else:
                unchanged += 1
            new_products.append(existing)
        else:
            final_slug = _unique(clean_slug)
            name = _slug_to_human_name(clean_slug)
            product = {
                "slug": final_slug,
                "name": name,
                "images": images_rel,
                "latestTs": int(max((f.stat().st_mtime for f in images), default=time.time())),
                "hasBuyLink": False,
            }
            sneaker = _infer_sneaker_fields(name)
            if sneaker:
                product.update(sneaker)
            else:
                product["category"] = _infer_category(name)
            new_products.append(product)
            added += 1

    new_products.sort(key=lambda p: int(p.get("latestTs", 0)), reverse=True)

    result = {"products": new_products}

    print()
    print(f"Resultado: {len(new_products)} produtos no total")
    print(f"  - Adicionados: {added}")
    print(f"  - Atualizados (imagens/slugs): {updated}")
    print(f"  - Sem alterações: {unchanged}")
    print(f"  - Pastas sem imagens (ignoradas): {missing_images}")

    if not dry_run:
        MANIFEST_PATH.write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print()
        print(f"Manifest salvo em: {MANIFEST_PATH}")
    else:
        print()
        print("(Dry-run: nada foi salvo)")

    return result


def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="Sincroniza telegram_manifest.json com todas as pastas de imagens existentes."
    )
    parser.add_argument("--dry-run", action="store_true", help="Mostra o que seria feito sem alterar arquivos.")
    args = parser.parse_args()
    sync_manifest(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
