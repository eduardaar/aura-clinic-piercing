import assert from "node:assert/strict";
import test from "node:test";
import {
  MigrationError,
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
  assert.deepEqual(platform.map((item) => item.version), ["0001"]);
  assert.deepEqual(tenant.map((item) => item.version), ["0001", "0002"]);
  assert.match(platform[0].checksum, /^[a-f0-9]{64}$/);
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
