import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";

const context = {};

before(async () => {
  Object.assign(context, await createTenant("finance2"));
  context.platformToken = await platformLogin();
  context.token = (await loginTenant(context.slug, context.adminEmail, context.adminPassword)).token;
  const plan = await req("/subscription", { method: "PATCH", tenant: context.slug, token: context.token, body: { plan_code: "premium" } });
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
});

after(async () => {
  if (context.tenant?.id) await deleteTenant(context.platformToken, context.tenant.id, context.slug);
});

function api(path, options = {}) {
  return req(path, { tenant: context.slug, token: context.token, ...options });
}

test("Financeiro 2.0 cria parcelas, baixa parcialmente e evita recorrência duplicada", async () => {
  const created = await api("/finance/entries", {
    method: "POST",
    body: {
      entry_type: "receivable", description: "Plano de tratamento", amount: 300,
      due_date: "2026-08-10", installment_count: 3, recurrence: "monthly"
    }
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.length, 3);
  assert.equal(created.json[0].amount, 100);

  const partial = await api(`/finance/entries/${created.json[0].id}`, { method: "PATCH", body: { paid_amount: 40 } });
  assert.equal(partial.status, 200, JSON.stringify(partial.json));
  assert.equal(partial.json.status, "partially_paid");

  const firstRun = await api("/finance/recurrences/process", { method: "POST", body: { horizon_days: 120 } });
  const secondRun = await api("/finance/recurrences/process", { method: "POST", body: { horizon_days: 120 } });
  assert.equal(firstRun.status, 200, JSON.stringify(firstRun.json));
  assert.equal(secondRun.status, 200, JSON.stringify(secondRun.json));
  assert.equal(secondRun.json.created, 0);

  const ledger = await api("/finance/ledger?from=2026-08-01&to=2027-12-31");
  assert.equal(ledger.status, 200, JSON.stringify(ledger.json));
  assert.ok(ledger.json.entries.some((item) => item.description === "Plano de tratamento"));
  assert.ok(ledger.json.receivable > 0);
});

test("ciclo financeiro preserva histórico, exclui testes dos indicadores e restaura com justificativa", async () => {
  const created = await api("/finance/entries", {
    method: "POST",
    body: { entry_type: "income", description: "Lançamento QA", amount: 125, paid_amount: 125, due_date: "2026-08-12", status: "paid" }
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json[0].id;

  const withoutReason = await api(`/finance/entries/${id}/lifecycle`, { method: "POST", body: { action: "test" } });
  assert.equal(withoutReason.status, 400);

  const marked = await api(`/finance/entries/${id}/lifecycle`, {
    method: "POST", body: { action: "test", reason: "Registro criado para validar o fluxo" }
  });
  assert.equal(marked.status, 200, JSON.stringify(marked.json));
  assert.equal(marked.json.lifecycle_status, "test");

  const ledger = await api("/finance/ledger?from=2026-08-01&to=2026-08-31");
  assert.equal(ledger.status, 200, JSON.stringify(ledger.json));
  assert.ok(ledger.json.entries.some((item) => item.id === id));
  assert.equal(ledger.json.cashflow.received, 40);

  const details = await api(`/finance/entries/${id}/details`);
  assert.equal(details.status, 200, JSON.stringify(details.json));
  assert.equal(details.json.audit[0].action, "test");

  const restored = await api(`/finance/entries/${id}/lifecycle`, {
    method: "POST", body: { action: "restore", reason: "Validação concluída" }
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.equal(restored.json.lifecycle_status, "active");
});

test("ação em massa é atômica", async () => {
  const created = await api("/finance/entries", {
    method: "POST",
    body: { entry_type: "expense", description: "Lote QA", amount: 30, due_date: "2026-08-15", installment_count: 2 }
  });
  const ids = created.json.map((item) => item.id);
  const bulk = await api("/finance/entries/bulk-lifecycle", {
    method: "POST", body: { ids, action: "test", reason: "Massa de testes automatizados" }
  });
  assert.equal(bulk.status, 200, JSON.stringify(bulk.json));
  assert.equal(bulk.json.count, 2);
  assert.ok(bulk.json.entries.every((item) => item.lifecycle_status === "test"));
});
