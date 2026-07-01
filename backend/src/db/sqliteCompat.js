// Adaptador que expõe a mesma interface do driver `sqlite` (get/all/run com
// placeholders `?`) porém executando no Postgres através do pool de conexões.
// Permite reaproveitar os handlers já validados sem reescrever o SQL app-por-app.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "../database/connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Converte placeholders posicionais `?` (SQLite) em `$1, $2, ...` (Postgres).
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Tabelas cuja PK não é `id` (não devem receber RETURNING id automático).
const NO_RETURNING_ID = /^\s*INSERT\s+INTO\s+(catalog_settings|catalog_theme)\b/i;

export const db = {
  async get(sql, params = []) {
    const result = await query(toPg(sql), params);
    return result.rows[0];
  },
  async all(sql, params = []) {
    const result = await query(toPg(sql), params);
    return result.rows;
  },
  async run(sql, params = []) {
    let text = toPg(sql);
    const isInsert = /^\s*INSERT\s+INTO/i.test(text);
    if (isInsert && !/\bRETURNING\b/i.test(text) && !NO_RETURNING_ID.test(text)) {
      text += " RETURNING id";
    }
    const result = await query(text, params);
    return { lastID: result.rows[0]?.id, changes: result.rowCount };
  },
};

// Compatível com o antigo getDb() (mesma assinatura, sempre o mesmo pool).
export async function getDb() {
  return db;
}

// Aplica o schema unificado (idempotente: CREATE TABLE IF NOT EXISTS).
export async function runSchema() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await query(sql);
}
