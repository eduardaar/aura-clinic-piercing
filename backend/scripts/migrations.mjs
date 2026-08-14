// CLI operacional das migrations versionadas.
// Uso: node scripts/migrations.mjs <status|verify|apply>
import { pool, query } from "../src/database/connection.js";
import {
  adoptExistingMigration,
  applyMigrationsForTarget,
  loadMigrations,
  migrationStatusForTarget
} from "../src/db/migrations.js";
import { inspectMigrationStructure } from "../src/db/migrationStructure.js";

const command = process.argv[2] || "status";
const option = (name) => process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const selectedTenant = option("--tenant");
const targetVersion = option("--target");
const adoptExisting = process.argv.includes("--adopt-existing");
const dryRun = process.argv.includes("--dry-run");
const allowReconciliation = process.argv.includes("--allow-reconciliation");
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
    return withClient((client) => applyMigrationsForTarget(client, {
      scope, targetSchema, migrations, targetVersion, dryRun, allowReconciliation,
      validateStructure: targetVersion ? async (migrationClient, migration) => {
        const inspectedVersion = migration.name.startsWith("reconcile_background_jobs") ? "0002" : migration.version;
        const inspection = await inspectMigrationStructure(migrationClient, {
          scope, targetSchema, version: inspectedVersion
        });
        if (!inspection.equivalent) {
          throw new Error(`Validação estrutural pós-migration falhou (${inspection.physicalFingerprint} != ${inspection.expectedFingerprint}).`);
        }
      } : null
    }));
  }

  try {
    // O CLI é executado depois do bootstrap do app no pipeline de deploy. A
    // verificação abaixo dá uma mensagem clara caso alguém o rode num banco
    // sem o schema de plataforma, em vez de criar uma base incompleta.
    const platformExists = await query("SELECT 1 FROM pg_namespace WHERE nspname = 'platform'");
    if (!platformExists.rows[0]) {
      throw new Error("Schema platform inexistente. Execute o bootstrap da aplicação antes das migrations.");
    }

    if ((adoptExisting || targetVersion || allowReconciliation) && !selectedTenant) {
      throw new Error("Operação controlada exige --tenant=<id|slug> explícito.");
    }
    if (adoptExisting && (!targetVersion || command !== "apply")) {
      throw new Error("Use apply --tenant=<id|slug> --target=<versão> --adopt-existing.");
    }
    const targets = selectedTenant ? [] : [{ scope: "platform", targetSchema: "platform", migrations: platformMigrations }];
    const tenants = await query("SELECT id, slug FROM platform.tenants ORDER BY id");
    const chosen = selectedTenant
      ? tenants.rows.filter((tenant) => String(tenant.id) === selectedTenant || tenant.slug === selectedTenant)
      : tenants.rows;
    if (selectedTenant && chosen.length !== 1) throw new Error(`Tenant explícito não encontrado: ${selectedTenant}.`);
    for (const tenant of chosen) {
      targets.push({
        scope: "tenant",
        targetSchema: `tenant_${tenant.id}`,
        migrations: tenantMigrations,
        tenant: tenant.slug
      });
    }

    let pending = 0;
    for (const target of targets) {
      let result;
      if (adoptExisting) {
        result = await withClient(async (client) => {
          const inspection = await inspectMigrationStructure(client, {
            scope: target.scope, targetSchema: target.targetSchema, version: targetVersion
          });
          if (dryRun) return { adopted: null, plannedAdoption: targetVersion, ...inspection };
          return adoptExistingMigration(client, {
            scope: target.scope,
            targetSchema: target.targetSchema,
            version: targetVersion,
            migrations: target.migrations,
            inspection,
            executor: process.env.USERNAME || process.env.USER || "unknown"
          });
        });
        if (dryRun) {
          console.log(`[migrations] ${target.targetSchema}: adoção-prevista=${result.plannedAdoption}`
            + ` fingerprint=${result.physicalFingerprint} equivalente=${result.equivalent}`);
          continue;
        }
        console.log(`[migrations] ${target.targetSchema}: adotada=${result.adopted} fingerprint=${result.physicalFingerprint}`);
        continue;
      }
      result = command === "apply"
        ? await applyTarget(target.scope, target.targetSchema, target.migrations)
        : await targetStatus(target.scope, target.targetSchema, target.migrations);
      pending += result.pending.length;
      const label = target.tenant ? `${target.targetSchema} (${target.tenant})` : target.targetSchema;
      const executed = result.appliedNow?.length ? ` aplicadas=${result.appliedNow.join(",")}` : "";
      const fingerprint = targetVersion
        ? await withClient((client) => inspectMigrationStructure(client, {
            scope: target.scope,
            targetSchema: target.targetSchema,
            version: targetVersion === "0004" ? "0002" : targetVersion
          }))
        : null;
      console.log(`[migrations] ${label}: aplicadas=${result.applied} pendentes=${result.pending.length}${executed}`
        + `${result.selected ? ` selecionadas=${result.selected.join(",") || "nenhuma"}` : ""}`
        + `${fingerprint ? ` fingerprint=${fingerprint.physicalFingerprint} equivalente=${fingerprint.equivalent}` : ""}`);
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
