const CATEGORY_LABELS = {
  sneakers: "Sneakers",
  roupas: "Roupa",
  bolsas: "Bolsas",
  tecnologia: "Tecnologia",
  eletronicos: "Tecnologia",
  fones: "Fones",
  oculos: "Óculos",
  relogios: "Relógios",
  bones: "Bonés",
  chinelos: "Chinelos",
  acessorios: "Acessórios",
  outros: "Outros"
};

const SIZE_SETS = {
  shoes: ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"],
  clothing: ["XS", "S", "M", "L", "XL", "XXL"],
  unique: ["Único"]
};

const SHOE_HINTS = [
  "sneaker",
  "sapatilha",
  "tenis",
  "ténis",
  "sapato",
  "jordan",
  "dunk",
  "yeezy",
  "gazelle",
  "samba",
  "campus",
  "spezial",
  "air max",
  "new balance",
  "asics",
  "adidas",
  "nike",
  "vans",
  "converse",
  "slipper",
  "boot",
  "bota"
];

const CLOTHING_HINTS = [
  "t-shirt",
  "tshirt",
  "tee",
  "camisola",
  "camisa",
  "camiseta",
  "hoodie",
  "sweatshirt",
  "casaco",
  "jacket",
  "jaqueta",
  "polo",
  "calças",
  "calca",
  "calção",
  "calcoes",
  "calções",
  "jeans",
  "shorts",
  "bermuda",
  "conjunto",
  "fato de treino",
  "top",
  "cropped"
];

const WOMEN_HINTS = ["mulher", "women", "wmns", "feminino", "lady", "girl"];
const MEN_HINTS = ["homem", "men", "masculino", "man"];
const KIDS_HINTS = ["criança", "crianca", "kids", "junior", "infantil", "baby"];

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function slugToLabel(value) {
  const label = String(value || "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!label) {
    return "";
  }
  return label
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getCategoryLabel(category) {
  const key = normalizeText(category);
  return CATEGORY_LABELS[key] || slugToLabel(category) || "Outros";
}

export function getGender(product) {
  const haystack = normalizeText(
    [product?.name, product?.brandLabel, product?.category].filter(Boolean).join(" ")
  );
  if (KIDS_HINTS.some((hint) => haystack.includes(hint))) {
    return "Criança";
  }
  if (WOMEN_HINTS.some((hint) => haystack.includes(hint))) {
    return "Mulher";
  }
  if (MEN_HINTS.some((hint) => haystack.includes(hint))) {
    return "Homem";
  }
  return "Unissexo";
}

export function getSizeContext(product) {
  const category = normalizeText(product?.category);
  const haystack = normalizeText(
    [product?.name, product?.brandLabel, product?.modelLabel].filter(Boolean).join(" ")
  );
  if (category === "sneakers" || SHOE_HINTS.some((hint) => haystack.includes(hint))) {
    return {
      type: "shoes",
      label: "Tamanho",
      sizes: SIZE_SETS.shoes
    };
  }
  if (category === "roupas" || CLOTHING_HINTS.some((hint) => haystack.includes(hint))) {
    return {
      type: "clothing",
      label: "Tamanho",
      sizes: SIZE_SETS.clothing
    };
  }
  return {
    type: "unique",
    label: "Tamanho",
    sizes: SIZE_SETS.unique
  };
}

export function isConsultPrice(rawPrice) {
  const text = normalizeText(rawPrice);
  if (!text) {
    return false;
  }
  return text.includes("consulta") || text.includes("consultar") || text.includes("sob consulta");
}

export function getPriceInfo(product, stateItem, config) {
  const statePrice = typeof stateItem?.priceLabel === "string" ? stateItem.priceLabel.trim() : "";
  const rawPrice = statePrice || String(product?.price || "").trim();
  if (isConsultPrice(rawPrice) || stateItem?.priceType === "consult") {
    return {
      label: config.catalog.consultPriceLabel,
      value: null,
      type: "consult"
    };
  }
  const numericMatch = rawPrice.match(/(\d+(?:[.,]\d+)?)/);
  if (rawPrice && numericMatch) {
    return {
      label: rawPrice.includes("€") ? rawPrice : `${numericMatch[1].replace(".", ",")}€`,
      value: Number(numericMatch[1].replace(",", ".")),
      type: "fixed"
    };
  }
  return {
    label: config.catalog.fixedPriceLabel,
    value: Number(config.catalog.fixedPriceValue || 0),
    type: "fixed"
  };
}

export function getAvailability(stateItem) {
  const status = normalizeText(stateItem?.status || "disponivel");
  if (status === "esgotado" || status === "soldout") {
    return "esgotado";
  }
  return "disponivel";
}

export function isNewProduct(product, now = Date.now()) {
  const latestTs = Number(product?.latestTs || 0);
  if (!latestTs) {
    return false;
  }
  const diffMs = now - latestTs * 1000;
  const days = diffMs / (1000 * 60 * 60 * 24);
  return days <= 45;
}

export function getProductBadges(product, stateItem, config, now = Date.now()) {
  const badges = [];
  const availability = getAvailability(stateItem);
  const priceInfo = getPriceInfo(product, stateItem, config);

  if (isNewProduct(product, now)) {
    badges.push({ label: "Novo", tone: "accent" });
  }
  if (priceInfo.type === "consult") {
    badges.push({ label: "Só consulta", tone: "warning" });
  }
  if (availability === "esgotado") {
    badges.push({ label: "Esgotado", tone: "danger" });
  }

  return badges;
}

export function buildProductLink(basePath, slug) {
  const cleanBase = String(basePath || "/").replace(/\/+$/, "");
  return `${cleanBase || ""}/produto/${encodeURIComponent(slug)}/`;
}

export function joinUrl(base, relativePath) {
  const cleanBase = String(base || "").replace(/\/+$/, "");
  const cleanPath = String(relativePath || "").replace(/^\/+/, "");
  return cleanBase ? `${cleanBase}/${cleanPath}` : `/${cleanPath}`;
}

export function getBrandLabel(product) {
  return String(product?.brandLabel || product?.brandSlug || "").trim() || "Sem marca";
}

export function getModelLabel(product) {
  const model = String(product?.modelLabel || product?.modelSlug || "").trim();
  return model && model !== "produto-sem-nome" ? model : "";
}

export function getCoverImage(product) {
  const first = Array.isArray(product?.images) ? product.images[0] : "";
  return first || "";
}

export function getRelatedProducts(product, allProducts, limit = 4) {
  const ownSlug = product?.slug;
  const brand = normalizeText(product?.brandSlug || product?.brandLabel);
  const category = normalizeText(product?.category);

  const scored = allProducts
    .filter((candidate) => candidate.slug !== ownSlug)
    .map((candidate) => {
      let score = 0;
      if (brand && normalizeText(candidate.brandSlug || candidate.brandLabel) === brand) {
        score += 3;
      }
      if (category && normalizeText(candidate.category) === category) {
        score += 2;
      }
      return { candidate, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return Number(b.candidate.latestTs || 0) - Number(a.candidate.latestTs || 0);
    })
    .slice(0, limit)
    .map((entry) => entry.candidate);

  return scored;
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function formatDateISO(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}
