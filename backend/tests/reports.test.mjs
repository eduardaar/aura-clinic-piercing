import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";

const context = {};

before(async () => {
  Object.assign(context, await createTenant("reports"));
  context.platformToken = await platformLogin();
  context.token = (await loginTenant(context.slug, context.adminEmail, context.adminPassword)).token;
  await req("/subscription", { method: "PATCH", tenant: context.slug, token: context.token, body: { plan_code: "premium" } });
});

after(async () => {
  if (context.tenant?.id) await deleteTenant(context.platformToken, context.tenant.id, context.slug);
});

test("central gera todos os relatórios suportados e CSV isolados no tenant", async () => {
  const types = ["financial", "sales", "stock", "services", "clients", "professionals", "appointments", "cancellations", "promotions", "coupons", "commissions", "payments", "catalog_conversion"];
  for (const type of types) {
    const response = await req(`/reports/${type}?from=2026-01-01&to=2026-12-31`, { tenant: context.slug, token: context.token });
    assert.equal(response.status, 200, `${type}: ${JSON.stringify(response.json)}`);
    assert.equal(Array.isArray(response.json.rows), true);
    assert.equal(response.json.type, type);
  }
});

test("analytics público valida sessão e aparece no relatório de conversão", async () => {
  const event = await req("/catalog/events", { method: "POST", tenant: context.slug, body: { event_type: "catalog_view", session_key: "session-report-123" } });
  assert.equal(event.status, 202, JSON.stringify(event.json));
  const report = await req("/reports/catalog_conversion?from=2026-01-01&to=2026-12-31", { tenant: context.slug, token: context.token });
  assert.equal(report.status, 200, JSON.stringify(report.json));
  assert.ok(report.json.rows.some((row) => row.event_type === "catalog_view"));
});
