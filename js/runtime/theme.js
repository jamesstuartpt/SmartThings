const STORAGE_KEY = "smartthings_theme_v1";

export function initTheme(defaultTheme = "system") {
  const root = document.documentElement;
  const saved = window.localStorage.getItem(STORAGE_KEY) || defaultTheme;
  applyTheme(saved);

  const button = document.querySelector("[data-theme-toggle]");
  if (button) {
    button.addEventListener("click", () => {
      const current = root.dataset.theme || "system";
      const next = current === "dark" ? "light" : current === "light" ? "system" : "dark";
      applyTheme(next);
    });
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  window.localStorage.setItem(STORAGE_KEY, theme);
  const button = document.querySelector("[data-theme-toggle]");
  if (button) {
    button.setAttribute("aria-label", `Tema atual: ${theme}`);
    button.setAttribute("title", `Tema atual: ${theme}`);
  }
}
