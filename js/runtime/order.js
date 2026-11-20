import { getConfig, getAbsoluteUrl } from "./config.js";
import { $, $all, copyText, createFocusTrap, lockBody, randomCode, updateLiveRegion } from "./helpers.js";

function safeParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

function todayToken() {
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export class OrderStore {
  constructor() {
    const config = getConfig();
    this.config = config;
    this.storageKey = config.order?.storageKey || "smartthings_order_v1";
    this.nameKey = config.order?.customerNameKey || "smartthings_customer_name_v1";
    this.items = [];
    this.customerName = "";
    this.listeners = new Set();
    this.load();
  }

  load() {
    try {
      this.items = safeParse(window.localStorage.getItem(this.storageKey), []);
      if (!Array.isArray(this.items)) {
        this.items = [];
      }
      this.customerName = window.localStorage.getItem(this.nameKey) || "";
    } catch (_error) {
      this.items = [];
      this.customerName = "";
    }
  }

  save() {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.items));
      window.localStorage.setItem(this.nameKey, this.customerName);
    } catch (_error) {
      // LocalStorage is optional in private browsing or low-storage contexts.
    }
    this.emit();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  emit() {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  snapshot() {
    return {
      items: [...this.items],
      customerName: this.customerName,
      count: this.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      total: this.items.reduce(
        (sum, item) => sum + (item.priceValue != null ? Number(item.priceValue) * Number(item.quantity || 1) : 0),
        0
      ),
      hasConsult: this.items.some((item) => item.priceType === "consult")
    };
  }

  setCustomerName(name) {
    this.customerName = String(name || "").trim();
    this.save();
  }

  add(item) {
    const index = this.items.findIndex(
      (entry) => entry.slug === item.slug && entry.size === item.size
    );
    if (index >= 0) {
      this.items[index].quantity += Number(item.quantity || 1);
    } else {
      this.items.push({
        slug: item.slug,
        refCode: item.refCode || "",
        name: item.name,
        brandLabel: item.brandLabel,
        size: item.size,
        sizeOptions: Array.isArray(item.sizeOptions) && item.sizeOptions.length ? item.sizeOptions : [item.size],
        quantity: Number(item.quantity || 1),
        priceLabel: item.priceLabel,
        priceValue: item.priceValue ?? null,
        priceType: item.priceType || "fixed",
        image: item.image || "",
        url: item.url || getAbsoluteUrl(`produto/${encodeURIComponent(item.slug)}/`)
      });
    }
    this.save();
    updateLiveRegion("Artigo adicionado ao pedido.");
  }

  update(index, next) {
    if (!this.items[index]) {
      return;
    }
    this.items[index] = { ...this.items[index], ...next };
    this.save();
  }

  remove(index) {
    this.items.splice(index, 1);
    this.save();
    updateLiveRegion("Artigo removido do pedido.");
  }

  clear() {
    this.items = [];
    this.save();
  }

  canSubmit() {
    return this.items.length > 0 && this.items.every((item) => String(item.size || "").trim());
  }

  generateOrderCode() {
    return `${this.config.order?.codePrefix || "ST"}-${todayToken()}-${randomCode(4)}`;
  }

  buildMessage() {
    const code = this.generateOrderCode();
    const nameLine = this.customerName ? this.customerName : "";
    const lines = [
      `Pedido ${code}`,
      `Nome: ${nameLine}`
    ];

    this.items.forEach((item, index) => {
      const line = [
        `${index + 1}) ${item.refCode || item.slug.toUpperCase()}`,
        item.name,
        `Tam. ${item.size}`,
        `${item.quantity}x`,
        item.priceLabel,
        item.url
      ];
      lines.push(line.join(" | "));
    });

    const totalLine = this.snapshot().hasConsult
      ? `Total estimado: ${this.snapshot().total}€ + artigos sob consulta (preço final e envio confirmados no WhatsApp)`
      : `Total estimado: ${this.snapshot().total}€ (preço final e envio confirmados no WhatsApp)`;

    lines.push(totalLine);
    lines.push(this.config.order?.textBase || "");

    return {
      code,
      text: lines.filter(Boolean).join("\n")
    };
  }

  buildWhatsappUrl() {
    const support = this.config.support || {};
    const { text } = this.buildMessage();
    return `https://wa.me/${support.whatsappNumber}?text=${encodeURIComponent(text)}`;
  }
}

export function mountOrderUI(store) {
  const drawer = $("#order-drawer");
  const backdrop = $("#drawer-backdrop");
  const openButtons = $all("[data-open-order]");
  const closeButtons = $all("[data-close-order]");
  const list = $("#order-items");
  const countNodes = $all("[data-order-count]");
  const totalNodes = $all("[data-order-total]");
  const sendButton = $("#order-send");
  const copyButton = $("#order-copy");
  const clearButton = $("#order-clear");
  const nameInput = $("#order-customer-name");
  const emptyState = $("#order-empty");
  const trap = drawer ? createFocusTrap(drawer, closeDrawer) : null;

  function openDrawer() {
    if (!drawer || !backdrop) {
      return;
    }
    drawer.hidden = false;
    backdrop.hidden = false;
    drawer.classList.add("is-open");
    backdrop.classList.add("is-open");
    lockBody(true);
    trap?.activate();
  }

  function closeDrawer() {
    if (!drawer || !backdrop) {
      return;
    }
    drawer.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    lockBody(false);
    trap?.deactivate();
    window.setTimeout(() => {
      drawer.hidden = true;
      backdrop.hidden = true;
    }, 220);
  }

  openButtons.forEach((button) => button.addEventListener("click", openDrawer));
  closeButtons.forEach((button) => button.addEventListener("click", closeDrawer));
  backdrop?.addEventListener("click", closeDrawer);

  nameInput?.addEventListener("input", (event) => {
    store.setCustomerName(event.currentTarget.value);
  });

  clearButton?.addEventListener("click", () => {
    store.clear();
  });

  sendButton?.addEventListener("click", () => {
    if (!store.canSubmit()) {
      updateLiveRegion("Escolhe o tamanho de todos os artigos antes de enviar.");
      openDrawer();
      return;
    }
    window.open(store.buildWhatsappUrl(), "_blank", "noopener");
  });

  copyButton?.addEventListener("click", async () => {
    const { text } = store.buildMessage();
    await copyText(text);
    updateLiveRegion("Pedido copiado.");
  });

  store.subscribe((snapshot) => {
    countNodes.forEach((node) => {
      node.textContent = String(snapshot.count);
    });
    totalNodes.forEach((node) => {
      node.textContent = `${snapshot.total}€`;
    });

    if (nameInput && nameInput.value !== snapshot.customerName) {
      nameInput.value = snapshot.customerName;
    }

    if (!list || !emptyState) {
      return;
    }

    list.innerHTML = "";
    emptyState.hidden = snapshot.items.length > 0;
    snapshot.items.forEach((item, index) => {
      const article = document.createElement("article");
      article.className = "order-item";
      article.innerHTML = `
        <div class="order-item__top">
          <div class="order-item__media">${item.image ? `<img src="${item.image}" alt="${item.name}" loading="lazy">` : ""}</div>
          <div>
            <p class="order-item__name">${item.name}</p>
            <p class="order-item__meta">${item.brandLabel || "Sem marca"} · ${item.priceLabel}${item.refCode ? ` · Ref. ${item.refCode}` : ""}</p>
          </div>
        </div>
        <div class="order-item__controls">
          <label class="select-field">
            <span class="sr-only">Tamanho</span>
            <select data-order-size>
              ${item.sizeOptions
                .map((size) => `<option value="${size}"${size === item.size ? " selected" : ""}>${size}</option>`)
                .join("")}
            </select>
          </label>
          <label class="select-field">
            <span class="sr-only">Quantidade</span>
            <select data-order-qty>
              ${[1, 2, 3, 4, 5]
                .map((value) => `<option value="${value}"${value === item.quantity ? " selected" : ""}>${value}x</option>`)
                .join("")}
            </select>
          </label>
          <button class="icon-button" type="button" data-order-remove aria-label="Remover artigo">×</button>
        </div>
      `;

      const sizeSelect = article.querySelector("[data-order-size]");
      const qtySelect = article.querySelector("[data-order-qty]");
      sizeSelect?.addEventListener("change", (event) => {
        store.update(index, { size: String(event.currentTarget.value || "").trim() });
      });
      qtySelect?.addEventListener("change", (event) => {
        store.update(index, { quantity: Number(event.currentTarget.value || 1) });
      });

      article.querySelector("[data-order-remove]")?.addEventListener("click", () => {
        store.remove(index);
      });

      list.appendChild(article);
    });
  });

  return { openDrawer, closeDrawer };
}
