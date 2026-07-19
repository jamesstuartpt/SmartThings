const SPREADSHEET_ID = "17Wye0UCdfJe6y6tnXKmyU7DnFggmqefO78bK485gln8";
const SHEET_NAME = "LINKS";
const FALLBACK_WHATSAPP_URL =
  "https://wa.me/351927515217?text=Ol%C3%A1!%20Vi%20o%20cat%C3%A1logo%20e%20preciso%20de%20ajuda.";

function doGet(e) {
  const slug = sanitizeSlug_(e && e.parameter ? e.parameter.slug : "");
  if (!slug) {
    return renderMessage_({
      title: "Link em falta",
      message: "Este produto nao tem um identificador valido.",
      fallbackUrl: FALLBACK_WHATSAPP_URL,
    });
  }

  const row = findProductBySlug_(slug);
  if (!row || !row.buyLink || !row.active) {
    return renderMessage_({
      title: "Produto sem link ativo",
      message:
        "Nao encontrei um link de compra ativo para este produto. Podes continuar pelo WhatsApp.",
      fallbackUrl: FALLBACK_WHATSAPP_URL,
    });
  }

  return renderRedirect_(row.buyLink, row.name || slug);
}

function authorizeApp() {
  return findProductBySlug_("carhartt_conjunto");
}

function findProductBySlug_(slug) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error("Folha nao encontrada: " + SHEET_NAME);
  }

  const values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return null;

  const headers = values[0].map((value) =>
    String(value || "")
      .trim()
      .toLowerCase()
  );

  const slugIndex = headers.indexOf("slug");
  const nameIndex = headers.indexOf("name");
  const buyLinkIndex = headers.indexOf("buylink");
  const activeIndex = headers.indexOf("active");

  if (slugIndex < 0 || buyLinkIndex < 0) {
    throw new Error("A folha precisa de ter pelo menos as colunas slug e buyLink.");
  }

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    const rowSlug = sanitizeSlug_(row[slugIndex]);
    if (rowSlug !== slug) continue;

    const buyLink = String(row[buyLinkIndex] || "").trim();
    const activeValue = activeIndex >= 0 ? row[activeIndex] : true;
    return {
      name: nameIndex >= 0 ? String(row[nameIndex] || "").trim() : "",
      buyLink,
      active: toBoolean_(activeValue),
    };
  }

  return null;
}

function sanitizeSlug_(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toBoolean_(value) {
  const normalized = String(value === true ? "true" : value || "")
    .trim()
    .toLowerCase();
  return !["", "0", "false", "no", "nao", "não", "off"].includes(normalized);
}

function escapeHtml_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderRedirect_(targetUrl, productName) {
  const safeUrl = escapeHtml_(targetUrl);
  const safeName = escapeHtml_(productName);
  const html = `
    <!doctype html>
    <html lang="pt">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>A redirecionar...</title>
        <meta http-equiv="refresh" content="0; url=${safeUrl}">
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
            color: #e8ff47;
          }
        </style>
        <script>
          window.location.replace(${JSON.stringify(targetUrl)});
        </script>
      </head>
      <body>
        <div class="card">
          <h1>A redirecionar...</h1>
          <p>${safeName}</p>
          <p>Se a pagina nao abrir sozinha, <a href="${safeUrl}" rel="noopener">carrega aqui</a>.</p>
        </div>
      </body>
    </html>
  `;
  return HtmlService.createHtmlOutput(html).setTitle("A redirecionar...");
}

function renderMessage_({ title, message, fallbackUrl }) {
  const safeTitle = escapeHtml_(title);
  const safeMessage = escapeHtml_(message);
  const safeFallback = escapeHtml_(fallbackUrl);
  const html = `
    <!doctype html>
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
        </style>
      </head>
      <body>
        <div class="card">
          <h1>${safeTitle}</h1>
          <p>${safeMessage}</p>
          <a href="${safeFallback}" rel="noopener">Falar no WhatsApp</a>
        </div>
      </body>
    </html>
  `;
  return HtmlService.createHtmlOutput(html).setTitle(safeTitle);
}
