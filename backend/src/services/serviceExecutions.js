import { localTimestamp } from "./utils.js";
import {
  cancelServiceExecutionReceivables,
  normalizeExplicitInstallments,
  normalizeInstallmentCount,
  parseStoredInstallments,
  serializeInstallments,
  syncServiceExecutionReceivables
} from "./receivables.js";
import { parseServiceRulesSnapshot } from "./serviceRules.js";

export async function getServiceExecution(db, id) {
  const execution = await db.get("SELECT * FROM service_executions WHERE id=?", [id]);
  if (!execution) return null;
  const items = await db.all("SELECT * FROM service_execution_items WHERE service_execution_id=? ORDER BY id", [id]);
  const receivables = await db.all("SELECT * FROM financial_entries WHERE source_type='service_execution' AND source_id=? AND entry_type='receivable' AND status!='canceled' ORDER BY installment_number,id", [id]);
  return { ...execution, items, receivables };
}

export async function ensureServiceExecution(db, appointmentId, user, options = {}) {
  const appointment = await db.get(`
    SELECT a.*, c.full_name, s.name AS service_name,
      j.name AS jewelry_name, v.variation_name AS variant_name,
      COALESCE((SELECT SUM(p.amount) FROM payments p
        WHERE p.appointment_id=a.id AND p.status IN ('pago','confirmado')),0) AS paid_value
      FROM appointments a
      JOIN clients c ON c.id=a.client_id
      LEFT JOIN services s ON s.id=a.service_id
      LEFT JOIN jewelry_inventory j ON j.id=a.jewelry_id
      LEFT JOIN jewelry_variants v ON v.id=a.jewelry_variant_id
      WHERE a.id=? FOR UPDATE OF a
  `, [appointmentId]);
  if (!appointment) return null;
  const existing = await db.get("SELECT * FROM service_executions WHERE appointment_id=? FOR UPDATE", [appointmentId]);
  const appointmentItems = await db.all(`
    SELECT ai.*, s.name AS service_name, p.name AS procedure_name,
      j.name AS product_name, v.variation_name AS variant_name
      FROM appointment_items ai
      LEFT JOIN services s ON s.id=ai.service_id
      LEFT JOIN procedures p ON p.id=ai.procedure_id
      LEFT JOIN jewelry_inventory j ON j.id=ai.jewelry_id
      LEFT JOIN jewelry_variants v ON v.id=ai.jewelry_variant_id
      WHERE ai.appointment_id=? ORDER BY ai.id
  `, [appointmentId]);

  const serviceSubtotal = Number(appointment.service_value || appointmentItems.reduce((sum, item) => sum + Number(item.procedure_price || 0), 0));
  const productSubtotal = Number(appointment.jewelry_value || appointmentItems.reduce((sum, item) => sum + Number(item.jewelry_unit_price || 0) * Number(item.quantity || 1), 0));
  const total = Number(appointment.total_value || Math.max(0, serviceSubtotal + productSubtotal - Number(appointment.discount_value || 0)));
  const paid = Math.min(total, Number(appointment.paid_value || 0));
  const outstanding = Math.max(0, Number(appointment.remaining_value ?? total - paid));
  const explicitProvided = Array.isArray(options.installments)
    ? options.installments.length > 0
    : options.installments != null;
  const automaticProvided = ["installmentCount", "installment_count", "firstDueDate", "first_due_date", "paymentMethod", "payment_method"]
    .some((key) => options[key] !== undefined);
  const stored = existing && !explicitProvided && !automaticProvided ? parseStoredInstallments(existing.installments_json) : null;
  const paymentMethod = String(options.paymentMethod || options.payment_method || appointment.remaining_payment_method || appointment.deposit_payment_method || "Pix");
  const explicitInstallments = normalizeExplicitInstallments(explicitProvided ? options.installments : stored, {
    total: outstanding,
    defaultPaymentMethod: paymentMethod
  });
  const installmentCount = explicitInstallments?.length || normalizeInstallmentCount(options.installmentCount ?? options.installment_count ?? existing?.installment_count ?? 1);
  const firstDueDate = explicitInstallments?.[0]?.dueDate || String(options.firstDueDate || options.first_due_date || existing?.first_due_date || localTimestamp().slice(0, 10));
  const snapshot = {
    appointment_id: appointment.id,
    client_name: appointment.full_name,
    procedure: appointment.service_name || appointment.procedure || "Atendimento",
    appointment_date: appointment.appointment_date,
    appointment_time: appointment.appointment_time,
    region: appointment.piercing_region || null,
    service_rules: parseServiceRulesSnapshot(appointment.service_rules_snapshot)
  };
  const optionalText = (key) => options[key] === undefined
    ? (existing?.[key] || null)
    : (String(options[key] || "").trim() || null);
  const clinicalNotes = optionalText("clinical_notes");
  const occurrences = optionalText("occurrences");
  const aftercareNotes = optionalText("aftercare_notes");

  let executionId = existing?.id;
  if (existing) {
    await db.run(`UPDATE service_executions SET
      client_id=?, professional_id=?, service_id=?, status='completed', snapshot=?,
      service_subtotal=?, product_subtotal=?, discount_total=?, total_value=?, paid_value=?, receivable_value=?,
      payment_method=?, installment_count=?, first_due_date=?, installments_json=?, executed_by_user_id=?,
      clinical_notes=?, occurrences=?, aftercare_notes=?,
      completed_at=now(), cancelled_at=NULL, cancellation_reason=NULL, updated_at=now()
      WHERE id=?`, [
      appointment.client_id, appointment.professional_id, appointment.service_id, snapshot,
      serviceSubtotal, productSubtotal, Number(appointment.discount_value || 0), total, paid, outstanding,
      paymentMethod, installmentCount, firstDueDate, explicitInstallments ? serializeInstallments(explicitInstallments) : null,
      user?.id || null, clinicalNotes, occurrences, aftercareNotes, existing.id
    ]);
  } else {
    const created = await db.run(`INSERT INTO service_executions
      (appointment_id, client_id, professional_id, service_id, snapshot,
       service_subtotal, product_subtotal, discount_total, total_value, paid_value, receivable_value,
       payment_method, installment_count, first_due_date, installments_json, executed_by_user_id,
       clinical_notes, occurrences, aftercare_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, [
      appointment.id, appointment.client_id, appointment.professional_id, appointment.service_id, snapshot,
      serviceSubtotal, productSubtotal, Number(appointment.discount_value || 0), total, paid, outstanding,
      paymentMethod, installmentCount, firstDueDate, explicitInstallments ? serializeInstallments(explicitInstallments) : null,
      user?.id || null, clinicalNotes, occurrences, aftercareNotes
    ]);
    executionId = created.returnedId;
  }

  await db.run("DELETE FROM service_execution_items WHERE service_execution_id=?", [executionId]);
  const sourceItems = appointmentItems.length ? appointmentItems : [{
    service_id: appointment.service_id,
    service_name: appointment.service_name || appointment.procedure,
    procedure_price: serviceSubtotal,
    jewelry_id: appointment.jewelry_id,
    jewelry_variant_id: appointment.jewelry_variant_id,
    product_name: appointment.jewelry_name,
    variant_name: appointment.variant_name,
    jewelry_unit_price: productSubtotal,
    quantity: 1,
    region: appointment.piercing_region
  }];
  for (const item of sourceItems) {
    if (item.service_id || Number(item.procedure_price || 0) > 0) {
      const value = Number(item.procedure_price || 0);
      await db.run(`INSERT INTO service_execution_items
        (service_execution_id,item_type,service_id,item_name,quantity,unit_price,total_value,metadata)
        VALUES (?, 'service', ?, ?, 1, ?, ?, ?)`, [
        executionId, item.service_id || null, item.procedure_name || item.service_name || appointment.procedure || "Atendimento",
        value, value, { region: item.region || appointment.piercing_region || null }
      ]);
    }
    if (item.jewelry_id) {
      const quantity = Math.max(1, Number(item.quantity || 1));
      const unitPrice = Number(item.jewelry_unit_price || 0);
      await db.run(`INSERT INTO service_execution_items
        (service_execution_id,item_type,product_id,product_variant_id,item_name,quantity,unit_price,total_value,metadata)
        VALUES (?, 'product', ?, ?, ?, ?, ?, ?, ?)`, [
        executionId, item.jewelry_id, item.jewelry_variant_id || null,
        item.variant_name ? `${item.product_name} - ${item.variant_name}` : item.product_name || appointment.jewelry_name || "Produto aplicado",
        quantity, unitPrice, unitPrice * quantity, { applied_during_service: true }
      ]);
    }
  }
  await db.run("UPDATE payments SET service_execution_id=? WHERE appointment_id=?", [executionId, appointmentId]);
  await syncServiceExecutionReceivables(db, {
    serviceExecutionId: executionId,
    amount: outstanding,
    installmentCount,
    firstDueDate,
    paymentMethod,
    installments: explicitInstallments,
    description: `Atendimento #${appointment.id}`
  });
  return getServiceExecution(db, executionId);
}

export async function cancelServiceExecution(db, appointmentId, reason) {
  const execution = await db.get("SELECT * FROM service_executions WHERE appointment_id=? FOR UPDATE", [appointmentId]);
  if (!execution) return null;
  await cancelServiceExecutionReceivables(db, execution.id);
  await db.run(
    "UPDATE service_executions SET status='cancelled', cancelled_at=now(), cancellation_reason=?, updated_at=now() WHERE id=?",
    [String(reason || "Atendimento cancelado").trim(), execution.id]
  );
  return getServiceExecution(db, execution.id);
}
