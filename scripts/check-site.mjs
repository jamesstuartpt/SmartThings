import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "../site_config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function walkHtml(dir) {
  const output = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await walkHtml(full)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      output.push(full);
    }
  }
  return output;
}

async function main() {
  const manifest = await readJson(path.join(ROOT, "imagens", "telegram_manifest.json"));
  const slugs = new Map();
  const missingImages = [];
  const duplicatedSlugs = [];

  for (const product of manifest.products || []) {
    if (slugs.has(product.slug)) {
      duplicatedSlugs.push(product.slug);
    }
    slugs.set(product.slug, true);
    for (const image of product.images || []) {
      try {
        await fs.access(path.join(ROOT, image));
      } catch (_error) {
        missingImages.push(image);
      }
    }
  }

  const htmlFiles = await walkHtml(ROOT);
  const deadHashes = [];
  for (const file of htmlFiles) {
    const raw = await fs.readFile(file, "utf8");
    if (raw.includes('href="#"') || raw.includes("href='#'")) {
      deadHashes.push(file);
    }
  }

  const summary = await readJson(path.join(ROOT, "data", "catalog", "summary.json"));
  const missingWhatsapp = !summary || !summary.products;
  const invalidSupport =
    !String(config.support?.whatsappNumber || "").trim() ||
    !String(config.support?.telegramUrl || "").trim();

  if (duplicatedSlugs.length || missingImages.length || deadHashes.length || missingWhatsapp || invalidSupport) {
    console.error("Validação falhou.");
    if (duplicatedSlugs.length) {
      console.error(`Slugs duplicados: ${duplicatedSlugs.join(", ")}`);
    }
    if (missingImages.length) {
      console.error(`Imagens em falta: ${missingImages.slice(0, 20).join(", ")}`);
    }
    if (deadHashes.length) {
      console.error(`Links mortos com #: ${deadHashes.join(", ")}`);
    }
    if (missingWhatsapp) {
      console.error("Resumo do catálogo não foi gerado.");
    }
    if (invalidSupport) {
      console.error("Links públicos de WhatsApp ou Telegram estão vazios.");
    }
    process.exit(1);
  }

  console.log(`Validação OK: ${htmlFiles.length} páginas HTML, ${summary.total} produtos.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
