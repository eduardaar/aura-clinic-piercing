import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { pool, query } from "../src/database/connection.js";
import { createDbAdapter } from "../src/db/sqliteCompat.js";
import { applySchemaSql } from "../src/db/sqliteCompat.js";
import { ensurePlatform } from "../src/services/tenants.js";
import { importAuraJewelry } from "../src/services/auraJewelryImport.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env") });

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const inline = process.argv.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const tenantSlug = String(argValue("tenant", "aura")).trim().toLowerCase();
const allowProduction = process.argv.includes("--allow-production");

if (process.env.NODE_ENV === "production" && !allowProduction) {
  console.error("Importação bloqueada em produção. Rode localmente ou use --allow-production conscientemente.");
  process.exit(1);
}

await ensurePlatform();
const tenantResult = await query("SELECT id, slug FROM platform.tenants WHERE slug = $1", [tenantSlug]);
const tenant = tenantResult.rows[0];
if (!tenant) {
  console.error(`Tenant "${tenantSlug}" não encontrado. Crie a clínica antes de importar.`);
  process.exit(1);
}

const schema = `tenant_${tenant.id}`;
const client = await pool.connect();
try {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  await applySchemaSql(client);
  await client.query(`SET search_path TO "${schema}", public`);
  const db = createDbAdapter(client);
  const summary = await importAuraJewelry(db);
  console.log(JSON.stringify({ tenant: tenant.slug, schema, ...summary }, null, 2));
} finally {
  try {
    await client.query("SET search_path TO public");
    client.release();
  } catch {
    client.release(true);
  }
  await pool.end();
}
