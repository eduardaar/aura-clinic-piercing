import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCompletionPayments } from "../src/services/completionPayments.js";

test("pagamentos divididos preservam forma, status, parcelas e taxa separados", () => {
  const rows = normalizeCompletionPayments([
    { method: "Pix", amount: "50", status: "pago" },
    { method: "Cartão de crédito", amount: "70", status: "pendente", installments: "3", fee_amount: "2.5" },
    { method: "transferência bancária", amount: 10 },
    { method: "outra", amount: 5 },
  ]);
  assert.equal(rows.length, 4);
  assert.equal(rows[1].amount, 70);
  assert.equal(rows[1].fee_amount, 2.5);
  assert.equal(rows[1].installments, 3);
  assert.equal(rows[1].status, "pendente");
});

test("dados financeiros inválidos não desaparecem silenciosamente nem são corrigidos para zero", () => {
  for (const patch of [
    { amount: "" }, { amount: null }, { amount: "abc" }, { amount: -1 }, { amount: Infinity }, { amount: "1.234" }, { amount: 10000000000 },
    { installments: "" }, { installments: 1.5 }, { installments: -1 },
    { fee_amount: -1 }, { fee_amount: Infinity }, { fee_amount: 101 }, { fee_amount: "1.234" }, { status: "estornado" },
    { expected_receipt_date: "2026-02-30" },
  ]) assert.throws(() => normalizeCompletionPayments([{ amount: 100, ...patch }]));
});

test("nenhum recebimento é necessário se o sinal já cobre o total", () => {
  assert.deepEqual(normalizeCompletionPayments([]), []);
  assert.deepEqual(normalizeCompletionPayments([{ amount: 0 }]), []);
});
