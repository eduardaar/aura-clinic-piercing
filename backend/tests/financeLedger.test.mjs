import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEntry } from "../src/services/financeLedger.js";

test("baixa parcial deriva status sem ultrapassar o valor do lançamento", () => {
  const partial = normalizeEntry({ entry_type: "receivable", description: "Parcela", amount: 100, paid_amount: 35, due_date: "2026-08-01" });
  assert.equal(partial.status, "partially_paid");
  assert.equal(partial.paid_amount, 35);
  const paid = normalizeEntry({ ...partial, paid_amount: 150 });
  assert.equal(paid.status, "paid");
  assert.equal(paid.paid_amount, 100);
});

test("lançamento rejeita tipo, status e dados obrigatórios inválidos", () => {
  assert.throws(() => normalizeEntry({ entry_type: "other", description: "X", amount: 1, due_date: "2026-08-01" }), /Tipo/);
  assert.throws(() => normalizeEntry({ entry_type: "payable", description: "", amount: 1, due_date: "" }), /obrigatórios/);
  assert.throws(() => normalizeEntry({ entry_type: "payable", description: "X", amount: 1, due_date: "2026-08-01", status: "x" }), /Status/);
});
