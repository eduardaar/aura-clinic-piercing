import { pool } from "../src/database/connection.js";
import { inspectMigrationStructure } from "../src/db/migrationStructure.js";

const client = await pool.connect();

try {
  await client.query("BEGIN READ ONLY");

  const selectedTenant = process.argv.find((argument) => argument.startsWith("--tenant="))?.split("=")[1];
  const tenants = (await client.query(
    "SELECT id, slug, name, status FROM platform.tenants ORDER BY id"
  )).rows.filter((tenant) => !selectedTenant
    || String(tenant.id) === selectedTenant
    || tenant.slug === selectedTenant);
  const ledgerExists = (await client.query(
    "SELECT to_regclass('platform.schema_migrations') IS NOT NULL AS ok"
  )).rows[0].ok;
  const ledger = ledgerExists
    ? (await client.query(`
        SELECT scope, target_schema, version, name, checksum, applied_at
          FROM platform.schema_migrations
         ORDER BY scope, target_schema, version
      `)).rows
    : [];
  const reports = [];

  for (const tenant of tenants) {
    const schema = `tenant_${tenant.id}`;
    const tables = (await client.query(`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = $1
         AND table_name = ANY($2::text[])
       ORDER BY table_name
    `, [schema, ["users", "background_jobs", "administrative_audit_logs", "user_permissions"]])).rows
      .map((row) => row.table_name);
    const columns = (await client.query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = ANY($2::text[])
         AND column_name = ANY($3::text[])
       ORDER BY table_name, ordinal_position
    `, [
      schema,
      ["users", "administrative_audit_logs", "user_permissions"],
      ["status", "tenant_id", "id", "user_id", "permission", "allowed", "created_by", "created_at", "updated_at"]
    ])).rows;
    const constraints = (await client.query(`
      SELECT constraint_name, constraint_type
        FROM information_schema.table_constraints
       WHERE table_schema = $1 AND table_name = 'user_permissions'
       ORDER BY constraint_name
    `, [schema])).rows;
    const foreignKeys = (await client.query(`
      SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = $1
         AND c.contype = 'f'
         AND c.conrelid = to_regclass(format('%I.user_permissions', $1))
       ORDER BY c.conname
    `, [schema])).rows;
    const indexes = (await client.query(`
      SELECT indexname, indexdef
        FROM pg_indexes
       WHERE schemaname = $1 AND tablename = 'user_permissions'
       ORDER BY indexname
    `, [schema])).rows;
    const counts = {};

    for (const table of ["users", "user_permissions", "administrative_audit_logs"]) {
      if (tables.includes(table)) {
        const result = await client.query(`SELECT count(*)::int AS n FROM "${schema}"."${table}"`);
        counts[table] = Number(result.rows[0].n);
      }
    }

    const fingerprints = {};
    for (const version of ["0001", "0002", "0003"]) {
      const inspection = await inspectMigrationStructure(client, { scope: "tenant", targetSchema: schema, version });
      fingerprints[version] = {
        expected: inspection.expectedFingerprint,
        physical: inspection.physicalFingerprint,
        equivalent: inspection.equivalent,
        ...(process.argv.includes("--differences") ? {
          expectedStructure: inspection.expected,
          physicalStructure: inspection.physical
        } : {})
      };
    }
    reports.push({
      tenant,
      schema,
      tables,
      columns,
      constraints,
      foreignKeys,
      indexes,
      counts,
      ledger: ledger.filter((row) => row.scope === "tenant" && row.target_schema === schema),
      fingerprints
    });
  }

  const report = {
    ledgerExists,
    platformLedger: ledger.filter((row) => row.scope === "platform"),
    tenants: reports
  };
  if (process.argv.includes("--summary")) {
    console.log(JSON.stringify({
      ledgerExists,
      platformLedger: report.platformLedger.map((row) => row.version),
      tenants: reports.map((item) => ({
        id: item.tenant.id,
        slug: item.tenant.slug,
        status: item.tenant.status,
        schema: item.schema,
        ledger: item.ledger.map((row) => row.version),
        users: item.counts.users ?? null,
        permissions: item.counts.user_permissions ?? null,
        physical0001: item.tables.includes("users"),
        physical0002: item.tables.includes("background_jobs"),
        physical0003: item.tables.includes("user_permissions")
          && item.columns.some((column) => column.table_name === "users" && column.column_name === "status")
          && item.columns.some((column) => column.table_name === "administrative_audit_logs" && column.column_name === "tenant_id"),
        fingerprints: item.fingerprints
      }))
    }, null, 2));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  await client.query("ROLLBACK");
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original read-only audit error.
  }
  throw error;
} finally {
  client.release();
  await pool.end();
}
