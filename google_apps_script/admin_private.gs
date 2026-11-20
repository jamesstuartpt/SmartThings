const DEFAULT_PRIVATE_SPREADSHEET_ID = "1bxN7ClOM1twl4lLWsJyar0wdMsnmn1v2rsA8R0w3Wfs";
const PRIVATE_SPREADSHEET_ID =
  PropertiesService.getScriptProperties().getProperty("SMARTTHINGS_PRIVATE_SPREADSHEET_ID") ||
  DEFAULT_PRIVATE_SPREADSHEET_ID;

const PRIVATE_SHEETS = {
  links: "LINKS",
  orders: "PEDIDOS_ST",
  profiles: "PESSOAL",
  sales: "Dados",
};

const PRIVATE_HEADERS = {
  links: ["slug", "name", "buyLink", "active", "platform", "category", "brand", "updatedAt", "notes"],
  orders: [
    "createdAt",
    "orderCode",
    "customerName",
    "customerPhone",
    "itemsText",
    "estimatedTotalEur",
    "status",
    "sourceUrl",
    "notes",
  ],
  profiles: [
    "PLATAFORMA",
    "CANAL DE VENDA",
    "AÇÃO",
    "COD. RASTREIO",
    "ORDER NO.",
    "DATA COMPRA",
    "DATA PREVISTA",
    "DATA VENDA",
    "DIAS EM STOCK",
    "EMAIL DE NOTIFICAÇÃO",
    "SENHA",
    "EMAIL HACOO CONTA",
    "TELEFONE USADO",
    "NOME DESTINATÁRIO",
    "ENDEREÇO ENTREGA",
    "LOJA",
    "CLASSIFICAÇÃO",
    "QTD",
    "",
    "ITEM",
    "MODELO",
    "COR",
    "TAMANHO / MODELO",
    "VALOR ITEM (€)",
    "VALOR FRETE (€)",
    "CUSTO Nº TELEMÓVEL (€)",
    "CUSTO TOTAL (€)",
    "ESTADO PAGAMENTO COMPRA",
    "COMPRADOR FINAL",
    "VALOR RECEBIDO (€)",
    "ESTADO RECEBIMENTO",
    "LUCRO (€)",
    "MARGEM (%)",
    "ROI (%)",
    "OBS",
  ],
};

function setupPrivateAdminSheets() {
  const ss = getPrivateSpreadsheet_();
  ensureSheet_(ss, PRIVATE_SHEETS.links, PRIVATE_HEADERS.links);
  ensureSheet_(ss, PRIVATE_SHEETS.orders, PRIVATE_HEADERS.orders);
  ensureExistingSheet_(ss, PRIVATE_SHEETS.profiles, PRIVATE_HEADERS.profiles);
  ensureExistingSheet_(ss, PRIVATE_SHEETS.sales);
  return "OK";
}

function appendApprovedOrder(order) {
  const payload = normalizePayload_(order);
  const row = [
    new Date(),
    payload.orderCode || "",
    payload.customerName || "",
    payload.customerPhone || "",
    payload.itemsText || "",
    payload.estimatedTotalEur || "",
    payload.status || "aprovado",
    payload.sourceUrl || "",
    payload.notes || "",
  ];
  appendRow_(PRIVATE_SHEETS.orders, PRIVATE_HEADERS.orders, row);
  return { ok: true, sheet: PRIVATE_SHEETS.orders };
}

function appendHacooProfile(profile) {
  const payload = normalizePayload_(profile);
  const row = [
    "HACOO",
    payload.salesChannel || "CATALOGO ST",
    payload.action || "PERFIL",
    "",
    payload.orderNo || "",
    payload.purchaseDate || new Date(),
    payload.expectedDate || "",
    "",
    "",
    payload.notificationEmail || "",
    payload.password || "",
    payload.hacooEmail || "",
    payload.phoneUsed || "",
    payload.recipientName || "",
    payload.deliveryAddress || "",
    payload.store || "",
    payload.rating || "",
    payload.quantity || 1,
    "",
    payload.itemType || "",
    payload.model || payload.profileLabel || "",
    payload.color || "",
    payload.sizeOrModel || "",
    payload.itemValueEur || "",
    payload.shippingValueEur || "",
    payload.phoneCostEur || "",
    payload.totalCostEur || "",
    payload.purchasePaymentStatus || "",
    payload.finalBuyer || "",
    payload.receivedValueEur || "",
    payload.receiptStatus || "",
    payload.profitEur || "",
    payload.marginPct || "",
    payload.roiPct || "",
    payload.notes || "",
  ];
  appendRow_(PRIVATE_SHEETS.profiles, PRIVATE_HEADERS.profiles, row);
  return { ok: true, sheet: PRIVATE_SHEETS.profiles };
}

function upsertPrivateLink(linkData) {
  const payload = normalizePayload_(linkData);
  const ss = getPrivateSpreadsheet_();
  const sheet = ensureSheet_(ss, PRIVATE_SHEETS.links, PRIVATE_HEADERS.links);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const slugIndex = headers.indexOf("slug");
  const rowValues = [
    payload.slug || "",
    payload.name || "",
    payload.buyLink || "",
    payload.active || "TRUE",
    payload.platform || "HACOO",
    payload.category || "",
    payload.brand || "",
    payload.updatedAt || new Date().toISOString(),
    payload.notes || "",
  ];

  for (let i = 1; i < values.length; i += 1) {
    if (String(values[i][slugIndex] || "").trim().toLowerCase() === String(payload.slug || "").trim().toLowerCase()) {
      sheet.getRange(i + 1, 1, 1, rowValues.length).setValues([rowValues]);
      return { ok: true, action: "updated", slug: payload.slug };
    }
  }

  sheet.appendRow(rowValues);
  return { ok: true, action: "created", slug: payload.slug };
}

function doPost(e) {
  const token = PropertiesService.getScriptProperties().getProperty("SMARTTHINGS_ADMIN_TOKEN") || "";
  const requestToken = ((e && e.parameter && e.parameter.token) || "").trim();
  if (!token || requestToken !== token) {
    return jsonResponse_({ ok: false, error: "unauthorized" }, 401);
  }

  const payload = normalizePayload_(e && e.postData ? e.postData.contents : {});
  const action = String(payload.action || "").trim();

  if (action === "appendApprovedOrder") {
    return jsonResponse_(appendApprovedOrder(payload));
  }
  if (action === "appendHacooProfile") {
    return jsonResponse_(appendHacooProfile(payload));
  }
  if (action === "upsertPrivateLink") {
    return jsonResponse_(upsertPrivateLink(payload));
  }

  return jsonResponse_({ ok: false, error: "unknown_action" }, 400);
}

function getPrivateSpreadsheet_() {
  if (!PRIVATE_SPREADSHEET_ID) {
    throw new Error("Define SMARTTHINGS_PRIVATE_SPREADSHEET_ID nas Script Properties.");
  }
  return SpreadsheetApp.openById(PRIVATE_SPREADSHEET_ID);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  const existingHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeader = headers.some((header, index) => String(existingHeaders[index] || "") !== header);
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureExistingSheet_(ss, name, expectedHeaders) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error("Folha obrigatória não encontrada: " + name);
  }
  if (expectedHeaders && expectedHeaders.length) {
    const existingHeaders = sheet.getRange(1, 1, 1, expectedHeaders.length).getValues()[0];
    for (let i = 0; i < expectedHeaders.length; i += 1) {
      const expected = String(expectedHeaders[i] || "");
      const actual = String(existingHeaders[i] || "");
      if (expected && expected !== actual) {
        throw new Error("Cabeçalho inesperado em " + name + " na coluna " + (i + 1) + ": esperado '" + expected + "', encontrado '" + actual + "'");
      }
    }
  }
  return sheet;
}

function appendRow_(sheetName, headers, row) {
  const ss = getPrivateSpreadsheet_();
  const sheet = ensureSheet_(ss, sheetName, headers);
  sheet.appendRow(row);
}

function normalizePayload_(payload) {
  if (!payload) return {};
  if (typeof payload === "string") {
    return JSON.parse(payload);
  }
  return payload;
}

function jsonResponse_(data, status) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  if (status) {
    output.setContent(JSON.stringify(Object.assign({ status }, data)));
  }
  return output;
}
