import json
import re
import sys
from pathlib import Path

EXPORT = Path(r"C:\Users\James Stuart\Downloads\Telegram Desktop\ChatExport_2026-08-27\result.json")
PROJECT = Path(r"c:\SmartThings")
MANIFEST = PROJECT / "imagens" / "telegram_manifest.json"

def pr(s):
    sys.stdout.buffer.write((s + "\n").encode("utf-8", errors="replace"))

with open(EXPORT, "r", encoding="utf-8") as f:
    data = json.load(f)
msgs = data.get("messages", [])
pr(f"Total de mensagens na exportacao: {len(msgs)}")

valid_msgs = [m for m in msgs if m.get("photo") or (m.get("text") and str(m["text"]).strip())]
pr(f"Mensagens com foto ou texto: {len(valid_msgs)}")

with_photo = [m for m in msgs if m.get("photo")]
pr(f"Mensagens com FOTO: {len(with_photo)}")

# Reconstruir texto das mensagens
def get_text(m):
    t = m.get("text", "")
    if isinstance(t, str):
        return t
    if isinstance(t, list):
        parts = []
        for part in t:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                parts.append(str(part.get("text", "")))
        return "".join(parts)
    return ""

with_link = 0
nike_msgs = 0
nike_msgs_with_photo = 0
produto_re = re.compile(r"^(.+?)\s*(?:—->|->|[-–=]{1,3}>)\s*(.+)$", re.MULTILINE)
nomes_nike = []
for m in msgs:
    txt = get_text(m)
    if re.search(r"https?://", txt):
        with_link += 1
    low = txt.lower()
    if "nike" in low:
        nike_msgs += 1
        if m.get("photo"):
            nike_msgs_with_photo += 1
        # extrair nome se parecer produto
        match = produto_re.search(txt.replace("\n", " "))
        if match:
            nome = match.group(1).strip(" -\n\t").strip()
        else:
            # pegar nas primeiras 80 chars nao-link
            parts = re.split(r"https?://\S+", txt, maxsplit=1)
            nome = parts[0].strip()[:120]
        nomes_nike.append(nome)

pr(f"Mensagens com LINK de compra: {with_link}")
pr(f"Mensagens que mencionam NIKE: {nike_msgs} (com foto: {nike_msgs_with_photo})")
pr("Amostra de nomes encontrados para Nike:")
for n in nomes_nike[:25]:
    pr("  - " + n)

# Agora comparar com manifest
pr("\n--- MANIFEST ATUAL ---")
with open(MANIFEST, "r", encoding="utf-8") as f:
    manifest = json.load(f)
products = manifest["products"]
nike_manifest_sneakers = [p for p in products if str(p.get("brandSlug", "")).lower() == "nike"]
nike_manifest_any = [p for p in products if ("nike" in _s.lower() if (_s := str(p.get("name", ""))) else False) or ("nike" in str(p.get("slug", "")).lower())]
pr(f"Produtos no manifest com brandSlug='nike': {len(nike_manifest_sneakers)}")
pr(f"Produtos no manifest com 'nike' em QUALQUER lugar (nome/slug): {len(nike_manifest_any)}")

# Distribuicao de categorias
from collections import Counter
cats = Counter(str(p.get("category", "?")) for p in products)
brands = Counter(str(p.get("brandSlug", "?")) for p in products if str(p.get("brandSlug", "?")) != "None" and str(p.get("brandSlug", "?")) != "?")
pr("\nTop categorias:")
for k, v in cats.most_common(10):
    pr(f"  {k}: {v}")
pr("\nMarcas (brandSlug) encontradas:")
for k, v in brands.most_common():
    pr(f"  {k}: {v}")

# Distribuicao de quantos produtos Nike sao sneakers vs outros
from collections import defaultdict
nike_by_cat = Counter(str(p.get("category", "?")) for p in nike_manifest_any)
pr("\nNike por categoria no manifest:")
for k, v in nike_by_cat.most_common():
    pr(f"  {k}: {v}")
