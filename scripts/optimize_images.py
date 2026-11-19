from __future__ import annotations

import json
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:
    raise SystemExit(
        "Pillow não está instalado. Instala com: python -m pip install Pillow"
    ) from exc


ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "imagens" / "telegram_manifest.json"


def load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def optimize_image(image_path: Path) -> bool:
    target = image_path.with_suffix(".webp")
    if target.exists():
        return False

    with Image.open(image_path) as image:
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGB")
        image.save(target, "WEBP", quality=82, method=6)
    return True


def main() -> None:
    manifest = load_manifest()
    created = 0
    skipped = 0

    for product in manifest.get("products", []):
        for relative in product.get("images", []):
            image_path = ROOT / relative
            if not image_path.exists():
                continue
            if image_path.suffix.lower() == ".webp":
                skipped += 1
                continue
            if optimize_image(image_path):
                created += 1
            else:
                skipped += 1

    print(f"WebP criados: {created}")
    print(f"Imagens já existentes ou ignoradas: {skipped}")


if __name__ == "__main__":
    main()
