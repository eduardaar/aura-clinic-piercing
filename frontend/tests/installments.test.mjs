import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInstallments,
  installmentSummary,
  installmentsForPayload,
  monthlyInstallmentDate,
} from "../src/lib/installments.js";

test("distribui centavos sem perder o total", () => {
  const rows = buildInstallments({
    total: 100,
    count: 3,
    firstDueDate: "2026-01-31",
    paymentMethod: "Pix",
  });
  assert.deepEqual(
    rows.map((item) => item.amount),
    [33.34, 33.33, 33.33],
  );
  assert.deepEqual(
    rows.map((item) => item.due_date),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
  assert.equal(installmentSummary(100, rows, 3).isValid, true);
});

test("normaliza o método padrão para as opções editáveis da grade", () => {
  const [installment] = buildInstallments({
    total: 50,
    count: 1,
    firstDueDate: "2026-04-10",
    paymentMethod: "Cartão de crédito",
  });
  assert.equal(installment.payment_method, "cartão de crédito");
});

test("calcula vencimentos mensais preservando o último dia possível", () => {
  assert.equal(monthlyInstallmentDate("2028-01-31", 1), "2028-02-29");
  assert.equal(monthlyInstallmentDate("2028-01-31", 2), "2028-03-31");
});

test("detecta divergência e normaliza o contrato do payload", () => {
  const rows = [
    { due_date: "2026-05-10", amount: "40.00", payment_method: "Pix" },
    { due_date: "2026-06-10", amount: "59.99", payment_method: "cartão de crédito" },
  ];
  const summary = installmentSummary(100, rows, 2);
  assert.equal(summary.differenceCents, 1);
  assert.equal(summary.isValid, false);
  assert.deepEqual(installmentsForPayload(rows), [
    { installment_number: 1, due_date: "2026-05-10", amount: 40, payment_method: "Pix" },
    { installment_number: 2, due_date: "2026-06-10", amount: 59.99, payment_method: "cartão de crédito" },
  ]);
});
