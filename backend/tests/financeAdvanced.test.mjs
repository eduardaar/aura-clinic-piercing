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
