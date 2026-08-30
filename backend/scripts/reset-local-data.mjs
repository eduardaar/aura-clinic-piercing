import "dotenv/config";
import { pool, query } from "../src/database/connection.js";
import { applyPlatformMigrations, ensurePlatform } from "../src/services/tenants.js";

const databaseUrl = new URL(process.env.DATABASE_URL || "");
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

if (process.env.NODE_ENV === "production" || !localHosts.has(databaseUrl.hostname)) {
  throw new Error("Reset recusado: este comando só pode ser executado em banco local e fora de produção.");
}

try {
  const schemas = await query(
    "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant\\_%' ESCAPE '\\' ORDER BY nspname"
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const { nspname } of schemas.rows) {
      if (!/^tenant_[a-z0-9_]+$/.test(nspname)) {
        throw new Error(`Schema de tenant inesperado: ${nspname}`);
      }
      await client.query(`DROP SCHEMA "${nspname}" CASCADE`);
    }
    await client.query("DROP SCHEMA IF EXISTS platform CASCADE");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await ensurePlatform();
  await applyPlatformMigrations();

  const tenants = await query("SELECT COUNT(*)::int AS total FROM platform.tenants");
  const admins = await query("SELECT COUNT(*)::int AS total FROM platform.platform_users");
  console.log(`Base local zerada: ${schemas.rowCount} tenant(s) removido(s).`);
  console.log(`Estado inicial: ${tenants.rows[0].total} clínica(s), ${admins.rows[0].total} administrador(es) da plataforma.`);
} finally {
  await pool.end();
}
