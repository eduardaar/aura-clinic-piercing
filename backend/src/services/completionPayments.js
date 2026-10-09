import { parseMoneyInputCents } from "./finance.js";

// Valida antes de qualquer escrita; mantém métodos legados cadastrados pela clínica.
export function normalizeCompletionPayments(rawPayments) {
  if (rawPayments !== undefined && !Array.isArray(rawPayments)) throw new Error("Informe a lista de pagamentos.");
  return (rawPayments || []).map((item) => {
    if (!item || typeof item !== "object") throw new Error("Pagamento inválido.");
    const amount = item.amount === undefined ? NaN : parseMoneyInputCents(item.amount, "O valor do pagamento") / 100;
    const installments = item.installments === undefined ? 1 : Number(item.installments);
    const fee = parseMoneyInputCents(item.fee_amount ?? 0, "A taxa da operadora") / 100;
    const status = String(item.status || "pago");
    const method = String(item.method || "Pix").trim();
    if (item.amount === "" || item.amount === null || !Number.isFinite(amount) || amount < 0) throw new Error("Informe um valor válido para cada pagamento.");
    if (!Number.isInteger(installments) || installments < 1) throw new Error("Informe uma quantidade inteira de parcelas, a partir de 1.");
    if (!Number.isFinite(fee) || fee < 0 || fee > amount) throw new Error("A taxa deve estar entre zero e o valor do pagamento.");
    if (!["pago", "confirmado", "pendente"].includes(status)) throw new Error("Status do pagamento inválido.");
    if (!method) throw new Error("Informe a forma de pagamento.");
    const date = item.expected_receipt_date || null;
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime()) || (date && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date))) throw new Error("Previsão de recebimento inválida.");
    return { amount: Math.round(amount * 100) / 100, method, status, installments, fee_amount: Math.round(fee * 100) / 100, expected_receipt_date: date, notes: String(item.notes || "") };
  }).filter((item) => item.amount > 0);
}
