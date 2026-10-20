import { FinancialRuleError, parseMoneyInputCents } from "./finance.js";
import { normalizeEntry } from "./financeLedger.js";
import { syncEntrySettlement } from "./financeSettlement.js";
import { recordAudit } from "./audit.js";
import { validBookingDate } from "./publicBookingAvailability.js";

export async function recordPayableChange(db, before, after, userId, { key = null, notes = "" } = {}) {
  if (!["payable", "expense"].includes(after.entry_type)) return;
  const delta = Math.round((Number(after.paid_amount) - Number(before?.paid_amount || 0)) * 100) / 100;
  if (!delta) return;
  await db.run(
    `INSERT INTO financial_entry_payments (entry_id,amount,paid_at,payment_method,notes,user_id,idempotency_key)
    VALUES (?,?,?,?,?,?,?)`,
    [
      after.id,
      delta,
      after.paid_at || new Date().toISOString(),
      after.payment_method || "Pix",
      notes,
      userId || null,
      key,
    ],
  );
}

export async function payFinancialEntry(db, id, body, req) {
  const cents = parseMoneyInputCents(body.amount, "O valor pago");
  const paidAt = String(body.paid_at || "");
  const method = String(body.payment_method || "").trim();
  const key = String(body.idempotency_key || "").trim();
  if (!(cents > 0) || !validBookingDate(paidAt) || !method || !key || key.length > 120)
    throw new FinancialRuleError(
      "Informe valor positivo, data do pagamento, forma de pagamento e identificação da operação.",
    );
  return db.transaction(async (tx) => {
    const before = await tx.get("SELECT * FROM financial_entries WHERE id=? FOR UPDATE", [id]);
    if (!before) throw new FinancialRuleError("Conta não encontrada.", 404);
    if (!["payable", "expense"].includes(before.entry_type))
      throw new FinancialRuleError("Utilize Contas a Receber para este lançamento.");
    const repeated = await tx.get("SELECT * FROM financial_entry_payments WHERE entry_id=? AND idempotency_key=?", [
      id,
      key,
    ]);
    if (repeated) {
      if (
        Math.round(Number(repeated.amount) * 100) !== cents ||
        repeated.paid_at !== paidAt ||
        repeated.payment_method !== method
      )
        throw new FinancialRuleError("Esta identificação já foi usada para outro pagamento.", 409);
      return before;
    }
    if (["canceled", "refunded"].includes(before.status) || (before.lifecycle_status || "active") !== "active")
      throw new FinancialRuleError("Esta conta não permite pagamento.", 409);
    const paidCents = Math.round(Number(before.paid_amount) * 100) + cents;
    if (paidCents > Math.round(Number(before.amount) * 100))
      throw new FinancialRuleError("O pagamento excede o saldo da conta.");
    const after = {
      ...before,
      ...normalizeEntry({ paid_amount: paidCents / 100, paid_at: paidAt, payment_method: method }, before),
    };
    await tx.run(
      "UPDATE financial_entries SET paid_amount=?,paid_at=?,payment_method=?,status=?,updated_at=now() WHERE id=?",
      [after.paid_amount, after.paid_at, after.payment_method, after.status, id],
    );
    await syncEntrySettlement(tx, before, after, req.user?.id);
    await recordPayableChange(tx, before, after, req.user?.id, { key, notes: String(body.notes || "") });
    await tx.run(
      "INSERT INTO financial_entry_audit (entry_id,user_id,action,before_data,after_data) VALUES (?,?,'payment',?,?)",
      [id, req.user?.id || null, JSON.stringify(before), JSON.stringify(after)],
    );
    await recordAudit(tx, {
      req,
      module: "finance",
      action: "payment",
      entityType: "financial_entry",
      entityId: id,
      reason: body.notes || "Pagamento de conta registrado",
      before,
      after,
    });
    return after;
  });
}
