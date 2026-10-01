import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  calculateOperationTotals,
  discountFromPercent,
  sumActiveAdjustments,
} from "../src/lib/operationTotals.js";

// Espelho de backend/tests/financial-source.test.mjs: os casos são os mesmos
// para que a tela e a gravação nunca divirjam.

test("exemplo obrigatório: 149,90 − 10,00 = 139,90 e sinal de 50,00 deixa 89,90", () => {
  const withoutPayment = calculateOperationTotals({ serviceSubtotal: 149.9, discountTotal: 10 });
  assert.equal(withoutPayment.grossTotal, 149.9);
  assert.equal(withoutPayment.discountTotal, 10);
  assert.equal(withoutPayment.netTotal, 139.9);
  assert.equal(withoutPayment.outstandingBalance, 139.9);
  assert.equal(withoutPayment.paymentStatus, "nao_pago");

  const withDeposit = calculateOperationTotals({
    serviceSubtotal: 149.9,
    discountTotal: 10,
    payments: [{ status: "pago", payment_type: "sinal", amount: 50 }]
  });
  assert.equal(withDeposit.netTotal, 139.9);
  assert.equal(withDeposit.depositPaid, 50);
  assert.equal(withDeposit.totalPaid, 50);
  assert.equal(withDeposit.outstandingBalance, 89.9);
  assert.equal(withDeposit.paymentStatus, "parcial");
});

test("calcula bruto, desconto, líquido, sinal e pagamentos sem duplicar", () => {
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
  assert.equal(result.adjustmentTotal, 0);
  assert.equal(result.netTotal, 315);
  assert.equal(result.depositPaid, 50);
  assert.equal(result.otherPayments, 265);
  assert.equal(result.totalPaid, 315);
  assert.equal(result.outstandingBalance, 0);
  assert.equal(result.paymentStatus, "liquidado");
  assert.equal(result.closed, true);
});

test("o sinal não é somado ao valor líquido", () => {
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
  assert.equal(result.closed, false);
});

test("acréscimo aumenta o líquido e o restante", () => {
  const result = calculateOperationTotals({
    serviceSubtotal: 149.9,
    discountTotal: 10,
    adjustmentTotal: 20,
    payments: [{ status: "pago", payment_type: "sinal", amount: 50 }]
  });

  assert.equal(result.adjustmentTotal, 20);
  assert.equal(result.netTotal, 159.9);
  assert.equal(result.outstandingBalance, 109.9);
});

test("abatimento reduz o líquido e o restante", () => {
  const result = calculateOperationTotals({
    serviceSubtotal: 149.9,
    discountTotal: 10,
    adjustment_total: -15.5,
    payments: [{ status: "pago", payment_type: "sinal", amount: 50 }]
  });

  assert.equal(result.adjustmentTotal, -15.5);
  assert.equal(result.netTotal, 124.4);
  assert.equal(result.outstandingBalance, 74.4);
});

test("acréscimo e abatimento juntos se compensam em centavos", () => {
  const adjustments = [
    { adjustment_type: "acrescimo", amount: 0.1, status: "ativo" },
    { adjustment_type: "acrescimo", amount: 0.2, status: "ativo" },
    { adjustment_type: "abatimento", amount: 0.3, status: "ativo" },
    { adjustment_type: "abatimento", amount: 99, status: "anulado" }
  ];
  assert.equal(sumActiveAdjustments(adjustments), 0);
  const result = calculateOperationTotals({ serviceSubtotal: 100, adjustmentTotal: sumActiveAdjustments(adjustments) });
  assert.equal(result.netTotal, 100);
});

test("clamps: desconto limitado ao bruto, entradas negativas viram zero e líquido nunca é negativo", () => {
  const discountOverGross = calculateOperationTotals({ serviceSubtotal: 80, productSubtotal: 20, discountTotal: 150 });
  assert.equal(discountOverGross.discountTotal, 100);
  assert.equal(discountOverGross.netTotal, 0);
  assert.equal(discountOverGross.paymentStatus, "liquidado");

  const negativeInputs = calculateOperationTotals({
    serviceSubtotal: -10,
    productSubtotal: 50,
    discountTotal: -5,
    payments: [{ status: "pago", payment_type: "restante", amount: -20 }]
  });
  assert.equal(negativeInputs.serviceSubtotal, 0);
  assert.equal(negativeInputs.grossTotal, 50);
  assert.equal(negativeInputs.discountTotal, 0);
  assert.equal(negativeInputs.totalPaid, 0);

  const deepRebate = calculateOperationTotals({ serviceSubtotal: 100, discountTotal: 40, adjustmentTotal: -80 });
  assert.equal(deepRebate.netTotal, 0);
  assert.equal(deepRebate.outstandingBalance, 0);
});

test("cupom e restante seguem o mesmo contrato, com status confirmado e crédito aplicado", () => {
  const result = calculateOperationTotals({
    serviceSubtotal: 80,
    productSubtotal: 20,
    discountTotal: 10,
    payments: [
      { status: "pago", payment_type: "sinal", amount: 30 },
      { status: "pago", payment_type: "restante", amount: 45 },
      { status: "confirmado", payment_type: "restante", amount: 10 },
      { status: "credito_aplicado", payment_type: "credito", amount: 5 },
      { status: "pendente", payment_type: "restante", amount: 999 },
      { status: "cancelado", payment_type: "sinal", amount: 999 }
    ]
  });

  assert.equal(result.grossTotal, 100);
  assert.equal(result.netTotal, 90);
  assert.equal(result.depositPaid, 30);
  assert.equal(result.otherPayments, 60);
  assert.equal(result.totalPaid, 90);
  assert.equal(result.outstandingBalance, 0);
  assert.equal(result.paymentStatus, "liquidado");
});

test("pagamento a maior aparece como excedente", () => {
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

test("abatimento que deixa o líquido abaixo do já pago vira excedente", () => {
  const result = calculateOperationTotals({
    serviceSubtotal: 100,
    adjustmentTotal: -30,
    payments: [{ status: "pago", payment_type: "sinal", amount: 80 }]
  });
  assert.equal(result.netTotal, 70);
  assert.equal(result.overpaymentAmount, 10);
  assert.equal(result.paymentStatus, "excedente");
});

test("cada entrada é arredondada para centavos (sem resíduo de ponto flutuante)", () => {
  const result = calculateOperationTotals({
    serviceSubtotal: 0.1,
    productSubtotal: 0.2,
    payments: [{ status: "pago", payment_type: "final", amount: 0.3 }]
  });

  assert.equal(result.grossTotal, 0.3);
  assert.equal(result.totalPaid, 0.3);
  assert.equal(result.balance, 0);

  const strings = calculateOperationTotals({ service_value: "1234.56", product_value: "0.015", discount_value: "789.01", adjustment_total: "0.005" });
  assert.equal(strings.productSubtotal, 0.02);
  assert.equal(strings.grossTotal, 1234.58);
  assert.equal(strings.netTotal, 445.58);
});

test("regressão completa: previsto 360, realizado 450 e sinal não vira receita extra", () => {
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
  assert.equal(realized.totalPaid, 450);
  assert.equal(realized.outstandingBalance, 0);
});

test("detalhamento cupom × manual: cupom primeiro, manual completa até o bruto", () => {
  // Exemplo do atendimento: 149,90 com 10,00 de desconto manual e sinal de 50.
  const manualOnly = calculateOperationTotals({
    serviceSubtotal: 149.9,
    couponDiscount: 0,
    manualDiscount: 10,
    payments: [{ status: "pago", payment_type: "sinal", amount: 50 }]
  });
  assert.equal(manualOnly.couponDiscount, 0);
  assert.equal(manualOnly.manualDiscount, 10);
  assert.equal(manualOnly.discountTotal, 10);
  assert.equal(manualOnly.netBeforeAdjustments, 139.9);
  assert.equal(manualOnly.netTotal, 139.9);
  assert.equal(manualOnly.outstandingBalance, 89.9);
  assert.equal(manualOnly.discountExceedsGross, false);

  const both = calculateOperationTotals({ serviceSubtotal: 150, productSubtotal: 50, couponDiscount: 20, manualDiscount: 10.5 });
  assert.equal(both.couponDiscount, 20);
  assert.equal(both.manualDiscount, 10.5);
  assert.equal(both.discountTotal, 30.5);
  assert.equal(both.netTotal, 169.5);

  // Com o detalhamento, `discountTotal` é ignorado (o backend faz o mesmo).
  const ignoredTotal = calculateOperationTotals({ serviceSubtotal: 100, couponDiscount: 5, discountTotal: 99 });
  assert.equal(ignoredTotal.discountTotal, 5);

  // Manual acima do que sobrou após o cupom: limitado e sinalizado.
  const over = calculateOperationTotals({ serviceSubtotal: 100, coupon_discount: 30, manual_discount_value: 90 });
  assert.equal(over.couponDiscount, 30);
  assert.equal(over.manualDiscount, 70);
  assert.equal(over.discountTotal, 100);
  assert.equal(over.netTotal, 0);
  assert.equal(over.discountExceedsGross, true);

  // Cupom maior que o bruto: o manual não entra.
  const couponOver = calculateOperationTotals({ serviceSubtotal: 40, couponDiscount: 50, manualDiscount: 5 });
  assert.equal(couponOver.couponDiscount, 40);
  assert.equal(couponOver.manualDiscount, 0);

  // Sem detalhamento, o total entra como cupom (leitores antigos).
  const legacy = calculateOperationTotals({ serviceSubtotal: 100, discountTotal: 15 });
  assert.equal(legacy.couponDiscount, 15);
  assert.equal(legacy.manualDiscount, 0);
});

test("sinaliza líquido negativo e separa o crédito aplicado dos demais pagamentos", () => {
  const result = calculateOperationTotals({
    serviceSubtotal: 100,
    couponDiscount: 0,
    manualDiscount: 40,
    adjustmentTotal: -70,
    payments: [
      { status: "credito_aplicado", payment_type: "credito", amount: 12.34 },
      { status: "pago", payment_type: "restante", amount: 0.66 }
    ]
  });
  assert.equal(result.netBeforeAdjustments, 60);
  assert.equal(result.netTotal, 0);
  assert.equal(result.negativeNet, true);
  assert.equal(result.creditApplied, 12.34);
  assert.equal(result.otherPayments, 13);
  assert.equal(result.paymentStatus, "excedente");
  assert.equal(calculateOperationTotals({ serviceSubtotal: 10, adjustmentTotal: -10 }).negativeNet, false);
});

test("o alias `adjustment` não existe no backend e é ignorado aqui também", () => {
  assert.equal(calculateOperationTotals({ serviceSubtotal: 10, adjustment: 5 }).netTotal, 10);
});

test("atalho em %: converte sobre bruto − cupom e arredonda a centavos", () => {
  assert.equal(discountFromPercent(149.9, 10), 14.99);
  assert.equal(discountFromPercent(99.99, "15,5"), 15.5);
  assert.equal(discountFromPercent(33.33, 33.333), 11.11);
  assert.equal(discountFromPercent(100, 150), 100);
  assert.equal(discountFromPercent(100, -5), 0);
  assert.equal(discountFromPercent(100, "abc"), 0);
});

// Paridade de verdade com o backend: extrai `calculateOperationTotals` do
// próprio services/finance.js (sem importar o módulo, que carrega config/.env)
// e compara as saídas em milhares de entradas sorteadas, inclusive aliases,
// strings, negativos, cupom × manual, ajustes e pagamentos de todos os status.
const BACKEND_FINANCE = new URL("../../backend/src/services/finance.js", import.meta.url);

function loadBackendCalculator() {
  const source = readFileSync(BACKEND_FINANCE, "utf8");
  const start = source.indexOf("export function calculateOperationTotals(");
  assert.notEqual(start, -1, "calculateOperationTotals não encontrada no backend");
  let depth = 0;
  let end = -1;
  // Corpo começa no "{" depois da lista de parâmetros (o padrão `input = {}` também tem chaves).
  for (let index = source.indexOf(") {", start) + 2; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) { end = index + 1; break; }
    }
  }
  const body = source.slice(start, end).replace("export function", "function");
  return new Function(`
    const toCents = (value) => Math.round(Number(value || 0) * 100);
    const fromCents = (value) => value / 100;
    ${body}
    return calculateOperationTotals;
  `)();
}

test("paridade com o calculateOperationTotals do backend em entradas sorteadas", { skip: !existsSync(BACKEND_FINANCE) && "backend fora do checkout" }, () => {
  const backendCalculate = loadBackendCalculator();
  let seed = 20260930;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const money = () => pick([undefined, null, "", 0, -5, Math.round(random() * 50000) / 100, String(Math.round(random() * 50000) / 100), Math.round(random() * 500000) / 1000]);
  for (let round = 0; round < 3000; round += 1) {
    const input = {};
    for (const key of ["serviceSubtotal", "service_value", "productSubtotal", "product_value", "discountTotal", "discount_value", "discount", "couponDiscount", "coupon_discount", "manualDiscount", "manual_discount_value"]) {
      if (random() < 0.3) input[key] = money();
    }
    if (random() < 0.5) input[pick(["adjustmentTotal", "adjustment_total"])] = pick([1, -1]) * Math.round(random() * 30000) / 100;
    if (random() < 0.7) {
      input.payments = Array.from({ length: Math.floor(random() * 4) }, () => ({
        status: pick(["pago", "confirmado", "credito_aplicado", "pendente", "cancelado", "PAGO", undefined]),
        [pick(["payment_type", "type"])]: pick(["sinal", "deposit", "restante", "credito", "Sinal", undefined]),
        [pick(["amount", "value"])]: money()
      }));
    }
    assert.deepEqual(calculateOperationTotals(input), backendCalculate(input), JSON.stringify(input));
  }
});
