import { $, $all, debounce } from "./helpers.js";
import { withBasePath } from "./config.js";

function buildCatalogUrl(query) {
  const url = new URL(withBasePath(""), window.location.origin);
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  const cleanedQuery = String(query || "").trim();
  if (cleanedQuery) {
    url.searchParams.set("q", cleanedQuery);
  }
  url.hash = "catalogo";
  return `${url.pathname}${url.search}${url.hash}`;
}

export function initGlobalSearch() {
  const forms = $all("[data-global-search-form]");
  const inputs = $all("[data-global-search-input]");
  const catalogSearch = $("#filter-search");
  const syncInputs = (value, origin) => {
    inputs.forEach((input) => {
      if (input !== origin && input.value !== value) {
        input.value = value;
      }
    });
  };

  const currentQuery = new URLSearchParams(window.location.search).get("q") || "";
  syncInputs(currentQuery);

  if (catalogSearch && catalogSearch.value !== currentQuery) {
    catalogSearch.value = currentQuery;
  }

  const syncCatalogSearch = debounce((value) => {
    if (!catalogSearch) {
      return;
    }
    if (catalogSearch.value !== value) {
      catalogSearch.value = value;
    }
    catalogSearch.dispatchEvent(new Event("input", { bubbles: true }));
  }, 160);

  inputs.forEach((input) => {
    input.addEventListener("input", (event) => {
      const value = event.currentTarget.value;
      syncInputs(value, event.currentTarget);
      if (catalogSearch) {
        syncCatalogSearch(value);
      }
    });
  });

  catalogSearch?.addEventListener("input", (event) => {
    syncInputs(event.currentTarget.value);
  });

  forms.forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("[data-global-search-input]", form);
      const nextUrl = buildCatalogUrl(input?.value || "");
      if (catalogSearch) {
        syncCatalogSearch(input?.value || "");
        document.getElementById("catalogo")?.scrollIntoView({ behavior: "smooth", block: "start" });
        window.history.replaceState({}, "", nextUrl);
        return;
      }
      window.location.href = nextUrl;
    });
  });
}
