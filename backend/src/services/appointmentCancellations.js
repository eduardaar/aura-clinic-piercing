import { localTimestamp } from "./utils.js";
import { restoreJewelryStock } from "./appointments.js";
import { restoreAppointmentConsumptions } from "./consumableUsage.js";
import { cancelSalesOrderReceivables } from "./receivables.js";

const RESOLUTIONS = new Set(["retain_deposit", "client_credit", "manual_refund", "no_payment"]);

function text(value, label) {
  const valueText = String(value || "").trim();
  if (!valueText) throw new Error(`${label} é obrigatório.`);
  return valueText;
}

export async function cancelAppointmentWithResolution(db, appointmentId, body = {}, userId = null) {
  const resolution = String(body.resolution || "");
  if (!RESOLUTIONS.has(resolution)) throw new Error("Escolha retenção do sinal, crédito, reembolso manual ou sem pagamento.");
  const reason = text(body.reason, "Motivo do cancelamento");
  return db.transaction(async (tx) => {
    const appointment = await tx.get("SELECT * FROM appointments WHERE id=? FOR UPDATE", [appointmentId]);
    if (!appointment) throw new Error("Agendamento não encontrado.");
    const previous = await tx.get("SELECT id FROM appointment_cancellations WHERE appointment_id=?", [appointmentId]);
    if (previous) throw new Error("Este agendamento já possui uma resolução de cancelamento.");
    if (appointment.status === "cancelado") throw new Error("Agendamento já está cancelado.");

    const paidRows = await tx.all(`
      SELECT * FROM payments
       WHERE appointment_id=? AND payment_type='sinal' AND status IN ('pago','confirmado') AND amount>0
       FOR UPDATE`, [appointmentId]);
    const depositAmount = Number(paidRows.reduce((total, item) => total + Number(item.amount || 0), 0).toFixed(2));
    if (!depositAmount && resolution !== "no_payment") throw new Error("Não há sinal recebido: use a resolução sem pagamento.");
    if (depositAmount && resolution === "no_payment") throw new Error("Há sinal recebido: escolha retenção, crédito ou reembolso manual.");

    // Atendimento já executado com pagamentos finais exige a devolução de venda
    // antes do cancelamento; assim nunca se misturam dois estornos financeiros.
    const finalPayment = await tx.get(`SELECT EXISTS(
      SELECT 1 FROM payments WHERE appointment_id=? AND payment_type <> 'sinal'
        AND status IN ('pago','confirmado') AND amount>0
    ) AS value`, [appointmentId]);
    if (appointment.status === "atendido" && finalPayment?.value) {
      throw new Error("Atendimento concluído com pagamento final deve ser resolvido pela devolução/estorno da venda antes do cancelamento.");
    }

    const created = await tx.run(`
      INSERT INTO appointment_cancellations
        (appointment_id, client_id, resolution, deposit_amount, refund_method, reason, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [appointment.id, appointment.client_id, resolution, depositAmount,
        resolution === "manual_refund" ? text(body.refund_method, "Forma do reembolso") : null, reason, userId]
    );

    if (resolution === "client_credit" && depositAmount > 0) {
      await tx.run(`INSERT INTO client_credits
        (client_id, appointment_cancellation_id, amount, remaining_amount, reason, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?)`, [appointment.client_id, created.returnedId, depositAmount, depositAmount, reason, userId]);
    }
    if (resolution === "manual_refund" && depositAmount > 0) {
      await tx.run(`INSERT INTO financial_entries
        (entry_type, description, category, amount, paid_amount, due_date, competence_date, status, payment_method, paid_at, responsible_user_id, notes, source_type, source_id, source_key)
        VALUES ('expense', ?, 'Estornos e reembolsos', ?, ?, ?, ?, 'paid', ?, ?, ?, ?, 'appointment_cancellation', ?, ?)
        ON CONFLICT (source_key) DO NOTHING`, [
        `Reembolso de sinal — agenda #${appointment.id}`, depositAmount, depositAmount,
        localTimestamp().slice(0, 10), localTimestamp().slice(0, 10), body.refund_method,
        localTimestamp(), userId, reason, created.returnedId, `appointment-cancellation:${created.returnedId}:refund`
      ]);
      await tx.run("UPDATE payments SET status='refunded', notes=COALESCE(notes, '') || ? WHERE appointment_id=? AND payment_type='sinal' AND status IN ('pago','confirmado')", [`\nReembolso manual no cancelamento #${created.returnedId}`, appointment.id]);
    }
    await tx.run("UPDATE payments SET status='cancelado' WHERE appointment_id=? AND status NOT IN ('pago','confirmado','refunded')", [appointment.id]);
    if (appointment.status === "atendido") {
      await restoreJewelryStock(tx, appointment.id);
      await restoreAppointmentConsumptions(tx, appointment.id, userId, `Cancelamento #${created.returnedId}: ${reason}`);
    }
    const serviceOrder = await tx.get("SELECT id FROM sales_orders WHERE appointment_id=? AND order_type='ordem_servico' FOR UPDATE", [appointment.id]);
    if (serviceOrder) {
      await cancelSalesOrderReceivables(tx, serviceOrder.id);
      await tx.run("UPDATE sales_orders SET status='cancelado', stock_deducted=0 WHERE id=?", [serviceOrder.id]);
    }
    const depositStatus = resolution === "retain_deposit" ? "retido" : resolution === "manual_refund" ? "estornado" : resolution === "client_credit" ? "creditado" : "cancelado";
    await tx.run(`UPDATE appointments SET status='cancelado', remaining_value=0, deposit_status=?, financial_notes=?, updated_at=? WHERE id=?`,
      [depositStatus, `${appointment.financial_notes || ""}\nCancelamento #${created.returnedId}: ${reason}`.trim(), localTimestamp(), appointment.id]);
    const after = await tx.get("SELECT * FROM appointments WHERE id=?", [appointment.id]);
    await tx.run("INSERT INTO appointment_financial_audit (appointment_id, user_id, action, reason, before_snapshot, after_snapshot) VALUES (?, ?, 'cancellation_resolution', ?, ?, ?)",
      [appointment.id, userId, reason, JSON.stringify(appointment), JSON.stringify(after)]);
    return { cancellation_id: created.returnedId, appointment: after, resolution, deposit_amount: depositAmount };
  });
}
