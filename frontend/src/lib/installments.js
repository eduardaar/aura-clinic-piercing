export const MAX_INSTALLMENT_COUNT = 120;

export function moneyToCents(value) {
  const number = Number(
    String(value ?? "0")
      .trim()
      .replace(",", "."),
  );
  if (!Number.isFinite(number)) return null;
  return Math.round((number + Number.EPSILON) * 100);
}

export function normalizeInstallmentCount(value) {
  const count = Math.trunc(Number(value || 1));
  return Math.min(MAX_INSTALLMENT_COUNT, Math.max(1, Number.isFinite(count) ? count : 1));
}

export function normalizePaymentMethod(value) {
  const method = String(value || "Pix").trim();
  const knownMethods = {
    pix: "Pix",
    dinheiro: "dinheiro",
    "cartão de crédito": "cartão de crédito",
    "cartao de credito": "cartão de crédito",
    "cartão de débito": "cartão de débito",
    "cartao de debito": "cartão de débito",
  };
  return knownMethods[method.toLocaleLowerCase("pt-BR")] || method;
}

function parseIsoDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, rawYear, rawMonth, rawDay] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function monthlyInstallmentDate(firstDueDate, offset) {
  const first = parseIsoDate(firstDueDate);
  if (!first) return "";
  const targetMonth = first.month - 1 + Number(offset || 0);
  const year = first.year + Math.floor(targetMonth / 12);
  const monthIndex = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(Math.min(first.day, lastDay)).padStart(2, "0")}`;
}

export function buildInstallments({ total, count = 1, firstDueDate, paymentMethod = "Pix" }) {
  const totalCents = moneyToCents(total);
  const installmentCount = normalizeInstallmentCount(count);
  if (totalCents == null || totalCents < 0 || !parseIsoDate(firstDueDate)) return [];
  const baseCents = Math.floor(totalCents / installmentCount);
  const remainder = totalCents % installmentCount;
  return Array.from({ length: installmentCount }, (_, index) => ({
    installment_number: index + 1,
    due_date: monthlyInstallmentDate(firstDueDate, index),
    amount: (baseCents + (index < remainder ? 1 : 0)) / 100,
    payment_method: normalizePaymentMethod(paymentMethod),
  }));
}

export function installmentSummary(total, installments, expectedCount = null) {
  const expectedCents = moneyToCents(total);
  const rows = Array.isArray(installments) ? installments : [];
  const rowCents = rows.map((item) => moneyToCents(item?.amount));
  const installmentCents = rowCents.reduce((sum, cents) => sum + (cents ?? 0), 0);
  const differenceCents = (expectedCents ?? 0) - installmentCents;
  const countMatches = expectedCount == null || rows.length === normalizeInstallmentCount(expectedCount);
  const rowsValid =
    rows.length > 0 &&
    rows.every(
      (item, index) =>
        (rowCents[index] ?? 0) > 0 &&
        Boolean(parseIsoDate(item?.due_date)) &&
        Boolean(String(item?.payment_method || "").trim()),
    );
  return {
    expectedCents: expectedCents ?? 0,
    installmentCents,
    differenceCents,
    countMatches,
    rowsValid,
    isValid: expectedCents != null && expectedCents > 0 && differenceCents === 0 && countMatches && rowsValid,
  };
}

export function installmentsForPayload(installments) {
  return (Array.isArray(installments) ? installments : []).map((item, index) => ({
    installment_number: index + 1,
    due_date: String(item?.due_date || ""),
    amount: (moneyToCents(item?.amount) ?? 0) / 100,
    payment_method: normalizePaymentMethod(item?.payment_method),
  }));
}
