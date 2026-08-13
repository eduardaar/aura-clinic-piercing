// CLI operacional das migrations versionadas.
// Uso: node scripts/migrations.mjs <status|verify|apply>
import { pool, query } from "../src/database/connection.js";
import {
  applyMigrationsForTarget,
  loadMigrations,
  migrationStatusForTarget
} from "../src/db/migrations.js";

const command = process.argv[2] || "status";
if (!new Set(["status", "verify", "apply"]).has(command)) {
  console.error("Uso: npm run migrations -- <status|verify|apply>");
  process.exitCode = 2;
} else {
  const platformMigrations = loadMigrations("platform");
  const tenantMigrations = loadMigrations("tenant");

  async function withClient(fn) {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async function targetStatus(scope, targetSchema, migrations) {
    return withClient((client) => migrationStatusForTarget(client, { scope, targetSchema, migrations }));
  }

  async function applyTarget(scope, targetSchema, migrations) {
    return withClient((client) => applyMigrationsForTarget(client, { scope, targetSchema, migrations }));
  }

  try {
    // O CLI é executado depois do bootstrap do app no pipeline de deploy. A
    // verificação abaixo dá uma mensagem clara caso alguém o rode num banco
    // sem o schema de plataforma, em vez de criar uma base incompleta.
    const platformExists = await query("SELECT 1 FROM pg_namespace WHERE nspname = 'platform'");
    if (!platformExists.rows[0]) {
      throw new Error("Schema platform inexistente. Execute o bootstrap da aplicação antes das migrations.");
    }

    const targets = [{ scope: "platform", targetSchema: "platform", migrations: platformMigrations }];
    const tenants = await query("SELECT id, slug FROM platform.tenants ORDER BY id");
    for (const tenant of tenants.rows) {
      targets.push({
        scope: "tenant",
        targetSchema: `tenant_${tenant.id}`,
        migrations: tenantMigrations,
        tenant: tenant.slug
      });
    }

    let pending = 0;
    for (const target of targets) {
      const result = command === "apply"
        ? await applyTarget(target.scope, target.targetSchema, target.migrations)
        : await targetStatus(target.scope, target.targetSchema, target.migrations);
      pending += result.pending.length;
      const label = target.tenant ? `${target.targetSchema} (${target.tenant})` : target.targetSchema;
      const executed = result.appliedNow?.length ? ` aplicadas=${result.appliedNow.join(",")}` : "";
      console.log(`[migrations] ${label}: aplicadas=${result.applied} pendentes=${result.pending.length}${executed}`);
    }
    if (command === "verify" && pending) {
      console.error(`[migrations] Há ${pending} migration(s) pendente(s).`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`[migrations] ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
