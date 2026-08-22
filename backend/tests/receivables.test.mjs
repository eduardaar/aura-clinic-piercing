import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInstallmentSchedule,
  configuresReceivableSchedule,
  normalizeExplicitInstallments,
  normalizeInstallmentCount,
  normalizeReceivableMode
} from "../src/services/receivables.js";

test("parcelamento financeiro preserva cada centavo", () => {
  const schedule = buildInstallmentSchedule(100, 3, "2026-01-15");
  assert.deepEqual(schedule.map((item) => item.amount), [33.34, 33.33, 33.33]);
  assert.equal(schedule.reduce((sum, item) => Math.round((sum + item.amount) * 100) / 100, 0), 100);
});

test("vencimento mensal ancora o dia e limita ao último dia do mês", () => {
  const schedule = buildInstallmentSchedule(90, 3, "2026-01-31");
  assert.deepEqual(schedule.map((item) => item.dueDate), ["2026-01-31", "2026-02-28", "2026-03-31"]);
});

test("contrato de recebível rejeita modo, parcelas e data inválidos", () => {
  assert.equal(normalizeReceivableMode(undefined), "paid");
  assert.equal(normalizeReceivableMode("pending"), "pending");
  assert.throws(() => normalizeReceivableMode("later"), /Modo/);
  assert.throws(() => normalizeInstallmentCount(0), /parcelas/);
  assert.throws(() => normalizeInstallmentCount(121), /parcelas/);
  assert.throws(() => buildInstallmentSchedule(10, 1, "2026-02-30"), /Data/);
});

test("venda à vista trata installments vazio como ausência de parcelamento", () => {
  assert.equal(configuresReceivableSchedule({ receivable_mode: "paid", installments: [] }), false);
  assert.equal(normalizeExplicitInstallments([], { total: 100 }), null);
  assert.equal(configuresReceivableSchedule({ receivable_mode: "pending", installments: [] }), true);
});
