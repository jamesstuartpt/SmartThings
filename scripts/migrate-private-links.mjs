import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = "c:/SmartThings";
const manifestPath = path.join(root, "imagens", "telegram_manifest.json");
const outDir = path.join(root, "_local", "private_admin");
const outCsv = path.join(outDir, "links_sheet_import.csv");

function buildProductRef(slug) {
  const digest = crypto
    .createHash("md5")
    .update(String(slug || "").trim().toLowerCase())
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();
  return `ST-${digest}`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function run() {
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const products = Array.isArray(raw?.products) ? raw.products : Array.isArray(raw) ? raw : [];
  const rows = [];
  let stripped = 0;

  for (const product of products) {
    const buyLink = String(product.buyLink || "").trim();
    if (buyLink) {
      const slug = String(product.slug || "").trim();
      rows.push({
        refCode: buildProductRef(slug),
        slug,
        name: String(product.name || "").trim(),
        buyLink,
        active: "TRUE",
        platform: "HACOO",
        category: String(product.category || "").trim(),
        brand: String(product.brandLabel || product.brandSlug || "").trim(),
        updatedAt: String(product.latestTs || ""),
        notes: "",
      });
    }

    if ("buyLink" in product || "hasBuyLink" in product) {
      delete product.buyLink;
      delete product.hasBuyLink;
      stripped += 1;
    }
  }

  rows.sort((a, b) => a.slug.localeCompare(b.slug, "pt"));
  fs.mkdirSync(outDir, { recursive: true });
  const header = ["refCode", "slug", "name", "buyLink", "active", "platform", "category", "brand", "updatedAt", "notes"];
  const csv = [
    header.join(","),
    ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
  ].join("\n");
  fs.writeFileSync(outCsv, csv, "utf8");
  fs.writeFileSync(manifestPath, JSON.stringify(raw, null, 2) + "\n", "utf8");

  console.log(JSON.stringify({
    csv: outCsv,
    exportedLinks: rows.length,
    strippedFromManifest: stripped,
    totalProducts: products.length,
  }, null, 2));
}

run();
