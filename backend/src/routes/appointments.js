// Rotas de agendamentos.
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { parseUpload, privateUpload, registerPrivateFiles } from "../middleware/upload.js";
import { normalizeAppointment, addMinutesToTime, localTimestamp } from "../services/utils.js";
import { parsePaging, pageResponse } from "../services/pagination.js";
import {
  listAppointments,
  countAppointments,
  upsertClient,
  deductJewelryStock,
  registerRemainingPayment,
  restoreJewelryStock,
  normalizeAppointmentItems,
  appointmentTotalsFromItems,
  replaceAppointmentItems,
  appointmentItemsFromBody,
  registerCompletionPayments
} from "../services/appointments.js";
import { validateCoupon } from "../services/discounts.js";
import { calculateOperationTotals, getAppointmentFinancialSnapshot } from "../services/finance.js";
import { ensurePostCareFollowups } from "../services/postcare.js";
import { awardLoyaltyForAppointment } from "../services/loyalty.js";
import { ensureSalesOrderForAppointment } from "../services/sales.js";
import { validateBody } from "../middleware/validate.js";
import { appointmentCreateSchema } from "../schemas/index.js";
import { queueAppointmentReminderNotifications } from "../services/notifications.js";
import { invalidateUsageCache, requireWithinLimit } from "../services/planLimits.js";
import { P } from "../config/permissions.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { hasPermission } from "../services/permissionService.js";
import { cancelSalesOrderReceivables, configuresReceivableSchedule } from "../services/receivables.js";
import { requireFeature } from "../services/subscriptions.js";

const router = Router();

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const APPOINTMENT_SORTABLE = {
  date: "a.appointment_date",
  status: "a.status",
  client: "c.full_name",
  professional: "p.name",
  total: "a.total_value"
};

function optionalId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

async function validateAppointmentItemsStock(db, items = []) {
  for (const item of Array.isArray(items) ? items : []) {
    if (!item.jewelry_id) continue;
    const quantity = Math.max(1, Number(item.quantity || 1));
    if (item.jewelry_variant_id) {
      const variant = await db.get(
        "SELECT quantity FROM jewelry_variants WHERE id = ? AND jewelry_id = ? AND is_active = 1",
        [item.jewelry_variant_id, item.jewelry_id]
      );
      if (!variant || Number(variant.quantity || 0) < quantity) {
        return "Quantidade indisponível para a variação de joia selecionada.";
      }
      continue;
    }
    const stock = await db.get(
      `SELECT CASE
         WHEN EXISTS (SELECT 1 FROM jewelry_variants WHERE jewelry_id = ? AND is_active = 1)
           THEN (SELECT COALESCE(SUM(quantity), 0) FROM jewelry_variants WHERE jewelry_id = ? AND is_active = 1)
         ELSE (SELECT quantity FROM jewelry_inventory WHERE id = ? AND status != 'arquivado')
       END AS quantity`,
      [item.jewelry_id, item.jewelry_id, item.jewelry_id]
    );
    if (Number(stock?.quantity || 0) < quantity) return "Quantidade indisponível para a joia selecionada.";
  }
  return "";
}

router.get("/api/appointments", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_VIEW)) return;
  const clauses = [];
  const params = [];
  if (req.query.professional_id) {
    clauses.push("a.professional_id = ?");
    params.push(req.query.professional_id);
  }
  if (req.query.status) {
    if (req.query.status === "pendente") {
      clauses.push("a.status IN ('pendente', 'awaiting_deposit_proof')");
    } else {
      clauses.push("a.status = ?");
      params.push(req.query.status);
    }
  }
  if (req.query.from) {
    clauses.push("a.appointment_date >= ?");
    params.push(req.query.from);
  }
  if (req.query.to) {
    clauses.push("a.appointment_date <= ?");
    params.push(req.query.to);
  }
  if (req.query.client_id) {
    clauses.push("a.client_id = ?");
    params.push(req.query.client_id);
  }
  if (req.query.search) {
    clauses.push("(c.full_name ILIKE ? OR c.whatsapp ILIKE ? OR a.procedure ILIKE ?)");
    params.push(...Array(3).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: APPOINTMENT_SORTABLE,
    tieBreak: "a.id",
    defaultOrderBy: "ORDER BY a.appointment_date, a.appointment_time"
  });
  const items = await listAppointments(db, where, params, paging);
  const total = paging.paginated ? await countAppointments(db, where, params) : items.length;
  res.json(pageResponse(items, total, paging));
}));

router.post("/api/appointments", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_CREATE)) return;
  await parseUpload(privateUpload.single("reference_photo"), req, res, { imagesOnly: true });
  await registerPrivateFiles(db, req.file, "appointment_reference", req.user?.id);
  // Payload chega como multipart (multer já populou req.body). Valida os
  // obrigatórios (profissional/data/hora) preservando os demais campos.
  if (!validateBody(appointmentCreateSchema, req, res)) return;
  // Cota do plano — a mais cara das quatro (conta o mês corrente numa coluna
  // TEXT sem índice), por isso fica depois da validação e antes de qualquer
  // consulta de negócio. Vale só para a agenda interna: o agendamento público
  // (routes/booking.js) não passa por aqui, e é de propósito — o 409 chegaria
  // ao cliente final da clínica, que não tem como resolver.
  if (!(await requireWithinLimit(req, res, "appointments_month", db))) return;
  const body = normalizeAppointment(req.body);
  // Bloqueia horários já ocupados para o mesmo profissional.
  const conflict = await db.get(
    `SELECT id FROM appointments
     WHERE professional_id = ? AND appointment_date = ? AND appointment_time = ?
     AND status NOT IN ('cancelado', 'remarcado')`,
    [body.professional_id, body.appointment_date, body.appointment_time]
  );
  if (conflict) {
    return res.status(409).json({ error: "Horário ocupado para este profissional." });
  }
  const photoUrl = req.file ? `/api/private-files/${req.file.filename}` : body.reference_photo_url || "";
  const client = await upsertClient(db, body);
  const serviceId = optionalId(body.service_id);
  const service = serviceId ? await db.get("SELECT * FROM services WHERE id = ?", [serviceId]) : null;
  const items = await normalizeAppointmentItems(db, { ...body, service_id: serviceId });
  const stockError = await validateAppointmentItemsStock(db, items);
  if (stockError) return res.status(409).json({ error: stockError });
  const firstItem = items[0] || {};
  const jewelryId = optionalId(firstItem.jewelry_id || body.jewelry_id);
  const variantId = optionalId(firstItem.jewelry_variant_id || body.jewelry_variant_id);
  const depositValue = Number(body.deposit_value ?? service?.deposit_value ?? 0);
  const totals = appointmentTotalsFromItems(items, { total_value: body.total_value, deposit_value: depositValue });
  const couponQuote = body.coupon_code ? await validateCoupon(db, body.coupon_code, { amount: totals.totalValue, client_id: client.id, items: items.map((item) => ({ product_id: item.jewelry_id, category: item.category, unit_price: item.jewelry_unit_price, quantity: item.quantity })) }) : null;
  if (couponQuote && !couponQuote.valid) return res.status(400).json({ error: couponQuote.error });
  const discountValue = Number(couponQuote?.discount_amount || 0);
  // Compatibilidade com integrações legadas: se enviaram apenas deposit_value,
  // historicamente isso significava sinal já recebido. As telas atuais sempre
  // enviam deposit_status e conseguem distinguir expectativa de recebimento.
  const depositStatus = depositValue > 0 ? String(body.deposit_status || "pago").toLowerCase() : "nao_aplicavel";
  const depositReceived = ["pago", "confirmado"].includes(depositStatus);
  const operationTotals = calculateOperationTotals({
    serviceSubtotal: totals.procedureValue,
    productSubtotal: totals.jewelryValue,
    discountTotal: discountValue,
    payments: [{
      status: depositReceived ? "pago" : "pendente",
      payment_type: "sinal",
      amount: depositValue
    }]
  });
  const totalValue = operationTotals.netTotal;
  const remainingValue = operationTotals.outstandingBalance;
  const duration = totals.durationMinutes || Number(service?.duration_minutes || body.duration_minutes || 40);
  const endTime = addMinutesToTime(body.appointment_time, duration);
  // Agendamento + itens + sinal formam um registro só: agendamento sem itens
  // (ou sem o pagamento do sinal) já entra torto na agenda e no financeiro.
  const appointmentId = await db.transaction(async (tx) => {
    const result = await tx.run(
      `INSERT INTO appointments
      (client_id, professional_id, service_id, jewelry_id, jewelry_variant_id, procedure, description, piercing_region, appointment_date, appointment_time, end_time, total_value, service_value, jewelry_value, subtotal_value, discount_value, coupon_id, coupon_code, coupon_snapshot, deposit_value, remaining_value, deposit_payment_method, remaining_payment_method, deposit_status, deposit_paid_at, financial_notes, status, notes, reference_photo_url, duration_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [client.id, body.professional_id, serviceId || firstItem.service_id || null, jewelryId, variantId, body.procedure || firstItem.procedure_name || service?.name || "Atendimento", body.description, body.piercing_region || firstItem.region || "Atendimento", body.appointment_date, body.appointment_time, endTime, totalValue, totals.procedureValue, totals.jewelryValue, totals.totalValue, discountValue, couponQuote?.coupon?.id || null, couponQuote?.coupon?.code || null, couponQuote ? JSON.stringify(couponQuote) : null, depositValue, remainingValue, body.deposit_payment_method, body.remaining_payment_method, depositStatus, depositReceived ? (body.deposit_paid_at || localTimestamp()) : null, body.financial_notes || "", body.status || "pendente", body.notes, photoUrl, duration]
    );
    await replaceAppointmentItems(tx, result.returnedId, items);
    if (couponQuote?.coupon?.id) {
      await tx.run("INSERT INTO coupon_usages (coupon_id, client_id, appointment_id, original_amount, discount_amount, final_amount) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (coupon_id, appointment_id) WHERE appointment_id IS NOT NULL DO NOTHING", [couponQuote.coupon.id, client.id, result.returnedId, totals.totalValue, discountValue, totalValue]);
    }
    if (depositValue > 0) {
      await tx.run(
        "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, 'sinal', ?, ?, ?)",
        [result.returnedId, client.id, depositValue, body.deposit_payment_method || "Pix", depositReceived ? "pago" : "pendente", depositReceived ? (body.deposit_paid_at || localTimestamp()) : localTimestamp()]
      );
    }
    return result.returnedId;
  });
  const created = await listAppointments(db, "WHERE a.id = ?", [appointmentId]).then((rows) => rows[0]);
  res.status(201).json(created);
}));

router.post("/api/appointments/:id/complete", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_FINALIZE)) return;
  const before = await db.get("SELECT * FROM appointments WHERE id = ?", [req.params.id]);
  if (!before) return res.status(404).json({ error: "Agendamento não encontrado." });
  if (before.status === "atendido" && !hasPermission(req.user, P.FINANCE_EDIT)) return res.status(403).json({ error: "Você não tem permissão para alterar um fechamento concluído." });
  if (before.status === "atendido" && !String(req.body.reason || "").trim()) return res.status(400).json({ error: "Informe o motivo da alteração financeira." });
  const financialSnapshot = await getAppointmentFinancialSnapshot(db, req.params.id);
  const maximumAtCompletion = Math.max(0, Number(financialSnapshot?.netTotal || before.total_value || 0) - Number(financialSnapshot?.depositPaid || 0));
  const paidAtCompletion = (Array.isArray(req.body?.payments) ? req.body.payments : [])
    .filter((item) => ["pago", "confirmado"].includes(String(item?.status || "pago")))
    .reduce((sum, item) => sum + Math.max(0, Number(item?.amount || 0)), 0);
  const willCreateReceivable = maximumAtCompletion - paidAtCompletion > 0.009;
  if ((configuresReceivableSchedule(req.body) || willCreateReceivable) &&
      !(await requireFeature(req, res, "basic_finance"))) return;
  try {
    await db.transaction(async (tx) => {
      await registerCompletionPayments(tx, req.params.id, req.body.payments, req.user?.id);
      await tx.run("UPDATE appointments SET status = 'atendido', financial_notes = ?, updated_at = ? WHERE id = ?", [req.body.financial_notes || before.financial_notes || "", localTimestamp(), req.params.id]);
      const after = await tx.get("SELECT * FROM appointments WHERE id = ?", [req.params.id]);
      await tx.run("INSERT INTO appointment_financial_audit (appointment_id, user_id, action, reason, before_snapshot, after_snapshot) VALUES (?, ?, ?, ?, ?, ?)", [req.params.id, req.user?.id, before.status === "atendido" ? "reopen_financial_close" : "financial_close", req.body.reason || null, JSON.stringify(before), JSON.stringify(after)]);
      await deductJewelryStock(tx, req.params.id);
      await ensureSalesOrderForAppointment(tx, req.params.id, req.user, req.body);
      await ensurePostCareFollowups(tx, req.params.id);
      await awardLoyaltyForAppointment(tx, req.params.id);
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Não foi possível concluir o atendimento." });
  }
  const updated = await listAppointments(db, "WHERE a.id = ?", [req.params.id]).then((rows) => rows[0]);
  res.json(updated);
}));

router.patch("/api/appointments/:id", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, req.body.status === "cancelado" ? P.APPOINTMENTS_CANCEL : P.APPOINTMENTS_EDIT)) return;
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [req.params.id]);
  const financialFields = ["total_value", "discount_value", "deposit_value", "remaining_value", "deposit_payment_method", "remaining_payment_method", "deposit_status", "deposit_paid_at", "coupon_code", "coupon_id"];
  const leavingFinalized = appointment?.status === "atendido" && req.body.status && req.body.status !== "atendido";
  const finalizedFinancialChange = appointment?.status === "atendido" && (
    leavingFinalized || financialFields.some((field) => req.body[field] !== undefined) || appointmentItemsFromBody(req.body).length > 0
  );
  if (finalizedFinancialChange) {
    if (!authorizePermission(req, res, P.FINANCE_EDIT)) return;
    if (!String(req.body.reason || "").trim()) return res.status(400).json({ error: "Informe o motivo da alteração financeira." });
  }
  if (!appointment) return res.status(404).json({ error: "Agendamento não encontrado." });
  const willRecalculateReceivable = finalizedFinancialChange && !leavingFinalized &&
    String(req.body.status || appointment.status) === "atendido";
  if ((configuresReceivableSchedule(req.body) || willRecalculateReceivable) &&
      !(await requireFeature(req, res, "basic_finance"))) return;

  if (req.body.status === "cancelado") {
    req.body.remaining_value = 0;
  }

  const hasSubmittedItems = appointmentItemsFromBody(req.body).length > 0;
  let pendingItems = null;
  let operationTotals = null;
  if (hasSubmittedItems) {
    const serviceId = optionalId(req.body.service_id ?? appointment.service_id);
    const service = serviceId ? await db.get("SELECT * FROM services WHERE id = ?", [serviceId]) : null;
    const items = await normalizeAppointmentItems(db, { ...appointment, ...req.body, service_id: serviceId });
    const stockError = await validateAppointmentItemsStock(db, items);
    if (stockError) return res.status(409).json({ error: stockError });
    const firstItem = items[0] || {};
    const totals = appointmentTotalsFromItems(items, {
      total_value: req.body.total_value ?? appointment.total_value,
      deposit_value: req.body.deposit_value ?? appointment.deposit_value
    });
    const couponCode = String(req.body.coupon_code ?? appointment.coupon_code ?? "").trim();
    let couponQuote = null;
    if (couponCode) {
      couponQuote = await validateCoupon(db, couponCode, {
        amount: totals.totalValue,
        client_id: appointment.client_id,
        items: items.map((item) => ({
          service_id: item.service_id,
          product_id: item.jewelry_id,
          category: item.category,
          unit_price: Number(item.jewelry_unit_price || 0),
          quantity: Number(item.quantity || 1)
        }))
      });
      if (!couponQuote?.valid) return res.status(400).json({ error: couponQuote?.error || "Cupom inválido ou não aplicável." });
    }
    const existingPayments = await db.all("SELECT * FROM payments WHERE appointment_id = ? AND status IN ('pago', 'confirmado')", [req.params.id]);
    const discountTotal = Number(couponQuote?.discount_amount ?? appointment.discount_value ?? 0);
    operationTotals = calculateOperationTotals({
      serviceSubtotal: totals.procedureValue,
      productSubtotal: totals.jewelryValue,
      discountTotal,
      payments: existingPayments.map((payment) => ({
        amount: Number(payment.amount || 0),
        status: payment.status,
        payment_type: payment.payment_type,
        type: payment.payment_type
      }))
    });

    req.body.service_id = serviceId || firstItem.service_id || null;
    req.body.jewelry_id = optionalId(firstItem.jewelry_id);
    req.body.jewelry_variant_id = optionalId(firstItem.jewelry_variant_id);
    req.body.procedure = req.body.procedure || firstItem.procedure_name || service?.name || appointment.procedure;
    req.body.piercing_region = req.body.piercing_region || firstItem.region || appointment.piercing_region;
    req.body.total_value = operationTotals.netTotal;
    req.body.discount_value = operationTotals.discountTotal;
    req.body.deposit_value = Number(req.body.deposit_value ?? appointment.deposit_value ?? operationTotals.depositPaid ?? 0);
    req.body.remaining_value = operationTotals.outstandingBalance;
    req.body.end_time = req.body.appointment_time ? addMinutesToTime(req.body.appointment_time, totals.durationMinutes || Number(service?.duration_minutes || appointment.duration_minutes || 40)) : req.body.end_time;
    req.body.coupon_code = couponCode || null;
    req.body.coupon_id = couponQuote?.coupon?.id || appointment.coupon_id || null;
    req.body.coupon_snapshot = couponQuote ? JSON.stringify(couponQuote) : appointment.coupon_snapshot || null;
    req.body.discount_value = operationTotals.discountTotal;
    req.body.remaining_value = operationTotals.outstandingBalance;
    pendingItems = items;
  }
  if (req.body.status === "cancelado") {
    req.body.remaining_value = 0;
  }

  const fields = ["status", "appointment_date", "appointment_time", "end_time", "professional_id", "service_id", "jewelry_id", "jewelry_variant_id", "procedure", "description", "piercing_region", "total_value", "discount_value", "deposit_value", "remaining_value", "deposit_payment_method", "remaining_payment_method", "deposit_status", "deposit_paid_at", "financial_notes", "coupon_code", "coupon_id", "coupon_snapshot", "notes"];
  const updates = fields.filter((field) => req.body[field] !== undefined);

  await db.transaction(async (tx) => {
    if (pendingItems) await replaceAppointmentItems(tx, req.params.id, pendingItems);
    if (updates.length) {
      await tx.run(
        `UPDATE appointments SET ${updates.map((field) => `${field} = ?`).join(", ")} WHERE id = ?`,
        [...updates.map((field) => req.body[field]), req.params.id]
      );
    }

    const depositChanged = ["deposit_value", "deposit_status", "deposit_payment_method", "deposit_paid_at"]
      .some((field) => req.body[field] !== undefined);
    if (depositChanged) {
      const current = await tx.get("SELECT * FROM appointments WHERE id = ? FOR UPDATE", [req.params.id]);
      const expected = Math.max(0, Number(current.deposit_value || 0));
      const status = expected > 0 ? String(current.deposit_status || "pendente").toLowerCase() : "nao_aplicavel";
      if (!["pendente", "pago", "confirmado", "parcial", "isento", "cancelado", "estornado", "nao_aplicavel"].includes(status)) {
        throw new Error("Status do sinal inválido.");
      }
      await tx.run("DELETE FROM payments WHERE appointment_id = ? AND payment_type = 'sinal'", [req.params.id]);
      if (expected > 0 && !["isento", "cancelado", "estornado", "nao_aplicavel"].includes(status)) {
        await tx.run(
          "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at, created_by_user_id) VALUES (?, ?, ?, 'sinal', ?, ?, ?, ?)",
          [current.id, current.client_id, expected, current.deposit_payment_method || "Pix", ["pago", "confirmado"].includes(status) ? "pago" : "pendente", ["pago", "confirmado"].includes(status) ? (current.deposit_paid_at || localTimestamp()) : localTimestamp(), req.user?.id || null]
        );
      }
      const financial = await getAppointmentFinancialSnapshot(tx, req.params.id);
      await tx.run("UPDATE appointments SET remaining_value = ?, deposit_paid_at = ?, updated_at = ? WHERE id = ?", [financial.outstandingBalance, ["pago", "confirmado"].includes(status) ? (current.deposit_paid_at || localTimestamp()) : null, localTimestamp(), req.params.id]);
    }

    if (req.body.status === "atendido") {
      await deductJewelryStock(tx, req.params.id);
      const configuredReceivable = configuresReceivableSchedule(req.body);
      if (!configuredReceivable) await registerRemainingPayment(tx, req.params.id);
      await ensureSalesOrderForAppointment(tx, req.params.id, req.user, req.body);
      await ensurePostCareFollowups(tx, req.params.id);
      await awardLoyaltyForAppointment(tx, req.params.id);
    }
    if (leavingFinalized) {
      await restoreJewelryStock(tx, req.params.id);
    }
    if (req.body.status === "cancelado") {
      await tx.run("UPDATE payments SET status = 'cancelado' WHERE appointment_id = ? AND status != 'pago'", [req.params.id]);
    }
    if (finalizedFinancialChange && req.body.status !== "atendido") {
      const after = await tx.get("SELECT * FROM appointments WHERE id=?", [req.params.id]);
      if (after?.status === "atendido") {
        await ensureSalesOrderForAppointment(tx, req.params.id, req.user, req.body);
      } else {
        const serviceOrder = await tx.get(
          "SELECT id FROM sales_orders WHERE appointment_id=? AND order_type='ordem_servico' FOR UPDATE",
          [req.params.id]
        );
        if (serviceOrder) {
          // A baixa física já foi desfeita por restoreJewelryStock. Manter o
          // marcador como 1 faria uma conclusão futura pular a nova baixa.
          await tx.run(
            "UPDATE sales_orders SET status=?, stock_deducted=0 WHERE id=?",
            [after?.status === "cancelado" ? "cancelado" : "aberta", serviceOrder.id]
          );
          await cancelSalesOrderReceivables(tx, serviceOrder.id);
        }
      }
    }
    if (finalizedFinancialChange) {
      const after = await tx.get("SELECT * FROM appointments WHERE id = ?", [req.params.id]);
      await tx.run("INSERT INTO appointment_financial_audit (appointment_id, user_id, action, reason, before_snapshot, after_snapshot) VALUES (?, ?, 'financial_correction', ?, ?, ?)", [req.params.id, req.user.id, String(req.body.reason).trim(), JSON.stringify(appointment), JSON.stringify(after)]);
    }
  });

  const updated = await listAppointments(db, "WHERE a.id = ?", [req.params.id]).then((rows) => rows[0]);
  if (["confirmado", "remarcado"].includes(updated?.status) || req.body.appointment_date || req.body.appointment_time) {
    await queueAppointmentReminderNotifications(db, updated);
  }
  res.json(updated);
}));

async function appointmentDeletionImpact(db, id) {
  const row = await db.get(`SELECT
    (SELECT COUNT(*) FROM payments WHERE appointment_id = ?) AS payments,
    (SELECT COUNT(*) FROM sales_orders WHERE appointment_id = ?) AS sales,
    (SELECT COUNT(*) FROM client_medical_records WHERE appointment_id = ?) AS medical_records,
    (SELECT COUNT(*) FROM digital_terms WHERE appointment_id = ?) AS terms,
    (SELECT COUNT(*) FROM post_care_followups WHERE appointment_id = ?) AS followups,
    (SELECT COUNT(*) FROM coupon_usages WHERE appointment_id = ?) AS coupon_usages,
    (SELECT COUNT(*) FROM promotion_usages WHERE appointment_id = ?) AS promotion_usages,
    (SELECT COUNT(*) FROM loyalty_points WHERE appointment_id = ?) AS loyalty_points,
    (SELECT COUNT(*) FROM payment_intents WHERE appointment_id = ?) AS payment_intents,
    (SELECT COUNT(*) FROM inventory_reservations WHERE appointment_id = ? AND status IN ('confirmed','active')) AS inventory_links
  `, [id, id, id, id, id, id, id, id, id, id]);
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, Number(value || 0)]));
}

router.get("/api/appointments/:id/deletion-impact", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_EDIT)) return;
  const appointment = await db.get("SELECT id FROM appointments WHERE id = ?", [req.params.id]);
  if (!appointment) return res.status(404).json({ error: "Agendamento não encontrado." });
  const impact = await appointmentDeletionImpact(db, req.params.id);
  res.json({ impact, can_delete: !Object.values(impact).some(Number) });
}));

router.delete("/api/appointments/:id", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CLIENTS_DELETE)) return;
  if (req.body?.confirmation !== "EXCLUIR AGENDAMENTO") return res.status(400).json({ error: "Digite EXCLUIR AGENDAMENTO para confirmar." });
  const reason = String(req.body?.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "Informe o motivo da exclusão." });
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [req.params.id]);
  if (!appointment) return res.status(404).json({ error: "Agendamento não encontrado." });
  const impact = await appointmentDeletionImpact(db, req.params.id);
  if (Object.values(impact).some(Number)) return res.status(409).json({ error: "Este agendamento possui vínculos financeiros, clínicos ou de estoque e não pode ser apagado. Cancele ou arquive preservando o histórico.", impact });
  await db.transaction(async (tx) => {
    await tx.run("DELETE FROM notification_queue WHERE appointment_id = ?", [req.params.id]);
    await tx.run("DELETE FROM appointments WHERE id = ?", [req.params.id]);
    await tx.run("INSERT INTO administrative_audit_logs (entity_type, entity_id, action, reason, user_id, snapshot) VALUES ('appointment', ?, 'hard_delete', ?, ?, ?)", [req.params.id, reason, req.user?.id || null, JSON.stringify({ appointment, impact })]);
  });
  // A cota conta agendamentos CRIADOS no mês; apagar um do mês corrente devolve
  // a vaga, então a medição cacheada não serve mais.
  invalidateUsageCache(req.tenant?.id);
  res.json({ ok: true, deleted: true });
}));

export default router;
