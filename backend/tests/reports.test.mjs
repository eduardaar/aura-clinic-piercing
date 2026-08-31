import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";

const context = {};

before(async () => {
  Object.assign(context, await createTenant("reports"));
  context.platformToken = await platformLogin();
  context.token = (await loginTenant(context.slug, context.adminEmail, context.adminPassword)).token;
  await req("/subscription", { method: "PATCH", tenant: context.slug, token: context.token, body: { plan_code: "studio" } });
});

after(async () => {
  if (context.tenant?.id) await deleteTenant(context.platformToken, context.tenant.id, context.slug);
});

test("central gera todos os relatórios suportados e CSV isolados no tenant", async () => {
  const types = [
    "financial", "payables", "receivables", "payments", "sales", "purchases", "suppliers", "stock", "stock_movements", "lots", "abc",
    "services", "clients", "digital_terms", "postcare", "biosafety", "professionals", "appointments", "cancellations", "promotions", "coupons",
    "commissions", "catalog_conversion", "users", "access_profiles", "permissions", "audit"
  ];
  for (const type of types) {
    const response = await req(`/reports/${type}?from=2026-01-01&to=2026-12-31`, { tenant: context.slug, token: context.token });
    assert.equal(response.status, 200, `${type}: ${JSON.stringify(response.json)}`);
    assert.equal(Array.isArray(response.json.rows), true);
    assert.equal(response.json.type, type);
  }
});

test("catálogo central agrupa relatórios e declara filtros e exportadores", async () => {
  const response = await req("/reports", { tenant: context.slug, token: context.token });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.ok(response.json.reports.length >= 10);
  assert.ok(response.json.reports.every((report) => report.category && Array.isArray(report.filters)));
  assert.ok(response.json.reports.flatMap((report) => report.filters).every((filter) => filter.key && filter.label && filter.type));
  assert.deepEqual(response.json.formats, ["pdf", "xlsx", "csv", "txt"]);
  assert.ok(response.json.reports.some((report) => report.type === "abc"));
});

test("relatório detalhado pagina, busca e informa o total no servidor", async () => {
  for (const [name, document] of [["Fornecedor Alfa Relatório", "04252011000110"], ["Fornecedor Beta Relatório", "19131243000197"]]) {
    const created = await req("/finance/suppliers", { method: "POST", tenant: context.slug, token: context.token, body: { name, person_type: "PJ", document } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
  }
  const firstPage = await req("/reports/suppliers?limit=1&offset=0&sort=name:asc", { tenant: context.slug, token: context.token });
  assert.equal(firstPage.status, 200, JSON.stringify(firstPage.json));
  assert.equal(firstPage.json.rows.length, 1);
  assert.ok(firstPage.json.total_rows >= 2);
  assert.equal(firstPage.json.limit, 1);
  const searched = await req("/reports/suppliers?search=Beta%20Relatório", { tenant: context.slug, token: context.token });
  assert.equal(searched.status, 200, JSON.stringify(searched.json));
  assert.equal(searched.json.rows.length, 1);
  assert.match(searched.json.rows[0].name, /Beta/);
});

test("analytics público valida sessão e aparece no relatório de conversão", async () => {
  const event = await req("/catalog/events", { method: "POST", tenant: context.slug, body: { event_type: "catalog_view", session_key: "session-report-123" } });
  assert.equal(event.status, 202, JSON.stringify(event.json));
  const report = await req("/reports/catalog_conversion?from=2026-01-01&to=2026-12-31", { tenant: context.slug, token: context.token });
  assert.equal(report.status, 200, JSON.stringify(report.json));
  assert.ok(report.json.rows.some((row) => row.event_type === "catalog_view"));
});

test("desempenho por profissional expoe producao, disponibilidade e taxas", async () => {
  const created = await req("/professionals", { method: "POST", tenant: context.slug, token: context.token, body: { name: "Profissional Relatorio", commission_percentage: 12, active: true } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const report = await req(`/reports/professionals?from=2026-08-01&to=2026-08-31&professional_id=${created.json.id}`, { tenant: context.slug, token: context.token });
  assert.equal(report.status, 200, JSON.stringify(report.json));
  assert.equal(report.json.rows.length, 1);
  const row = report.json.rows[0];
  for (const field of ["worked_days", "available_hours", "occupied_hours", "completed_appointments", "cancellations", "no_shows", "jewelry_sold", "service_revenue", "revenue", "average_ticket", "commission", "occupancy_rate", "attendance_rate"]) {
    assert.ok(Object.hasOwn(row, field), `campo ausente: ${field}`);
  }
});
