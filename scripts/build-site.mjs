import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import config from "../site_config.js";
import {
  buildProductLink,
  escapeHtml,
  formatDateISO,
  getAvailability,
  getBrandLabel,
  getCategoryLabel,
  getCoverImage,
  getGender,
  getModelLabel,
  getPriceInfo,
  getProductBadges,
  getRelatedProducts,
  getSizeContext,
  isNewProduct,
  joinUrl,
  normalizeText,
  stripHtml
} from "../js/shared/catalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "imagens", "telegram_manifest.json");
const STATE_PATH = path.join(ROOT, "data", "estado.json");
const CHUNK_SIZE = 64;

function buildProductRef(slug) {
  const digest = crypto
    .createHash("md5")
    .update(String(slug || "").trim().toLowerCase())
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();
  return `ST-${digest}`;
}

function getBasePath() {
  try {
    const url = new URL(config.baseUrl);
    return url.pathname.replace(/\/+$/, "");
  } catch (_error) {
    return "";
  }
}

function assetUrl(relativePath) {
  return joinUrl(getBasePath(), relativePath);
}

function absoluteUrl(relativePath) {
  const base = String(config.baseUrl || "").replace(/\/+$/, "");
  const clean = String(relativePath || "").replace(/^\/+/, "");
  return `${base}/${clean}`;
}

const FEATURED_REF_CODES = Array.isArray(config.catalog?.featuredRefCodes)
  ? config.catalog.featuredRefCodes.map((value) => String(value || "").trim()).filter(Boolean)
  : [];

const POPULAR_TERMS = Array.isArray(config.catalog?.popularSearchTerms)
  ? config.catalog.popularSearchTerms.map((value) => normalizeText(value)).filter(Boolean)
  : [];

const POPULAR_BRAND_TOKENS = new Set(["adidas", "nike", "asics", "new balance", "newbalance"]);

function buildPopularityScore(product) {
  const haystack = normalizeText([
    product?.name,
    product?.brandLabel,
    product?.category,
    product?.modelLabel
  ].filter(Boolean).join(" "));
  let score = 0;

  const refIndex = FEATURED_REF_CODES.indexOf(String(product?.refCode || "").trim());
  if (refIndex >= 0) {
    score += 100000 - refIndex * 1000;
  }

  POPULAR_TERMS.forEach((term, index) => {
    if (term && haystack.includes(term)) {
      score += 6000 - index * 50;
    }
  });

  if (normalizeText(product?.category) === "sneakers") {
    score += 250;
  }

  if (POPULAR_BRAND_TOKENS.has(normalizeText(product?.brandLabel))) {
    score += 120;
  }

  if (isNewProduct(product)) {
    score += 40;
  }

  score += Number(product?.latestTs || 0) / 1e10;
  return Number(score.toFixed(4));
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

async function ensureDir(filePath) {
  await fs.mkdir(filePath, { recursive: true });
}

async function removePath(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

async function writeText(filePath, contents) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, contents, "utf8");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function getImageSize(relativePath) {
  const normalized = String(relativePath || "").replace(/^\//, "");
  const absolutePath = path.join(ROOT, normalized);
  try {
    const buffer = await fs.readFile(absolutePath);
    if (buffer.length < 24) {
      return { width: 1200, height: 1500 };
    }
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20)
      };
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7)
          };
        }
        offset += 2 + length;
      }
    }
    if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
      const chunk = buffer.toString("ascii", 12, 16);
      if (chunk === "VP8X") {
        return {
          width: 1 + buffer.readUIntLE(24, 3),
          height: 1 + buffer.readUIntLE(27, 3)
        };
      }
    }
  } catch (_error) {
    return { width: 1200, height: 1500 };
  }
  return { width: 1200, height: 1500 };
}

async function getPreferredImagePath(relativePath) {
  const extension = path.extname(relativePath);
  if (!extension) {
    return relativePath;
  }
  const webpPath = relativePath.slice(0, -extension.length) + ".webp";
  if (await fileExists(path.join(ROOT, webpPath))) {
    return webpPath;
  }
  return relativePath;
}

function dedupeOptions(values) {
  return [...new Map(values.map((entry) => [entry.value, entry])).values()];
}

function navMarkup(currentPath) {
  const items = [
    { href: assetUrl(""), label: "Catálogo" },
    { href: assetUrl("como-funciona/"), label: "Como funciona" },
    { href: assetUrl("trocas-devolucoes/"), label: "Trocas" },
    { href: assetUrl("privacidade/"), label: "Privacidade" }
  ];

  return items
    .map((item) => {
      const active = currentPath === item.href ? ' aria-current="page"' : "";
      return `<a href="${item.href}"${active}>${item.label}</a>`;
    })
    .join("");
}

function topbarMarkup(currentPath) {
  return `
    <header class="topbar">
      <div class="container topbar__inner">
        <a class="brand" href="${assetUrl("")}" aria-label="${escapeHtml(config.siteName)}">
          <span class="brand__mark">ST</span>
          <span class="brand__text">
            <strong class="brand__name">${escapeHtml(config.siteName)}</strong>
            <span class="brand__meta">Pedido por WhatsApp · pt-PT</span>
          </span>
        </a>
        <nav class="topbar__nav">${navMarkup(currentPath)}</nav>
        <div class="topbar__actions">
          <button class="theme-toggle" type="button" data-theme-toggle aria-label="${escapeHtml(config.ui.themeToggleLabel)}">◐</button>
          <button class="icon-button" type="button" data-open-order aria-label="${escapeHtml(config.catalog.orderCtaLabel)}">
            <span aria-hidden="true">🛒</span>
            <span class="sr-only">Ir para o carrinho</span>
          </button>
        </div>
      </div>
      <div class="container topbar__search-row">
        <form class="topbar-search searchbox" data-global-search-form role="search" action="${assetUrl("")}">
          <span aria-hidden="true">⌕</span>
          <input
            data-global-search-input
            type="search"
            name="q"
            placeholder="Pesquisar no catálogo a partir de qualquer página"
            autocomplete="off"
          >
          <button class="topbar-search__submit" type="submit">Pesquisar</button>
        </form>
      </div>
    </header>
  `;
}

function footerMarkup() {
  return `
    <footer class="footer">
      <div class="container footer__compact">
        <p><strong>${escapeHtml(config.seller.displayName || config.siteName)}</strong></p>
        <p><a href="https://wa.me/${escapeHtml(config.support.whatsappNumber)}">${escapeHtml(config.support.whatsappLabel)}</a></p>
        <p><a href="${escapeHtml(config.support.telegramUrl)}" target="_blank" rel="noopener">${escapeHtml(config.support.telegramLabel)}</a></p>
      </div>
    </footer>
  `;
}

function drawerMarkup() {
  return `
    <div class="drawer-backdrop" id="drawer-backdrop" hidden></div>
    <aside class="order-drawer" id="order-drawer" hidden aria-labelledby="order-title" aria-modal="true" role="dialog">
      <div class="order-drawer__head">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div>
            <h2 class="drawer-title" id="order-title">Carrinho</h2>
            <p class="helper-text">Stock, preço final e envio são confirmados no WhatsApp.</p>
          </div>
          <button class="icon-button" type="button" data-close-order aria-label="Fechar pedido">×</button>
        </div>
      </div>
      <div class="order-drawer__body">
        <label class="text-field">
          <span class="sr-only">Nome opcional</span>
          <input id="order-customer-name" type="text" placeholder="Nome (opcional)">
        </label>
        <div class="empty-state" id="order-empty">
          <p>Ainda não tens artigos no pedido.</p>
          <p>Escolhe o artigo, confirma o tamanho e depois envia tudo pelo WhatsApp.</p>
        </div>
        <div id="order-items"></div>
      </div>
      <div class="order-drawer__footer">
        <p class="helper-text">Artigos: <strong data-order-count>0</strong> · Total estimado: <strong data-order-total>0€</strong></p>
        <div style="display:grid; gap:10px;">
          <button class="button button--primary" id="order-send" type="button">Finalizar compra</button>
          <button class="button" id="order-copy" type="button">Copiar pedido</button>
          <button class="button" id="order-clear" type="button">Limpar carrinho</button>
        </div>
      </div>
    </aside>
    <div class="order-toolbar">
      <div class="order-toolbar__inner">
        <div class="order-toolbar__summary">
          <strong><span data-order-count>0</span> artigos no pedido</strong>
          <span>Total estimado <span data-order-total>0€</span></span>
        </div>
        <button class="button button--primary" type="button" data-open-order>${escapeHtml(config.catalog.orderCtaLabel)}</button>
      </div>
    </div>
    <div class="modal-backdrop" id="modal-backdrop" hidden></div>
    <section class="quick-modal" id="quick-modal" hidden aria-modal="true" role="dialog" aria-labelledby="quick-modal-title">
      <div class="quick-modal__content">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <h2 class="drawer-title" id="quick-modal-title">Adicionar ao carrinho</h2>
          <button class="icon-button" type="button" data-close-modal aria-label="Fechar modal">×</button>
        </div>
        <div id="quick-modal-body"></div>
      </div>
    </section>
    <div class="toast" id="st-toast" hidden role="status" aria-live="polite"></div>
    <div class="sr-only" id="st-live-region" aria-live="polite"></div>
  `;
}

function headMarkup({ title, description, canonicalPath, imagePath, extraMeta = "" }) {
  const canonical = absoluteUrl(canonicalPath);
  const image = absoluteUrl(imagePath || config.defaultOgImage);
  return `
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:type" content="website">
    <meta property="og:locale" content="${escapeHtml(config.locale)}">
    <meta property="og:site_name" content="${escapeHtml(config.siteName)}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${image}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${image}">
    <meta name="twitter:site" content="${escapeHtml(config.seo.twitterHandle || "")}">
    <link rel="icon" href="${assetUrl("favicon.svg")}" type="image/svg+xml">
    <link rel="shortcut icon" href="${assetUrl("favicon.svg")}" type="image/svg+xml">
    <meta name="theme-color" content="#111111">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&display=swap">
    <link rel="stylesheet" href="${assetUrl("css/tokens.css")}">
    <link rel="stylesheet" href="${assetUrl("css/app.css")}">
    ${extraMeta}
  `;
}

function pageDocument({ title, description, canonicalPath, imagePath, bodyClass = "", currentPath, main, bootstrapJson = "", scriptPath, extraMeta = "" }) {
  return `<!doctype html>
<html lang="${escapeHtml(config.language)}">
  <head>
    ${headMarkup({ title, description, canonicalPath, imagePath, extraMeta })}
  </head>
  <body class="${bodyClass}">
    ${topbarMarkup(assetUrl(currentPath))}
    <div class="shell">
      ${main}
    </div>
    ${footerMarkup()}
    ${drawerMarkup()}
    ${bootstrapJson}
    <script type="module" src="${assetUrl("site_config.js")}"></script>
    <script type="module" src="${assetUrl(scriptPath)}"></script>
  </body>
</html>`;
}

function renderCard(product, options = {}) {
  const singleAction = options.quickAdd === false;
  const quickAction = singleAction
    ? `<a class="catalog-card__button catalog-card__button--primary" href="${product.url}">Ver artigo</a>`
    : `<button class="catalog-card__button catalog-card__button--primary" type="button" data-quick-add="${escapeHtml(product.slug)}">Adicionar ao carrinho</button>`;
  return `
    <article class="catalog-card">
      <a class="catalog-card__link" href="${product.url}">
        <div class="catalog-card__media">
          <span class="skeleton" aria-hidden="true"></span>
          <img src="${product.coverImage}" alt="${escapeHtml(product.name)}" loading="lazy" width="${product.coverWidth}" height="${product.coverHeight}">
          <div class="catalog-card__badges">
            ${product.badges
              .map((badge) => `<span class="badge badge--${badge.tone}">${escapeHtml(badge.label)}</span>`)
              .join("")}
          </div>
        </div>
        <div class="catalog-card__body">
          <div class="catalog-card__meta">
            <span class="catalog-card__brand">${escapeHtml(product.brandLabel)}</span>
            <span class="catalog-card__price">${escapeHtml(product.priceLabel)}</span>
          </div>
          <h3 class="catalog-card__name">${escapeHtml(product.name)}</h3>
          <p class="catalog-card__ref">Ref. ${escapeHtml(product.refCode)}</p>
        </div>
      </a>
      <div class="catalog-card__foot${singleAction ? " catalog-card__foot--single" : ""}">
        ${singleAction ? "" : `<a class="catalog-card__button" href="${product.url}">Ver artigo</a>`}
        ${quickAction}
      </div>
    </article>
  `;
}

function heroMarkup() {
  const lines =
    Array.isArray(config.catalog?.heroTitleLines) && config.catalog.heroTitleLines.length
      ? config.catalog.heroTitleLines
      : [config.catalog.heroTitle];
  const titleHtml = lines
    .filter(Boolean)
    .map((line, index) =>
      index === 0
        ? escapeHtml(line)
        : `<span class="hero__title-outline">${escapeHtml(line)}</span>`
    )
    .join("<br>");
  const whatsappLink = `https://wa.me/${encodeURIComponent(config.support.whatsappNumber)}`;

  return `
    <section class="hero hero--home">
      <div class="container hero--home__inner">
        <p class="hero__eyebrow">${escapeHtml(config.catalog.heroEyebrow || "")}</p>
        <h1 class="hero__title">${titleHtml}</h1>
        <p class="hero__lead">${escapeHtml(config.catalog.heroIntro || "")}</p>
        <div class="hero__actions">
          <a class="button button--primary" href="#catalogo">${escapeHtml(config.catalog.heroCtaLabel)}</a>
          <a class="button button--ghost" href="${whatsappLink}" target="_blank" rel="noopener">${escapeHtml(config.catalog.heroSecondaryCtaLabel)}</a>
        </div>
      </div>
    </section>
  `;
}

function marqueeMarkup() {
  const items = Array.isArray(config.catalog?.marqueeItems)
    ? config.catalog.marqueeItems.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!items.length) {
    return "";
  }
  const track = items
    .map(
      (item) =>
        `<span class="marquee__item">${escapeHtml(item)}<span class="marquee__dot" aria-hidden="true">✦</span></span>`
    )
    .join("");
  return `
    <div class="marquee" aria-hidden="true">
      <div class="marquee__track">
        <span class="marquee__group">${track}</span>
        <span class="marquee__group">${track}</span>
      </div>
    </div>
  `;
}

function stepsMarkup() {
  const steps = Array.isArray(config.catalog?.steps) ? config.catalog.steps : [];
  if (!steps.length) {
    return "";
  }
  const cards = steps
    .map(
      (step, index) => `
        <article class="step-card">
          <p class="step-card__num">${String(index + 1).padStart(2, "0")}</p>
          <h3 class="step-card__title">${escapeHtml(step.title)}</h3>
          <p class="step-card__text">${escapeHtml(step.text)}</p>
        </article>
      `
    )
    .join("");
  return `
    <section class="steps-section">
      <div class="container">
        <div class="section-head">
          <div>
            <h2>Como funciona o pedido</h2>
            <p>${escapeHtml(config.catalog.shippingNotice)}</p>
          </div>
        </div>
        <div class="steps-grid">${cards}</div>
      </div>
    </section>
  `;
}

function buildHomePage(featuredProducts) {
  const featuredHtml = featuredProducts.map(renderCard).join("");
  const bootstrapJson = `<script id="st-catalog-bootstrap" type="application/json">${JSON.stringify({
    summaryUrl: assetUrl("data/catalog/summary.json")
  })}</script>`;

  const main = `
    <main>
      ${heroMarkup()}
      ${marqueeMarkup()}
      <section class="catalog-section catalog-section--home" id="catalogo">
        <div class="container">
          <div class="section-head">
            <div>
              <h1>Catálogo</h1>
              <p>Escolhe os artigos, define o tamanho e envia o pedido por WhatsApp. O stock, o preço final e o envio são confirmados depois.</p>
            </div>
            <p id="catalog-count">A carregar catálogo...</p>
          </div>

          <div class="filters" aria-label="Filtros do catálogo">
            <label class="searchbox">
              <span aria-hidden="true">⌕</span>
              <input id="filter-search" type="search" placeholder="Pesquisar por marca, modelo ou categoria">
            </label>
            <details class="filter-dropdown" id="filters-disclosure">
              <summary class="filters-toggle" id="filters-toggle">
                <span>Filtros</span>
                <strong id="filters-summary" hidden>0</strong>
              </summary>
              <section class="filters-panel" id="filters-panel" aria-label="Opções de filtro">
                <div class="filters-panel__head">
                  <h2>Filtros</h2>
                </div>
                <div class="filters-panel__grid">
                  <label class="select-field"><span class="sr-only">Marca</span><select id="filter-brand"></select></label>
                  <label class="select-field"><span class="sr-only">Categoria</span><select id="filter-category"></select></label>
                  <label class="select-field"><span class="sr-only">Género</span><select id="filter-gender"></select></label>
                  <label class="select-field"><span class="sr-only">Tamanho</span><select id="filter-size"></select></label>
                  <label class="select-field">
                    <span class="sr-only">Tipo de preço</span>
                    <select id="filter-price">
                      <option value="">Preço</option>
                      <option value="fixed">40€</option>
                      <option value="consult">Só consulta</option>
                    </select>
                  </label>
                  <label class="select-field">
                    <span class="sr-only">Ordenar</span>
                    <select id="filter-sort">
                      <option value="mais-vendidos">Mais vendidos</option>
                      <option value="relevancia">Relevância</option>
                      <option value="recentes">Mais recentes</option>
                      <option value="az">A → Z</option>
                    </select>
                  </label>
                </div>
              </section>
            </details>
          </div>

          <div class="catalog-grid" id="catalog-grid">${featuredHtml}</div>
          <div class="empty-state" id="catalog-empty" hidden>
            <p>Não encontrámos artigos com estes filtros.</p>
            <p>Limpa alguns filtros ou tenta outro termo.</p>
          </div>
          <div style="display:flex; justify-content:center; margin-top:22px;">
            <button class="button" id="catalog-load-more" type="button">Ver mais artigos</button>
          </div>
        </div>
      </section>
      ${stepsMarkup()}
    </main>
  `;

  return pageDocument({
    title: config.seo.title,
    description: config.seo.description,
    canonicalPath: "",
    imagePath: config.defaultOgImage,
    currentPath: "",
    main,
    bootstrapJson,
    scriptPath: "js/main.js"
  });
}

function productJsonLd(product) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    image: product.images.map((image) => image.absoluteUrl),
    description: product.description,
    brand: {
      "@type": "Brand",
      name: product.brandLabel
    },
    sku: product.slug,
    category: product.categoryLabel,
    url: product.absoluteUrl,
    offers: {
      "@type": "Offer",
      priceCurrency: config.currency,
      price: product.priceValue || config.catalog.fixedPriceValue,
      availability:
        product.availability === "esgotado"
          ? "https://schema.org/OutOfStock"
          : "https://schema.org/InStock",
      url: product.absoluteUrl
    }
  };
  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

function buildProductPage(product) {
  const pageData = `<script id="st-product-data" type="application/json">${JSON.stringify({
    product
  })}</script>`;

  const relatedHtml = product.related.map((relatedProduct) => renderCard(relatedProduct, { quickAdd: false })).join("");
  const galleryThumbs = product.images
    .map(
      (image, index) => `
        <button class="gallery__thumb${index === 0 ? " is-active" : ""}" type="button" data-gallery-thumb data-image="${image.url}" data-alt="${escapeHtml(image.alt)}">
          <img src="${image.url}" alt="${escapeHtml(image.alt)}" loading="lazy" width="${image.width}" height="${image.height}">
        </button>
      `
    )
    .join("");

  const sizeGuideText =
    product.sizeType === "shoes"
      ? "Guia simples: escolhe o número EU que costumas usar. Se estiveres entre dois tamanhos, confirma no WhatsApp antes de enviar."
      : product.sizeType === "clothing"
        ? "Guia simples: XS a XXL. Se quiseres confirmar medidas, envia o pedido e valida no WhatsApp."
        : "Este artigo usa tamanho único.";

  const main = `
    <main class="page-layout container">
      <section class="product-grid">
        <div class="gallery">
          <div class="gallery__main">
            <button id="product-open-zoom" type="button" style="all:unset; display:block; width:100%; height:100%; cursor:zoom-in;">
              <img id="product-main-image" src="${product.images[0].url}" alt="${escapeHtml(product.images[0].alt)}" width="${product.images[0].width}" height="${product.images[0].height}">
            </button>
          </div>
          <div class="gallery__thumbs">${galleryThumbs}</div>
        </div>
      </section>
      <section class="product-panel">
        <p class="catalog-card__brand">${escapeHtml(product.brandLabel)} · ${escapeHtml(product.categoryLabel)}</p>
        <h1 class="product-title">${escapeHtml(product.name)}</h1>
        <p class="product-ref">Ref. ${escapeHtml(product.refCode)}</p>
        <p class="product-meta">${escapeHtml(product.description)}</p>
        <div class="chip-row">
          ${product.badges.map((badge) => `<span class="badge badge--${badge.tone}">${escapeHtml(badge.label)}</span>`).join("")}
        </div>
        <div class="price-line">
          <span class="price-line__value">${escapeHtml(product.priceLabel)}</span>
          <span class="price-line__hint">Preço final e envio confirmados no WhatsApp.</span>
        </div>
        <div class="selector">
          <div class="selector__label">
            <strong>${escapeHtml(product.sizeLabel)}</strong>
            <button class="chip" id="size-guide-open" type="button">Guia de tamanhos</button>
          </div>
          <div class="selector__chips">
            ${product.sizes
              .map((size, index) => `<button class="size-chip${index === 0 ? " is-active" : ""}" type="button" data-product-size="${escapeHtml(size)}">${escapeHtml(size)}</button>`)
              .join("")}
          </div>
        </div>
        <div class="field-block">
          <p class="inline-note">${escapeHtml(config.catalog.shippingNotice)}</p>
        </div>
        <div class="hero__actions">
          <button class="button button--primary" id="product-add" type="button">Adicionar ao carrinho</button>
          <button class="button" id="product-buy-now" type="button">Comprar agora</button>
        </div>
      </section>
      <section class="container" style="grid-column:1 / -1; padding-bottom:56px;">
        <div class="section-head">
          <div>
            <h2>Relacionados</h2>
            <p>Mais opções dentro da mesma marca ou categoria.</p>
          </div>
        </div>
        <div class="related-grid">${relatedHtml}</div>
      </section>
    </main>
    <div class="modal-backdrop" id="zoom-backdrop" hidden></div>
    <section class="zoom-modal" id="zoom-modal" hidden aria-modal="true" role="dialog">
      <div class="zoom-modal__content">
        <div style="display:flex; justify-content:flex-end;">
          <button class="icon-button" type="button" data-close-zoom aria-label="Fechar zoom">×</button>
        </div>
        <img id="zoom-image" src="${product.images[0].url}" alt="${escapeHtml(product.images[0].alt)}" width="${product.images[0].width}" height="${product.images[0].height}">
      </div>
    </section>
    <div class="modal-backdrop" id="size-guide-backdrop" hidden></div>
    <section class="size-guide-modal" id="size-guide-modal" hidden aria-modal="true" role="dialog">
      <div class="size-guide-modal__content">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <h2 class="drawer-title">Guia de tamanhos</h2>
          <button class="icon-button" type="button" data-close-guide aria-label="Fechar guia">×</button>
        </div>
        <p>${escapeHtml(sizeGuideText)}</p>
      </div>
    </section>
  `;

  return pageDocument({
    title: `${product.name} | ${config.siteName}`,
    description: product.description,
    canonicalPath: `produto/${product.slug}/`,
    imagePath: product.coverPath,
    currentPath: `produto/${product.slug}/`,
    main,
    bootstrapJson: `${pageData}${productJsonLd(product)}`,
    scriptPath: "js/product-page.js"
  });
}

function buildInfoPage({ slug, title, intro, sections }) {
  const blocks = sections
    .map(
      (section) => `
        <article class="notice-card">
          <h2 class="notice-card__title">${escapeHtml(section.title)}</h2>
          ${section.body.map((line) => `<p class="notice-card__text">${escapeHtml(line)}</p>`).join("")}
        </article>
      `
    )
    .join("");

  const main = `
    <main class="catalog-section">
      <div class="container">
        <div class="section-head">
          <div>
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(intro)}</p>
          </div>
        </div>
        <div class="info-strip">${blocks}</div>
      </div>
    </main>
  `;

  return pageDocument({
    title: `${title} | ${config.siteName}`,
    description: intro,
    canonicalPath: `${slug}/`,
    imagePath: config.defaultOgImage,
    currentPath: `${slug}/`,
    main,
    scriptPath: "js/static-page.js"
  });
}

async function build() {
  const manifest = await readJson(MANIFEST_PATH, { products: [] });
  const state = await readJson(STATE_PATH, { items: {} });
  const imageMetaCache = new Map();
  const stateItems = state.items || {};
  const products = manifest.products || [];

  const normalizedProducts = [];

  for (const product of products) {
    const stateItem = stateItems[product.slug] || {};
    const brandLabel = getBrandLabel(product);
    const categoryLabel = getCategoryLabel(product.category);
    const gender = getGender(product);
    const genderSlug = normalizeText(gender).replace(/\s+/g, "-");
    const sizeContext = getSizeContext(product);
    const priceInfo = getPriceInfo(product, stateItem, config);
    const badges = getProductBadges(product, stateItem, config);
    const coverPath = await getPreferredImagePath(getCoverImage(product));
    const coverSize = imageMetaCache.get(coverPath) || (await getImageSize(coverPath));
    imageMetaCache.set(coverPath, coverSize);
    const url = buildProductLink(getBasePath(), product.slug);
    const absoluteProductUrl = new URL(url, config.baseUrl).toString();
    const description = `${brandLabel} · ${categoryLabel}. ${config.catalog.shippingNotice}`;
    const refCode = buildProductRef(product.slug);
    const images = [];

    for (const originalImagePath of product.images || []) {
      const imagePath = await getPreferredImagePath(originalImagePath);
      const meta = imageMetaCache.get(imagePath) || (await getImageSize(imagePath));
      imageMetaCache.set(imagePath, meta);
      images.push({
        path: imagePath,
        url: assetUrl(imagePath),
        absoluteUrl: absoluteUrl(imagePath),
        width: meta.width,
        height: meta.height,
        alt: `${product.name} · imagem ${images.length + 1}`
      });
    }

    normalizedProducts.push({
      slug: product.slug,
      refCode,
      name: product.name,
      brandLabel,
      brandSlug: normalizeText(product.brandSlug || brandLabel).replace(/\s+/g, "-"),
      category: normalizeText(product.category || "outros"),
      categoryLabel,
      modelLabel: getModelLabel(product),
      latestTs: Number(product.latestTs || 0),
      gender,
      genderSlug,
      sizeType: sizeContext.type,
      sizeLabel: sizeContext.label,
      sizes: sizeContext.sizes,
      availability: getAvailability(stateItem),
      isNew: isNewProduct(product),
      priceLabel: priceInfo.label,
      priceValue: priceInfo.value,
      priceType: priceInfo.type,
      badges,
      coverPath,
      coverImage: assetUrl(coverPath),
      coverWidth: coverSize.width,
      coverHeight: coverSize.height,
      url,
      absoluteUrl: absoluteProductUrl,
      images,
      description
    });
  }

  normalizedProducts.sort((a, b) => Number(b.latestTs || 0) - Number(a.latestTs || 0));

  const summaryProducts = normalizedProducts.map((product) => ({
    slug: product.slug,
    refCode: product.refCode,
    name: product.name,
    brandLabel: product.brandLabel,
    brandSlug: product.brandSlug,
    category: product.category,
    categoryLabel: product.categoryLabel,
    gender: product.gender,
    genderSlug: product.genderSlug,
    latestTs: product.latestTs,
    sizes: product.sizes,
    priceLabel: product.priceLabel,
    priceValue: product.priceValue,
    priceType: product.priceType,
    popularityScore: buildPopularityScore(product),
    badges: product.badges,
    coverImage: product.coverImage,
    coverWidth: product.coverWidth,
    coverHeight: product.coverHeight,
    url: product.url,
    absoluteUrl: product.absoluteUrl
  }));

  const filters = {
    brands: dedupeOptions(
      summaryProducts
        .filter((product) => product.brandLabel && product.brandLabel !== "Sem marca")
        .map((product) => ({ value: product.brandSlug, label: product.brandLabel }))
    ).sort((a, b) => a.label.localeCompare(b.label, "pt")),
    categories: dedupeOptions(
      summaryProducts.map((product) => ({ value: product.category, label: product.categoryLabel }))
    ).sort((a, b) => a.label.localeCompare(b.label, "pt")),
    genders: dedupeOptions(
      summaryProducts.map((product) => ({ value: product.genderSlug, label: product.gender }))
    ).sort((a, b) => a.label.localeCompare(b.label, "pt")),
    sizes: dedupeOptions(
      summaryProducts.flatMap((product) => product.sizes.map((size) => ({ value: size, label: size })))
    )
  };

  const featuredProducts = [...normalizedProducts].sort((a, b) => {
    const scoreDiff = Number(buildPopularityScore(b)) - Number(buildPopularityScore(a));
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return Number(b.latestTs || 0) - Number(a.latestTs || 0);
  });

  await removePath(path.join(ROOT, "produto"));
  await removePath(path.join(ROOT, "como-funciona"));
  await removePath(path.join(ROOT, "privacidade"));
  await removePath(path.join(ROOT, "trocas-devolucoes"));
  await removePath(path.join(ROOT, "data", "catalog"));

  const summary = {
    generatedAt: new Date().toISOString(),
    total: summaryProducts.length,
    chunkSize: CHUNK_SIZE,
    filters,
    products: summaryProducts
  };

  await writeText(path.join(ROOT, "data", "catalog", "summary.json"), JSON.stringify(summary, null, 2));

  for (let index = 0; index < summaryProducts.length; index += CHUNK_SIZE) {
    const chunk = summaryProducts.slice(index, index + CHUNK_SIZE);
    const chunkId = String(index / CHUNK_SIZE + 1).padStart(3, "0");
    await writeText(
      path.join(ROOT, "data", "catalog", "chunks", `chunk-${chunkId}.json`),
      JSON.stringify({ chunk: chunkId, products: chunk }, null, 2)
    );
  }

  await writeText(path.join(ROOT, "index.html"), buildHomePage(featuredProducts.slice(0, 12)));

  for (const product of normalizedProducts) {
    const fullProduct = {
      ...product,
      related: getRelatedProducts(product, normalizedProducts, 4)
    };
    await writeText(path.join(ROOT, "produto", product.slug, "index.html"), buildProductPage(fullProduct));
  }

  await writeText(
    path.join(ROOT, "como-funciona", "index.html"),
    buildInfoPage({
      slug: "como-funciona",
      title: "Como funciona",
      intro: "Este catálogo organiza o pedido, mas a confirmação final continua no WhatsApp.",
      sections: [
        {
          title: "Pedido não é compra finalizada",
          body: [
            "O cliente escolhe os artigos e tamanhos no site.",
            "Depois envia o pedido para o WhatsApp e só aí recebe confirmação de stock, preço final e custo de envio."
          ]
        },
        {
          title: "Pagamento e prazo",
          body: [config.seller.paymentPolicy, config.seller.shippingPolicy]
        },
        {
          title: "Acompanhamento",
          body: [
            "Todo o acompanhamento do pedido é feito no WhatsApp.",
            "Quando existir mais conteúdo visual, o canal de Telegram ajuda a validar fotos e vídeos reais."
          ]
        }
      ]
    })
  );

  await writeText(
    path.join(ROOT, "trocas-devolucoes", "index.html"),
    buildInfoPage({
      slug: "trocas-devolucoes",
      title: "Trocas e devoluções",
      intro: "Texto editável e honesto, sem promessas não confirmadas.",
      sections: [
        {
          title: config.seller.returnsPolicyTitle,
          body: [
            config.seller.returnsPolicyBody,
            "TODO: o dono deve confirmar o texto final antes de considerar esta política fechada."
          ]
        }
      ]
    })
  );

  await writeText(
    path.join(ROOT, "privacidade", "index.html"),
    buildInfoPage({
      slug: "privacidade",
      title: "Privacidade",
      intro: "O site é estático e guarda o pedido apenas no teu dispositivo.",
      sections: [
        {
          title: "Dados locais",
          body: [
            "O pedido e o nome opcional são guardados apenas no localStorage do navegador.",
            "O site não recolhe dados pessoais para servidor próprio."
          ]
        },
        {
          title: "Analytics",
          body: [
            config.analytics.enabled
              ? "Analytics sem cookies está ativo conforme a configuração pública."
              : "Analytics está desligado por defeito."
          ]
        }
      ]
    })
  );

  const notFoundHtml = pageDocument({
    title: `Página não encontrada | ${config.siteName}`,
    description: "A página pedida não existe ou foi movida.",
    canonicalPath: "404.html",
    imagePath: config.defaultOgImage,
    currentPath: "404.html",
    main: `
      <main class="catalog-section">
        <div class="container">
          <div class="empty-state">
            <h1>404</h1>
            <p>Não encontrámos esta página.</p>
            <p><a class="button button--primary" href="${assetUrl("")}">Voltar ao catálogo</a></p>
          </div>
        </div>
      </main>
    `,
    scriptPath: "js/static-page.js"
  });
  await writeText(path.join(ROOT, "404.html"), notFoundHtml);

  const staticRoutes = [
    "",
    "como-funciona/",
    "trocas-devolucoes/",
    "privacidade/",
    "404.html",
    ...normalizedProducts.map((product) => `produto/${product.slug}/`)
  ];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticRoutes
  .map((route) => {
    const clean = route === "" ? "" : route;
    return `  <url><loc>${absoluteUrl(clean)}</loc></url>`;
  })
  .join("\n")}
</urlset>`;
  await writeText(path.join(ROOT, "sitemap.xml"), sitemap);
  await writeText(
    path.join(ROOT, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${absoluteUrl("sitemap.xml")}\n`
  );

  if (!(await fileExists(path.join(ROOT, "imagens", "og-default.svg")))) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#111111" />
  <circle cx="970" cy="140" r="110" fill="#c7ff3d" opacity="0.9" />
  <text x="90" y="255" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="86" font-weight="700">Smart Things PT</text>
  <text x="90" y="345" fill="#d0d0cb" font-family="Inter, Arial, sans-serif" font-size="38">Catálogo estático com pedido por WhatsApp</text>
  <text x="90" y="430" fill="#c7ff3d" font-family="Inter, Arial, sans-serif" font-size="34">Sneakers · Roupa · Acessórios</text>
</svg>`;
    await writeText(path.join(ROOT, "imagens", "og-default.svg"), svg);
  }

  console.log(`Build concluído: ${normalizedProducts.length} produtos, ${Math.ceil(summaryProducts.length / CHUNK_SIZE)} chunks.`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
