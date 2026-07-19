import argparse
import asyncio
import csv
import getpass
import json
import re
import time
from pathlib import Path
from typing import Any

try:
    from telethon import TelegramClient
    from telethon.errors import (
        AuthRestartError,
        PasswordHashInvalidError,
        PhoneCodeInvalidError,
        SessionPasswordNeededError,
    )
except ImportError:  # pragma: no cover - runtime dependency
    TelegramClient = None
    AuthRestartError = None
    PasswordHashInvalidError = None
    PhoneCodeInvalidError = None
    SessionPasswordNeededError = None


PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_MANIFEST = PROJECT_ROOT / "imagens" / "telegram_manifest.json"
DEFAULT_CONFIG = PROJECT_ROOT / "telegram_publish_config.json"
DEFAULT_PRICES = PROJECT_ROOT / "telegram_prices.csv"
DEFAULT_LOCAL_DIR = PROJECT_ROOT / "_local"
DEFAULT_SESSION = DEFAULT_LOCAL_DIR / "telegram_publisher"
DEFAULT_STATE = DEFAULT_LOCAL_DIR / "telegram_publish_state.json"

PRICE_IN_NAME_RE = re.compile(
    r"(?:(?:—->|->|—>|=>)\s*)?(?:€\s*\d+[\.,]?\d*|\d+[\.,]?\d*\s*€|\d+[\.,]?\d*\s*(?:eur|euro|euros))",
    re.IGNORECASE,
)


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"Configuracao invalida em {path}")
    return data


def load_manifest(path: Path) -> list[dict[str, Any]]:
    data = load_json(path)
    products = data.get("products")
    if not isinstance(products, list):
        raise ValueError(f"Manifest invalido em {path}: 'products' nao e lista")
    cleaned: list[dict[str, Any]] = []
    for item in products:
        if not isinstance(item, dict):
            continue
        slug = str(item.get("slug") or "").strip()
        name = str(item.get("name") or "").strip()
        images = item.get("images")
        if not slug or not name or not isinstance(images, list):
            continue
        cleaned.append(item)
    return cleaned


def write_price_template(manifest: list[dict[str, Any]], path: Path, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError(f"O ficheiro ja existe: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["slug", "name", "price", "name_override", "caption_extra", "active"],
        )
        writer.writeheader()
        for product in manifest:
            writer.writerow(
                {
                    "slug": str(product.get("slug") or ""),
                    "name": str(product.get("name") or ""),
                    "price": "",
                    "name_override": "",
                    "caption_extra": "",
                    "active": "1",
                }
            )


def load_prices(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(
            f"Nao encontrei a tabela de precos: {path}. Use --init-prices para gerar."
        )
    with path.open("r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows: dict[str, dict[str, str]] = {}
        for raw in reader:
            if not isinstance(raw, dict):
                continue
            slug = str(raw.get("slug") or "").strip()
            if not slug:
                continue
            rows[slug] = {
                "price": str(raw.get("price") or "").strip(),
                "name_override": str(raw.get("name_override") or "").strip(),
                "caption_extra": str(raw.get("caption_extra") or "").strip(),
                "active": str(raw.get("active") or "1").strip(),
            }
    return rows


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"published_slugs": []}
    data = load_json(path)
    published = data.get("published_slugs")
    if not isinstance(published, list):
        published = []
    return {"published_slugs": [str(x) for x in published if str(x).strip()]}


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def is_active(row: dict[str, str]) -> bool:
    flag = row.get("active", "1").strip().lower()
    return flag not in {"0", "false", "no", "off"}


def chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def clean_publish_name(text: str) -> str:
    name = str(text or "").strip()
    if not name:
        return ""
    name = PRICE_IN_NAME_RE.sub("", name)
    name = re.sub(r"\s+", " ", name).strip(" -–—")
    return name


def build_caption(
    product: dict[str, Any],
    price_row: dict[str, str],
    config: dict[str, Any],
) -> str:
    raw_name = price_row.get("name_override") or str(product.get("name") or "").strip()
    name = clean_publish_name(raw_name)
    price = price_row.get("price", "").strip() or str(config.get("default_price_text") or "").strip()
    if not price:
        raise ValueError(f"Produto sem preco: {product.get('slug')}")

    lines = [name, f"{str(config.get('price_label') or 'Valor').strip()}: {price}"]

    extra = price_row.get("caption_extra", "").strip()
    if extra:
        lines.append(extra)

    footer_lines = config.get("footer_lines") or []
    if isinstance(footer_lines, list):
        lines.extend(str(line).strip() for line in footer_lines if str(line).strip())

    return "\n".join(lines).strip()


def resolve_product_images(product: dict[str, Any]) -> list[str]:
    images = product.get("images")
    if not isinstance(images, list):
        return []
    resolved: list[str] = []
    for rel in images:
        path = (PROJECT_ROOT / str(rel)).resolve()
        if path.exists():
            resolved.append(str(path))
    return resolved


def select_products(
    manifest: list[dict[str, Any]],
    prices: dict[str, dict[str, str]],
    published_slugs: set[str],
    limit: int,
    only_slugs: set[str],
    include_published: bool,
    newest_first: bool,
    default_price_text: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    ordered = sorted(
        manifest,
        key=lambda item: int(item.get("latestTs") or 0),
        reverse=newest_first,
    )
    selected: list[dict[str, Any]] = []
    skipped_missing_price: list[str] = []

    for product in ordered:
        slug = str(product.get("slug") or "").strip()
        if not slug:
            continue
        if only_slugs and slug not in only_slugs:
            continue
        if not include_published and slug in published_slugs:
            continue
        row = prices.get(slug, {})
        if row and not is_active(row):
            continue
        price_text = (row.get("price") or "").strip() if row else ""
        if not price_text and not default_price_text.strip():
            skipped_missing_price.append(slug)
            continue
        if not resolve_product_images(product):
            continue
        selected.append(product)
        if limit > 0 and len(selected) >= limit:
            break

    return selected, skipped_missing_price


async def ensure_login(client: Any, phone: str) -> None:
    if await client.is_user_authorized():
        return

    for attempt in range(3):
        try:
            await client.send_code_request(phone)
            break
        except AuthRestartError:
            if attempt == 2:
                raise
            print("Telegram pediu reinicio da autenticacao. A tentar novamente...")
    else:
        raise RuntimeError("Nao foi possivel iniciar a autenticacao no Telegram.")

    for attempt in range(3):
        code = input("Codigo recebido no Telegram: ").strip()
        try:
            await client.sign_in(phone=phone, code=code)
            return
        except PhoneCodeInvalidError:
            if attempt == 2:
                raise
            print("Codigo invalido. Tenta novamente.")
        except SessionPasswordNeededError:
            for pwd_attempt in range(3):
                password = getpass.getpass("Password 2FA: ").strip()
                try:
                    await client.sign_in(password=password)
                    return
                except PasswordHashInvalidError:
                    if pwd_attempt == 2:
                        raise
                    print("Password invalida. Tenta novamente.")


async def publish_products(
    products: list[dict[str, Any]],
    prices: dict[str, dict[str, str]],
    config: dict[str, Any],
    state_path: Path,
    dry_run: bool,
) -> None:
    state = load_state(state_path)
    published_slugs = set(str(x) for x in state.get("published_slugs", []))

    if dry_run:
        for index, product in enumerate(products, start=1):
            slug = str(product.get("slug") or "").strip()
            row = prices.get(slug, {})
            caption = build_caption(product, row, config)
            image_paths = resolve_product_images(product)
            if not image_paths:
                print(f"[skip] {slug}: sem imagens validas")
                continue
            print(f"[{index}/{len(products)}] {slug} -> {len(image_paths)} imagem(ns)")
            print(caption)
        return

    if TelegramClient is None:
        raise ImportError(
            "Falta a biblioteca 'telethon'. Instale com: python -m pip install telethon"
        )

    api_id = config.get("api_id")
    api_hash = str(config.get("api_hash") or "").strip()
    phone = str(config.get("phone") or "").strip()
    channel = str(config.get("channel") or "").strip()
    if not api_id or not api_hash or not phone or not channel:
        raise ValueError("Configuracao incompleta: api_id, api_hash, phone e channel sao obrigatorios")

    session_path = Path(str(config.get("session_file") or DEFAULT_SESSION))
    if not session_path.is_absolute():
        session_path = (PROJECT_ROOT / session_path).resolve()
    session_path.parent.mkdir(parents=True, exist_ok=True)

    client = TelegramClient(str(session_path), int(api_id), api_hash)
    async with client:
        await ensure_login(client, phone)
        entity = await client.get_entity(channel)
        max_media = int(config.get("max_media_per_post") or 10)
        delay_seconds = float(config.get("delay_seconds") or 1.0)

        for index, product in enumerate(products, start=1):
            slug = str(product.get("slug") or "").strip()
            row = prices.get(slug, {})
            caption = build_caption(product, row, config)
            image_paths = resolve_product_images(product)
            if not image_paths:
                print(f"[skip] {slug}: sem imagens validas")
                continue

            print(f"[{index}/{len(products)}] {slug} -> {len(image_paths)} imagem(ns)")
            batches = chunked(image_paths, max(1, min(max_media, 10)))
            for batch_idx, batch in enumerate(batches):
                await client.send_file(
                    entity,
                    batch if len(batch) > 1 else batch[0],
                    caption=caption if batch_idx == 0 else "",
                    force_document=False,
                )
                if delay_seconds > 0:
                    await asyncio.sleep(delay_seconds)

            if slug not in published_slugs:
                published_slugs.add(slug)
                state["published_slugs"] = sorted(published_slugs)
                save_state(state_path, state)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Publica produtos do manifest do site no Telegram sem link explicito."
    )
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST), help="Manifest JSON a publicar.")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="Ficheiro JSON com credenciais/configuracao.")
    parser.add_argument("--prices-csv", default=str(DEFAULT_PRICES), help="Tabela manual de precos.")
    parser.add_argument("--state", default=str(DEFAULT_STATE), help="Estado local de slugs ja publicados.")
    parser.add_argument("--limit", type=int, default=0, help="Limite de produtos a publicar. 0 = sem limite.")
    parser.add_argument(
        "--only-slugs",
        default="",
        help="Lista separada por virgulas para publicar apenas certos slugs.",
    )
    parser.add_argument(
        "--publish-order",
        choices=["oldest_first", "newest_first"],
        default="oldest_first",
        help="Ordem de envio. 'oldest_first' deixa os mais novos no topo do canal no final.",
    )
    parser.add_argument("--republish", action="store_true", help="Ignora o ficheiro de estado e volta a publicar.")
    parser.add_argument("--dry-run", action="store_true", help="Nao envia nada; apenas mostra o que seria publicado.")
    parser.add_argument("--init-prices", action="store_true", help="Gera uma tabela CSV base a partir do manifest.")
    parser.add_argument("--force", action="store_true", help="Permite sobrescrever a tabela de precos no --init-prices.")
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    config_path = Path(args.config)
    prices_path = Path(args.prices_csv)
    state_path = Path(args.state)

    if not manifest_path.is_absolute():
        manifest_path = (PROJECT_ROOT / manifest_path).resolve()
    if not config_path.is_absolute():
        config_path = (PROJECT_ROOT / config_path).resolve()
    if not prices_path.is_absolute():
        prices_path = (PROJECT_ROOT / prices_path).resolve()
    if not state_path.is_absolute():
        state_path = (PROJECT_ROOT / state_path).resolve()

    manifest = load_manifest(manifest_path)

    if args.init_prices:
        write_price_template(manifest, prices_path, force=args.force)
        print(f"Tabela de precos criada em: {prices_path}")
        return 0

    config = load_json(config_path)
    prices = load_prices(prices_path)

    published_slugs: set[str] = set()
    if not args.republish:
        published_slugs = set(load_state(state_path).get("published_slugs", []))

    only_slugs = {s.strip() for s in args.only_slugs.split(",") if s.strip()}
    newest_first = args.publish_order == "newest_first"
    default_price_text = str(config.get("default_price_text") or "").strip()
    selected, missing_price = select_products(
        manifest=manifest,
        prices=prices,
        published_slugs=published_slugs,
        limit=max(0, int(args.limit)),
        only_slugs=only_slugs,
        include_published=args.republish,
        newest_first=newest_first,
        default_price_text=default_price_text,
    )

    print(f"Manifest: {manifest_path}")
    print(f"Produtos no manifest: {len(manifest)}")
    print(f"Produtos selecionados: {len(selected)}")
    print(f"Produtos sem preco: {len(missing_price)}")
    if missing_price:
        preview = ", ".join(missing_price[:20])
        suffix = " ..." if len(missing_price) > 20 else ""
        print(f"Sem preco: {preview}{suffix}")

    if not selected:
        print("Nada para publicar.")
        return 0

    started = time.time()
    asyncio.run(
        publish_products(
            products=selected,
            prices=prices,
            config=config,
            state_path=state_path,
            dry_run=args.dry_run,
        )
    )
    elapsed = time.time() - started
    print(f"Concluido em {elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
