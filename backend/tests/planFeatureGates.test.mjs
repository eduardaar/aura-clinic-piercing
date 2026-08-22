import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";

const context = {};

before(async () => {
  Object.assign(context, await createTenant("plan-gates"));
  context.platformToken = await platformLogin();
  context.token = (await loginTenant(context.slug, context.adminEmail, context.adminPassword)).token;
});

after(async () => {
  if (context.tenant?.id) {
    await deleteTenant(context.platformToken, context.tenant.id, context.slug);
  }
});

function api(path, options = {}) {
  return req(path, { tenant: context.slug, token: context.token, ...options });
}

async function setPlan(planCode) {
  const response = await req(`/platform/tenants/${context.tenant.id}/plan`, {
    method: "PATCH",
    token: context.platformToken,
    body: { plan_code: planCode }
  });
  assert.equal(response.status, 200, JSON.stringify(response.json));
}

test("Start vende à vista, mas não burla recebíveis nem comissões", async () => {
  await setPlan("start");

  const paidSale = await api("/sales-orders", {
    method: "POST",
    body: {
      full_name: "Cliente à vista Start",
      whatsapp: "11977770001",
      status: "concluida",
      receivable_mode: "paid",
      installments: [],
      payment_method: "Pix",
      items: [{ item_name: "Venda balcão", quantity: 1, unit_price: 50 }]
    }
  });
  assert.equal(paidSale.status, 201, JSON.stringify(paidSale.json));

  const pendingOnStart = await api("/sales-orders", {
    method: "POST",
    body: {
      full_name: "Cliente a prazo Start",
      whatsapp: "11977770002",
      status: "aberta",
      receivable_mode: "pending",
      first_due_date: "2026-09-10",
      items: [{ item_name: "Venda a prazo", quantity: 1, unit_price: 90 }]
    }
  });
  assert.equal(pendingOnStart.status, 403, JSON.stringify(pendingOnStart.json));
  assert.equal(pendingOnStart.json.code, "plan_upgrade_required");

  const commissionReport = await api("/reports/commissions?from=2026-01-01&to=2026-12-31");
  assert.equal(commissionReport.status, 403, JSON.stringify(commissionReport.json));

  const commissionJob = await api("/jobs/report-exports", {
    method: "POST",
    headers: { "Idempotency-Key": "commission-start-blocked" },
    body: { type: "commissions", format: "csv" }
  });
  assert.equal(commissionJob.status, 403, JSON.stringify(commissionJob.json));

  await setPlan("profissional");
  const pendingSale = await api("/sales-orders", {
    method: "POST",
    body: {
      full_name: "Cliente a prazo Profissional",
      whatsapp: "11977770003",
      status: "aberta",
      source: "catalogo",
      receivable_mode: "pending",
      first_due_date: "2026-09-15",
      items: [{ item_name: "Pedido do catálogo", quantity: 1, unit_price: 120 }]
    }
  });
  assert.equal(pendingSale.status, 201, JSON.stringify(pendingSale.json));

  await setPlan("start");
  const closeExistingPending = await api(`/sales-orders/${pendingSale.json.id}`, {
    method: "PATCH",
    body: { status: "concluida" }
  });
  assert.equal(closeExistingPending.status, 403, JSON.stringify(closeExistingPending.json));
  assert.equal(closeExistingPending.json.code, "plan_upgrade_required");

  await setPlan("studio");
  const studioReport = await api("/reports/commissions?from=2026-01-01&to=2026-12-31");
  assert.equal(studioReport.status, 200, JSON.stringify(studioReport.json));
  const queued = await api("/jobs/report-exports", {
    method: "POST",
    headers: { "Idempotency-Key": "commission-studio-created" },
    body: { type: "commissions", format: "csv" }
  });
  assert.equal(queued.status, 202, JSON.stringify(queued.json));

  await setPlan("start");
  const jobs = await api("/jobs");
  assert.equal(jobs.status, 200, JSON.stringify(jobs.json));
  assert.ok(!jobs.json.items.some((item) => item.id === queued.json.job.id));
  const download = await api(`/jobs/${queued.json.job.id}/download`);
  assert.equal(download.status, 403, JSON.stringify(download.json));
  assert.equal(download.json.code, "plan_upgrade_required");
});
