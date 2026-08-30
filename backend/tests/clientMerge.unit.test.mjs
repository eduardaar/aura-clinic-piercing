import test from "node:test";
import assert from "node:assert/strict";
import { ClientMergeError, mergeClientData, mergeClients } from "../src/services/clientMerge.js";

test("dados do destino vencem e apenas lacunas, tags e consentimentos são complementados", () => {
  const merged = mergeClientData(
    { id: 2, email: "destino@aura.test", phone: "", whatsapp: "11999990000", tags: ["vip"], operational_consent: false, referred_by_client_id: 1 },
    { id: 1, email: "origem@aura.test", phone: "1133334444", whatsapp: "11888880000", tags: ["retorno", "VIP"], operational_consent: true, referred_by_client_id: 3 },
  );
  assert.equal(merged.email, "destino@aura.test");
  assert.equal(merged.phone, "1133334444");
  assert.equal(merged.whatsapp, "11999990000");
  assert.deepEqual(merged.tags, ["vip", "retorno"]);
  assert.equal(merged.operational_consent, true);
  assert.equal(merged.referred_by_client_id, 3, "não cria autorreferência no destino");
});

test("mesclagem move FKs descobertas, preserva auditoria imutável e anonimiza a origem", async () => {
  const runs = [];
  let allCall = 0;
  const tx = {
    async all() {
      allCall += 1;
      if (allCall === 1) return [
        { id: 10, full_name: "Duplicado", whatsapp: "11900000010", tags: [], lifecycle_status: "active" },
        { id: 20, full_name: "Correto", whatsapp: "11900000020", tags: [], lifecycle_status: "active" },
      ];
      return [
        { table_name: "appointments", column_name: "client_id" },
        { table_name: "payments", column_name: "client_id" },
        { table_name: "privacy_audit_logs", column_name: "client_id" },
        { table_name: "clients", column_name: "guardian_client_id" },
      ];
    },
    async run(sql, params) {
      runs.push({ sql, params });
      return { changes: sql.includes('UPDATE "') ? 2 : 1 };
    },
  };
  const db = { transaction: (callback) => callback(tx) };
  const result = await mergeClients(db, { sourceId: 10, targetId: 20, reason: "Duplicidade confirmada", actor: { id: 7, role: "admin" } });
  assert.deepEqual(result.moved_records, { appointments: 2, payments: 2 });
  assert.ok(runs.some(({ sql, params }) => sql.includes('UPDATE "appointments"') && params[0] === 20 && params[1] === 10));
  assert.ok(!runs.some(({ sql }) => sql.includes('UPDATE "privacy_audit_logs"')));
  const sourceUpdate = runs.find(({ sql }) => sql.includes("merged_into_client_id=?"));
  assert.ok(sourceUpdate);
  assert.ok(sourceUpdate.params.includes(20));
  assert.ok(runs.some(({ sql }) => sql.includes("INSERT INTO audit_events")));
});

test("origem terminal não pode ser mesclada novamente", async () => {
  const tx = {
    async all() { return [{ id: 1, merged_into_client_id: 3 }, { id: 2 }]; },
    async run() { throw new Error("não deveria escrever"); },
  };
  await assert.rejects(
    () => mergeClients({ transaction: (callback) => callback(tx) }, { sourceId: 1, targetId: 2, reason: "Duplicidade confirmada" }),
    (error) => error instanceof ClientMergeError && error.code === "source_already_merged",
  );
});
