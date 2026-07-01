// Adaptador que expõe a mesma interface do driver `sqlite` (get/all/run com
// placeholders `?`) porém executando no Postgres SOBRE UM CLIENT ESPECÍFICO.
//
// Multi-tenant: cada requisição recebe um client do pool com o search_path
// apontando para o schema da clínica ("tenant_<id>"). Por isso NÃO existe mais
// um singleton global de `db` — toda query do app DEVE passar pelo adaptador
// criado por createDbAdapter(client) dentro do withDb (ou de um client
// dedicado com search_path configurado, como no provisionamento).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Converte placeholders posicionais `?` (SQLite) em `$1, $2, ...` (Postgres).
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Tabelas cuja PK não é `id` (não devem receber RETURNING id automático).
const NO_RETURNING_ID = /^\s*INSERT\s+INTO\s+(catalog_settings|catalog_theme)\b/i;

// Factory do adaptador: executa tudo no client informado (que já deve estar
// com o search_path do tenant). Mesma semântica do antigo singleton.
export function createDbAdapter(client) {
  return {
    async get(sql, params = []) {
      const result = await client.query(toPg(sql), params);
      return result.rows[0];
    },
    async all(sql, params = []) {
      const result = await client.query(toPg(sql), params);
      return result.rows;
    },
    async run(sql, params = []) {
      let text = toPg(sql);
      const isInsert = /^\s*INSERT\s+INTO/i.test(text);
      if (isInsert && !/\bRETURNING\b/i.test(text) && !NO_RETURNING_ID.test(text)) {
        text += " RETURNING id";
      }
      const result = await client.query(text, params);
      return { lastID: result.rows[0]?.id, changes: result.rowCount };
    },
  };
}

// Aplica o schema unificado das clínicas (idempotente: CREATE TABLE IF NOT
// EXISTS) no client informado. O chamador é responsável por definir o
// search_path para o schema do tenant ANTES (apenas o schema do tenant, sem
// "public", para os IF NOT EXISTS não serem enganados por tabelas homônimas).
export async function applySchemaSql(client) {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await client.query(sql);
}
