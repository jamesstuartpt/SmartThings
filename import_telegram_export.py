"""
import_telegram_export.py
=========================

Importa o ChatExport_2026-08-27 para o telegram_manifest.json.

MODOS:
  (sem flags)      = DRY-RUN: relatório completo, NENHUMA GRAVAÇÃO
  --apply          = Aplicar alterações (gravas manifest e cópias fotos)
  --limit N        = Apenas processar as primeiras N mensagens (testes)

FLUXO MATCH 3-CASCATA (por ordem):
  1. MATCH EXATO por slug normalizado
  2. MATCH SEMELHANTE por nome normalizado (tokens intersection >= 75%)
  3. MATCH por foto (nesta fase: N/A — apenas marcamos como "possível")

CLASSIFICAÇÕES FINAIS por mensagem:
  🟢 EXATO_COM_LINK_NOVO  → match slug exato + produto não tinha buyLink → atualiza
  🟢 EXATO_JA_TEM_LINK    → match slug exato + produto já tem buyLink igual → skip
  🟡 PROVAVEL             → match nome > 75% → validação manual
  🔴 NOVO                 → sem match nenhum → adicionar
  ⚪ IGNORADO             → sem foto OU sem buy-link na primeira linha
"""

import json
import re
import sys
import shutil
import hashlib
import argparse
import unicodedata
from pathlib import Path
from typing import Any, Optional

# ============================================================
# CONSTANTES
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent
IMG_DIR = PROJECT_ROOT / "imagens" / "telegram"
MANIFEST_PATH = PROJECT_ROOT / "imagens" / "telegram_manifest.json"

EXPORT_DIR = Path(r"C:\Users\James Stuart\Downloads\Telegram Desktop\ChatExport_2026-08-27")
EXPORT_JSON = EXPORT_DIR / "result.json"
EXPORT_PHOTOS = EXPORT_DIR / "photos"

URL_RE = re.compile(r"https?://[^\s<\">)）\]]+")
EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\u2600-\u27BF"
    "\U0001F100-\U0001F1FF"
    "]",
    flags=re.UNICODE,
)
MOJI_STRANGE_RE = re.compile(r"[\u0080-\u009F\u00AD\u200B-\u200D\uFEFF]")

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

# Mojibakes EXCLUSIVOS do ChatExport (codificação errada ao exportar HTML/UTF-8)
EXPORT_MOJI_FIXES = [
    ("\u00d4\u00c7\u00f6", "->"),   # ÔÇö  → seta
    ("\u00d4\u00c7\u00e2", "-"),
    ("\u00d4\u00c7\u201d", "->"),
    ("\u00d4\u00c7", "-"),
    ("\u00d4\u00e2\u0082\u00ac", "€"),  # Ôé¼ → €
    ("\u00c3\u2039", "e"),
    ("\u00c3\u00ae", "i"),
    ("\u00c2\u00ad", ""),
    ("\u00c6\u2019", "AE"),
    ("\u00e2\u201a\u00ac", "€"),
    ("\u201a\u00c4", ""),  # ƒÆ
    ("\u201a\u00c4\\u00ed", ""),
    ("\u201a\u00c4ì", ""),
    ("\u201a\u00c4ù", ""),
    ("\u201a\u00c4", ""),
    ("\u0192\u00c6", ""),
    ("\u0192\u00c4", ""),
    ("\u0192\u00e2", ""),
    ("\u0192Ô", ""),
    ("\u0178", "Y"),
    ("\u2019", "'"),
    ("\u201c", '"'),
    ("\u201d", '"'),
    ("\u2013", "-"),
    ("\u2014", "-"),
    ("\u00a0", " "),
    ("\u00bb", ">>"),
    ("\u00ab", "<<"),
]

LINE_NOISE_PREFIXES = [
    "varios colores",
    "varios colores",
    "tambien en",
    "tambem em",
    "fotos realizadas por mi",
    "fotos feitas por mim",
    "yep express",
    "yepexpress",
    "yep express",
    "envio",
    "entrega",
    "tamanhos",
    "disponivel",
    "disponible",
    "stock",
    "pack",
]


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
    s = EMOJI_RE.sub("", s)
    s = re.sub(r"[\U00010000-\U0010FFFF]", "", s)
    s = re.sub(r"[^a-z0-9_\-]+", "_", s)
    s = re.sub(r"_+", "_", s)
    s = s.strip(" _-")
    s = s or "produto-sem-nome"
    if len(s) > max_len:
        s = s[:max_len].rstrip("_-")
    return s


def _clean_display_name(text: str) -> str:
    s = text or ""
    for old, new in EXPORT_MOJI_FIXES:
        s = s.replace(old, new)
    s = _deep_fix_mojibake(s)
    s = s.replace("\r", "\n").replace("\u00a0", " ")
    s = EMOJI_RE.sub(" ", s)
    s = MOJI_STRANGE_RE.sub("", s)
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


# Tokens que são demasiado genéricos para contar como "modelo":
#   - Palavras comuns (polo, the, de, la, du, des, di, del, el, da, do, das, dos)
#   - "Muchos / muchisimos colores → cor (não é modelo)
#   - "Nuevo / Novedad / collection" → ruído
_GENERIC_STOPWORDS = {
    "polo","the","de","la","le","du","des","di","del","el","da","do","das","dos",
    "and","x","vs","para","por","com","con","sem","sin","em","en","in","on","no",
    "new","novo","nueva","nuevos","nuevas","novos","novidade","novedad",
    "collection","collezione","coleccion","colecao","capsule","pack","kit",
    "colores","colores","color","colors","cor","cores","colour","colours",
    "tambien","tambem","teneis","tenis","numeros","novedad","muchos","muchisimas","muchas",
    "todos","todas","disponivel","disponible","stock","envio","entrega",
    "express","rapido","rapida","urgente","normal",
    "original","originales","originais","premium","high","quality",
    "photos","fotos","foto","photo","real","reales","reais","hecho","feito",
    "mi","por","mim","minhas","minhas","maos","feito",
    # Marcas RUÍDO que aparecem junto de nomes mas nao contam como modelo por si só:
    "xx","00","ii","iii","iv","vi","vii","viii","ix","xi","xii","se","unisex",
    "homem","mulher","men","women","man","woman","kids","crianca","bebe",
    "tamanho","tamanhos","size","sizes","medidas","numero","numeracao",
    "preco","preco","promocao","promo","desconto","oferta",
}

# ============================================================
# TODAS as MARCAS CONHECIDAS (1 ou mais palavras)
# Usado para calcular NON_BRAND corretamente (mesmo qdo brand_token só captura 1 palavra).
# Ex.: cleaned = "AMI PARIS" → ambos tokens são marca; "tokens_all - ALL_KNOWN_BRAND_TOKENS
# dá vazio.
# ============================================================
ALL_KNOWN_BRAND_TOKENS = set()
_KNOWN_BRANDS_MULTIWORD = [
    "polo ralph lauren","new balance","the north face","dr martens",
    "marc jacobs","stone island","fear of god essentials fear_of_god essentials",
    "yohji yamamoto","bad bunny","wales bonner","ami paris","fred perry",
    "casa blanca","carolina herrera","maison margiela","gallery dept",
    "chrome hearts","cp company","on running","on cloud",
    "louis vuitton","gucci","versace","prada","dolce gabbana",
    "armani exchange","armani","valentino","hermes","chanel","dior","burberry",
    "fendi","balenciaga","lululemon athletica","lululemon",
    "palm angels",
]
for mb in _KNOWN_BRANDS_MULTIWORD:
    for t in mb.split():
        if len(t) >= 2:
            ALL_KNOWN_BRAND_TOKENS.add(t.lower())
# Adicionar marcas 1-palavra tbm:
for mb in ["nike","jordan","adidas","asics","puma","vans","converse","reebok",
    "ugg","moncler","canada goose","canada","supreme","hoka","under armour",
    "armour","onitsuka","asics","tiger","mexico","golden","goose","sabot",
    "essentials","humme","betis","apple","watch","serie","series","hummel",
    "equipo","equipaciones","equipaciones","futbol","equipos"]:
    ALL_KNOWN_BRAND_TOKENS.add(mb)

def _tokenize(text: str) -> set[str]:
    cleaned = _clean_display_name(_strip_accents(text or "")).lower()
    cleaned = re.sub(r"[^a-z0-9]+", " ", cleaned)
    tokens = {
        t for t in cleaned.split()
        if len(t) >= 2 and t not in _GENERIC_STOPWORDS
    }
    return tokens


# ============================================================
# PARSE TELEGRAM
# ============================================================

def flatten_text(msg_text) -> str:
    """text pode ser str OU list de partes; retorna str plana."""
    if isinstance(msg_text, str):
        return msg_text
    if isinstance(msg_text, list):
        flat = ""
        for part in msg_text:
            if isinstance(part, str):
                flat += part
            elif isinstance(part, dict):
                flat += str(part.get("text", ""))
        return flat
    return str(msg_text or "")


def parse_telegram_message(msg: dict) -> dict:
    """
    Dada 1 mensagem do ChatExport, extrai:
      { id, date, photos, buy_link, cleaned_name, brand_token, tokens,
        slug_candidate, price_raw }
    """
    msg_id = msg.get("id")
    date = msg.get("date")
    raw_photo = msg.get("photo")
    photos = []
    if raw_photo and isinstance(raw_photo, str):
        photos = [EXPORT_DIR / raw_photo.replace("\\", "/")]
    # Também pode haver múltiplas fotos em "photo" array? (verificar)
    if isinstance(msg.get("photo"), list):
        photos = [EXPORT_DIR / p.replace("\\", "/") for p in msg["photo"] if isinstance(p, str)]
    # Mensagens dentro de album: a primeira msg tem a foto + texto, as seguintes podem ter fotos apenas
    # Tentamos também buscar em msg.photo (list) se existir.
    if not photos and msg.get("type") == "message":
        # fallback: tentar ficheiro com id = photo_<id-num>@...
        pass

    raw_text = flatten_text(msg.get("text"))
    text = _clean_display_name(raw_text)
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]

    buy_link: Optional[str] = None
    name_lines: list[str] = []
    price_raw: Optional[str] = None

    for idx, ln in enumerate(lines):
        urls = URL_RE.findall(ln)
        if urls and not buy_link and idx == 0:
            buy_link = urls[0]
            rest = ln.replace(buy_link, "").strip(" -—:|·•")
            if rest:
                name_lines.append(rest)
            continue
        if urls and buy_link:
            # +2 URL no meio de texto: ignorar (só o 1º é buy-link)
            ln_clean = re.sub(URL_RE, "", ln).strip()
            if ln_clean:
                name_lines.append(ln_clean)
            continue
        name_lines.append(ln)

    # Filtrar linhas ruído (extrair preço e limpar ruído)
    final_lines: list[str] = []
    price_pattern = re.compile(r"([0-9]+)\s*[€eEuros$]", re.IGNORECASE)
    arrow_pattern = re.compile(r"\s*[\-\u2013\u2014>\u2192]+\s*")
    for ln in name_lines:
        ln2 = arrow_pattern.sub(" ", ln).strip()
        m_price = price_pattern.search(ln2)
        if m_price and price_raw is None:
            price_raw = f"{m_price.group(1)}€"
            ln2 = price_pattern.sub("", ln2)
        lower_ln = _strip_accents(ln2.lower())
        if any(lower_ln.startswith(pref) for pref in LINE_NOISE_PREFIXES):
            continue
        if not lower_ln:
            continue
        # Limpar parentesis finais tipo (YepExpress)
        ln2 = re.sub(r"\([^)]*[Ee]xpress[^)]*\)", "", ln2).strip()
        ln2 = re.sub(r"\([^)]*[Ff]otos[^)]*\)", "", ln2).strip()
        ln2 = re.sub(r"\([^)]*\)", "", ln2).strip()
        if ln2:
            final_lines.append(ln2)

    cleaned_name = " / ".join([ln for ln in final_lines if ln])
    cleaned_name = re.sub(r"\s+", " ", cleaned_name).strip(" /-")

    # Extrair marca (1ª palavra OU par conhecido)
    brand_token = None
    slug_extra_for_brand = ""
    name_lower_tokens = cleaned_name.replace("/", " ").replace("  ", " ").split()
    if name_lower_tokens:
        # Marcas conhecidas de 2-3 palavras
        known_2 = {
            ("polo", "ralph"), ("polo ralph", "lauren"), ("new", "balance"),
            ("the", "north"), ("north", "face"), ("dr", "martens"),
            ("marc", "jacobs"), ("stone", "island"), ("fear", "of"),
            ("yohji", "yamamoto"), ("bad", "bunny"), ("wales", "bonner"),
        }
        t0 = name_lower_tokens[0].lower().strip("'\"()[]")
        brand_candidate = t0
        if len(name_lower_tokens) >= 2:
            t1 = name_lower_tokens[1].lower().strip("'\"()[]")
            for (a, b), combined in [
                (("polo","ralph"), "ralph_lauren"),
                (("new","balance"), "new_balance"),
                (("the","north"), "the_north_face"),
                (("dr","martens"), "dr_martens"),
                (("marc","jacobs"), "marc_jacobs"),
                (("stone","island"), "stone_island"),
                (("yohji","yamamoto"), "yohji_yamamoto"),
            ]:
                if t0 == a and t1 == b:
                    brand_candidate = combined
                    slug_extra_for_brand = (combined + "_")
                    break
        brand_token = brand_candidate.strip("'\"").replace("-", "_")
        slug_extra_for_brand = slug_extra_for_brand or (brand_token + "_" if brand_token else "")

    raw_for_slug = cleaned_name
    if not raw_for_slug:
        raw_for_slug = f"msg_{msg_id}"
    slug_candidate = _sanitize_slug_strong(slug_extra_for_brand + raw_for_slug)
    tokens = _tokenize(cleaned_name or f"msg {msg_id}")

    return {
        "id": msg_id,
        "date": date,
        "photos": [p for p in photos if p and p.exists()],
        "buy_link": buy_link,
        "cleaned_name": cleaned_name,
        "brand_token": brand_token,
        "tokens": tokens,
        "slug_candidate": slug_candidate,
        "price_raw": price_raw,
    }


# ============================================================
# CARREGAR MANIFEST ATUAL
# ============================================================

def load_manifest() -> list[dict]:
    if not MANIFEST_PATH.exists():
        return []
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    if isinstance(raw, dict):
        products = raw.get("products") or raw.get("items") or []
        if isinstance(products, list):
            return products
        return []
    if isinstance(raw, list):
        return raw
    return []


def save_manifest(products_list: list[dict]) -> None:
    wrapper = {"products": products_list}
    if MANIFEST_PATH.exists():
        try:
            with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
                current = json.load(f)
            if isinstance(current, dict):
                for k, v in current.items():
                    if k not in ("products", "items"):
                        wrapper[k] = v
        except Exception:
            pass
    tmp = MANIFEST_PATH.with_suffix(".tmp.json")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(wrapper, f, ensure_ascii=False, indent=2)
    tmp.replace(MANIFEST_PATH)


def build_manifest_indexes(manifest: list[dict]) -> dict:
    by_slug_norm: dict[str, dict] = {}
    by_tokens: dict[str, list[dict]] = {}
    by_full_tokens: list[tuple[set[str], dict]] = []

    for p in manifest:
        slug = p.get("slug", "")
        slug_norm = _sanitize_slug_strong(slug)
        by_slug_norm[slug_norm] = p
        name = p.get("name") or ""
        brand_slug = p.get("brandSlug") or ""
        model_slug = p.get("modelSlug") or ""
        hay = f"{brand_slug} {name} {model_slug} {p.get('category','')}"
        toks = _tokenize(hay)
        by_full_tokens.append((toks, p))
        for t in toks:
            by_tokens.setdefault(t, []).append(p)
    return {
        "by_slug_norm": by_slug_norm,
        "by_tokens": by_tokens,
        "by_full_tokens": by_full_tokens,
    }


# ============================================================
# MATCH 3-CASCATA
# ============================================================

def match_message(parsed: dict, idx: dict) -> tuple[str, Optional[dict], float]:
    """
    Retorna (tipo_match, produto_manifest, score_similaridade)
    tipo_match ∈ { "exact", "probable", "none" }
    """
    by_slug_norm = idx["by_slug_norm"]
    by_full_tokens = idx["by_full_tokens"]

    msg_toks_all = parsed["tokens"]
    brand_toks = _tokenize(parsed.get("brand_token") or "")
    non_brand_tokens = msg_toks_all - brand_toks
    # Quantos tokens significativos (não só marca) tem a msg
    has_model_info = len(non_brand_tokens) >= 1
    # Caso extremo: "UGG", "MONCLER" etc. -> marca == nome completo
    only_brand_name = (len(msg_toks_all) <= 1 and brand_toks == msg_toks_all)

    # 1) SLUG EXATO
    slug_can = parsed["slug_candidate"]
    matched_prod = None
    matched_score = 1.0
    if slug_can in by_slug_norm:
        matched_prod = by_slug_norm[slug_can]
    else:
        # variante sem o prefixo brand
        stripped = re.sub(r"^[a-z0-9]+_", "", slug_can)
        if stripped and stripped in by_slug_norm:
            matched_prod = by_slug_norm[stripped]
    if matched_prod is not None:
        if only_brand_name or not has_model_info:
            # Nao podemos afirmar exato se so temos marca (generico)
            return ("probable", matched_prod, 0.82)
        return ("exact", matched_prod, matched_score)

    # 2) MATCH por tokens interseção
    msg_toks = msg_toks_all
    if not msg_toks:
        return ("none", None, 0.0)
    best_score = 0.0
    best_prod = None
    for (prod_toks, prod) in by_full_tokens:
        if not prod_toks:
            continue
        inter = len(msg_toks & prod_toks)
        if inter == 0:
            continue
        union = len(msg_toks | prod_toks)
        score = inter / max(1, union)
        hits = inter
        # exigir pelo menos 2 tokens OU (1 token + has_model_info ok? baixar threshold)
        if hits >= 2 and score > best_score:
            best_score = score
            best_prod = prod
        # fallback: se só 1 token, mas é modelo conhecido (ex: campus/gazelle/dunk),
        # aceitar com score maior
        elif hits == 1 and score > 0.45 and score > best_score and non_brand_tokens:
            best_score = score
            best_prod = prod
    if best_score >= 0.82:
        return ("probable", best_prod, round(best_score, 3))
    return ("none", None, round(best_score, 3))


# ============================================================
# CLASSIFICAÇÃO FINAL e ESTATÍSTICAS
# ============================================================

def is_sneakers_like(cleaned_name: str, brand_token: Optional[str]) -> bool:
    n = (_strip_accents(_clean_display_name(cleaned_name or "")) or "").lower()
    if brand_token and brand_token in {"nike","jordan","adidas","new_balance","asics","puma","vans","converse"}:
        return True
    sneaker_terms = [
        "sneaker","sapatilha","tenis","air max","samba","gazelle","campus","jordan",
        "dunk","yeezy","new balance","tn","ultraboost","nmd","slip on","slip-on",
        "pegasus","air force","af1","blazer","cortez","retro","kobe","lebron",
    ]
    return any(t in n for t in sneaker_terms)


def classify_and_report(msgs_parsed: list[dict], manifest: list[dict], manifest_idx: dict,
                        limit: Optional[int] = None,
                        group_photos_by_time: bool = True) -> dict:
    # ============================================================
    # (X) AGRUPAR FOTOS EXTRA POR HORÁRIO (mesmo minuto = mesmo produto)
    #   REGRA RIGOROSA v2:
    #   - No mesmo minuto: se houver EXATAMENTE 1 msg com buy-link (mãe) +
    #     msgs SEM buy-link + COM foto = agrupar fotos todas para a MÃE.
    #   - No mesmo minuto: se houver 2+ msgs com buy-link (vários produtos
    #     diferentes postados rapidamente no mesmo minuto!) -> NADA AGRUPA.
    #     As "filhas" SEM buy-link não são adicionadas a lado nenhum;
    #     caem todas em IGNORADO (seguro, não mistura fotos).
    #   - As "filhas" (sem buy-link, com foto) de um grupo válido são
    #     marcadas com _merged_into_mom para não caírem depois em IGNORADO.
    # ============================================================
    if group_photos_by_time:
        by_minute: dict[str, list[dict]] = {}
        for pm in msgs_parsed:
            d = pm.get("date") or ""
            key_min = d[:16] if len(d) >= 16 else f"__{pm.get('id')}"
            by_minute.setdefault(key_min, []).append(pm)
        for key_min, grupo in by_minute.items():
            maes = [g for g in grupo if g.get("buy_link")]
            filhas = [g for g in grupo if not g.get("buy_link") and g.get("photos")]
            # RIGOROSO: apenas 1 mãe, NUNCA round-robin (que mistura produtos!)
            if len(maes) == 1 and filhas:
                mae = maes[0]
                extra_photos = []
                for fl in filhas:
                    extra_photos.extend(fl["photos"])
                    fl["_merged_into_mom"] = mae["id"]
                seen = {}
                for p in mae["photos"] + extra_photos:
                    seen[str(p)] = p
                mae["photos"] = list(seen.values())
                mae["_extra_photos_count"] = len(extra_photos)
            # Caso NÃO dê match: len(maes) != 1 (0 ou 2+) → NÃO MISTURA NADA;
            # as filhas não são marcadas com _merged_into_mom e depois caem
            # em IGNORADO normalmente (seguro).

    stats = {
        "total_msgs": len(msgs_parsed),
        "with_photo": sum(1 for m in msgs_parsed if m["photos"]),
        "with_buy_link": sum(1 for m in msgs_parsed if m["buy_link"]),
        "with_photo_and_link": sum(1 for m in msgs_parsed if m["photos"] and m["buy_link"]),
        "exato_com_link_novo": [],
        "exato_ja_tem_link": [],
        "exato_sem_antes": [],  # sem buy-link antes
        "provavel": [],
        "novo": [],
        "ignorado_sem_foto_ou_link": [],
        "nike": {"exato": [], "provavel": [], "novo": [], "ignorado": []},
        "fotos_extra_agrupadas_x": 0,
    }

    for pm in msgs_parsed:
        if pm.get("_merged_into_mom"):
            stats["fotos_extra_agrupadas_x"] += len(pm.get("photos") or [])
            continue
        # ---------------------------------------------------------------------
        # REGRA vFINAL: SÓ MARCA (usando ALL_KNOWN_BRAND_TOKENS + stopwords)
        #   tokens da msg - ALL_KNOWN_BRAND - stopwords = {} → sem modelo
        #   → IGNORAR COMPLETAMENTE, em QUALQUER fase.
        # ---------------------------------------------------------------------
        all_msg_toks = pm["tokens"]
        nao_brand_robusto = (
            all_msg_toks - ALL_KNOWN_BRAND_TOKENS - _GENERIC_STOPWORDS
        )
        # Fallback: usar a marca parseada do header também
        brand_toks_here = _tokenize(pm.get("brand_token") or "")
        non_brand_here = nao_brand_robusto
        if not non_brand_here:
            # Tentar fallback antigo (caso ALL_KNOWN não apanhe)
            non_brand_here = all_msg_toks - brand_toks_here - _GENERIC_STOPWORDS
        non_brand_here = {t for t in non_brand_here if len(t) >= 2}
        # BLOQUEAR CLARAMENTE:
        if all_msg_toks and not non_brand_here:
            pm["_brand_only_skipped"] = True
            stats["ignorado_sem_foto_ou_link"].append(pm)
            if (pm.get("brand_token") or "").lower() == "nike":
                stats["nike"]["ignorado"].append(pm)
            continue
        # ---------------------------------------------------------------------
        is_nike = (pm.get("brand_token") or "").lower() in {"nike"}
        if not pm["photos"] or not pm["buy_link"]:
            stats["ignorado_sem_foto_ou_link"].append(pm)
            if is_nike: stats["nike"]["ignorado"].append(pm)
            continue
        typ, prod, score = match_message(pm, manifest_idx)
        if typ == "exact":
            # Double-check: se o produto manifest for genérico E a msg não
            # adicionar modelo → bloquear também (seguro-duplo).
            prod_tokens = _tokenize((prod or {}).get("name") or "") if prod else set()
            extra_nova_vs_manifest = (
                all_msg_toks - ALL_KNOWN_BRAND_TOKENS - _GENERIC_STOPWORDS - prod_tokens
            )
            if not non_brand_here or (prod_tokens and not extra_nova_vs_manifest and
                (prod_tokens.issubset(ALL_KNOWN_BRAND_TOKENS | _GENERIC_STOPWORDS))):
                stats["ignorado_sem_foto_ou_link"].append(pm)
                if is_nike: stats["nike"]["ignorado"].append(pm)
                continue
            existing = (prod or {}).get("buyLink") or (prod or {}).get("hasBuyLink")
            if existing:
                stats["exato_ja_tem_link"].append({"msg": pm, "prod": prod, "score": score})
            else:
                stats["exato_com_link_novo"].append({"msg": pm, "prod": prod, "score": score})
            if is_nike: stats["nike"]["exato"].append(pm)
        elif typ == "probable":
            if not non_brand_here:
                stats["ignorado_sem_foto_ou_link"].append(pm)
                if is_nike: stats["nike"]["ignorado"].append(pm)
                continue
            stats["provavel"].append({"msg": pm, "prod": prod, "score": score})
            if is_nike: stats["nike"]["provavel"].append(pm)
        else:
            if not non_brand_here:
                stats["ignorado_sem_foto_ou_link"].append(pm)
                if is_nike: stats["nike"]["ignorado"].append(pm)
                continue
            stats["novo"].append({"msg": pm, "score": score})
            if is_nike: stats["nike"]["novo"].append(pm)

    return stats


# ============================================================
# APLICAR ALTERAÇÕES (--apply)
# ============================================================

def _ensure_slug_unique(slug: str, existing_slugs: set[str]) -> str:
    if slug not in existing_slugs:
        return slug
    i = 2
    while f"{slug}_{i}" in existing_slugs:
        i += 1
    return f"{slug}_{i}"


def _copy_photos_for_msg(msg_photos: list[Path], dest_dir: Path) -> list[str]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    imgs = sorted(dest_dir.glob("*.jpg")) + sorted(dest_dir.glob("*.jpeg")) + sorted(dest_dir.glob("*.png"))
    next_idx = len(imgs) + 1
    result_images = [p.name for p in imgs]
    for src in msg_photos:
        ext = src.suffix.lower() or ".jpg"
        dest = dest_dir / f"{next_idx}{ext}"
        shutil.copy2(src, dest)
        result_images.append(dest.name)
        next_idx += 1
    return result_images


def apply_changes(stats: dict, manifest: list[dict],
                  *,
                  skip_probable_apply: bool = True,
                  new_sneakers_price: Optional[str] = "40€",
                  new_other_price_text: Optional[str] = None,
                  ignore_telegram_price: bool = True,
                  ) -> tuple[int, int, list[dict], dict]:
    """
    skip_probable_apply (B): se True, NÃO aplica provável (default True)
    new_sneakers_price (Q+40): preço para sneakers NOVOS. None = não definir preço.
    new_other_price_text: para produtos novos não-sneakers. Ex.: "Consulte o preço"
    ignore_telegram_price (Q): se True, ignora completamente pm["price_raw"]
    Retorna: (atualizados, novos, erros, extra_stats)
    """
    erros = []
    manifest_idx = {p.get("slug", ""): p for p in manifest}
    existing_slugs = {p.get("slug", "") for p in manifest}
    extra_stats = {"probable_skipped": 0, "new_sneakers_price_used": 0, "new_other_price": 0}

    atualizados = 0
    # 1) Atualizar MATCH exato com link novo
    for item in stats["exato_com_link_novo"]:
        prod: dict = item["prod"]
        pm = item["msg"]
        slug = prod.get("slug", "")
        if not slug:
            erros.append(f"produto sem slug, msg {pm['id']}")
            continue
        prod["buyLink"] = pm["buy_link"]
        prod["hasBuyLink"] = True
        if not ignore_telegram_price and pm.get("price_raw") and not prod.get("price"):
            prod["price"] = pm["price_raw"]
        prod["latestTs"] = max(prod.get("latestTs", 0), _date_to_ts(pm.get("date")))
        # Copiar foto (adicionar)
        dest_dir = IMG_DIR / slug
        try:
            images_list = _copy_photos_for_msg(pm["photos"], dest_dir)
            # Garantir que o prod.images fica com elas
            existing_imgs = set(prod.get("images") or [])
            for n in images_list:
                if n not in existing_imgs:
                    prod.setdefault("images", []).append(n)
                    existing_imgs.add(n)
        except Exception as e:
            erros.append(f"atualizar fotos {slug}: {e}")
        manifest_idx[slug] = prod
        atualizados += 1

    # 1b) PROVÁVEL (B): skip por defeito
    if not skip_probable_apply:
        for item in stats["provavel"]:
            prod: dict = item["prod"]
            pm = item["msg"]
            slug = (prod or {}).get("slug", "")
            if not slug or not prod:
                continue
            if not (prod.get("buyLink") or prod.get("hasBuyLink")):
                prod["buyLink"] = pm["buy_link"]
                prod["hasBuyLink"] = True
                prod["latestTs"] = max(prod.get("latestTs", 0), _date_to_ts(pm.get("date")))
                dest_dir = IMG_DIR / slug
                try:
                    images_list = _copy_photos_for_msg(pm["photos"], dest_dir)
                    existing_imgs = set(prod.get("images") or [])
                    for n in images_list:
                        if n not in existing_imgs:
                            prod.setdefault("images", []).append(n)
                            existing_imgs.add(n)
                except Exception as e:
                    erros.append(f"provavel fotos {slug}: {e}")
                atualizados += 1
    else:
        extra_stats["probable_skipped"] = len(stats["provavel"])

    # 2) NOVOS produtos → criar (com Q+40€)
    novos = 0
    for item in stats["novo"]:
        pm = item["msg"]
        raw_slug = pm["slug_candidate"]
        unique_slug = _ensure_slug_unique(raw_slug, existing_slugs)
        existing_slugs.add(unique_slug)

        name = pm["cleaned_name"] or f"Produto {pm['id']}"
        brand_slug_raw = pm.get("brand_token") or ""
        brand_slug = re.sub(r"[^a-z0-9_]", "", brand_slug_raw.lower().replace("-", "_"))
        brand_label = (pm["cleaned_name"].split()[0] if pm["cleaned_name"] else brand_slug).strip("\"'")
        if brand_slug == "ralph_lauren":
            brand_label = "Polo Ralph Lauren"
        if brand_slug == "new_balance":
            brand_label = "New Balance"
        if brand_slug == "the_north_face":
            brand_label = "The North Face"
        if brand_slug == "dr_martens":
            brand_label = "Dr. Martens"

        category = "outros"
        name_lower = (_strip_accents(_clean_display_name(name)) or "").lower()
        sneakers_bool = False
        if is_sneakers_like(name, brand_slug):
            category = "sneakers"
            sneakers_bool = True
        else:
            if any(w in name_lower for w in ["bolsa","mochila","bag","backpack","polene","longchamp","kanken","crossbody","tote"]):
                category = "bolsas"
            elif any(w in name_lower for w in ["oculos","ray ban","ray-ban"]):
                category = "oculos"
            elif any(w in name_lower for w in ["bone","new era","newera"," bon "]):
                category = "bones"
            elif any(w in name_lower for w in ["relogio","watch"]):
                category = "relogios"
            elif any(w in name_lower for w in ["camiseta","tshirt","t-shirt","hoodie","jersey","shorts","pantal","chaqueta","jaqueta","sudadera","jacket","polo","carhartt","ralph","moncler","essentials","corteiz","stussy","stone island"]):
                category = "roupas"
            elif any(w in name_lower for w in ["chinelo","slide"]):
                category = "chinelos"

        dest_dir = IMG_DIR / unique_slug
        images_list = []
        try:
            images_list = _copy_photos_for_msg(pm["photos"], dest_dir)
        except Exception as e:
            erros.append(f"criar fotos {unique_slug} (msg {pm['id']}): {e}")

        prod = {
            "slug": unique_slug,
            "name": name,
            "category": category,
            "brandSlug": brand_slug,
            "brandLabel": brand_label,
            "modelSlug": "",
            "modelLabel": "",
            "images": images_list,
            "latestTs": _date_to_ts(pm.get("date")),
            "buyLink": pm["buy_link"],
            "hasBuyLink": True,
        }
        # (Q+40€) Regra de preços nos NOVOS:
        if ignore_telegram_price:
            if sneakers_bool:
                if new_sneakers_price:
                    prod["price"] = new_sneakers_price
                    extra_stats["new_sneakers_price_used"] += 1
            elif new_other_price_text:
                prod["price"] = new_other_price_text
                extra_stats["new_other_price"] += 1
        elif pm.get("price_raw"):
            prod["price"] = pm["price_raw"]
        manifest.append(prod)
        manifest_idx[unique_slug] = prod
        novos += 1

    return (atualizados, novos, erros, extra_stats)


def _date_to_ts(date_str: Optional[str]) -> int:
    if not date_str:
        import time as _t
        return int(_t.time())
    try:
        # formato esperado "2026-08-15T09:10:17"
        import datetime as dt
        d = dt.datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        return int(d.timestamp())
    except Exception:
        import time as _t
        return int(_t.time())


# ============================================================
# PRINT RELATÓRIO
# ============================================================

def _short(msg: dict, n: int = 80) -> str:
    s = msg.get("cleaned_name") or f"<sem nome msg {msg.get('id')}>"
    return s[:n] + ("…" if len(s) > n else "")


def _short_prod(p: Optional[dict]) -> str:
    if not p: return "—"
    return f"{p.get('slug','')[:50]} | {p.get('name','')[:60]}"


def print_report(stats: dict, dry_run: bool, limit: Optional[int]):
    print()
    print("=" * 82)
    title = "RELATÓRIO DRY-RUN (0 alterações gravadas)" if dry_run else "RELATÓRIO FINAL (alterações aplicadas)"
    print(title.center(82))
    print("=" * 82)
    print(f"  Fonte:        {EXPORT_JSON}")
    print(f"  Manifest:     {MANIFEST_PATH}")
    print(f"  Produtos no manifest ANTES: {sum(1 for _ in [])} (nº linhas)")
    lmt_txt = f" (limit={limit})" if limit else ""
    print(f"  Mensagens processadas:      {stats['total_msgs']}{lmt_txt}")
    print(f"    · com FOTO:               {stats['with_photo']}")
    print(f"    · com BUY-LINK:           {stats['with_buy_link']}")
    print(f"    · com FOTO + BUY-LINK:    {stats['with_photo_and_link']}")
    print()
    exact_upd = len(stats["exato_com_link_novo"])
    exact_skip = len(stats["exato_ja_tem_link"])
    probable = len(stats["provavel"])
    new = len(stats["novo"])
    ign = len(stats["ignorado_sem_foto_ou_link"])
    print("  CLASSIFICAÇÃO por cascata de MATCH:")
    print(f"    🟢 EXATO com link NOVO (a atualizar):  {exact_upd:4}")
    print(f"    🟢 EXATO já tem buyLink (ignorar):     {exact_skip:4}")
    print(f"    🟡 PROVÁVEL (>72% tokens, validação):  {probable:4}")
    print(f"    🔴 NOVO (sem match, a adicionar):      {new:4}")
    print(f"    ⚪ IGNORADO (sem foto/link):            {ign:4}")
    print()
    # Nike focus
    print("  NIKE (exemplos):")
    nk_ex = len(stats["nike"]["exato"])
    nk_pr = len(stats["nike"]["provavel"])
    nk_nv = len(stats["nike"]["novo"])
    nk_ig = len(stats["nike"]["ignorado"])
    print(f"    · exato:      {nk_ex}")
    print(f"    · provável:   {nk_pr}")
    print(f"    · novo:       {nk_nv}")
    print(f"    · ignorado:   {nk_ig}")
    for arr, lbl in [(stats["nike"]["exato"], "exato"), (stats["nike"]["novo"], "novo")]:
        if not arr: continue
        for pm in arr[:3]:
            extras = ""
            if isinstance(pm, dict) and "prod" in pm:
                extras = f" ↔ {_short_prod(pm.get('prod'))}"
                pm = pm["msg"]
            print(f"      • [{lbl}] id={pm['id']} slug={pm['slug_candidate'][:45]}  {_short(pm,60)}" + extras)
    print()
    # Exemplos por categoria
    print("-" * 82)
    print("  EXEMPLOS (primeiros 5 por classe):")
    print("-" * 82)
    for arr_name, title_arr, has_prod in [
        ("exato_com_link_novo", "EXATO com link NOVO", True),
        ("provavel", "PROVÁVEL (validação manual)", True),
        ("novo", "NOVO (produto a adicionar)", False),
    ]:
        arr = stats[arr_name]
        print(f"  ## {title_arr} (total {len(arr)})")
        if not arr:
            print("     (vazio)")
            continue
        for it in arr[:5]:
            pm = it["msg"]
            score = it.get("score", "-")
            p_info = ""
            if has_prod:
                p_info = f"\n         ↔ manifest: {_short_prod(it.get('prod'))}"
            price = pm.get("price_raw") or "-"
            print(f"     • id={pm['id']} score={score} price={price} link={pm['buy_link']}")
            print(f"       nome: {_short(pm, 120)}")
            print(f"       slug: {pm['slug_candidate'][:60]}")
            print(f"       fotos: {[p.name for p in pm['photos'][:3]]}{'…' if len(pm['photos'])>3 else ''}" + p_info)
    print("-" * 82)
    print("  IGNORADOS (primeiros 3):")
    for pm in stats["ignorado_sem_foto_ou_link"][:3]:
        why = []
        if not pm["photos"]: why.append("sem foto")
        if not pm["buy_link"]: why.append("sem buy-link")
        print(f"     • id={pm['id']} ({', '.join(why)}): {_short(pm, 100)}")
    print("=" * 82)


def save_probables_json(stats: dict, out_path: Path) -> Path:
    """Guarda os PROVÁVEIS para validação manual posterior (opção B)."""
    simplified = []
    for it in stats["provavel"]:
        pm = it["msg"]
        prod = it.get("prod") or {}
        simplified.append({
            "msg_id": pm.get("id"),
            "msg_date": pm.get("date"),
            "msg_name": pm.get("cleaned_name"),
            "msg_slug_candidate": pm.get("slug_candidate"),
            "msg_buy_link": pm.get("buy_link"),
            "msg_photos": [str(p.name) for p in (pm.get("photos") or [])[:6]],
            "msg_extra_photos_count": pm.get("_extra_photos_count"),
            "match_score": it.get("score"),
            "manifest_slug": prod.get("slug"),
            "manifest_name": prod.get("name"),
            "manifest_category": prod.get("category"),
            "manifest_images": (prod.get("images") or [])[:6],
        })
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "info": "Validação manual PROVÁVEL (opção B skip_probable=True). Quando confiares, volta a correr o import com --include-probable para aplicar estes também.",
            "total": len(simplified),
            "items": simplified,
        }, f, ensure_ascii=False, indent=2)
    return out_path


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Import ChatExport Telegram para manifest SmartThings PT")
    parser.add_argument("--apply", action="store_true", help="Aplicar alterações (default = DRY-RUN)")
    parser.add_argument("--limit", type=int, default=None, help="Processar apenas N mensagens (debug)")
    parser.add_argument("--json", action="store_true", help="Imprimir também JSON final de stats")

    # Opção B (modo B default = True): skip probable; incluir só com flag
    parser.add_argument("--include-probable", dest="skip_probable", action="store_false",
                        default=True, help="Aplicar também prováveis (modo A/C). Default: skip (modo B).")

    # Opção X: agrupar fotos por horário (default True = ligado)
    parser.add_argument("--no-group-photos", dest="group_photos", action="store_false",
                        default=True, help="Desligar agrupamento de fotos extra por horário.")

    # Opção Q + 40€: preço para produtos novos e ignore preço Telegram
    parser.add_argument("--new-sneakers-price", dest="new_sneakers_price", type=str, default="40€",
                        help='Preço para produtos novos de sneakers. (default "40€")')
    parser.add_argument("--new-other-price", dest="new_other_price", type=str, default=None,
                        help='Preço para produtos novos NÃO sneakers. (default None = usar "Consulte o preço"/não definir)')
    parser.add_argument("--use-telegram-price", dest="ignore_telegram_price", action="store_false",
                        default=True, help="Usar o preço escrito no Telegram se existir. (default: ignorar = Q)")

    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    if not EXPORT_JSON.exists():
        print(f"ERRO: não encontrei {EXPORT_JSON}")
        sys.exit(1)
    if not EXPORT_PHOTOS.exists():
        print(f"ERRO: não encontrei pasta fotos em {EXPORT_PHOTOS}")
        sys.exit(1)

    with open(EXPORT_JSON, "r", encoding="utf-8") as f:
        export_data = json.load(f)
    msgs = export_data.get("messages", [])
    if args.limit:
        msgs = msgs[: args.limit]

    manifest = load_manifest()
    manifest_count_before = len(manifest)
    idx = build_manifest_indexes(manifest)

    print(f"[setup] mensagens chat export: {len(msgs)}")
    print(f"[setup] produtos no manifest: {manifest_count_before}")
    print(f"[setup] fotos na pasta export: {len(list(EXPORT_PHOTOS.glob('*.jpg')))}")
    print(f"[setup] modo = {'APLICAR' if args.apply else 'DRY-RUN (sem gravações)'}")
    print(f"[setup] modo B (skip provável): {args.skip_probable}  (--include-probable para desligar)")
    print(f"[setup] modo X (agrupar fotos extra por horário): {args.group_photos}")
    print(f"[setup] Q: ignorar preço Telegram e usar regras: ignore={args.ignore_telegram_price}  new_sneakers_price={args.new_sneakers_price!r}  new_other_price={args.new_other_price!r}")

    parsed = [parse_telegram_message(m) for m in msgs]

    stats = classify_and_report(parsed, manifest, idx, limit=args.limit, group_photos_by_time=args.group_photos)
    print_report(stats, dry_run=not args.apply, limit=args.limit)
    print(f"\n  (X) Fotos extra agrupadas por horário (mesmo minuto): ~{stats.get('fotos_extra_agrupadas_x', 0)}")

    if args.json:
        import io as _io
        buf = _io.StringIO()
        json.dump({
            k: (v if isinstance(v, (int, str, float, list)) else len(v))
            for k, v in stats.items()
            if k != "by_full_tokens" and not k.startswith("by_")
        }, buf, ensure_ascii=False, indent=2, default=str)
        print("\n\n--- stats.json ---")
        print(buf.getvalue())

    # Sempre (dry-run + apply) guardar o ficheiro provável para validação manual (B)
    prov_path = PROJECT_ROOT / "_logs" / "import_telegram__provavel_pendente.json"
    if stats["provavel"]:
        sp = save_probables_json(stats, prov_path)
        print(f"\n[info B + logs] ✓ {len(stats['provavel'])} prováveis guardados em: {sp}")
        print("         Podes abrir esse JSON para rever manualmente.")

    if args.apply:
        IMG_DIR.mkdir(parents=True, exist_ok=True)
        atualizados, novos, erros, extra_stats = apply_changes(
            stats, manifest,
            skip_probable_apply=args.skip_probable,
            new_sneakers_price=args.new_sneakers_price,
            new_other_price_text=args.new_other_price,
            ignore_telegram_price=args.ignore_telegram_price,
        )
        # ordenar manifest por latestTs desc (mantém padrão)
        manifest.sort(key=lambda p: p.get("latestTs", 0), reverse=True)
        save_manifest(manifest)
        print(f"\n[apply OK] ✓ manifest gravado em {MANIFEST_PATH}")
        print(f"          · Atualizados buyLink novo (exato{'' if args.skip_probable else '+prov'}): {atualizados}")
        print(f"          · Produtos NOVOS adicionados: {novos}")
        print(f"          · PROVÁVEIS saltados (modo B): {extra_stats.get('probable_skipped',0)}")
        print(f"          · NOVOS sneakers com preço {args.new_sneakers_price!r}: {extra_stats.get('new_sneakers_price_used',0)}")
        print(f"          · NOVOS não-sneakers com preço {args.new_other_price!r}: {extra_stats.get('new_other_price',0)}")
        print(f"          · Total manifest ANTES → DEPOIS: {manifest_count_before} → {len(manifest)} (+{len(manifest)-manifest_count_before})")
        if erros:
            print(f"          · Erros ({len(erros)}):")
            for e in erros[:10]:
                print(f"              • {e}")
    else:
        print("\n[dry-run] Nenhuma alteração gravada. Para aplicar, volta a correr com flag --apply.")
        print("          > Para incluir PROVÁVEIS também: acrescenta --include-probable (modo A em vez de B)")
        print("          > Depois de --apply, vamos correr sync_manifest.py para confirmar idempotência.")


if __name__ == "__main__":
    main()
