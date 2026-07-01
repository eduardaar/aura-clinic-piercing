import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL não definida. Configure-a no arquivo .env (veja .env.example)."
  );
}

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
