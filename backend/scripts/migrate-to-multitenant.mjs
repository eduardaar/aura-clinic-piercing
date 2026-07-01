// Migração one-shot: move os dados atuais (schema public) para o modelo
// multi-tenant, criando o tenant "aura" e transferindo TODAS as tabelas de
// `public` para `tenant_<id>` via ALTER TABLE ... SET SCHEMA (sequences e
// índices migram junto por ownership — sem cópia de dados).
//
// Uso (a partir de backend/): node scripts/migrate-to-multitenant.mjs
import "dotenv/config";
import { pool, query } from "../src/database/connection.js";
import { ensurePlatform } from "../src/services/tenants.js";

const TENANT_NAME = "Aura Clinic";
const TENANT_SLUG = "aura";

async function main() {
  console.log("== Migração para multi-tenant ==");

  // 1) Garante o schema de controle `platform` (e o superadmin inicial).
  await ensurePlatform();
  console.log("[1/4] Schema de controle `platform` OK.");

  // 2) Se o tenant 'aura' já existe, a migração já foi feita — só reporta.
  const existing = await query("SELECT id, slug FROM platform.tenants WHERE slug = $1", [TENANT_SLUG]);
  if (existing.rows[0]) {
    console.log(`[2/4] Tenant '${TENANT_SLUG}' já existe (id=${existing.rows[0].id}). Nada a migrar.`);
    return;
  }

  // 3) Registra o tenant e cria o schema dele.
  const inserted = await query(
    "INSERT INTO platform.tenants (name, slug) VALUES ($1, $2) RETURNING id",
    [TENANT_NAME, TENANT_SLUG]
  );
  const tenantId = inserted.rows[0].id;
  const schema = `tenant_${tenantId}`;
  await query(`CREATE SCHEMA "${schema}"`);
  console.log(`[2/4] Tenant '${TENANT_SLUG}' criado (id=${tenantId}, schema=${schema}).`);

  // 4) Move cada tabela de `public` para o schema do tenant.
  const tables = await query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  if (!tables.rows.length) {
    console.log("[3/4] Nenhuma tabela em `public` para mover.");
  } else {
    console.log(`[3/4] Movendo ${tables.rows.length} tabela(s) de public → ${schema}:`);
    for (const { table_name: table } of tables.rows) {
      await query(`ALTER TABLE public."${table}" SET SCHEMA "${schema}"`);
      console.log(`  - ${table} ✔`);
    }
  }

  console.log(`[4/4] Migração concluída. Os dados da Aura agora vivem em ${schema}.`);
  console.log("Dica: defina DEFAULT_TENANT=aura no .env para requisições sem X-Tenant em dev.");
}

main()
  .catch((error) => {
    console.error("ERRO na migração:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
