import json
import re
import unicodedata
import shutil
import sys
from pathlib import Path
from typing import Optional

PROJECT = Path(__file__).resolve().parent
IMG_DIR = PROJECT / "imagens" / "telegram"
MANIFEST_PATH = PROJECT / "imagens" / "telegram_manifest.json"
INDEX_PATH = PROJECT / "index.html"

MOJIBAKE_MAP = {
    "ß": "a",
    "à": "a",
    "á": "a",
    "â": "a",
    "ã": "a",
    "ä": "a",
    "å": "a",
    "æ": "ae",
    "þ": "c",
    "ç": "c",
    "þ": "c",
    "ð": "d",
    "è": "e",
    "é": "e",
    "ê": "e",
    "ë": "e",
    "ì": "i",
    "í": "i",
    "î": "i",
    "ï": "i",
    "±": "n",
    "ñ": "n",
    "ò": "o",
    "ó": "o",
    "ô": "o",
    "õ": "o",
    "ö": "o",
    "ø": "o",
    "¾": "o",
    "·": "u",
    "ù": "u",
    "ú": "u",
    "û": "u",
    "ü": "u",
    "Ú": "e",
    "Ý": "i",
    "ý": "y",
    "ÿ": "y",
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
    out = []
    for ch in nfkd:
        if unicodedata.category(ch) != "Mn":
            out.append(ch)
    return "".join(out)


def _sanitize_slug(text: str) -> str:
    s = _deep_fix_mojibake(text or "")
    s = _strip_accents(s)
    s = s.lower()
    s = re.sub(r"[^a-z0-9_\-]+", "_", s)
    s = re.sub(r"_+", "_", s)
    s = re.sub(r"[-_]+[-_]", "_", s)
    s = s.strip(" _-")
    s = s or "produto-sem-nome"
    return s[:120]


def _clean_name(text: str) -> str:
    s = _deep_fix_mojibake(text or "")
    s = s.replace("\u00a0", " ").replace("\r", " ").replace("\n", " ")
    s = re.sub(r"\s+", " ", s)
    s = s.strip()
    return s


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        return {"products": []}
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_manifest(data: dict) -> None:
    MANIFEST_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def make_unique_slug(desired: str, used: set) -> str:
    if desired not in used:
        used.add(desired)
        return desired
    i = 2
    while True:
        candidate = f"{desired}_{i}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        i += 1


def rename_folders_and_fix_manifest(dry_run: bool = False) -> None:
    data = load_manifest()
    products = list(data.get("products", []) or [])
    print(f"Produtos no manifest inicial: {len(products)}")

    folder_renames: list[tuple[Path, Path]] = []
    seen_slugs = set()
    fixed_folder_count = 0
    products_by_old_slug: dict[str, list[int]] = {}

    for idx, p in enumerate(products):
        old_slug = str(p.get("slug", "")).strip()
        old_key = old_slug.lower()
        products_by_old_slug.setdefault(old_key, []).append(idx)

    # First pass: discover folders that need renaming
    for folder in sorted(IMG_DIR.iterdir()):
        if not folder.is_dir() or folder.name.startswith("."):
            continue
        old_name = folder.name
        new_name = _sanitize_slug(old_name)
        if new_name != old_name:
            target = IMG_DIR / new_name
            dedup_suffix = 2
            while target.exists():
                target = IMG_DIR / f"{new_name}_{dedup_suffix}"
                dedup_suffix += 1
            folder_renames.append((folder, target))
            fixed_folder_count += 1
        else:
            seen_slugs.add(new_name)

    # Actually rename folders (if not dry)
    if dry_run:
        print(f"\nPastas a renomear: {len(folder_renames)}")
        for src, dst in folder_renames[:20]:
            print(f"  {src.name}  ->  {dst.name}")
        if len(folder_renames) > 20:
            print(f"  ... e mais {len(folder_renames) - 20}")
    else:
        print(f"\nA renomear {len(folder_renames)} pastas...")
        for src, dst in folder_renames:
            try:
                shutil.move(str(src), str(dst))
            except Exception as e:
                print(f"  ERRO ao renomear {src.name}: {e}")

    # Build a map from old folder name -> current folder name (after renames)
    folder_current_name = {}
    for src, dst in folder_renames:
        folder_current_name[src.name.lower()] = dst.name

    def _current_folder_image_paths(old_folder_name: str):
        key_lower = old_folder_name.lower()
        current = folder_current_name.get(key_lower, old_folder_name)
        folder = IMG_DIR / current
        if not folder.is_dir():
            return []
        exts = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
        files = sorted(
            [f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in exts],
            key=lambda f: f.name.lower(),
        )
        return [
            str(Path("imagens") / "telegram" / current / f.name).replace("\\", "/")
            for f in files
        ]

    # Now fix manifest products
    used_slugs = set()
    manifest_fixed_count = 0
    manifest_slug_changed = 0

    for p in products:
        old_slug_raw = str(p.get("slug", "")).strip()
        old_slug_key = old_slug_raw.lower()

        new_slug = _sanitize_slug(old_slug_raw)
        new_slug = make_unique_slug(new_slug, used_slugs)

        old_name = str(p.get("name", ""))
        new_name = _clean_name(old_name)

        # Update image paths (point to the renamed folder, and refresh list)
        new_images = _current_folder_image_paths(old_slug_raw)
        if not new_images:
            new_images = list(p.get("images", []) or [])
            # Also try fixing folder references inside each path
            fixed_paths = []
            for im in new_images:
                parts = im.replace("\\", "/").split("/")
                if len(parts) >= 3 and parts[0].lower() == "imagens" and parts[1].lower() == "telegram":
                    old_folder_in_path = parts[2]
                    new_folder_in_path = folder_current_name.get(
                        old_folder_in_path.lower(), old_folder_in_path
                    )
                    parts[2] = new_folder_in_path
                    fixed_paths.append("/".join(parts))
                else:
                    fixed_paths.append(im)
            new_images = fixed_paths

        changed_any = False
        if new_slug != old_slug_raw:
            p["slug"] = new_slug
            manifest_slug_changed += 1
            changed_any = True
        if new_name and new_name != old_name:
            p["name"] = new_name
            changed_any = True
        if list(new_images) != list(p.get("images", [])):
            p["images"] = new_images
            changed_any = True

        # Also fix sneaker fields and category strings
        for field in ("brandLabel", "modelLabel", "category", "brandSlug", "modelSlug"):
            if field in p and isinstance(p[field], str):
                orig = p[field]
                if field.endswith("Slug"):
                    cleaned = _sanitize_slug(orig)
                else:
                    cleaned = _clean_name(orig)
                if cleaned != orig:
                    p[field] = cleaned
                    changed_any = True

        if changed_any:
            manifest_fixed_count += 1

    print(f"\nManifest: slugs alterados: {manifest_slug_changed}")
    print(f"Manifest: produtos com alguma correção: {manifest_fixed_count}")

    if not dry_run:
        save_manifest({"products": products})
        print(f"Manifest gravado: {MANIFEST_PATH}")

    # Find spotlight/news references in index.html and suggest/update them
    print("\n--- Verificando SPOTLIGHT_SLUGS / NEWS_SLUGS no index.html ---")
    if INDEX_PATH.exists():
        html = INDEX_PATH.read_text(encoding="utf-8")
        for array_name in ("SPOTLIGHT_SLUGS", "NEWS_SLUGS"):
            m = re.search(rf"const\s+{array_name}\s*=\s*(\[[\s\S]*?\]);", html)
            if not m:
                print(f"{array_name}: não encontrado")
                continue
            raw_body = m.group(1)
            strs = re.findall(r'"([^"\\]*(?:\\.[^"\\]*)*)"|\'([^\'\\]*(?:\\.[^\'\\]*)*)\'', raw_body)
            slugs = []
            for dq, sq in strs:
                slugs.append(dq if dq else sq)
            if not slugs:
                print(f"{array_name}: sem slugs")
                continue

            current_slug_set = {str(p.get("slug", "")).lower() for p in products}
            missing = []
            replacements = {}
            for s in slugs:
                clean_expected = _sanitize_slug(s)
                found_key = None
                if s.lower() in current_slug_set:
                    found_key = s.lower()
                elif clean_expected in current_slug_set:
                    found_key = clean_expected
                else:
                    norm_s = _strip_accents(s.lower())
                    for cs in current_slug_set:
                        if _strip_accents(cs) == norm_s:
                            found_key = cs
                            break
                if found_key:
                    actual_slug = next(
                        (p["slug"] for p in products if p["slug"].lower() == found_key), None
                    )
                    if actual_slug and actual_slug != s:
                        replacements[s] = actual_slug
                else:
                    missing.append(s)

            if replacements:
                print(f"\n{array_name}: SLUGS QUE NÃO COINCIDEM (a corrigir):")
                for old, new in replacements.items():
                    print(f"  {old}  ->  {new}")
            if missing:
                print(f"\n{array_name}: SLUGS EM FALTA no manifest:")
                for s in missing:
                    print(f"  {s}")
            if not replacements and not missing:
                print(f"{array_name}: OK (todos encontrados)")

            if not dry_run and (replacements or missing):
                new_slugs_ordered = [replacements.get(s, s) for s in slugs]
                new_body_lines = ["["]
                for s in new_slugs_ordered:
                    escaped = s.replace("\\", "\\\\").replace('"', '\\"')
                    new_body_lines.append(f'      "{escaped}",')
                new_body_lines.append("    ]")
                new_full = f"const {array_name} = " + "\n".join(new_body_lines) + ";"
                html = html.replace(m.group(0), new_full)

        if not dry_run:
            INDEX_PATH.write_text(html, encoding="utf-8")
            print("\nindex.html atualizado com slugs corrigidos.")


def main():
    dry = "--dry-run" in sys.argv
    rename_folders_and_fix_manifest(dry_run=dry)


if __name__ == "__main__":
    main()
