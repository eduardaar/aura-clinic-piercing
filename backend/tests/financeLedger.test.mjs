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

test("sincronização do razão: status explícito, crédito aplicado fora e espelho órfão cancelado", async () => {
  const { syncFinanceSources, PAYMENT_LEDGER_STATUS_SQL } = await import("../src/services/financeLedger.js");
  assert.match(PAYMENT_LEDGER_STATUS_SQL, /'pago','confirmado'\) THEN 'paid'/);
  assert.match(PAYMENT_LEDGER_STATUS_SQL, /'refunded','estornado'\) THEN 'refunded'/);
  const statements = [];
  await syncFinanceSources({ async run(sql) { statements.push(sql); } });
  const payments = statements[0];
  assert.match(payments, /p\.status <> 'credito_aplicado'/, "crédito aplicado não é espelhado como receita");
  assert.match(payments, /source_type='service_execution'/, "pendente coberto pelo recebível da execução não duplica");
  assert.match(statements[1], /SET status='canceled'/);
  assert.match(statements[1], /NOT EXISTS/, "espelho sem pagamento válido é cancelado, nunca apagado");
});
