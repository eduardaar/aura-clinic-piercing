import { recalculateAppointmentFinancials, FinancialRuleError } from "./finance.js";
import { localTimestamp } from "./utils.js";
import { applyConfiguredCardFee } from "./cardFees.js";

// O título continua sendo a origem contábil; o pagamento ligado a ele é a
// entrada de caixa da operação. Ambos são alterados na mesma transação.
export async function syncEntrySettlement(db, before, after, userId) {
  if (before.source_type === "expense" && after.entry_type === "expense") {
    await db.run("UPDATE expenses SET status=?,paid_at=?,payment_method=?,paid_by_user_id=? WHERE id=?", [
      Number(after.paid_amount) >= Number(after.amount) ? "paga" : "pendente",
      after.paid_at,
      after.payment_method,
      userId || null,
      before.source_id,
    ]);
    return;
  }
  if (!["receivable", "income"].includes(after.entry_type)) return;
  if (before.source_type === "payment") {
    const payment = await db.get("SELECT * FROM payments WHERE id=? FOR UPDATE", [before.source_id]);
    if (!payment) throw new FinancialRuleError("Pagamento de origem não encontrado.");
    if (![0, Number(after.amount)].includes(Number(after.paid_amount)))
      throw new FinancialRuleError("Para receber parcialmente, use o título em Contas a Receber.");
    await db.run("UPDATE payments SET amount=?,status=?,method=?,paid_at=?,financial_account_id=? WHERE id=?", [
      after.amount,
      Number(after.paid_amount) > 0 ? "pago" : "pendente",
      after.payment_method || payment.method,
      after.paid_at || payment.paid_at,
      after.financial_account_id,
      payment.id,
    ]);
    const card = await applyConfiguredCardFee(
      db,
      {
        amount: Number(after.amount),
        method: after.payment_method || payment.method,
        installments: Number(payment.installments || 1),
        fee_amount: Number(payment.fee_amount || 0),
        card_fee_table_id: after.card_fee_table_id || payment.card_fee_table_id,
        fee_policy: after.fee_policy || payment.card_fee_snapshot?.fee_policy || "studio",
        quoted_charged_amount: after.quoted_charged_amount ?? payment.card_fee_snapshot?.charged_amount,
      },
      { current: payment },
    );
    await db.run("UPDATE payments SET fee_amount=?,net_amount=?,card_fee_table_id=?,card_fee_snapshot=?,card_surcharge_amount=? WHERE id=?", [
      card.fee_amount,
      Number(after.amount) + Number(card.card_surcharge_amount || 0) - card.fee_amount,
      card.card_fee_table_id,
      JSON.stringify(card.card_fee_snapshot),
      Number(card.card_surcharge_amount || 0),
      payment.id,
    ]);
    if (payment.appointment_id) {
      if (payment.payment_type === "sinal")
        await db.run(
          "UPDATE appointments SET deposit_value=?,deposit_status=?,deposit_payment_method=?,deposit_paid_at=? WHERE id=?",
          [
            after.amount,
            Number(after.paid_amount) > 0 ? "pago" : "pendente",
            after.payment_method || payment.method,
            Number(after.paid_amount) > 0 ? after.paid_at || payment.paid_at : null,
            payment.appointment_id,
          ],
        );
      await recalculateAppointmentFinancials(db, payment.appointment_id);
      await updateExecutionMoney(db, payment.appointment_id);
    }
    return;
  }
  let source;
  if (before.source_type === "service_execution")
    source = await db.get(
      "SELECT client_id,appointment_id,id AS execution_id FROM service_executions WHERE id=? FOR UPDATE",
      [before.source_id],
    );
  else if (before.source_type === "sales_order")
    source = await db.get("SELECT client_id,id AS sales_order_id FROM sales_orders WHERE id=? FOR UPDATE", [
      before.source_id,
    ]);
  else return;
  if (!source?.client_id) throw new FinancialRuleError("Cliente da operação de origem não encontrado.");
  const payment = await db.get("SELECT * FROM payments WHERE financial_entry_id=? FOR UPDATE", [before.id]);
  const delta = Math.round((Number(after.paid_amount) - Number(before.paid_amount)) * 100) / 100;
  if (!delta) return null;
  const amount = Math.round((Number(payment?.amount || 0) + delta) * 100) / 100;
  if (amount < 0) throw new FinancialRuleError("A correção atinge um pagamento do fechamento. Corrija o pagamento de origem.");
  if (delta < 0 && (Number(payment?.fee_amount) > 0 || Number(payment?.card_surcharge_amount) > 0))
    throw new FinancialRuleError("A baixa contém taxas de cartão. Registre o estorno na origem para preservar as taxas e o valor devolvido.");
  const card = delta > 0 ? await applyConfiguredCardFee(db, {
    amount: delta, method: after.payment_method || "Pix", installments: Number(after.card_installments || 1), fee_amount: 0,
    card_fee_table_id: after.card_fee_table_id, fee_policy: after.fee_policy || "studio", quoted_charged_amount: after.quoted_charged_amount,
  }) : null;
  const fee = Math.round((Number(payment?.fee_amount || 0) + Number(card?.fee_amount || 0)) * 100) / 100;
  const surcharge = Math.round((Number(payment?.card_surcharge_amount || 0) + Number(card?.card_surcharge_amount || 0)) * 100) / 100;
  const status = amount > 0 && !["canceled", "refunded"].includes(after.status) ? "pago" : "cancelado";
  const paidAt = after.paid_at || localTimestamp();
  // A linha de payments continua sendo o resumo do título. Cada baixa real,
  // com a conta e a taxa contratada naquele momento, fica no histórico.
  const snapshot = payment && Number(payment.amount) > 0 ? { mode: "receipts", gross_amount: amount,
    charged_amount: Math.round((amount+surcharge)*100)/100, fee_amount: fee, net_amount: Math.round((amount+surcharge-fee)*100)/100 }
    : card?.card_fee_snapshot || null;
  if (payment) await db.run(
    "UPDATE payments SET amount=?,status=?,method=?,paid_at=?,financial_account_id=NULL,fee_amount=?,card_surcharge_amount=?,net_amount=?,card_fee_table_id=?,card_fee_snapshot=? WHERE id=?",
    [amount,status,after.payment_method || "Pix",paidAt,fee,surcharge,Math.round((amount+surcharge-fee)*100)/100,card?.card_fee_table_id || payment.card_fee_table_id,JSON.stringify(snapshot),payment.id]);
  else if (amount > 0) await db.run(
    "INSERT INTO payments (client_id,appointment_id,service_execution_id,sales_order_id,financial_entry_id,amount,payment_type,method,status,paid_at,created_by_user_id,fee_amount,card_surcharge_amount,net_amount,card_fee_table_id,card_fee_snapshot) VALUES (?,?,?,?,?,?,'recebimento',?,?,?,?,?,?,?,?,?)",
    [source.client_id,source.appointment_id || null,source.execution_id || null,source.sales_order_id || null,before.id,amount,
      after.payment_method || "Pix",status,paidAt,userId || null,fee,surcharge,Math.round((amount+surcharge-fee)*100)/100,card?.card_fee_table_id,JSON.stringify(snapshot)]);
  if (source.appointment_id) {
    await recalculateAppointmentFinancials(db, source.appointment_id);
    await updateExecutionMoney(db, source.appointment_id);
  }
  return card;
}

async function updateExecutionMoney(db, appointmentId) {
  await db.run(
    `UPDATE service_executions SET paid_value=a.total_value-a.remaining_value,receivable_value=a.remaining_value,updated_at=now()
    FROM appointments a WHERE service_executions.appointment_id=a.id AND a.id=? AND service_executions.status='completed'`,
    [appointmentId],
  );
}
