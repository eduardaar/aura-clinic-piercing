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
    ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"],
  );
  const tenantVersions = tenant.map((item) => item.version);
  assert.deepEqual(tenantVersions.slice(0, 19), ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013", "0014", "0015", "0016", "0017", "0018", "0019"]);
  assert.deepEqual([...tenantVersions].sort(), tenantVersions, "migrations tenant devem permanecer ordenadas");
  assert.equal(new Set(tenantVersions).size, tenantVersions.length, "versões tenant não podem se repetir");
  for (const version of ["0020", "0021", "0022", "0023", "0024", "0025", "0028", "0029", "0030", "0031", "0032", "0033", "0034", "0035"]) assert.ok(tenantVersions.includes(version));
  assert.ok(platform.every((item) => /^[a-f0-9]{64}$/.test(item.checksum)));
});

test("migration platform 0008 versiona documentos e centraliza conteúdo público", () => {
  const content = loadMigrations("platform").find((item) => item.version === "0008");
  assert.ok(content, "a migration platform 0008 é obrigatória");
  assert.match(content.sql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+platform\.legal_document_versions/i);
  assert.match(content.sql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+platform\.content_articles/i);
  assert.match(content.sql, /content_type\s+IN\s*\('news',\s*'manual'\)/i);
});

test("migration 0021 amplia o cadastro brasileiro de clientes", () => {
  const clients = loadMigrations("tenant").find((item) => item.version === "0021");
  assert.ok(clients, "a migration tenant 0021 é obrigatória");
  assert.match(clients.sql, /ALTER\s+TABLE\s+clients[^;]*social_name/i);
  assert.match(clients.sql, /preferred_contact/i);
  assert.match(clients.sql, /postal_code/i);
});

test("migration 0028 amplia relacionamento e consentimentos do cliente", () => {
  const relationship = loadMigrations("tenant").find((item) => item.version === "0028");
  assert.ok(relationship, "a migration tenant 0028 é obrigatória");
  for (const column of ["acquisition_source", "tags", "lifecycle_status", "marketing_consent", "guardian_client_id"]) {
    assert.match(relationship.sql, new RegExp(`clients[^;]*${column}`, "i"));
  }
});

test("migration 0031 torna a origem mesclada rastreável e terminal", () => {
  const merge = loadMigrations("tenant").find((item) => item.version === "0031");
  assert.ok(merge, "a migration tenant 0031 é obrigatória");
  for (const column of ["merged_into_client_id", "merged_at", "merged_by_user_id", "merge_reason"]) {
    assert.match(merge.sql, new RegExp(`clients[^;]*${column}`, "i"));
  }
  assert.match(merge.sql, /clients_merge_not_self_check/i);
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

test("migration 0024 adiciona os dados clínicos opcionais à execução", () => {
  const clinicalExecution = loadMigrations("tenant").find((item) => item.version === "0024");
  assert.ok(clinicalExecution, "a migration tenant 0024 é obrigatória");
  for (const column of ["clinical_notes", "occurrences", "aftercare_notes"]) {
    assert.match(clinicalExecution.sql, new RegExp(`service_executions[^;]*${column}`, "i"));
  }
});

test("migration 0025 unifica produtos e materiais na mesma fonte de estoque", () => {
  const unifiedInventory = loadMigrations("tenant").find((item) => item.version === "0025");
  assert.ok(unifiedInventory, "a migration tenant 0025 é obrigatória");
  for (const column of ["can_sell", "can_use_in_service", "track_stock", "track_lots", "can_publish"]) {
    assert.match(unifiedInventory.sql, new RegExp(`jewelry_inventory[^;]*${column}`, "i"));
  }
  assert.match(unifiedInventory.sql, /CREATE\s+TABLE\s+service_inventory_recipes/i);
  assert.match(unifiedInventory.sql, /CREATE\s+TABLE\s+inventory_item_lots/i);
  assert.match(unifiedInventory.sql, /DROP\s+TABLE\s+IF\s+EXISTS\s+consumables\s+CASCADE/i);
});

test("migration 0032 persiste regras opcionais do catálogo no agendamento", () => {
  const rules = loadMigrations("tenant").find((item) => item.version === "0032");
  assert.ok(rules, "a migration tenant 0032 é obrigatória");
  for (const column of ["minimum_age_years", "requires_guardian", "requires_signed_term", "return_after_days", "scheduling_interval_minutes", "minimum_advance_minutes", "postcare_enabled"]) {
    assert.match(rules.sql, new RegExp(`services[^;]*${column}`, "i"));
  }
  assert.match(rules.sql, /appointments[^;]*service_rules_snapshot/i);
  assert.match(rules.sql, /appointment_items[^;]*service_rules_snapshot/i);
});

test("migration 0033 persiste checklist e biossegurança com histórico", () => {
  const operational = loadMigrations("tenant").find((item) => item.version === "0033");
  assert.ok(operational, "a migration tenant 0033 é obrigatória");
  assert.match(operational.sql, /CREATE\s+TABLE\s+service_operational_settings/i);
  assert.match(operational.sql, /appointments[^;]*operational_requirements_snapshot/i);
  assert.match(operational.sql, /service_executions[^;]*checklist_snapshot/i);
  assert.match(operational.sql, /CREATE\s+TABLE\s+service_execution_operational_revisions/i);
});

test("migration 0034 preserva o histórico de reagendamentos", () => {
  const history = loadMigrations("tenant").find((item) => item.version === "0034");
  assert.ok(history, "a migration tenant 0034 é obrigatória");
  for (const column of ["previous_date", "previous_time", "new_date", "new_time", "reason", "changed_by_user_id"]) {
    assert.match(history.sql, new RegExp(`appointment_reschedule_history[^;]*${column}`, "i"));
  }
});

test("migration 0035 consolida o cadastro do tipo de atendimento", () => {
  const unified = loadMigrations("tenant").find((item) => item.version === "0035");
  assert.ok(unified, "a migration tenant 0035 é obrigatória");
  assert.match(unified.sql, /ALTER\s+TABLE\s+services[^;]*category/i);
  assert.match(unified.sql, /ALTER\s+TABLE\s+services[^;]*body_area/i);
  assert.match(unified.sql, /CREATE\s+TABLE\s+service_compatible_inventory_items/i);
  assert.doesNotMatch(unified.sql, /DROP\s+TABLE\s+procedures/i);
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
