import assert from "node:assert/strict";
import test from "node:test";
import {
  MigrationError,
  adoptExistingMigration,
  applyMigrationsForTarget,
  checksumSql,
  compareLedger,
  loadMigrations,
  migrationStatusForTarget
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
    }
  };
}

test("migrations versionadas têm baseline válido por escopo", () => {
  const platform = loadMigrations("platform");
  const tenant = loadMigrations("tenant");
  assert.deepEqual(platform.map((item) => item.version), ["0001", "0002", "0003", "0004", "0005"]);
  assert.deepEqual(tenant.map((item) => item.version), ["0001", "0002", "0003", "0004", "0005"]);
  assert.ok(platform.every((item) => /^[a-f0-9]{64}$/.test(item.checksum)));
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
    scope: "tenant", targetSchema: "tenant_42", migrations: [first, second, third], targetVersion: "0002"
  });
  assert.deepEqual(result.appliedNow, ["0002"]);
  assert.equal(client.calls.some((call) => call.text.includes("SELECT 3")), false);

  await assert.rejects(
    applyMigrationsForTarget(clientWith(), {
      scope: "tenant", targetSchema: "tenant_42", migrations: [first, second], targetVersion: "0002"
    }),
    (error) => error instanceof MigrationError && error.code === "missing_dependencies"
  );
});

test("--adopt-existing registra equivalência sem executar SQL e recusa fingerprint divergente", async () => {
  const first = migration("0001", "SELECT must_not_run;");
  const inspection = { equivalent: true, expectedFingerprint: "abc", physicalFingerprint: "abc" };
  const client = clientWith();
  const result = await adoptExistingMigration(client, {
    scope: "tenant", targetSchema: "tenant_42", version: "0001", migrations: [first], inspection, executor: "test"
  });
  assert.equal(result.adopted, "0001");
  assert.equal(client.calls.some((call) => call.text.includes("must_not_run")), false);
  assert.ok(client.calls.some((call) => call.text.includes("migration_adoption_audit")));

  await assert.rejects(
    adoptExistingMigration(clientWith(), {
      scope: "tenant", targetSchema: "tenant_42", version: "0001", migrations: [first],
      inspection: { equivalent: false, expectedFingerprint: "abc", physicalFingerprint: "def" }
    }),
    (error) => error instanceof MigrationError && error.code === "structure_mismatch"
  );
});

test("ledger identifica migration pendente e checksum adulterado", () => {
  const first = migration("0001");
  const second = migration("0002", "SELECT 2;");
  const pending = compareLedger([first, second], [{ version: "0001", name: "test", checksum: first.checksum }]);
  assert.deepEqual(pending.pending.map((item) => item.version), ["0002"]);

  const changed = compareLedger([first], [{ version: "0001", name: "test", checksum: "x".repeat(64) }]);
  assert.equal(changed.changed.length, 1);
});

test("runner aplica pendentes e registra ledger no mesmo commit", async () => {
  const client = clientWith();
  const result = await applyMigrationsForTarget(client, {
    scope: "tenant",
    targetSchema: "tenant_42",
    migrations: [migration("0001")]
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
      migrations: [migration("0002", "SELECT explode;")]
    }),
    /falha simulada/
  );
  assert.ok(client.calls.some((call) => call.text === "ROLLBACK"));
  assert.equal(client.calls.some((call) => call.text.includes("INSERT INTO platform.schema_migrations")), false);
});

test("status recusa checksum alterado e schema fora do escopo", async () => {
  const item = migration("0001");
  await assert.rejects(
    migrationStatusForTarget(clientWith({ ledger: [{ version: "0001", name: "test", checksum: "0".repeat(64) }] }), {
      scope: "platform", targetSchema: "platform", migrations: [item]
    }),
    (error) => error instanceof MigrationError && error.code === "integrity_failure"
  );
  await assert.rejects(
    applyMigrationsForTarget(clientWith(), {
      scope: "tenant", targetSchema: "platform", migrations: [item]
    }),
    (error) => error instanceof MigrationError && error.code === "invalid_target"
  );
});
