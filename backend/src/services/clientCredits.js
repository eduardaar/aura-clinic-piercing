import { localTimestamp } from "./utils.js";
import { getAppointmentFinancialSnapshot } from "./finance.js";

function requestedAmount(value, maximum) {
  const amount = value === undefined || value === null || value === "" ? maximum : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Informe um valor de crédito válido.");
  if (amount > maximum + 0.009) throw new Error("O crédito informado supera o saldo em aberto.");
  return Number(amount.toFixed(2));
}

async function consumeCredits(tx, clientId, amount, target, userId) {
  let remaining = amount;
  const credits = await tx.all(`SELECT * FROM client_credits
    WHERE client_id=? AND status IN ('open','partially_used') AND remaining_amount>0
    ORDER BY created_at, id FOR UPDATE`, [clientId]);
  const available = credits.reduce((sum, item) => sum + Number(item.remaining_amount || 0), 0);
  if (available + 0.009 < amount) throw new Error("O cliente não possui crédito disponível suficiente.");
  for (const credit of credits) {
    if (remaining <= 0) break;
    const used = Math.min(remaining, Number(credit.remaining_amount));
    const next = Number((Number(credit.remaining_amount) - used).toFixed(2));
    await tx.run("UPDATE client_credits SET remaining_amount=?, status=?, updated_at=now() WHERE id=?", [next, next === 0 ? "used" : "partially_used", credit.id]);
    await tx.run(`INSERT INTO client_credit_usages (client_credit_id, appointment_id, sales_order_id, amount, created_by_user_id)
      VALUES (?, ?, ?, ?, ?)`, [credit.id, target.appointmentId || null, target.salesOrderId || null, used, userId]);
    remaining = Number((remaining - used).toFixed(2));
  }
}

async function availableCreditAmount(tx, clientId) {
  const row = await tx.get("SELECT COALESCE(SUM(remaining_amount),0) AS total FROM client_credits WHERE client_id=? AND status IN ('open','partially_used')", [clientId]);
  return Number(row?.total || 0);
}

export async function applyCreditToAppointment(db, appointmentId, body = {}, userId = null) {
  return db.transaction(async (tx) => {
    const appointment = await tx.get("SELECT * FROM appointments WHERE id=? FOR UPDATE", [appointmentId]);
    if (!appointment) throw new Error("Agendamento não encontrado.");
    if (appointment.status === "cancelado") throw new Error("Não é possível aplicar crédito em agendamento cancelado.");
    const snapshot = await getAppointmentFinancialSnapshot(tx, appointment.id);
    const outstanding = Number(snapshot?.outstandingBalance || 0);
    const amount = body.amount === undefined || body.amount === null || body.amount === ""
      ? Number(Math.min(outstanding, await availableCreditAmount(tx, appointment.client_id)).toFixed(2))
      : requestedAmount(body.amount, outstanding);
    if (amount <= 0) throw new Error("O cliente não possui crédito disponível ou o agendamento não tem saldo em aberto.");
    await consumeCredits(tx, appointment.client_id, amount, { appointmentId: appointment.id }, userId);
    await tx.run(`INSERT INTO payments
      (appointment_id, client_id, amount, payment_type, method, status, paid_at, created_by_user_id, idempotency_key, notes)
      VALUES (?, ?, ?, 'credito_cliente', 'Crédito do cliente', 'credito_aplicado', ?, ?, ?, ?)` ,
      [appointment.id, appointment.client_id, amount, localTimestamp(), userId, `appointment:${appointment.id}:credit:${Date.now()}`, "Crédito de cliente aplicado; não representa nova entrada de caixa."]);
    const after = await getAppointmentFinancialSnapshot(tx, appointment.id);
    await tx.run("UPDATE appointments SET remaining_value=?, updated_at=? WHERE id=?", [after.outstandingBalance, localTimestamp(), appointment.id]);
    return { appointment_id: appointment.id, applied_amount: amount, remaining_value: after.outstandingBalance };
  });
}

export async function applyCreditToSalesOrder(db, orderId, body = {}, userId = null) {
  return db.transaction(async (tx) => {
    const order = await tx.get("SELECT * FROM sales_orders WHERE id=? FOR UPDATE", [orderId]);
    if (!order) throw new Error("Venda não encontrada.");
    if (["cancelado", "devolvida"].includes(order.status)) throw new Error("Não é possível aplicar crédito nesta venda.");
    const entries = await tx.all(`SELECT * FROM financial_entries WHERE source_type='sales_order' AND source_id=? AND entry_type='receivable'
      AND status IN ('pending','overdue','partially_paid') ORDER BY due_date, id FOR UPDATE`, [order.id]);
    const maximum = Number(entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.amount) - Number(entry.paid_amount || 0)), 0).toFixed(2));
    const amount = body.amount === undefined || body.amount === null || body.amount === ""
      ? Number(Math.min(maximum, await availableCreditAmount(tx, order.client_id)).toFixed(2))
      : requestedAmount(body.amount, maximum);
    if (amount <= 0) throw new Error("O cliente não possui crédito disponível ou a venda não tem saldo em aberto.");
    await consumeCredits(tx, order.client_id, amount, { salesOrderId: order.id }, userId);
    let remaining = amount;
    for (const entry of entries) {
      if (remaining <= 0) break;
      const open = Math.max(0, Number(entry.amount) - Number(entry.paid_amount || 0));
      const used = Math.min(open, remaining);
      const paid = Number((Number(entry.paid_amount || 0) + used).toFixed(2));
      await tx.run("UPDATE financial_entries SET paid_amount=?, status=?, payment_method='Crédito do cliente', paid_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [paid, paid >= Number(entry.amount) ? "paid" : "partially_paid", localTimestamp(), entry.id]);
      remaining = Number((remaining - used).toFixed(2));
    }
    await tx.run(`INSERT INTO payments
      (client_id, sales_order_id, amount, payment_type, method, status, paid_at, created_by_user_id, idempotency_key, notes)
      VALUES (?, ?, ?, 'credito_cliente', 'Crédito do cliente', 'credito_aplicado', ?, ?, ?, ?)`,
      [order.client_id, order.id, amount, localTimestamp(), userId, `sales-order:${order.id}:credit:${Date.now()}`, "Crédito de cliente aplicado; não representa nova entrada de caixa."]);
    return { sales_order_id: order.id, applied_amount: amount, remaining_value: Number((maximum - amount).toFixed(2)) };
  });
}
