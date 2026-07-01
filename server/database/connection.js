import dotenv from "dotenv";
import pkg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://postgres:AuraClinic%402026@localhost:5432/aura_clinic",
  ssl: false,
});

export async function query(text, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

export async function testConnection() {
  const result = await query("SELECT NOW() as now");
  return result.rows[0];
}

export async function runCoreMigrations() {
  const filePath = path.join(__dirname, "migrations", "001_create_core_tables.sql");
  const sql = fs.readFileSync(filePath, "utf8");
  if (!sql.trim()) return;
  await query(sql);
}
