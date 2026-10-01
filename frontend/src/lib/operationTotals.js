// Espelho no frontend de calculateOperationTotals (backend/src/services/finance.js).
//
// A tela recalcula o resumo enquanto a pessoa digita (desconto, itens, ajustes),
// mas quem grava é o backend: se as duas contas divergirem, o que aparece na
// tela não é o que fica no atendimento. Por isso a matemática aqui é a MESMA do
// backend, em centavos inteiros, com os mesmos nomes de entrada e de saída e os
// mesmos limites (desconto nunca passa do bruto; líquido nunca fica negativo).
// Mudou lá? Mude aqui e nos dois testes (financial-source/operationTotals).
//
//   bruto     = serviços + produtos
//   desconto  = cupom (limitado ao bruto) + manual (limitado ao que sobrou)
//               — sem o detalhamento, `discountTotal` entra como cupom
//   ajustes   = Σ acréscimos ativos − Σ abatimentos ativos (assinado)
//   líquido   = max(0, bruto − desconto + ajustes)
//   pago      = pagamentos pago | confirmado | credito_aplicado (sinal à parte)
//   restante  = max(0, líquido − pago)   excedente = max(0, pago − líquido)

const PAID_STATUSES = ["pago", "confirmado", "credito_aplicado"];
const DEPOSIT_TYPES = ["sinal", "deposit"];

/**
 * Reais → centavos inteiros, com o mesmo arredondamento do backend.
 * @param {unknown} value
 * @returns {number}
 */
export function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

/**
 * Centavos inteiros → reais.
 * @param {number} cents
 * @returns {number}
 */
export function fromCents(cents) {
  return cents / 100;
}

/**
 * @typedef {object} OperationTotalsInput
 * @property {number|string} [serviceSubtotal] Também aceita `service_value`/`serviceValue`.
 * @property {number|string} [productSubtotal] Também aceita `product_value`/`productValue`.
 * @property {number|string} [discountTotal] Desconto TOTAL, usado só quando não vem o detalhamento
 *   cupom × manual (entra como cupom). Também `discount_value`/`discount`.
 * @property {number|string} [couponDiscount] Desconto de cupom/promoção. Também `coupon_discount`.
 * @property {number|string} [manualDiscount] Desconto manual. Também `manual_discount_value`.
 *   Informar qualquer um dos dois liga o detalhamento e `discountTotal` é ignorado.
 * @property {number|string} [adjustmentTotal] Ajustes assinados (acréscimos − abatimentos). Também `adjustment_total`.
 * @property {Array<Record<string, any>>} [payments] Linhas com `status`, `payment_type`/`type` e `amount`/`value`.
 * @property {any} [service_value]
 * @property {any} [serviceValue]
 * @property {any} [product_value]
 * @property {any} [productValue]
 * @property {any} [discount_value]
 * @property {any} [discount]
 * @property {any} [coupon_discount]
 * @property {any} [manual_discount_value]
 * @property {any} [adjustment_total]
 */

/**
 * @typedef {object} OperationTotals
 * @property {number} serviceSubtotal
 * @property {number} productSubtotal
 * @property {number} grossTotal
 * @property {number} couponDiscount Cupom efetivamente aplicado (limitado ao bruto).
 * @property {number} manualDiscount Manual efetivamente aplicado (limitado ao que sobrou do bruto).
 * @property {number} discountTotal
 * @property {number} netBeforeAdjustments Bruto − desconto.
 * @property {number} adjustmentTotal
 * @property {number} netTotal
 * @property {number} depositPaid
 * @property {number} otherPayments
 * @property {number} creditApplied Parte de `otherPayments` que veio de crédito aplicado.
 * @property {number} totalPaid
 * @property {number} outstandingBalance
 * @property {number} overpaymentAmount
 * @property {number} balance
 * @property {"liquidado" | "parcial" | "nao_pago" | "excedente"} paymentStatus
 * @property {boolean} closed
 * @property {boolean} discountExceedsGross O desconto PEDIDO (cupom + manual) passou do bruto.
 * @property {boolean} negativeNet Os ajustes levariam o líquido abaixo de zero.
 */

/**
 * Chaves extras são aceitas e ignoradas, como no backend.
 * @param {OperationTotalsInput & Record<string, any>} [input]
 * @returns {OperationTotals}
 */
export function calculateOperationTotals(input = {}) {
  const serviceCents = Math.max(0, toCents(input.serviceSubtotal ?? input.service_value ?? input.serviceValue));
  const productCents = Math.max(0, toCents(input.productSubtotal ?? input.product_value ?? input.productValue));
  const grossCents = serviceCents + productCents;
  const splitDiscount = [input.couponDiscount, input.coupon_discount, input.manualDiscount, input.manual_discount_value]
    .some((value) => value !== undefined && value !== null);
  const requestedCouponCents = Math.max(0, toCents(splitDiscount
    ? input.couponDiscount ?? input.coupon_discount
    : input.discountTotal ?? input.discount_value ?? input.discount));
  const requestedManualCents = splitDiscount ? Math.max(0, toCents(input.manualDiscount ?? input.manual_discount_value)) : 0;
  // Cupom primeiro; o manual completa até o bruto (mesma ordem do backend).
  const couponCents = Math.min(requestedCouponCents, grossCents);
  const manualCents = Math.min(requestedManualCents, grossCents - couponCents);
  const discountCents = couponCents + manualCents;
  // Assinado: acréscimo soma, abatimento subtrai. Não é limitado aqui — o
  // backend recusa o abatimento que deixaria o líquido negativo; o piso em
  // zero do líquido só protege leituras de dados antigos ou inconsistentes.
  const adjustmentCents = toCents(input.adjustmentTotal ?? input.adjustment_total);
  const netBeforeAdjustmentsCents = grossCents - discountCents;
  const unclampedNetCents = netBeforeAdjustmentsCents + adjustmentCents;
  const netCents = Math.max(0, unclampedNetCents);

  const payments = Array.isArray(input.payments) ? input.payments : [];
  const confirmedPayments = payments.filter((payment) => PAID_STATUSES.includes(String(payment?.status || "").toLowerCase()));
  const isDeposit = (payment) => DEPOSIT_TYPES.includes(String(payment?.payment_type || payment?.type || "").toLowerCase());
  const depositRows = confirmedPayments.filter(isDeposit);
  const otherRows = confirmedPayments.filter((payment) => !isDeposit(payment));
  const creditRows = otherRows.filter((payment) => String(payment?.status || "").toLowerCase() === "credito_aplicado");
  const sumCents = (rows) => rows.reduce((sum, item) => sum + Math.max(0, toCents(item.amount ?? item.value)), 0);
  const depositCents = sumCents(depositRows);
  const otherCents = sumCents(otherRows);
  const creditCents = sumCents(creditRows);
  const totalPaidCents = depositCents + otherCents;
  const balanceCents = netCents - totalPaidCents;
  const outstandingCents = Math.max(0, balanceCents);
  const overpaymentCents = Math.max(0, -balanceCents);
  const paymentStatus = overpaymentCents > 0
    ? "excedente"
    : outstandingCents === 0
      ? "liquidado"
      : totalPaidCents > 0 ? "parcial" : "nao_pago";

  return {
    serviceSubtotal: fromCents(serviceCents),
    productSubtotal: fromCents(productCents),
    grossTotal: fromCents(grossCents),
    couponDiscount: fromCents(couponCents),
    manualDiscount: fromCents(manualCents),
    discountTotal: fromCents(discountCents),
    netBeforeAdjustments: fromCents(netBeforeAdjustmentsCents),
    adjustmentTotal: fromCents(adjustmentCents),
    netTotal: fromCents(netCents),
    depositPaid: fromCents(depositCents),
    otherPayments: fromCents(otherCents),
    creditApplied: fromCents(creditCents),
    totalPaid: fromCents(totalPaidCents),
    outstandingBalance: fromCents(outstandingCents),
    overpaymentAmount: fromCents(overpaymentCents),
    balance: fromCents(balanceCents),
    paymentStatus,
    closed: outstandingCents === 0,
    discountExceedsGross: requestedCouponCents + requestedManualCents > grossCents,
    negativeNet: unclampedNetCents < 0
  };
}

/**
 * Soma assinada dos ajustes ATIVOS de uma lista vinda da API
 * (`adjustment_type` acrescimo|abatimento, `status` ativo|anulado).
 * @param {Array<Record<string, any>>} [adjustments]
 * @returns {number} Reais (acréscimos − abatimentos).
 */
export function sumActiveAdjustments(adjustments = []) {
  const cents = (Array.isArray(adjustments) ? adjustments : [])
    .filter((item) => String(item?.status || "ativo").toLowerCase() !== "anulado")
    .reduce((sum, item) => {
      const amount = Math.max(0, toCents(item?.amount));
      return String(item?.adjustment_type || "").toLowerCase() === "abatimento" ? sum - amount : sum + amount;
    }, 0);
  return fromCents(cents);
}

/**
 * Atalho de desconto em %: converte para R$ sobre a base informada
 * (bruto − cupom), arredondado a centavos. O que se grava é sempre o valor.
 * Percentual fora de 0–100 é limitado ao intervalo.
 * @param {number|string} base Reais.
 * @param {number|string} percent
 * @returns {number} Reais.
 */
export function discountFromPercent(base, percent) {
  const baseCents = Math.max(0, toCents(base));
  const rate = Math.min(100, Math.max(0, Number(String(percent ?? "").replace(",", ".")) || 0));
  return fromCents(Math.round((baseCents * rate) / 100));
}
