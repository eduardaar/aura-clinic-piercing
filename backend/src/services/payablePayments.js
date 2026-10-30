import { FinancialRuleError, parseMoneyInputCents } from "./finance.js";
import { normalizeEntry } from "./financeLedger.js";
import { syncEntrySettlement } from "./financeSettlement.js";
import { recordAudit } from "./audit.js";
import { validBookingDate } from "./publicBookingAvailability.js";
import { accountSelection } from "./financialAccounts.js";

export async function recordPayableChange(db, before, after, userId, { key = null, notes = "", card = null } = {}) {
  if (!["payable", "expense", "income", "receivable"].includes(after.entry_type) || ["payment", "card_fee", "card_surcharge"].includes(after.source_type)) return;
  const delta = Math.round((Number(after.paid_amount) - Number(before?.paid_amount || 0)) * 100) / 100;
  if (!delta) return;
  await db.run(
    `INSERT INTO financial_entry_payments (entry_id,amount,paid_at,payment_method,notes,user_id,idempotency_key,financial_account_id,fee_amount,card_surcharge_amount,card_fee_snapshot)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      after.id,
      delta,
      after.paid_at || new Date().toISOString(),
      after.payment_method || "Pix",
      notes,
      userId || null,
      key,
      after.financial_account_id === undefined ? before?.financial_account_id || null : after.financial_account_id,
      card?.fee_amount || 0, card?.card_surcharge_amount || 0, card?.card_fee_snapshot ? JSON.stringify(card.card_fee_snapshot) : null,
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
    const accountValue = body.financial_account_id === undefined ? before.financial_account_id : body.financial_account_id;
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
        repeated.payment_method !== method || (body.financial_account_id !== undefined && Number(repeated.financial_account_id || 0) !== Number(body.financial_account_id || 0))
      )
        throw new FinancialRuleError("Esta identificação já foi usada para outro pagamento.", 409);
      return before;
    }
    const accountId = await accountSelection(tx, accountValue);
    if (["canceled", "refunded"].includes(before.status) || (before.lifecycle_status || "active") !== "active")
      throw new FinancialRuleError("Esta conta não permite pagamento.", 409);
    const paidCents = Math.round(Number(before.paid_amount) * 100) + cents;
    if (paidCents > Math.round(Number(before.amount) * 100))
      throw new FinancialRuleError("O pagamento excede o saldo da conta.");
    const after = {
      ...before,
      ...normalizeEntry({ paid_amount: paidCents / 100, paid_at: paidAt, payment_method: method, financial_account_id: accountId }, before),
    };
    await tx.run(
      "UPDATE financial_entries SET paid_amount=?,paid_at=?,payment_method=?,status=?,financial_account_id=?,updated_at=now() WHERE id=?",
      [after.paid_amount, after.paid_at, after.payment_method, after.status, accountId, id],
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
