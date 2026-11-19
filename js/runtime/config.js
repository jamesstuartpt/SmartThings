export function getConfig() {
  return window.SMARTTHINGS_CONFIG || {};
}

export function getBasePath() {
  const config = getConfig();
  try {
    const url = new URL(config.baseUrl || window.location.origin);
    const pathname = url.pathname.replace(/\/+$/, "");
    return pathname || "";
  } catch (_error) {
    return "";
  }
}

export function withBasePath(path) {
  const basePath = getBasePath();
  const cleanPath = String(path || "").replace(/^\/+/, "");
  if (!cleanPath) {
    return basePath || "/";
  }
  return `${basePath}/${cleanPath}`.replace(/\/{2,}/g, "/");
}

export function getAbsoluteUrl(path) {
  const config = getConfig();
  const baseUrl = String(config.baseUrl || window.location.origin).replace(/\/+$/, "");
  const relative = String(path || "").replace(/^\/+/, "");
  return `${baseUrl}/${relative}`;
}
