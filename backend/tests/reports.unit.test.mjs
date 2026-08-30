import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, REPORT_CATALOG } from "../src/services/reports.js";

test("registro declara filtros, colunas e paginação dos relatórios operacionais", () => {
  const expected = ["purchases", "suppliers", "payables", "receivables", "stock_movements", "lots", "digital_terms", "postcare", "biosafety", "users", "access_profiles", "permissions", "audit"];
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
