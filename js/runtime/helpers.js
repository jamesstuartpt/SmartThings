export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function readJsonScript(id) {
  const node = document.getElementById(id);
  if (!node) {
    return null;
  }
  try {
    return JSON.parse(node.textContent || "null");
  } catch (_error) {
    return null;
  }
}

export function formatCurrency(value, locale = "pt-PT", currency = "EUR") {
  if (value == null || Number.isNaN(Number(value))) {
    return "";
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(Number(value));
}

export function debounce(callback, wait = 180) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), wait);
  };
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "readonly");
  input.style.position = "absolute";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
  return Promise.resolve();
}

export function lockBody(isLocked) {
  document.body.classList.toggle("no-scroll", Boolean(isLocked));
}

export function createFocusTrap(container, onEscape) {
  const focusableSelector =
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

  function handleKeydown(event) {
    if (event.key === "Escape") {
      onEscape?.();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = $all(focusableSelector, container).filter(
      (element) => !element.hasAttribute("hidden")
    );
    if (!focusable.length) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return {
    activate() {
      container.addEventListener("keydown", handleKeydown);
      const focusable = $all(focusableSelector, container);
      focusable[0]?.focus();
    },
    deactivate() {
      container.removeEventListener("keydown", handleKeydown);
    }
  };
}

export function updateLiveRegion(message) {
  const region = document.getElementById("st-live-region");
  if (region) {
    region.textContent = message;
  }
}

let toastTimer = 0;

export function showToast(message) {
  const toast = document.getElementById("st-toast");
  if (!toast) {
    updateLiveRegion(message);
    return;
  }
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => {
      toast.hidden = true;
    }, 180);
  }, 1800);
}

export function randomCode(length = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}
