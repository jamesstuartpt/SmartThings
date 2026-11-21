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

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Mirrors the build-time reference code generation so old cart items can still
// produce the same product reference even if they were saved before `refCode`.
function md5(value) {
  function rotateLeft(x, c) {
    return (x << c) | (x >>> (32 - c));
  }
  function addUnsigned(a, b) {
    const l = (a & 0xffff) + (b & 0xffff);
    const m = (a >> 16) + (b >> 16) + (l >> 16);
    return (m << 16) | (l & 0xffff);
  }
  function cmn(q, a, b, x, s, t) {
    return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, q), addUnsigned(x, t)), s), b);
  }
  function ff(a, b, c, d, x, s, t) {
    return cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function gg(a, b, c, d, x, s, t) {
    return cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function hh(a, b, c, d, x, s, t) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a, b, c, d, x, s, t) {
    return cmn(c ^ (b | ~d), a, b, x, s, t);
  }
  function convertToWords(text) {
    const words = [];
    const messageLength = text.length;
    let index = 0;
    while (index < messageLength) {
      const wordCount = (index - (index % 4)) / 4;
      words[wordCount] = words[wordCount] || 0;
      words[wordCount] |= text.charCodeAt(index) << ((index % 4) * 8);
      index += 1;
    }
    const wordCount = (index - (index % 4)) / 4;
    words[wordCount] = words[wordCount] || 0;
    words[wordCount] |= 0x80 << ((index % 4) * 8);
    words[(((index + 8) >>> 6) << 4) + 14] = messageLength * 8;
    return words;
  }
  function utf8Encode(text) {
    return unescape(encodeURIComponent(text));
  }
  function toHex(value32) {
    let output = "";
    for (let i = 0; i <= 3; i += 1) {
      output += (`0${((value32 >>> (i * 8)) & 255).toString(16)}`).slice(-2);
    }
    return output;
  }

  const x = convertToWords(utf8Encode(String(value || "")));
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let i = 0; i < x.length; i += 16) {
    const aa = a;
    const bb = b;
    const cc = c;
    const dd = d;

    a = ff(a, b, c, d, x[i + 0], 7, 0xd76aa478);
    d = ff(d, a, b, c, x[i + 1], 12, 0xe8c7b756);
    c = ff(c, d, a, b, x[i + 2], 17, 0x242070db);
    b = ff(b, c, d, a, x[i + 3], 22, 0xc1bdceee);
    a = ff(a, b, c, d, x[i + 4], 7, 0xf57c0faf);
    d = ff(d, a, b, c, x[i + 5], 12, 0x4787c62a);
    c = ff(c, d, a, b, x[i + 6], 17, 0xa8304613);
    b = ff(b, c, d, a, x[i + 7], 22, 0xfd469501);
    a = ff(a, b, c, d, x[i + 8], 7, 0x698098d8);
    d = ff(d, a, b, c, x[i + 9], 12, 0x8b44f7af);
    c = ff(c, d, a, b, x[i + 10], 17, 0xffff5bb1);
    b = ff(b, c, d, a, x[i + 11], 22, 0x895cd7be);
    a = ff(a, b, c, d, x[i + 12], 7, 0x6b901122);
    d = ff(d, a, b, c, x[i + 13], 12, 0xfd987193);
    c = ff(c, d, a, b, x[i + 14], 17, 0xa679438e);
    b = ff(b, c, d, a, x[i + 15], 22, 0x49b40821);

    a = gg(a, b, c, d, x[i + 1], 5, 0xf61e2562);
    d = gg(d, a, b, c, x[i + 6], 9, 0xc040b340);
    c = gg(c, d, a, b, x[i + 11], 14, 0x265e5a51);
    b = gg(b, c, d, a, x[i + 0], 20, 0xe9b6c7aa);
    a = gg(a, b, c, d, x[i + 5], 5, 0xd62f105d);
    d = gg(d, a, b, c, x[i + 10], 9, 0x02441453);
    c = gg(c, d, a, b, x[i + 15], 14, 0xd8a1e681);
    b = gg(b, c, d, a, x[i + 4], 20, 0xe7d3fbc8);
    a = gg(a, b, c, d, x[i + 9], 5, 0x21e1cde6);
    d = gg(d, a, b, c, x[i + 14], 9, 0xc33707d6);
    c = gg(c, d, a, b, x[i + 3], 14, 0xf4d50d87);
    b = gg(b, c, d, a, x[i + 8], 20, 0x455a14ed);
    a = gg(a, b, c, d, x[i + 13], 5, 0xa9e3e905);
    d = gg(d, a, b, c, x[i + 2], 9, 0xfcefa3f8);
    c = gg(c, d, a, b, x[i + 7], 14, 0x676f02d9);
    b = gg(b, c, d, a, x[i + 12], 20, 0x8d2a4c8a);

    a = hh(a, b, c, d, x[i + 5], 4, 0xfffa3942);
    d = hh(d, a, b, c, x[i + 8], 11, 0x8771f681);
    c = hh(c, d, a, b, x[i + 11], 16, 0x6d9d6122);
    b = hh(b, c, d, a, x[i + 14], 23, 0xfde5380c);
    a = hh(a, b, c, d, x[i + 1], 4, 0xa4beea44);
    d = hh(d, a, b, c, x[i + 4], 11, 0x4bdecfa9);
    c = hh(c, d, a, b, x[i + 7], 16, 0xf6bb4b60);
    b = hh(b, c, d, a, x[i + 10], 23, 0xbebfbc70);
    a = hh(a, b, c, d, x[i + 13], 4, 0x289b7ec6);
    d = hh(d, a, b, c, x[i + 0], 11, 0xeaa127fa);
    c = hh(c, d, a, b, x[i + 3], 16, 0xd4ef3085);
    b = hh(b, c, d, a, x[i + 6], 23, 0x04881d05);
    a = hh(a, b, c, d, x[i + 9], 4, 0xd9d4d039);
    d = hh(d, a, b, c, x[i + 12], 11, 0xe6db99e5);
    c = hh(c, d, a, b, x[i + 15], 16, 0x1fa27cf8);
    b = hh(b, c, d, a, x[i + 2], 23, 0xc4ac5665);

    a = ii(a, b, c, d, x[i + 0], 6, 0xf4292244);
    d = ii(d, a, b, c, x[i + 7], 10, 0x432aff97);
    c = ii(c, d, a, b, x[i + 14], 15, 0xab9423a7);
    b = ii(b, c, d, a, x[i + 5], 21, 0xfc93a039);
    a = ii(a, b, c, d, x[i + 12], 6, 0x655b59c3);
    d = ii(d, a, b, c, x[i + 3], 10, 0x8f0ccc92);
    c = ii(c, d, a, b, x[i + 10], 15, 0xffeff47d);
    b = ii(b, c, d, a, x[i + 1], 21, 0x85845dd1);
    a = ii(a, b, c, d, x[i + 8], 6, 0x6fa87e4f);
    d = ii(d, a, b, c, x[i + 15], 10, 0xfe2ce6e0);
    c = ii(c, d, a, b, x[i + 6], 15, 0xa3014314);
    b = ii(b, c, d, a, x[i + 13], 21, 0x4e0811a1);
    a = ii(a, b, c, d, x[i + 4], 6, 0xf7537e82);
    d = ii(d, a, b, c, x[i + 11], 10, 0xbd3af235);
    c = ii(c, d, a, b, x[i + 2], 15, 0x2ad7d2bb);
    b = ii(b, c, d, a, x[i + 9], 21, 0xeb86d391);

    a = addUnsigned(a, aa);
    b = addUnsigned(b, bb);
    c = addUnsigned(c, cc);
    d = addUnsigned(d, dd);
  }

  return `${toHex(a)}${toHex(b)}${toHex(c)}${toHex(d)}`;
}

function getItemRefCode(item) {
  const existingRef = String(item?.refCode || "").trim();
  if (existingRef) {
    return existingRef;
  }
  const slug = normalizeText(item?.slug);
  if (!slug) {
    return "";
  }
  return `ST-${md5(slug).slice(0, 6).toUpperCase()}`;
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
      this.items = this.items.map((item) => ({
        ...item,
        refCode: getItemRefCode(item)
      }));
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
      const refCode = getItemRefCode(item);
      const line = [
        `${index + 1}) Ref. ${refCode || item.slug.toUpperCase()}`,
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
    const footerLine = String(this.config.order?.textBase || "").trim();

    lines.push(totalLine);
    if (footerLine && !normalizeText(totalLine).includes(normalizeText(footerLine))) {
      lines.push(footerLine);
    }

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
            <p class="order-item__meta">${item.brandLabel || "Sem marca"} · ${item.priceLabel}${getItemRefCode(item) ? ` · Ref. ${getItemRefCode(item)}` : ""}</p>
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
