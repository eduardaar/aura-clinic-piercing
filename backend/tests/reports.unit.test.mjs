import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, REPORT_CATALOG, reportColumns, reportExportColumns, reportExportValue, resolveReportAccess } from "../src/services/reports.js";

test("registro declara filtros, colunas e paginação dos relatórios operacionais", () => {
  const expected = ["purchases", "suppliers", "payables", "receivables", "stock_movements", "lots", "digital_terms", "postcare", "biosafety", "chemical_indicators", "value_adjustments", "commissions", "users", "access_profiles", "permissions", "audit"];
  for (const type of expected) {
    const report = REPORT_CATALOG.find((item) => item.type === type);
    assert.ok(report, `relatório ausente: ${type}`);
    assert.equal(report.pagination, "server");
    assert.ok(report.columns.length > 0);
    assert.ok(report.filters.every((filter) => filter.key && filter.label && filter.type));
    assert.deepEqual(report.formats, ["pdf", "xlsx", "csv", "txt"]);
  }
});

test("consulta detalhada aplica busca, ordenação e paginação seguras", async () => {
  const calls = [];
  const db = {
    async get(sql, params) {
      calls.push({ method: "get", sql, params });
      return { total_rows: "12" };
    },
    async all(sql, params) {
      calls.push({ method: "all", sql, params });
      return [{ id: 8, name: "Fornecedor Beta" }];
    }
  };
  const report = await buildReport(db, "suppliers", { search: "Beta", sort: "name:asc", limit: "1", offset: "3" });
  assert.equal(report.total_rows, 12);
  assert.equal(report.limit, 1);
  assert.equal(report.offset, 3);
  assert.match(calls[0].sql, /COUNT\(\*\)/);
  assert.match(calls[0].sql, /ILIKE/);
  assert.match(calls[1].sql, /ORDER BY name ASC, id DESC LIMIT \? OFFSET \?/);
  assert.deepEqual(calls[1].params.slice(-2), [1, 3]);
});

test("consulta de exportação mantém filtros e remove somente a paginação", async () => {
  const calls = [];
  const db = {
    async get() { return { total_rows: 2 }; },
    async all(sql, params) {
      calls.push({ sql, params });
      return [{ id: 1 }, { id: 2 }];
    }
  };
  const report = await buildReport(db, "payables", { from: "2026-09-01", to: "2026-09-30", status: "pending", paginated: false });
  assert.equal(report.rows.length, 2);
  assert.equal(report.total_rows, 2);
  assert.doesNotMatch(calls[0].sql, /LIMIT \?/);
  assert.deepEqual(calls[0].params, ["payable", "2026-09-01", "2026-09-30", "pending"]);
});

test("todo relatório do catálogo declara colunas com rótulo pt-BR; nenhum expõe discount_value fora de cupom/promoção", () => {
  for (const report of REPORT_CATALOG) {
    assert.ok(report.columns?.length, `${report.type} sem colunas declaradas`);
    for (const column of report.columns) {
      assert.ok(column.label && !/_/.test(column.label), `${report.type}.${column.key}: rótulo cru`);
    }
    if (!["promotions", "coupons"].includes(report.type)) {
      assert.equal(report.columns.some((column) => column.key === "discount_value"), false, `${report.type} usa discount_value (renderizado por discount_type)`);
    }
  }
});

const user = (role, extra = {}) => ({ role, ...extra });

test("acesso: financeiros exigem reports.view_financial; comissão segue commission.*; escopo próprio é forçado", () => {
  assert.equal(resolveReportAccess(user("reception"), "payments").status, 403);
  assert.equal(resolveReportAccess(user("reception"), "value_adjustments").status, 403);
  assert.equal(resolveReportAccess(user("finance"), "payments").allowed, true);
  assert.equal(resolveReportAccess(user("admin"), "commissions").allowed, true);
  assert.equal(resolveReportAccess(user("finance"), "commissions").ownProfessionalId, null, "financeiro tem view_all");
  // reports.view_financial sem commission.* não abre comissões.
  const financialOnly = user("reception", { granted_permissions: ["reports.view_financial"] });
  assert.equal(resolveReportAccess(financialOnly, "commissions").status, 403);
  const own = user("piercer", { professional_id: 7, granted_permissions: ["commission.view_own"] });
  assert.deepEqual([resolveReportAccess(own, "commissions").allowed, resolveReportAccess(own, "commissions").ownProfessionalId], [true, 7]);
  assert.equal(resolveReportAccess(user("piercer", { granted_permissions: ["commission.view_own"] }), "commissions").status, 409);
  const ownReports = user("piercer", { professional_id: 3, granted_permissions: ["reports.view_own"] });
  assert.equal(resolveReportAccess(ownReports, "chemical_indicators").ownProfessionalId, 3);
  assert.equal(resolveReportAccess(ownReports, "clients").status, 403);
  assert.equal(resolveReportAccess(user("admin"), "inexistente").allowed, false);
});

test("colunas de comissão no desempenho: só com plano e permissão; custo do estoque só com view_cost", () => {
  const keys = (type, context) => reportColumns(type, context).map(({ key }) => key);
  const admin = resolveReportAccess(user("admin"), "professionals");
  assert.ok(keys("professionals", admin.context).includes("commission"));
  const noPlan = resolveReportAccess(user("admin"), "professionals", { hasPlanFeature: (feature) => feature !== "commissions" });
  assert.ok(!keys("professionals", noPlan.context).includes("commission"));
  const viewer = resolveReportAccess(user("reception", { granted_permissions: ["reports.view_all"] }), "professionals");
  assert.ok(!keys("professionals", viewer.context).includes("commission"));
  const ownBoth = resolveReportAccess(user("piercer", { professional_id: 4, granted_permissions: ["reports.view_own", "commission.view_own"] }), "professionals");
  assert.ok(keys("professionals", ownBoth.context).includes("commission"), "próprio profissional com view_own vê a própria comissão");
  assert.ok(!keys("stock", resolveReportAccess(user("reception", { granted_permissions: ["reports.view_all"] }), "stock").context).includes("cost_value"));
  assert.ok(keys("stock", resolveReportAccess(user("finance"), "stock").context).includes("cost_value"));
});

test("exportação: rótulos declarados e valores em pt-BR", () => {
  const report = { type: "value_adjustments", columns: reportColumns("value_adjustments"), rows: [{ id: 1, created_at_local: "2026-09-30 21:45", adjustment_type: "acrescimo", status: "anulado", amount: 10 }] };
  const columns = reportExportColumns(report);
  assert.deepEqual(columns.map(({ label }) => label), ["ID", "Data/hora", "Tipo", "Valor", "Situação"]);
  const byKey = Object.fromEntries(columns.map((column) => [column.key, column]));
  assert.equal(reportExportValue(byKey.created_at_local, "2026-09-30 21:45"), "30/09/2026 21:45");
  assert.equal(reportExportValue(byKey.adjustment_type, "acrescimo"), "Acréscimo");
  assert.equal(reportExportValue(byKey.status, "anulado"), "Anulado");
  assert.equal(reportExportValue(byKey.amount, 10), 10);
  assert.equal(reportExportValue({ key: "has_photo", kind: "boolean" }, false), "Não");
});

test("pagamentos e vendas: cancelados ficam fora sem filtro explícito; vendas sem o espelho da agenda", async () => {
  const calls = [];
  const db = { async get() { return {}; }, async all(sql, params) { calls.push({ sql, params }); return []; } };
  await buildReport(db, "payments", { from: "2026-09-01", to: "2026-09-30" });
  assert.match(calls[0].sql, /p\.status<>'cancelado'/);
  assert.match(calls[0].sql, /status IN \('pago','confirmado'\) THEN p\.amount ELSE 0/);
  await buildReport(db, "sales", { from: "2026-09-01", to: "2026-09-30" });
  assert.match(calls[1].sql, /so\.source<>'agenda'/);
  assert.match(calls[1].sql, /so\.status NOT IN \('cancelado','cancelada'\)/);
  await buildReport(db, "services", { from: "2026-09-01", to: "2026-09-30" });
  assert.match(calls[2].sql, /a\.status='atendido'/);
  assert.match(calls[2].sql, /sei\.item_type='service'/);
});

test("exportação converte TIMESTAMPTZ (Date) no fuso da clínica, em pt-BR", () => {
  // 01/10/2026 01:30 UTC = 30/09/2026 22:30 em São Paulo.
  const instant = new Date("2026-10-01T01:30:00Z");
  assert.equal(reportExportValue({ key: "created_at", kind: "date" }, instant), "30/09/2026");
  assert.equal(reportExportValue({ key: "created_at", kind: "datetime" }, instant), "30/09/2026 22:30");
});

test("comissões exigem só o recurso de comissões do plano (mesmo gate de /api/commissions)", async () => {
  const { REPORT_FEATURE_REQUIREMENTS } = await import("../src/services/reports.js");
  assert.deepEqual(REPORT_FEATURE_REQUIREMENTS.commissions, ["commissions"]);
});
