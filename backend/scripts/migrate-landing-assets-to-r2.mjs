// Move imagens padrão da Landing para `plataforma/landing/` no R2 e atualiza
// as referências guardadas no banco. O dry-run não grava nada.
//
//   npm --prefix backend run migrate:landing-assets:r2
//   npm --prefix backend run migrate:landing-assets:r2 -- --apply
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "../src/database/connection.js";
import { r2Enabled } from "../src/config/index.js";
import { buildKey } from "../src/services/storage/keys.js";
import { storage } from "../src/services/storage/index.js";

const apply = process.argv.includes("--apply");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const assetsDir = path.join(root, "frontend", "public", "assets", "landing");
const imageNames = [
  "hero-studio.jpg", "feature-agenda.jpg", "feature-jewelry.jpg", "feature-care.jpg",
  "showcase-1.jpg", "showcase-2.jpg", "showcase-3.jpg"
];

function replaceUrls(value, urls) {
  if (typeof value === "string") return urls.get(value) || value;
  if (Array.isArray(value)) return value.map((item) => replaceUrls(item, urls));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceUrls(item, urls)]));
  }
  return value;
}

if (!r2Enabled || !storage.isRemote) {
  throw new Error("R2 não está configurado. Defina todas as variáveis R2_* antes de migrar os assets da Landing.");
}

try {
  const urls = new Map();
  for (const name of imageNames) {
    const source = path.join(assetsDir, name);
    const key = buildKey({ scope: "public", category: "landing", filename: name });
    const url = storage.publicUrl(key);
    urls.set(`/assets/landing/${name}`, url);
    if (apply) await storage.putPublic(key, await fs.readFile(source), { contentType: "image/jpeg" });
    console.log(`${apply ? "enviado" : "será enviado"}: /assets/landing/${name} -> ${url}`);
  }

  const { rows } = await query("SELECT section_key, content FROM platform.landing_sections ORDER BY section_key");
  for (const row of rows) {
    const content = replaceUrls(row.content, urls);
    if (JSON.stringify(content) === JSON.stringify(row.content)) continue;
    if (apply) {
      await query("UPDATE platform.landing_sections SET content=$1::jsonb, updated_at=now() WHERE section_key=$2", [JSON.stringify(content), row.section_key]);
    }
    console.log(`${apply ? "atualizado" : "será atualizado"}: bloco ${row.section_key}`);
  }
  console.log(apply ? "Migração da Landing concluída." : "Dry-run concluído. Rode com --apply para enviar ao R2 e atualizar a Landing.");
} finally {
  await pool.end();
}
