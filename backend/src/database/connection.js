import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "pg";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../../.env") });

const { Pool } = pkg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL não definida. Configure-a no arquivo .env (veja .env.example)."
  );
}

// NUMERIC AQUI CONTINUA STRING — e isso é deliberado.
//
// Este módulo é a porta do schema `platform` (planos, assinaturas, faturas) e
// de qualquer consulta feita fora do ciclo de requisição da clínica. O painel
// financeiro da plataforma (`services/platformFinance.js`) trata dinheiro como
// string decimal de ponta a ponta, exatamente para nunca passar por ponto
// flutuante; `tenant_invoices.amount` já é NUMERIC(12,2) e o comportamento
// padrão do driver (OID 1700 → string) é o que sustenta esse contrato.
//
// Por isso NÃO existe aqui um `pg.types.setTypeParser(1700, …)` global: ele
// alcançaria também o painel da plataforma e converteria em `Number` justamente
// o dinheiro que foi mantido fora do float de propósito. A conversão para
// `Number` que o código das clínicas espera vive uma camada abaixo, por query,
// em `db/postgres.js` (createDb) — veja a nota longa lá.
//
// Pool exportado: o middleware withDb pega um client POR REQUISIÇÃO para
// definir o search_path do tenant (isolamento multi-tenant por schema).
export const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

export async function query(text, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function testConnection() {
  const result = await query("SELECT NOW() as now");
  return result.rows[0];
}
