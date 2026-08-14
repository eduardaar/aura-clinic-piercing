import test from "node:test";
import assert from "node:assert/strict";
import { calculateOperationTotals } from "../src/services/finance.js";

test("fonte oficial do fluxo financeiro calcula bruto, desconto, liquido, sinal e pagamentos sem duplicar", () => {
  const result = calculateOperationTotals({
    serviceSubtotal: 150,
    productSubtotal: 200,
    discountTotal: 35,
    payments: [
      { status: "pago", payment_type: "sinal", amount: 50 },
      { status: "pago", payment_type: "restante", amount: 265 }
    ]
  });

  assert.equal(result.grossTotal, 350);
  assert.equal(result.discountTotal, 35);
  assert.equal(result.netTotal, 315);
  assert.equal(result.depositPaid, 50);
  assert.equal(result.otherPayments, 265);
  assert.equal(result.totalPaid, 315);
  assert.equal(result.outstandingBalance, 0);
  assert.equal(result.paymentStatus, "liquidado");
});

test("a mesma fonte não soma o sinal como parte do valor liquido", () => {
  const result = calculateOperationTotals({
    serviceSubtotal: 150,
    productSubtotal: 200,
    discountTotal: 35,
    payments: [{ status: "pago", payment_type: "sinal", amount: 50 }]
  });

  assert.equal(result.netTotal, 315);
  assert.equal(result.totalPaid, 50);
  assert.equal(result.outstandingBalance, 265);
  assert.equal(result.paymentStatus, "parcial");
});

test("cupom e restante são parte do mesmo contrato e não geram cálculo paralelo", () => {
  const result = calculateOperationTotals({
    serviceSubtotal: 80,
    productSubtotal: 20,
    discountTotal: 10,
    payments: [
      { status: "pago", payment_type: "sinal", amount: 30 },
      { status: "pago", payment_type: "restante", amount: 45 },
      { status: "confirmado", payment_type: "restante", amount: 15 }
    ]
  });

  assert.equal(result.grossTotal, 100);
  assert.equal(result.discountTotal, 10);
  assert.equal(result.netTotal, 90);
  assert.equal(result.depositPaid, 30);
  assert.equal(result.otherPayments, 60);
  assert.equal(result.totalPaid, 90);
  assert.equal(result.outstandingBalance, 0);
  assert.equal(result.paymentStatus, "liquidado");
});

test("pagamentos confirmados de outros tipos entram no total e excedente permanece visivel", () => {
  const result = calculateOperationTotals({
    serviceSubtotal: 100,
    payments: [
      { status: "pago", payment_type: "sinal", amount: 30 },
      { status: "confirmado", payment_type: "complementar", amount: 80 }
    ]
  });

  assert.equal(result.depositPaid, 30);
  assert.equal(result.otherPayments, 80);
  assert.equal(result.totalPaid, 110);
  assert.equal(result.outstandingBalance, 0);
  assert.equal(result.overpaymentAmount, 10);
  assert.equal(result.balance, -10);
  assert.equal(result.paymentStatus, "excedente");
});

test("calculo monetario arredonda cada entrada para centavos", () => {
  const result = calculateOperationTotals({
    serviceSubtotal: 0.1,
    productSubtotal: 0.2,
    payments: [{ status: "pago", payment_type: "final", amount: 0.3 }]
  });

  assert.equal(result.grossTotal, 0.3);
  assert.equal(result.totalPaid, 0.3);
  assert.equal(result.balance, 0);
});

test("regressao completa: previsto 360, realizado 450 e sinal nao vira receita extra", () => {
  const forecast = calculateOperationTotals({
    serviceSubtotal: 200,
    productSubtotal: 200,
    discountTotal: 40,
    payments: [{ status: "pago", payment_type: "sinal", amount: 50 }]
  });
  const realized = calculateOperationTotals({
    serviceSubtotal: 200,
    productSubtotal: 300,
    discountTotal: 50,
    payments: [
      { status: "pago", payment_type: "sinal", amount: 50 },
      { status: "pago", payment_type: "final", amount: 400 }
    ]
  });

  assert.equal(forecast.netTotal, 360);
  assert.equal(forecast.outstandingBalance, 310);
  assert.equal(realized.grossTotal, 500);
  assert.equal(realized.netTotal, 450);
  assert.equal(realized.depositPaid, 50);
  assert.equal(realized.otherPayments, 400);
  assert.equal(realized.totalPaid, 450);
  assert.equal(realized.outstandingBalance, 0);
});
