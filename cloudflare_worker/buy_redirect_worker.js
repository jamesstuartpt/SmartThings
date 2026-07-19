const DEFAULT_GOOGLE_SHEET_ID = "17Wye0UCdfJe6y6tnXKmyU7DnFggmqefO78bK485gln8";
const DEFAULT_GOOGLE_SHEET_NAME = "LINKS";
const DEFAULT_WHATSAPP_FALLBACK =
  "https://api.whatsapp.com/send?phone=351927515217&text=Ol%C3%A1!%20Vi%20o%20cat%C3%A1logo%20e%20preciso%20de%20ajuda.";
const DEFAULT_CACHE_TTL_SECONDS = 300;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const slug = sanitizeSlug(url.searchParams.get("slug"));

    if (!slug) {
      return renderMessage({
        title: "Link em falta",
        message: "Este produto nao tem um identificador valido.",
        fallbackUrl: getFallbackWhatsAppUrl(env),
        status: 400,
      });
    }

    try {
      const products = await getProducts(env, ctx);
      const row = products.find((item) => sanitizeSlug(item.slug) === slug);

      if (!row || !row.buyLink || !row.active) {
        return renderMessage({
          title: "Produto sem link ativo",
          message:
            "Nao encontrei um link de compra ativo para este produto. Podes continuar pelo WhatsApp.",
          fallbackUrl: getFallbackWhatsAppUrl(env),
          status: 404,
        });
      }

      return Response.redirect(row.buyLink, 302);
    } catch (error) {
      return renderMessage({
        title: "Servico temporariamente indisponivel",
        message:
          "Nao foi possivel obter o link de compra agora. Podes continuar pelo WhatsApp.",
        fallbackUrl: getFallbackWhatsAppUrl(env),
        status: 502,
        debug: env.DEBUG_BUY_REDIRECT === "true" ? String(error) : "",
      });
    }
  },
};

function sanitizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function toBoolean(value) {
  const normalized = String(value === true ? "true" : value || "")
    .trim()
    .toLowerCase();
  return !["", "0", "false", "no", "nao", "não", "off"].includes(normalized);
}

function getFallbackWhatsAppUrl(env) {
  return String(env.FALLBACK_WHATSAPP_URL || DEFAULT_WHATSAPP_FALLBACK).trim();
}

function getSheetSourceUrl(env) {
  if (env.GOOGLE_SHEET_GVIZ_URL) return String(env.GOOGLE_SHEET_GVIZ_URL).trim();

  const spreadsheetId = String(env.GOOGLE_SHEET_ID || DEFAULT_GOOGLE_SHEET_ID).trim();
  const sheetName = String(env.GOOGLE_SHEET_NAME || DEFAULT_GOOGLE_SHEET_NAME).trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEET_ID.");
  }

  const sourceUrl = new URL(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`,
  );
  sourceUrl.searchParams.set("tqx", "out:json");
  sourceUrl.searchParams.set("sheet", sheetName);
  return sourceUrl.toString();
}

async function getProducts(env, ctx) {
  const sourceUrl = getSheetSourceUrl(env);
  const cacheTtl = Number(env.BUY_REDIRECT_CACHE_TTL || DEFAULT_CACHE_TTL_SECONDS);
  const cache = caches.default;
  const cacheKey = new Request(sourceUrl, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached.json();
  }

  const response = await fetch(sourceUrl, {
    headers: {
      Accept: "application/json,text/plain,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`Sheet request failed with ${response.status}.`);
  }

  const rawText = await response.text();
  const products = parseGoogleVisualizationRows(rawText);
  const cacheResponse = new Response(JSON.stringify(products), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${cacheTtl}`,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, cacheResponse.clone()));
  return products;
}

function parseGoogleVisualizationRows(rawText) {
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Unexpected Google Sheets response format.");
  }

  const payload = JSON.parse(rawText.slice(start, end + 1));
  const table = payload.table || {};
  const cols = Array.isArray(table.cols) ? table.cols : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const headers = cols.map((col) => normalizeHeader(col.label || col.id || ""));

  const slugIndex = headers.indexOf("slug");
  const nameIndex = headers.indexOf("name");
  const buyLinkIndex = headers.indexOf("buylink");
  const activeIndex = headers.indexOf("active");

  if (slugIndex < 0 || buyLinkIndex < 0) {
    throw new Error("The sheet must contain slug and buyLink columns.");
  }

  return rows
    .map((row) => (Array.isArray(row.c) ? row.c : []))
    .map((cells) => ({
      slug: getCellValue(cells[slugIndex]),
      name: nameIndex >= 0 ? getCellValue(cells[nameIndex]) : "",
      buyLink: getCellValue(cells[buyLinkIndex]),
      active: activeIndex >= 0 ? toBoolean(getCellValue(cells[activeIndex])) : true,
    }))
    .filter((item) => item.slug);
}

function getCellValue(cell) {
  if (!cell) return "";
  if (cell.f != null && cell.f !== "") return String(cell.f).trim();
  if (cell.v == null) return "";
  return String(cell.v).trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMessage({ title, message, fallbackUrl, status = 200, debug = "" }) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeFallback = escapeHtml(fallbackUrl);
  const safeDebug = debug ? `<pre>${escapeHtml(debug)}</pre>` : "";
  const html = `<!doctype html>
<html lang="pt">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0a0a0a;
        color: #f5f5f5;
        font-family: Arial, sans-serif;
      }
      .card {
        width: min(92vw, 520px);
        padding: 28px;
        border-radius: 18px;
        background: #111;
        border: 1px solid rgba(255,255,255,0.08);
        text-align: center;
      }
      a {
        display: inline-block;
        margin-top: 14px;
        color: #0a0a0a;
        background: #e8ff47;
        text-decoration: none;
        padding: 12px 18px;
        border-radius: 999px;
        font-weight: 700;
      }
      pre {
        margin-top: 16px;
        text-align: left;
        white-space: pre-wrap;
        word-break: break-word;
        color: #d6d6d6;
        background: #171717;
        padding: 12px;
        border-radius: 12px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
      <a href="${safeFallback}" rel="noopener">Falar no WhatsApp</a>
      ${safeDebug}
    </div>
  </body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
