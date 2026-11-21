import { getConfig, withBasePath } from "./config.js";
import { $, $all, debounce, readJsonScript, updateLiveRegion } from "./helpers.js";
import { OrderStore } from "./order.js";

const PAGE_SIZE = 24;

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function bySort(sort, products) {
  const list = [...products];
  if (sort === "mais-vendidos") {
    return list.sort((a, b) => {
      const scoreDiff = Number(b.popularityScore || 0) - Number(a.popularityScore || 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return Number(b.latestTs || 0) - Number(a.latestTs || 0);
    });
  }
  if (sort === "recentes") {
    return list.sort((a, b) => Number(b.latestTs || 0) - Number(a.latestTs || 0));
  }
  if (sort === "az") {
    return list.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt"));
  }
  return list.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function scoreProduct(product, query) {
  if (!query) {
    return 0;
  }
  const haystack = normalizeText(
    [product.name, product.brandLabel, product.categoryLabel, product.gender].join(" ")
  );
  if (haystack.startsWith(query)) {
    return 10;
  }
  if (haystack.includes(query)) {
    return 5;
  }
  return 0;
}

function applyFilters(products, state) {
  const query = normalizeText(state.q);
  return bySort(
    state.sort,
    products
      .map((product) => ({
        ...product,
        score: scoreProduct(product, query)
      }))
      .filter((product) => {
        if (query && product.score === 0) {
          return false;
        }
        if (state.brand && product.brandSlug !== state.brand) {
          return false;
        }
        if (state.category && product.category !== state.category) {
          return false;
        }
        if (state.gender && product.genderSlug !== state.gender) {
          return false;
        }
        if (state.size && !product.sizes.includes(state.size)) {
          return false;
        }
        if (state.price && product.priceType !== state.price) {
          return false;
        }
        return true;
      })
  );
}

function getStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const config = getConfig();
  return {
    q: params.get("q") || "",
    brand: params.get("brand") || "",
    category: params.get("category") || "",
    gender: params.get("gender") || "",
    size: params.get("size") || "",
    price: params.get("price") || "",
    sort: params.get("sort") || config.catalog?.defaultSort || "relevancia"
  };
}

function syncUrl(state) {
  const params = new URLSearchParams();
  Object.entries(state).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  const next = params.toString();
  const url = `${window.location.pathname}${next ? `?${next}` : ""}`;
  window.history.replaceState({}, "", url);
}

function cardMarkup(product) {
  return `
    <article class="catalog-card">
      <a class="catalog-card__link" href="${product.url}">
        <div class="catalog-card__media">
          <span class="skeleton" aria-hidden="true"></span>
          <img src="${product.coverImage}" alt="${product.name}" loading="lazy" width="${product.coverWidth}" height="${product.coverHeight}">
          <div class="catalog-card__badges">
            ${product.badges
              .map((badge) => `<span class="badge badge--${badge.tone}">${badge.label}</span>`)
              .join("")}
          </div>
        </div>
        <div class="catalog-card__body">
          <div class="catalog-card__meta">
            <span class="catalog-card__brand">${product.brandLabel}</span>
            <span class="catalog-card__price">${product.priceLabel}</span>
          </div>
          <h3 class="catalog-card__name">${product.name}</h3>
          <p class="catalog-card__ref">Ref. ${product.refCode || product.slug}</p>
        </div>
      </a>
      <div class="catalog-card__foot">
        <a class="catalog-card__button" href="${product.url}">Ver artigo</a>
        <button class="catalog-card__button catalog-card__button--primary" type="button" data-quick-add="${product.slug}">Adicionar ao carrinho</button>
      </div>
    </article>
  `;
}

function renderOptions(select, options, label) {
  if (!select) {
    return;
  }
  select.innerHTML = [`<option value="">${label}</option>`]
    .concat(options.map((option) => `<option value="${option.value}">${option.label}</option>`))
    .join("");
}

export async function initCatalogPage(orderStore) {
  const bootstrap = readJsonScript("st-catalog-bootstrap");
  const catalogUrl = bootstrap?.summaryUrl || withBasePath("data/catalog/summary.json");
  const response = await fetch(catalogUrl, { cache: "no-store" });
  const summary = await response.json();
  const products = summary.products || [];
  const grid = $("#catalog-grid");
  const emptyState = $("#catalog-empty");
  const count = $("#catalog-count");
  const loadMore = $("#catalog-load-more");
  const filtersSummary = $("#filters-summary");
  const quickModal = $("#quick-modal");
  const quickBackdrop = $("#modal-backdrop");
  const quickBody = $("#quick-modal-body");
  let visible = PAGE_SIZE;
  let state = getStateFromUrl();
  let filtered = applyFilters(products, state);

  renderOptions($("#filter-brand"), summary.filters.brands || [], "Marca");
  renderOptions($("#filter-category"), summary.filters.categories || [], "Categoria");
  renderOptions($("#filter-gender"), summary.filters.genders || [], "Género");
  renderOptions($("#filter-size"), summary.filters.sizes || [], "Tamanho");

  const controls = {
    q: $("#filter-search"),
    brand: $("#filter-brand"),
    category: $("#filter-category"),
    gender: $("#filter-gender"),
    size: $("#filter-size"),
    price: $("#filter-price"),
    sort: $("#filter-sort")
  };

  Object.entries(controls).forEach(([key, input]) => {
    if (input) {
      input.value = state[key] || "";
    }
  });

  function updateFilterSummary() {
    const activeCount = [state.brand, state.category, state.gender, state.size, state.price]
      .filter(Boolean)
      .length;
    if (filtersSummary) {
      filtersSummary.textContent = String(activeCount);
      filtersSummary.hidden = activeCount === 0;
    }
  }

  function closeQuickModal() {
    if (!quickModal || !quickBackdrop) {
      return;
    }
    quickModal.classList.remove("is-open");
    quickBackdrop.classList.remove("is-open");
    quickModal.hidden = true;
    quickBackdrop.hidden = true;
    document.body.classList.remove("no-scroll");
  }

  function openQuickModal(product) {
    if (!quickModal || !quickBackdrop || !quickBody) {
      window.location.href = product.url;
      return;
    }
    quickBody.innerHTML = `
      <h2 class="drawer-title">${product.name}</h2>
      <p class="helper-text">${product.brandLabel} · ${product.priceLabel} · Ref. ${product.refCode || product.slug}</p>
      <div class="selector">
        <div class="selector__label"><strong>Tamanho</strong><span>Obrigatório</span></div>
        <div class="selector__chips">
          ${product.sizes
            .map((size, index) => `<button class="size-chip${index === 0 ? " is-active" : ""}" type="button" data-size="${size}">${size}</button>`)
            .join("")}
        </div>
      </div>
      <div class="field-block">
        <button class="button button--primary" type="button" data-confirm-add>Adicionar ao carrinho</button>
      </div>
      <p class="inline-note">${getConfig().catalog?.shippingNotice || ""}</p>
    `;
    let activeSize = product.sizes[0] || "";
    $all("[data-size]", quickBody).forEach((button) => {
      button.addEventListener("click", () => {
        activeSize = button.dataset.size || "";
        $all("[data-size]", quickBody).forEach((node) => node.classList.remove("is-active"));
        button.classList.add("is-active");
      });
    });
    $("[data-confirm-add]", quickBody)?.addEventListener("click", () => {
      orderStore.add({
        slug: product.slug,
        refCode: product.refCode,
        name: product.name,
        brandLabel: product.brandLabel,
        size: activeSize,
        sizeOptions: product.sizes,
        quantity: 1,
        priceLabel: product.priceLabel,
        priceValue: product.priceValue,
        priceType: product.priceType,
        image: product.coverImage,
        url: product.absoluteUrl
      });
      closeQuickModal();
    });

    quickModal.hidden = false;
    quickBackdrop.hidden = false;
    quickModal.classList.add("is-open");
    quickBackdrop.classList.add("is-open");
    document.body.classList.add("no-scroll");
  }

  quickBackdrop?.addEventListener("click", closeQuickModal);
  $all("[data-close-modal]").forEach((button) => button.addEventListener("click", closeQuickModal));

  function bindQuickAdd() {
    $all("[data-quick-add]").forEach((button) => {
      if (button.dataset.bound === "1") {
        return;
      }
      button.dataset.bound = "1";
      button.addEventListener("click", () => {
        const product = products.find((entry) => entry.slug === button.dataset.quickAdd);
        if (product) {
          openQuickModal(product);
        }
      });
    });
  }

  function render() {
    filtered = applyFilters(products, state);
    const sliced = filtered.slice(0, visible);
    if (grid) {
      grid.innerHTML = sliced.map(cardMarkup).join("");
    }
    bindQuickAdd();
    if (count) {
      count.textContent = `${filtered.length} artigos encontrados`;
    }
    if (emptyState) {
      emptyState.hidden = filtered.length > 0;
    }
    if (loadMore) {
      loadMore.hidden = visible >= filtered.length;
    }
    updateFilterSummary();
    updateLiveRegion(`${filtered.length} artigos filtrados.`);
  }

  Object.entries(controls).forEach(([key, input]) => {
    if (!input) {
      return;
    }
    const handler = key === "q"
      ? debounce((value) => {
          state = { ...state, [key]: value };
          visible = PAGE_SIZE;
          syncUrl(state);
          render();
        })
      : (event) => {
          state = { ...state, [key]: event.currentTarget.value };
          visible = PAGE_SIZE;
          syncUrl(state);
          render();
        };
    if (key === "q") {
      input.addEventListener("input", (event) => {
        handler(event.currentTarget.value);
      });
    } else {
      input.addEventListener("change", handler);
    }
  });

  loadMore?.addEventListener("click", () => {
    visible += PAGE_SIZE;
    render();
  });

  render();
}

export function initCatalogApp() {
  const orderStore = new OrderStore();
  return initCatalogPage(orderStore);
}
