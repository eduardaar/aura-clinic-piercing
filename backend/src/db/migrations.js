// Runner de migrations SQL versionadas. O ledger fica centralizado em
// platform.schema_migrations para permitir auditar, em uma só consulta, a
// versão aplicada no schema da plataforma e em cada clínica.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.join(__dirname, "migrations");
const SCOPES = new Set(["platform", "tenant"]);
const FILE_PATTERN = /^(\d{4,})_([a-z0-9][a-z0-9_-]*)\.sql$/;
const TENANT_SCHEMA_PATTERN = /^tenant_[1-9]\d*$/;

export class MigrationError extends Error {
  constructor(message, { code = "migration_error", details } = {}) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
    this.details = details;
  }
}

function assertScope(scope) {
  if (!SCOPES.has(scope)) {
    throw new MigrationError(`Escopo de migration inválido: ${scope}.`, { code: "invalid_scope" });
  }
}

function assertTargetSchema(scope, targetSchema) {
  const valid = (scope === "platform" && targetSchema === "platform")
    || (scope === "tenant" && TENANT_SCHEMA_PATTERN.test(targetSchema));
  if (!valid) {
    throw new MigrationError(`Schema de destino inválido para ${scope}: ${targetSchema}.`, { code: "invalid_target" });
  }
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function checksumSql(sql) {
  // O mesmo commit pode ser materializado como LF no Linux do deploy e CRLF
  // no Windows operacional. O ledger representa o conteúdo SQL, não o estilo
  // local de quebra de linha.
  const canonicalSql = String(sql).replaceAll("\r\n", "\n");
  return crypto.createHash("sha256").update(canonicalSql, "utf8").digest("hex");
}

function compatibleLineEndingChecksums(sql) {
  const lf = String(sql).replaceAll("\r\n", "\n");
  const crlf = lf.replaceAll("\n", "\r\n");
  return [...new Set([lf, crlf].map((value) => crypto.createHash("sha256").update(value, "utf8").digest("hex")))];
}

// Carrega e valida os arquivos antes de abrir uma transação. Isso evita que
// um deploy parcialmente empacotado escreva qualquer coisa no banco.
export function loadMigrations(scope, { root = DEFAULT_ROOT } = {}) {
  assertScope(scope);
  const directory = path.join(root, scope);
  if (!fs.existsSync(directory)) {
    throw new MigrationError(`Diretório de migrations ausente: ${directory}.`, { code: "missing_directory" });
  }

  const seenVersions = new Set();
  const migrations = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => {
      const match = FILE_PATTERN.exec(entry.name);
      if (!match) {
        throw new MigrationError(
          `Nome de migration inválido em ${scope}: ${entry.name}. Use NNNN_descricao.sql.`,
          { code: "invalid_filename" }
        );
      }
      const version = match[1];
      if (seenVersions.has(version)) {
        throw new MigrationError(`Versão duplicada de migration ${scope}/${version}.`, { code: "duplicate_version" });
      }
      seenVersions.add(version);
      const filename = path.join(directory, entry.name);
      const sql = fs.readFileSync(filename, "utf8");
      if (!sql.trim()) {
        throw new MigrationError(`Migration vazia: ${scope}/${entry.name}.`, { code: "empty_migration" });
      }
      if (/\b(?:COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i.test(sql)
        || /(?:^|;)\s*BEGIN\s*(?:;|$)/im.test(sql)) {
        throw new MigrationError(
          `Migration ${scope}/${entry.name} controla transação. O runner já executa tudo atomicamente.`,
          { code: "transaction_control" }
        );
      }
      return {
        version,
        name: match[2],
        filename: entry.name,
        sql,
        checksum: checksumSql(sql),
        compatibleChecksums: compatibleLineEndingChecksums(sql)
      };
    })
    .sort((left, right) => left.version.localeCompare(right.version));

  return migrations;
}

export function compareLedger(migrations, appliedRows) {
  const expected = new Map(migrations.map((migration) => [migration.version, migration]));
  const applied = new Map(appliedRows.map((row) => [String(row.version), row]));
  const changed = [];
  const unknown = [];
  const pending = [];

  for (const [version, row] of applied) {
    const migration = expected.get(version);
    if (!migration) {
      unknown.push({ version, name: row.name });
    } else if (!(migration.compatibleChecksums || [migration.checksum]).includes(row.checksum)) {
      changed.push({ version, name: migration.name, expected: migration.checksum, applied: row.checksum });
    }
  }
  for (const migration of migrations) {
    if (!applied.has(migration.version)) pending.push(migration);
  }
  return { changed, unknown, pending, applied: appliedRows.length };
}

function ledgerFailure(status, scope, targetSchema) {
  if (status.changed.length || status.unknown.length) {
    const changed = status.changed.map((item) => item.version).join(", ");
    const unknown = status.unknown.map((item) => item.version).join(", ");
    throw new MigrationError(
      `Integridade das migrations comprometida em ${scope}/${targetSchema}`
        + `${changed ? `; checksum alterado: ${changed}` : ""}`
        + `${unknown ? `; versões ausentes do artefato: ${unknown}` : ""}.`,
      { code: "integrity_failure", details: status }
    );
  }
}

export async function ensureMigrationLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform.schema_migrations (
      scope TEXT NOT NULL CHECK (scope IN ('platform', 'tenant')),
      target_schema TEXT NOT NULL,
      version TEXT NOT NULL,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (scope, target_schema, version)
    );
  `);
}

async function readLedger(client, scope, targetSchema, { lock = false } = {}) {
  const suffix = lock ? " FOR UPDATE" : "";
  const result = await client.query(
    `SELECT version, name, checksum, applied_at
       FROM platform.schema_migrations
      WHERE scope = $1 AND target_schema = $2
      ORDER BY version${suffix}`,
    [scope, targetSchema]
  );
  return result.rows;
}

// Aplica todas as pendentes de um escopo/destino dentro de UMA transação. Um
// lock transacional impede que dois processos do deploy executem a mesma
// migration em paralelo. O schema de destino só aceita os formatos conhecidos;
// assim ele nunca vira interpolação vinda de input externo.
export async function applyMigrationsForTarget(client, {
  scope,
  targetSchema,
  migrations = loadMigrations(scope),
  dryRun = false,
  targetVersion = null,
  allowReconciliation = false,
  validateStructure = null
}) {
  assertScope(scope);
  assertTargetSchema(scope, targetSchema);

  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`aura:migrations:${scope}:${targetSchema}`]);
    await ensureMigrationLedger(client);
    const ledger = await readLedger(client, scope, targetSchema, { lock: true });
    const status = compareLedger(migrations, ledger);
    ledgerFailure(status, scope, targetSchema);

    const selected = targetVersion
      ? status.pending.filter((migration) => migration.version === targetVersion)
      : status.pending;
    if (targetVersion && !migrations.some((migration) => migration.version === targetVersion)) {
      throw new MigrationError(`Migration ${scope}/${targetVersion} inexistente.`, { code: "unknown_target" });
    }
    const alreadyApplied = targetVersion && ledger.some((row) => String(row.version) === targetVersion);
    if (targetVersion && !selected.length && !alreadyApplied) {
      throw new MigrationError(`Migration ${scope}/${targetVersion} não está disponível para aplicação.`, { code: "target_unavailable" });
    }
    if (targetVersion && selected.length && !allowReconciliation) {
      const missingEarlier = migrations
        .filter((migration) => migration.version < targetVersion)
        .filter((migration) => !ledger.some((row) => String(row.version) === migration.version));
      if (missingEarlier.length) {
        throw new MigrationError(
          `Dependências anteriores ausentes no ledger de ${scope}/${targetSchema}: ${missingEarlier.map((item) => item.version).join(", ")}.`,
          { code: "missing_dependencies" }
        );
      }
    }

    if (dryRun) {
      await client.query("ROLLBACK");
      return { ...status, selected: selected.map((migration) => migration.version), appliedNow: [], dryRun: true };
    }

    await client.query(`SET LOCAL search_path TO ${quoteIdentifier(targetSchema)}`);
    for (const migration of selected) {
      await client.query(migration.sql);
      if (validateStructure) await validateStructure(client, migration);
      await client.query(
        `INSERT INTO platform.schema_migrations (scope, target_schema, version, name, checksum)
         VALUES ($1, $2, $3, $4, $5)`,
        [scope, targetSchema, migration.version, migration.name, migration.checksum]
      );
    }
    await client.query("COMMIT");
    return { ...status, selected: selected.map((migration) => migration.version), appliedNow: selected.map((migration) => migration.version), dryRun: false };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // A conexão pode já ter caído; o erro da migration é mais útil ao deploy.
    }
    throw error;
  }
}

export async function adoptExistingMigration(client, {
  scope,
  targetSchema,
  version,
  migrations = loadMigrations(scope),
  inspection,
  executor = "unknown"
}) {
  assertScope(scope);
  assertTargetSchema(scope, targetSchema);
  if (!version) throw new MigrationError("A adoção exige uma versão explícita.", { code: "missing_target" });
  const migration = migrations.find((item) => item.version === version);
  if (!migration) throw new MigrationError(`Migration ${scope}/${version} inexistente.`, { code: "unknown_target" });
  if (!inspection?.equivalent || inspection.expectedFingerprint !== inspection.physicalFingerprint) {
    throw new MigrationError(`Estrutura física não equivale a ${scope}/${version}; adoção recusada.`, {
      code: "structure_mismatch", details: inspection
    });
  }

  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`aura:migrations:${scope}:${targetSchema}`]);
    await ensureMigrationLedger(client);
    const ledger = await readLedger(client, scope, targetSchema, { lock: true });
    const status = compareLedger(migrations, ledger);
    ledgerFailure(status, scope, targetSchema);
    if (ledger.some((row) => String(row.version) === version)) {
      throw new MigrationError(`${scope}/${targetSchema}/${version} já consta no ledger.`, { code: "already_applied" });
    }
    const missingEarlier = migrations
      .filter((item) => item.version < version && !item.name.startsWith("reconcile_"))
      .filter((item) => !ledger.some((row) => String(row.version) === item.version));
    if (missingEarlier.length) {
      throw new MigrationError(`Dependências anteriores ausentes: ${missingEarlier.map((item) => item.version).join(", ")}.`, { code: "missing_dependencies" });
    }
    await client.query(`SET LOCAL search_path TO ${quoteIdentifier(targetSchema)}`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS migration_adoption_audit (
        id BIGSERIAL PRIMARY KEY,
        scope TEXT NOT NULL,
        target_schema TEXT NOT NULL,
        version TEXT NOT NULL,
        checksum TEXT NOT NULL,
        expected_fingerprint TEXT NOT NULL,
        physical_fingerprint TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode = 'adopt-existing'),
        executor TEXT NOT NULL,
        adopted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(scope, target_schema, version)
      )
    `);
    await client.query(
      `INSERT INTO platform.schema_migrations (scope, target_schema, version, name, checksum)
       VALUES ($1, $2, $3, $4, $5)`,
      [scope, targetSchema, migration.version, migration.name, migration.checksum]
    );
    await client.query(
      `INSERT INTO migration_adoption_audit
         (scope, target_schema, version, checksum, expected_fingerprint, physical_fingerprint, mode, executor)
       VALUES ($1,$2,$3,$4,$5,$6,'adopt-existing',$7)`,
      [scope, targetSchema, version, migration.checksum, inspection.expectedFingerprint, inspection.physicalFingerprint, executor]
    );
    await client.query("COMMIT");
    return { adopted: version, checksum: migration.checksum, ...inspection };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  }
}

export async function migrationStatusForTarget(client, { scope, targetSchema, migrations = loadMigrations(scope) }) {
  assertScope(scope);
  assertTargetSchema(scope, targetSchema);
  await ensureMigrationLedger(client);
  const status = compareLedger(migrations, await readLedger(client, scope, targetSchema));
  ledgerFailure(status, scope, targetSchema);
  return status;
}

export const migrationPaths = { root: DEFAULT_ROOT };
