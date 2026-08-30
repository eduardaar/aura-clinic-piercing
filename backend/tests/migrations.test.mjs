import assert from "node:assert/strict";
import test from "node:test";
import {
  MigrationError,
  adoptExistingMigration,
  applyMigrationsForTarget,
  checksumSql,
  compareLedger,
  loadMigrations,
  migrationStatusForTarget,
} from "../src/db/migrations.js";

function migration(version, sql = "SELECT 1;") {
  return { version, name: "test", filename: `${version}_test.sql`, sql, checksum: checksumSql(sql) };
}

function clientWith({ ledger = [], failOn } = {}) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: String(text), params });
      if (failOn && String(text).includes(failOn)) throw new Error("falha simulada");
      if (String(text).includes("FROM platform.schema_migrations")) return { rows: ledger };
      return { rows: [] };
    },
  };
}

test("migrations versionadas têm baseline válido por escopo", () => {
  const platform = loadMigrations("platform");
  const tenant = loadMigrations("tenant");
  assert.deepEqual(
    platform.map((item) => item.version),
    ["0001", "0002", "0003", "0004", "0005", "0006", "0007"],
  );
  assert.deepEqual(
    tenant.map((item) => item.version),
    [
      "0001",
      "0002",
      "0003",
      "0004",
      "0005",
      "0006",
      "0007",
      "0008",
      "0009",
      "0010",
      "0011",
      "0012",
      "0013",
      "0014",
      "0015",
      "0016",
      "0017",
      "0018",
      "0019",
      "0020",
      "0021",
    ],
  );
  assert.ok(platform.every((item) => /^[a-f0-9]{64}$/.test(item.checksum)));
});

test("migration 0021 amplia o cadastro brasileiro de clientes", () => {
  const clients = loadMigrations("tenant").find((item) => item.version === "0021");
  assert.ok(clients, "a migration tenant 0021 é obrigatória");
  assert.match(clients.sql, /ALTER\s+TABLE\s+clients[^;]*social_name/i);
  assert.match(clients.sql, /preferred_contact/i);
  assert.match(clients.sql, /postal_code/i);
});

test("migration 0020 amplia a fonte única de fornecedores", () => {
  const suppliers = loadMigrations("tenant").find((item) => item.version === "0020");
  assert.ok(suppliers, "a migration tenant 0020 é obrigatória");
  assert.match(suppliers.sql, /ALTER\s+TABLE\s+suppliers[^;]*legal_name/i);
  assert.match(suppliers.sql, /categories\s+JSONB/i);
  assert.match(suppliers.sql, /ux_suppliers_document/i);
  assert.doesNotMatch(suppliers.sql, /CREATE\s+TABLE\s+supplier/i);
});

test("migration platform 0006 consolida matriz e aliases sem reofertar legado", () => {
  const planMatrix = loadMigrations("platform").find((item) => item.version === "0006");
  assert.ok(planMatrix, "a migration platform 0006 é obrigatória");
  assert.match(planMatrix.sql, /price_cents\s*=\s*3990/i);
  assert.match(planMatrix.sql, /price_cents\s*=\s*6990/i);
  assert.match(planMatrix.sql, /price_cents\s*=\s*11990/i);
  assert.match(planMatrix.sql, /anamnese[^;]*anamnesis[^;]*digital_terms/is);
  assert.doesNotMatch(planMatrix.sql, /features\s*=\s*'[^']*advanced_finance/i);
});

test("migration 0011 persiste a configuração explícita de parcelas nas origens", () => {
  const explicitInstallments = loadMigrations("tenant").find((item) => item.version === "0011");
  assert.ok(explicitInstallments, "a migration tenant 0011 é obrigatória");
  assert.match(
    explicitInstallments.sql,
    /ALTER\s+TABLE\s+purchase_orders[^;]*\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?installments_json/i,
  );
  assert.match(
    explicitInstallments.sql,
    /ALTER\s+TABLE\s+sales_orders[^;]*\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?installments_json/i,
  );
});

test("checksum é estável entre checkout LF e CRLF", () => {
  assert.equal(checksumSql("SELECT 1;\nSELECT 2;\n"), checksumSql("SELECT 1;\r\nSELECT 2;\r\n"));
});

test("--target aplica somente a versão explícita e exige dependências", async () => {
  const first = migration("0001");
  const second = migration("0002", "SELECT 2;");
  const third = migration("0003", "SELECT 3;");
  const client = clientWith({ ledger: [{ version: "0001", name: first.name, checksum: first.checksum }] });
  const result = await applyMigrationsForTarget(client, {
    scope: "tenant",
    targetSchema: "tenant_42",
    migrations: [first, second, third],
    targetVersion: "0002",
  });
  assert.deepEqual(result.appliedNow, ["0002"]);
  assert.equal(
    client.calls.some((call) => call.text.includes("SELECT 3")),
    false,
  );

  await assert.rejects(
    applyMigrationsForTarget(clientWith(), {
      scope: "tenant",
      targetSchema: "tenant_42",
      migrations: [first, second],
      targetVersion: "0002",
    }),
    (error) => error instanceof MigrationError && error.code === "missing_dependencies",
  );
});

test("--adopt-existing registra equivalência sem executar SQL e recusa fingerprint divergente", async () => {
  const first = migration("0001", "SELECT must_not_run;");
  const inspection = { equivalent: true, expectedFingerprint: "abc", physicalFingerprint: "abc" };
  const client = clientWith();
  const result = await adoptExistingMigration(client, {
    scope: "tenant",
    targetSchema: "tenant_42",
    version: "0001",
    migrations: [first],
    inspection,
    executor: "test",
  });
  assert.equal(result.adopted, "0001");
  assert.equal(
    client.calls.some((call) => call.text.includes("must_not_run")),
    false,
  );
  assert.ok(client.calls.some((call) => call.text.includes("migration_adoption_audit")));

  await assert.rejects(
    adoptExistingMigration(clientWith(), {
      scope: "tenant",
      targetSchema: "tenant_42",
      version: "0001",
      migrations: [first],
      inspection: { equivalent: false, expectedFingerprint: "abc", physicalFingerprint: "def" },
    }),
    (error) => error instanceof MigrationError && error.code === "structure_mismatch",
  );
});

test("ledger identifica migration pendente e checksum adulterado", () => {
  const first = migration("0001");
  const second = migration("0002", "SELECT 2;");
  const pending = compareLedger([first, second], [{ version: "0001", name: "test", checksum: first.checksum }]);
  assert.deepEqual(
    pending.pending.map((item) => item.version),
    ["0002"],
  );

  const changed = compareLedger([first], [{ version: "0001", name: "test", checksum: "x".repeat(64) }]);
  assert.equal(changed.changed.length, 1);
});

test("runner aplica pendentes e registra ledger no mesmo commit", async () => {
  const client = clientWith();
  const result = await applyMigrationsForTarget(client, {
    scope: "tenant",
    targetSchema: "tenant_42",
    migrations: [migration("0001")],
  });
  assert.deepEqual(result.appliedNow, ["0001"]);
  assert.ok(client.calls.some((call) => call.text === "BEGIN"));
  assert.ok(client.calls.some((call) => call.text.includes('SET LOCAL search_path TO "tenant_42"')));
  assert.ok(client.calls.some((call) => call.text.includes("INSERT INTO platform.schema_migrations")));
  assert.equal(client.calls.at(-1).text, "COMMIT");
});

test("runner aborta e faz rollback quando SQL falha", async () => {
  const client = clientWith({ failOn: "SELECT explode" });
  await assert.rejects(
    applyMigrationsForTarget(client, {
      scope: "platform",
      targetSchema: "platform",
      migrations: [migration("0002", "SELECT explode;")],
    }),
    /falha simulada/,
  );
  assert.ok(client.calls.some((call) => call.text === "ROLLBACK"));
  assert.equal(
    client.calls.some((call) => call.text.includes("INSERT INTO platform.schema_migrations")),
    false,
  );
});

test("status recusa checksum alterado e schema fora do escopo", async () => {
  const item = migration("0001");
  await assert.rejects(
    migrationStatusForTarget(clientWith({ ledger: [{ version: "0001", name: "test", checksum: "0".repeat(64) }] }), {
      scope: "platform",
      targetSchema: "platform",
      migrations: [item],
    }),
    (error) => error instanceof MigrationError && error.code === "integrity_failure",
  );
  await assert.rejects(
    applyMigrationsForTarget(clientWith(), {
      scope: "tenant",
      targetSchema: "platform",
      migrations: [item],
    }),
    (error) => error instanceof MigrationError && error.code === "invalid_target",
  );
});
