// Rotas de agendamentos.
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { parseUpload, privateUpload, registerPrivateFiles } from "../middleware/upload.js";
import { normalizeAppointment, addMinutesToTime, localTimestamp, rangesOverlap, timeToMinutes } from "../services/utils.js";
import { parsePaging, pageResponse } from "../services/pagination.js";
import { textSearch } from "../services/textSearch.js";
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
  registerCompletionPayments,
  supersedePendingDeposit,
  completionCeiling,
  previewAppointmentFinancials,
  resolveAppointmentCoupon
} from "../services/appointments.js";
import {
  DISCOUNT_ABOVE_GROSS_MESSAGE,
  FinancialRuleError,
  NEGATIVE_NET_MESSAGE,
  appointmentFinancialInput,
  calculateOperationTotals,
  getAppointmentFinancialSnapshot,
  parseMoneyInputCents,
  recalculateAppointmentFinancials,
  storedCouponDiscount
} from "../services/finance.js";
import { ensurePostCareFollowups } from "../services/postcare.js";
import { awardLoyaltyForAppointment } from "../services/loyalty.js";
import { validateBody } from "../middleware/validate.js";
import { appointmentCreateSchema } from "../schemas/index.js";
import { queueAppointmentReminderNotifications } from "../services/notifications.js";
import { invalidateUsageCache, requireWithinLimit } from "../services/planLimits.js";
import { P } from "../config/permissions.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { hasPermission } from "../services/permissionService.js";
import { configuresReceivableSchedule } from "../services/receivables.js";
import { requireFeature } from "../services/subscriptions.js";
import { consumeAppointmentRecipe, restoreAppointmentConsumptions } from "../services/consumableUsage.js";
import { cancelAppointmentWithResolution } from "../services/appointmentCancellations.js";
import { applyCreditToAppointment } from "../services/clientCredits.js";
import {
  cancelPendingAppointmentCommunications,
  scheduleAppointmentClientAutomations,
  scheduleClientAutomationEvent
} from "../services/communications.js";
import { recordAudit } from "../services/audit.js";
import { cancelServiceExecution, ensureServiceExecution, hasSettledServiceExecutionReceivable } from "../services/serviceExecutions.js";
import { refreshAppointmentCommissions, reverseAppointmentCommissions } from "../services/commissions.js";
import { SETTLED_RECEIVABLE_MESSAGE } from "../services/appointmentValueAdjustments.js";
import { assertCompletionServiceRules, parseServiceRulesSnapshot, validateAppointmentTimingRules, validateClientServiceRules } from "../services/serviceRules.js";
import { mergeOperationalRequirements } from "../services/operationalRequirements.js";

const router = Router();
const APPOINTMENT_STATUSES = new Set(["pendente", "awaiting_deposit_proof", "confirmado", "chegou", "em_atendimento", "atendido", "cancelado", "nao_compareceu", "remarcado", "recusado"]);

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

function validIsoDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(value || ""));
}

const DISCOUNT_PERMISSION_MESSAGE = "Você não tem permissão para aplicar desconto.";
const COUPON_PERMISSION_MESSAGE = "Você não tem permissão para aplicar cupom.";
const DEPOSIT_STATUSES = new Set(["pendente", "pago", "confirmado", "parcial", "isento", "cancelado", "estornado", "retido", "creditado", "nao_aplicavel"]);

const cents = (value) => Math.round(Number(value || 0) * 100);

function couponCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

// Motivo do desconto manual: opcional, texto curto. `undefined` = não enviado.
function discountReason(value) {
  if (value === undefined) return undefined;
  const text = String(value ?? "").trim();
  if (text.length > 500) throw new FinancialRuleError("O motivo do desconto deve ter no máximo 500 caracteres.");
  return text || null;
}

// Valor do sinal: mesmo parser estrito do desconto. Sem isso, texto virava
// NaN (o NUMERIC do Postgres aceita 'NaN') e valor negativo era gravado, e as
// duas coisas contaminavam o saldo. "50,00" vira 50.
function normalizeDepositInput(body) {
  const depositCents = parseMoneyInputCents(body.deposit_value, "O valor do sinal");
  if (depositCents !== undefined) body.deposit_value = depositCents / 100;
  const expectedCents = parseMoneyInputCents(body.deposit_expected_value, "O sinal esperado");
  if (expectedCents !== undefined) body.deposit_expected_value = expectedCents / 100;
}

// Regra de negócio do dinheiro (FinancialRuleError) vira resposta com o status
// certo; qualquer outro erro sobe para o withDb (500 + error_logs).
function financialError(res, error) {
  if (!(error instanceof FinancialRuleError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

function jsonParam(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

// Sincroniza o pagamento do sinal com os campos deposit_* do agendamento
// (SPEC 9, item 2). Antes, todo salvamento apagava e recriava a linha: o id
// mudava (lançamento órfão no ledger) e um sinal já confirmado voltava a
// "pendente". Agora só age quando valor/status/forma realmente mudam, e faz
// UPDATE no lugar. Sinal recebido nunca volta a pendente por efeito colateral.
async function syncDepositPayment(tx, appointmentId, userId) {
  const current = await tx.get("SELECT * FROM appointments WHERE id = ? FOR UPDATE", [appointmentId]);
  const expected = Math.max(0, Number(current.deposit_value || 0));
  const requestedStatus = expected > 0 ? String(current.deposit_status || "pendente").toLowerCase() : "nao_aplicavel";
  if (!DEPOSIT_STATUSES.has(requestedStatus)) throw new FinancialRuleError("Status do sinal inválido.");
  const method = current.deposit_payment_method || "Pix";
  const rows = await tx.all(
    "SELECT * FROM payments WHERE appointment_id = ? AND payment_type = 'sinal' AND status NOT IN ('cancelado', 'refunded') ORDER BY id FOR UPDATE",
    [appointmentId]
  );
  const isConfirmed = (status) => ["pago", "confirmado"].includes(String(status || "").toLowerCase());
  const primary = rows.find((row) => isConfirmed(row.status)) || rows[0] || null;
  // Linhas extras de sinal (herança da recriação antiga) que ainda estão
  // pendentes são canceladas; recebidas ficam intactas.
  for (const extra of rows.filter((row) => row !== primary && !isConfirmed(row.status))) {
    await tx.run("UPDATE payments SET status = 'cancelado' WHERE id = ?", [extra.id]);
  }
  const wantsPayment = expected > 0 && !["isento", "cancelado", "estornado", "nao_aplicavel"].includes(requestedStatus);
  let depositStatus = requestedStatus;
  let paidAt = null;
  if (primary && isConfirmed(primary.status)) {
    if (!wantsPayment) {
      throw new FinancialRuleError("O sinal já foi recebido e não pode ser removido por aqui. Use o cancelamento ou o Financeiro para devolvê-lo.", 409);
    }
    if (cents(primary.amount) !== cents(expected) || String(primary.method || "") !== method) {
      await tx.run("UPDATE payments SET amount = ?, method = ? WHERE id = ?", [expected, method, primary.id]);
    }
    depositStatus = isConfirmed(requestedStatus) ? requestedStatus : "pago";
    paidAt = current.deposit_paid_at || primary.paid_at || localTimestamp();
  } else if (wantsPayment) {
    const confirmed = isConfirmed(requestedStatus);
    const paymentStatus = confirmed ? "pago" : "pendente";
    paidAt = confirmed ? (current.deposit_paid_at || localTimestamp()) : null;
    if (primary) {
      const changed = cents(primary.amount) !== cents(expected) || primary.status !== paymentStatus || String(primary.method || "") !== method;
      if (changed) {
        await tx.run("UPDATE payments SET amount = ?, method = ?, status = ?, paid_at = ? WHERE id = ?",
          [expected, method, paymentStatus, paidAt || primary.paid_at || localTimestamp(), primary.id]);
      }
    } else {
      await tx.run(
        "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at, created_by_user_id) VALUES (?, ?, ?, 'sinal', ?, ?, ?, ?)",
        [current.id, current.client_id, expected, method, paymentStatus, paidAt || localTimestamp(), userId || null]
      );
    }
  } else if (primary) {
    // Sinal pendente que deixou de ser esperado: cancelado, não apagado.
    await tx.run("UPDATE payments SET status = 'cancelado' WHERE id = ?", [primary.id]);
  }
  await tx.run("UPDATE appointments SET deposit_status = ?, deposit_paid_at = ?, updated_at = ? WHERE id = ?",
    [depositStatus, paidAt, localTimestamp(), appointmentId]);
}

async function syncCouponUsage(tx, appointment, coupon, totals) {
  if (coupon.changed) await tx.run("DELETE FROM coupon_usages WHERE appointment_id = ?", [appointment.id]);
  if (!coupon.couponId) return;
  await tx.run(
    `INSERT INTO coupon_usages (coupon_id, client_id, appointment_id, original_amount, discount_amount, final_amount)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (coupon_id, appointment_id) WHERE appointment_id IS NOT NULL
     DO UPDATE SET original_amount = EXCLUDED.original_amount, discount_amount = EXCLUDED.discount_amount, final_amount = EXCLUDED.final_amount`,
    [coupon.couponId, appointment.client_id, appointment.id, totals.grossTotal, totals.couponDiscount, totals.netTotal]
  );
}

// Toda alteração do desconto manual fica registrada nas duas trilhas: a
// central (audit_events) e a financeira do próprio agendamento.
async function recordManualDiscountChange(tx, req, before, after) {
  const pick = (row) => ({
    manual_discount_value: Number(row.manual_discount_value || 0),
    manual_discount_reason: row.manual_discount_reason || null,
    discount_value: Number(row.discount_value || 0),
    total_value: Number(row.total_value || 0)
  });
  const reason = after.manual_discount_reason || "Desconto manual alterado";
  await tx.run("INSERT INTO appointment_financial_audit (appointment_id, user_id, action, reason, before_snapshot, after_snapshot) VALUES (?, ?, 'manual_discount', ?, ?, ?)",
    [after.id, req.user?.id || null, reason, JSON.stringify(before), JSON.stringify(after)]);
  await recordAudit(tx, {
    req, module: "appointments", action: "discount", entityType: "appointment", entityId: after.id,
    reason, before: pick(before), after: pick(after), severity: "warning"
  });
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
  const search = textSearch(["c.full_name", "c.whatsapp", "a.procedure", "p.name", "s.name", "j.name"], req.query.search);
  if (search.sql) { clauses.push(search.sql); params.push(...search.params); }
  if (req.query.id) { clauses.push("a.id = ?"); params.push(req.query.id); }
  if (req.query.from && req.query.to && String(req.query.from) > String(req.query.to)) return res.status(400).json({ error: "A data inicial deve ser anterior ou igual à data final." });
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
  // Desconto manual e cupom são decisões com permissão própria (SPEC 2.3).
  let manualDiscountCents = 0;
  let manualDiscountReason = null;
  try {
    manualDiscountCents = parseMoneyInputCents(req.body.manual_discount_value, "O desconto") ?? 0;
    manualDiscountReason = discountReason(req.body.manual_discount_reason) ?? null;
    normalizeDepositInput(req.body);
  } catch (error) {
    if (financialError(res, error)) return;
    throw error;
  }
  if (manualDiscountCents > 0 && !hasPermission(req.user, P.APPOINTMENTS_APPLY_DISCOUNT)) {
    return res.status(403).json({ error: DISCOUNT_PERMISSION_MESSAGE });
  }
  if (couponCode(req.body.coupon_code) && !hasPermission(req.user, P.APPOINTMENTS_APPLY_COUPON)) {
    return res.status(403).json({ error: COUPON_PERMISSION_MESSAGE });
  }
  if (!(await requireWithinLimit(req, res, "appointments_month", db))) return;
  const body = normalizeAppointment(req.body);
  // Bloqueia horários já ocupados para o mesmo profissional.
  const conflict = await db.get(
    `SELECT id FROM appointments
     WHERE professional_id = ? AND appointment_date = ? AND appointment_time = ?
     AND status NOT IN ('cancelado', 'remarcado', 'nao_compareceu')`,
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
  const serviceRulesSnapshot = items.filter((item) => item.service_id || item.procedure_id).map((item) => item.service_rules_snapshot);
  const operationalRequirementsSnapshot = mergeOperationalRequirements(items.map((item) => item.operational_requirements_snapshot));
  const clientProfile = await db.get("SELECT * FROM clients WHERE id=?", [client.id]);
  const clientRuleError = validateClientServiceRules({ rules: serviceRulesSnapshot, client: clientProfile, appointmentDate: body.appointment_date, guardianProvided: Boolean(body.guardian_name && body.guardian_document) });
  if (clientRuleError) return res.status(400).json({ error: clientRuleError });
  const timingRuleError = validateAppointmentTimingRules({ rules: serviceRulesSnapshot, appointmentDate: body.appointment_date, appointmentTime: body.appointment_time });
  if (timingRuleError) return res.status(400).json({ error: timingRuleError });
  const stockError = await validateAppointmentItemsStock(db, items);
  if (stockError) return res.status(409).json({ error: stockError });
  const firstItem = items[0] || {};
  const jewelryId = optionalId(firstItem.jewelry_id || body.jewelry_id);
  const variantId = optionalId(firstItem.jewelry_variant_id || body.jewelry_variant_id);
  const depositValue = Number(body.deposit_value ?? service?.deposit_value ?? 0);
  const depositExpectedValue = Number(body.deposit_expected_value ?? service?.deposit_value ?? 0);
  const totals = appointmentTotalsFromItems(items, { total_value: body.total_value, deposit_value: depositValue });
  // Itens sem preço caem no total informado (legado): ele vira o bruto do serviço.
  const serviceGross = totals.procedureValue + totals.jewelryValue > 0 ? totals.procedureValue : totals.totalValue;
  const coupon = await resolveAppointmentCoupon(db, { body, items, itemsChanged: true, gross: totals.totalValue, clientId: client.id });
  if (coupon.error) return res.status(400).json({ error: coupon.error });
  // Compatibilidade com integrações legadas: se enviaram apenas deposit_value,
  // historicamente isso significava sinal já recebido. As telas atuais sempre
  // enviam deposit_status e conseguem distinguir expectativa de recebimento.
  const depositStatus = depositValue > 0 ? String(body.deposit_status || "pago").toLowerCase() : "nao_aplicavel";
  const depositReceived = ["pago", "confirmado"].includes(depositStatus);
  const operationTotals = calculateOperationTotals({
    serviceSubtotal: serviceGross,
    productSubtotal: totals.jewelryValue,
    couponDiscount: coupon.couponDiscount,
    manualDiscount: manualDiscountCents / 100,
    payments: [{
      status: depositReceived ? "pago" : "pendente",
      payment_type: "sinal",
      amount: depositValue
    }]
  });
  if (operationTotals.discountExceedsGross) return res.status(400).json({ error: DISCOUNT_ABOVE_GROSS_MESSAGE });
  const totalValue = operationTotals.netTotal;
  const remainingValue = operationTotals.outstandingBalance;
  const duration = totals.durationMinutes || Number(service?.duration_minutes || body.duration_minutes || 40);
  const endTime = addMinutesToTime(body.appointment_time, duration);
  const requestedInterval = Math.max(0, ...serviceRulesSnapshot.map((rule) => Number(rule.scheduling_interval_minutes || 0)));
  const sameDayAppointments = await db.all(`SELECT appointment_time,end_time,service_rules_snapshot FROM appointments
    WHERE professional_id=? AND appointment_date=? AND status NOT IN ('cancelado','remarcado','nao_compareceu')`, [body.professional_id, body.appointment_date]);
  const overlapsInterval = sameDayAppointments.some((scheduled) => {
    const scheduledInterval = Math.max(0, ...parseServiceRulesSnapshot(scheduled.service_rules_snapshot).map((rule) => Number(rule.scheduling_interval_minutes || 0)));
    return rangesOverlap(timeToMinutes(body.appointment_time), timeToMinutes(endTime) + requestedInterval,
      timeToMinutes(scheduled.appointment_time), timeToMinutes(scheduled.end_time || addMinutesToTime(scheduled.appointment_time, duration)) + scheduledInterval);
  });
  if (overlapsInterval) return res.status(409).json({ error: "O horário conflita com outro atendimento ou com seu intervalo obrigatório." });
  const hasManualDiscount = manualDiscountCents > 0 || Boolean(manualDiscountReason);
  // Agendamento + itens + sinal formam um registro só: agendamento sem itens
  // (ou sem o pagamento do sinal) já entra torto na agenda e no financeiro.
  const appointmentId = await db.transaction(async (tx) => {
    const result = await tx.run(
      `INSERT INTO appointments
      (client_id, professional_id, service_id, jewelry_id, jewelry_variant_id, procedure, description, piercing_region, appointment_date, appointment_time, end_time, total_value, service_value, jewelry_value, subtotal_value, discount_value, coupon_id, coupon_code, coupon_snapshot, deposit_value, remaining_value, deposit_payment_method, remaining_payment_method, deposit_status, deposit_paid_at, financial_notes, status, notes, reference_photo_url, duration_minutes, service_rules_snapshot, operational_requirements_snapshot, manual_discount_value, manual_discount_reason, manual_discount_updated_by, manual_discount_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [client.id, body.professional_id, serviceId || firstItem.service_id || null, jewelryId, variantId, body.procedure || firstItem.procedure_name || service?.name || "Atendimento", body.description, body.piercing_region || firstItem.region || "Atendimento", body.appointment_date, body.appointment_time, endTime, totalValue, operationTotals.serviceSubtotal, operationTotals.productSubtotal, operationTotals.grossTotal, operationTotals.discountTotal, coupon.couponId, coupon.couponCode, jsonParam(coupon.couponSnapshot), depositValue, remainingValue, body.deposit_payment_method, body.remaining_payment_method, depositStatus, depositReceived ? (body.deposit_paid_at || localTimestamp()) : null, body.financial_notes || "", body.status || "pendente", body.notes, photoUrl, duration, JSON.stringify(serviceRulesSnapshot), JSON.stringify(operationalRequirementsSnapshot), manualDiscountCents / 100, manualDiscountReason, hasManualDiscount ? req.user?.id || null : null, hasManualDiscount ? new Date() : null]
    );
    await replaceAppointmentItems(tx, result.returnedId, items);
    if (depositValue > 0) {
      await tx.run(
        "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, 'sinal', ?, ?, ?)",
        [result.returnedId, client.id, depositValue, body.deposit_payment_method || "Pix", depositReceived ? "pago" : "pendente", depositReceived ? (body.deposit_paid_at || localTimestamp()) : localTimestamp()]
      );
    }
    await tx.run("UPDATE appointments SET deposit_expected_value=? WHERE id=?", [depositExpectedValue, result.returnedId]);
    // Mesma conta usada em toda alteração posterior: o que a criação grava é
    // exatamente o que o snapshot financeiro devolve.
    const recalculated = await recalculateAppointmentFinancials(tx, result.returnedId);
    await syncCouponUsage(tx, recalculated.appointment, coupon, recalculated.totals);
    if (hasManualDiscount) {
      await recordManualDiscountChange(tx, req, { ...recalculated.appointment, manual_discount_value: 0, manual_discount_reason: null, discount_value: recalculated.totals.couponDiscount, total_value: (cents(recalculated.totals.grossTotal) - cents(recalculated.totals.couponDiscount)) / 100 }, recalculated.appointment);
    }
    await recordAudit(tx, {
      req, module: "appointments", action: "create", entityType: "appointment", entityId: result.returnedId,
      reason: "Agendamento criado",
      after: {
        id: result.returnedId, client_id: client.id, professional_id: body.professional_id,
        service_id: serviceId || firstItem.service_id || null, appointment_date: body.appointment_date,
        appointment_time: body.appointment_time, status: body.status || "pendente",
        subtotal_value: recalculated.totals.grossTotal, discount_value: recalculated.totals.discountTotal,
        manual_discount_value: recalculated.totals.manualDiscount, total_value: recalculated.totals.netTotal,
        deposit_value: depositValue, deposit_expected_value: depositExpectedValue, deposit_status: depositStatus
      }
    });
    return result.returnedId;
  });
  const created = await listAppointments(db, "WHERE a.id = ?", [appointmentId]).then((rows) => rows[0]);
  await scheduleAppointmentClientAutomations(db, appointmentId);
  if (depositValue > 0 && !depositReceived) {
    await scheduleClientAutomationEvent(db, appointmentId, "payment_pending");
  }
  res.status(201).json(created);
}));

// Prévia oficial do dinheiro do agendamento (SPEC 9, item 7): mesma
// normalização de itens, mesmo cupom e mesma conta da gravação, sem gravar.
// A agenda usa esta rota (com debounce) no lugar de /catalog/price-quote, que
// soma promoções que o agendamento interno não aplica.
router.post("/api/appointments/financial-preview", withFeature("agenda", async (req, res, db) => {
  if (!hasPermission(req.user, P.APPOINTMENTS_CREATE) && !authorizePermission(req, res, P.APPOINTMENTS_EDIT)) return;
  const body = req.body || {};
  const appointmentId = optionalId(body.appointment_id);
  const appointment = appointmentId ? await db.get("SELECT * FROM appointments WHERE id = ?", [appointmentId]) : null;
  if (appointmentId && !appointment) return res.status(404).json({ error: "Agendamento não encontrado." });
  let manualDiscountCents;
  try {
    manualDiscountCents = parseMoneyInputCents(body.manual_discount_value, "O desconto");
  } catch (error) {
    if (financialError(res, error)) return;
    throw error;
  }
  const preview = await previewAppointmentFinancials(db, {
    appointment,
    body,
    manualDiscount: manualDiscountCents === undefined ? undefined : manualDiscountCents / 100
  });
  const { discountExceedsGross, negativeNet, ...totals } = preview.totals;
  res.json({
    ...totals,
    manualDiscountReason: body.manual_discount_reason ?? appointment?.manual_discount_reason ?? null,
    adjustments: preview.adjustments,
    coupon: {
      code: preview.coupon.couponCode || (couponCode(body.coupon_code) || null),
      valid: !preview.coupon.error && Boolean(preview.coupon.couponId),
      error: preview.coupon.error,
      discount: totals.couponDiscount
    },
    validation: {
      discount: discountExceedsGross ? DISCOUNT_ABOVE_GROSS_MESSAGE : null,
      coupon: preview.coupon.error,
      net: negativeNet ? NEGATIVE_NET_MESSAGE : null
    }
  });
}));

router.post("/api/appointments/:id/complete", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_FINALIZE)) return;
  const before = await db.get("SELECT * FROM appointments WHERE id = ?", [req.params.id]);
  if (!before) return res.status(404).json({ error: "Agendamento não encontrado." });
  if (before.status === "atendido" && !hasPermission(req.user, P.FINANCE_EDIT)) return res.status(403).json({ error: "Você não tem permissão para alterar um fechamento concluído." });
  if (before.status === "atendido" && !String(req.body.reason || "").trim()) return res.status(400).json({ error: "Informe o motivo da alteração financeira." });
  // Mesmo teto do serviço de fechamento: líquido ajustado menos sinal
  // confirmado e crédito aplicado.
  const financialSnapshot = await getAppointmentFinancialSnapshot(db, req.params.id);
  const maximumAtCompletion = completionCeiling(financialSnapshot, before.total_value);
  const paidAtCompletion = (Array.isArray(req.body?.payments) ? req.body.payments : [])
    .filter((item) => ["pago", "confirmado"].includes(String(item?.status || "pago")))
    .reduce((sum, item) => sum + Math.max(0, Number(item?.amount || 0)), 0);
  const willCreateReceivable = maximumAtCompletion - paidAtCompletion > 0.009;
  if ((configuresReceivableSchedule(req.body) || willCreateReceivable) &&
      !(await requireFeature(req, res, "basic_finance"))) return;
  try {
    await db.transaction(async (tx) => {
      await assertCompletionServiceRules(tx, req.params.id);
      await registerCompletionPayments(tx, req.params.id, req.body.payments, req.user?.id);
      await tx.run("UPDATE appointments SET status = 'atendido', financial_notes = ?, updated_at = ? WHERE id = ?", [req.body.financial_notes || before.financial_notes || "", localTimestamp(), req.params.id]);
      const after = await tx.get("SELECT * FROM appointments WHERE id = ?", [req.params.id]);
      await tx.run("INSERT INTO appointment_financial_audit (appointment_id, user_id, action, reason, before_snapshot, after_snapshot) VALUES (?, ?, ?, ?, ?, ?)", [req.params.id, req.user?.id, before.status === "atendido" ? "reopen_financial_close" : "financial_close", req.body.reason || null, JSON.stringify(before), JSON.stringify(after)]);
      await deductJewelryStock(tx, req.params.id);
      await consumeAppointmentRecipe(tx, req.params.id, req.user?.id || null);
      // A execução também vincula ajustes e indicadores químicos do atendimento.
      await ensureServiceExecution(tx, req.params.id, req.user, req.body);
      await refreshAppointmentCommissions(tx, req.params.id, {
        userId: req.user?.id || null,
        // Motivo vazio não pode virar "Refechamento: " sem conteúdo na trilha.
        reason: before.status === "atendido" ? `Refechamento: ${String(req.body.reason || "").trim() || "sem motivo informado"}` : "Atendimento finalizado"
      });
      await ensurePostCareFollowups(tx, req.params.id);
      await awardLoyaltyForAppointment(tx, req.params.id);
      const completed = await tx.get("SELECT id, client_id, professional_id, service_id, appointment_date, appointment_time, status, total_value, remaining_value FROM appointments WHERE id=?", [req.params.id]);
      await recordAudit(tx, {
        req, module: "appointments", action: "complete", entityType: "appointment", entityId: req.params.id,
        reason: String(req.body?.reason || "Atendimento concluído"),
        before: { id: before.id, status: before.status, total_value: before.total_value, remaining_value: before.remaining_value },
        after: completed, severity: "warning"
      });
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Não foi possível concluir o atendimento." });
  }
  const updated = await listAppointments(db, "WHERE a.id = ?", [req.params.id]).then((rows) => rows[0]);
  await cancelPendingAppointmentCommunications(db, req.params.id);
  await scheduleClientAutomationEvent(db, req.params.id, "appointment_completed", { uniqueContext: updated?.updated_at || "completed" });
  res.json(updated);
}));

// Cancelar é uma decisão financeira, não apenas uma troca de status. A rota
// obriga a registrar se o sinal foi retido, virou crédito ou saiu como reembolso.
router.post("/api/appointments/:id/cancel", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_CANCEL)) return;
  const resolution = String(req.body?.resolution || "");
  if (["client_credit", "manual_refund"].includes(resolution) && !authorizePermission(req, res, P.FINANCE_EDIT)) return;
  try {
    const result = await cancelAppointmentWithResolution(db, req.params.id, req.body || {}, req.user?.id || null);
    await recordAudit(db, {
      req, module: "appointments", action: result.outcome === "nao_compareceu" ? "no_show" : "cancel", entityType: "appointment", entityId: req.params.id,
      reason: String(req.body?.reason || (result.outcome === "nao_compareceu" ? "Não compareceu" : "Cancelamento")),
      after: { status: result.outcome, resolution: result.resolution, deposit_amount: result.deposit_amount },
      severity: "critical"
    });
    await cancelPendingAppointmentCommunications(db, req.params.id);
    await scheduleClientAutomationEvent(db, req.params.id, "appointment_cancelled", { uniqueContext: result.cancellation_id });
    res.json(result);
  } catch (error) {
    const message = error.message || "Não foi possível cancelar o agendamento.";
    res.status(/não encontrado/i.test(message) ? 404 : /já |deve ser resolvido|Não há sinal|Há sinal/i.test(message) ? 409 : 400).json({ error: message });
  }
}));

router.post("/api/appointments/:id/apply-client-credit", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_EDIT)) return;
  try {
    res.json(await applyCreditToAppointment(db, req.params.id, req.body || {}, req.user?.id || null));
  } catch (error) {
    if (financialError(res, error)) return;
    res.status(/não encontrado/i.test(error.message) ? 404 : 400).json({ error: error.message || "Não foi possível aplicar o crédito." });
  }
}));

// Valor do desconto manual a gravar (em reais), a partir dos centavos pedidos.
function manualDiscountValue(requestedCents, appointment) {
  return requestedCents === undefined ? Number(appointment.manual_discount_value || 0) : requestedCents / 100;
}

router.patch("/api/appointments/:id", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, req.body.status === "cancelado" ? P.APPOINTMENTS_CANCEL : P.APPOINTMENTS_EDIT)) return;
  if (req.body.appointment_date !== undefined && !validIsoDate(req.body.appointment_date)) {
    return res.status(400).json({ error: "Data do agendamento inválida. Use o formato AAAA-MM-DD." });
  }
  for (const field of ["appointment_time", "end_time"]) {
    if (req.body[field] !== undefined && req.body[field] !== null && req.body[field] !== "" && !validTime(req.body[field])) {
      return res.status(400).json({ error: "Horário do agendamento inválido. Use o formato HH:MM." });
    }
  }
  if (req.body.status === "cancelado") {
    return res.status(409).json({ error: "Use o fluxo de cancelamento para registrar retenção, crédito, reembolso ou ausência de pagamento." });
  }
  if (req.body.status !== undefined && !APPOINTMENT_STATUSES.has(String(req.body.status))) {
    return res.status(400).json({ error: "Status do agendamento inválido." });
  }
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [req.params.id]);
  if (!appointment) return res.status(404).json({ error: "Agendamento não encontrado." });
  // Marcar como atendido pelo PATCH faz a mesma finalização do /complete
  // (baixa de estoque, execução, comissão, fidelidade): exige a mesma
  // permissão de finalizar, além de editar. Um atendimento já fechado que
  // reenvia o mesmo status é correção: segue a regra de finance.edit abaixo.
  if (req.body.status === "atendido" && appointment.status !== "atendido" &&
      !authorizePermission(req, res, P.APPOINTMENTS_FINALIZE)) return;

  // Desconto manual: valida o formato e exige permissão só quando o valor (ou
  // o motivo) realmente muda — a tela reenvia o formulário inteiro.
  let manualDiscountCents;
  let manualReason;
  try {
    manualDiscountCents = parseMoneyInputCents(req.body.manual_discount_value, "O desconto");
    manualReason = discountReason(req.body.manual_discount_reason);
    normalizeDepositInput(req.body);
  } catch (error) {
    if (financialError(res, error)) return;
    throw error;
  }
  const discountValueChanged = manualDiscountCents !== undefined && manualDiscountCents !== cents(appointment.manual_discount_value);
  const discountReasonChanged = manualReason !== undefined && (manualReason || "") !== (appointment.manual_discount_reason || "");
  const discountChanged = discountValueChanged || discountReasonChanged;
  if (discountChanged && !hasPermission(req.user, P.APPOINTMENTS_APPLY_DISCOUNT)) {
    return res.status(403).json({ error: DISCOUNT_PERMISSION_MESSAGE });
  }
  const couponChanged = req.body.coupon_code !== undefined && req.body.coupon_code !== null &&
    couponCode(req.body.coupon_code) !== couponCode(appointment.coupon_code);
  if (couponChanged && !hasPermission(req.user, P.APPOINTMENTS_APPLY_COUPON)) {
    return res.status(403).json({ error: COUPON_PERMISSION_MESSAGE });
  }
  // Trocar o profissional de um atendimento fechado muda a comissão: vale
  // como alteração financeira (SPEC 9, item 5).
  const professionalChanged = req.body.professional_id !== undefined && req.body.professional_id !== null && req.body.professional_id !== "" &&
    Number(req.body.professional_id) !== Number(appointment.professional_id);

  const financialFields = ["total_value", "discount_value", "deposit_value", "remaining_value", "deposit_payment_method", "remaining_payment_method", "deposit_status", "deposit_paid_at", "coupon_code", "coupon_id", "manual_discount_value", "manual_discount_reason"];
  const leavingFinalized = appointment.status === "atendido" && req.body.status && req.body.status !== "atendido";
  const finalizedFinancialChange = appointment.status === "atendido" && (
    leavingFinalized || professionalChanged || financialFields.some((field) => req.body[field] !== undefined) || appointmentItemsFromBody(req.body).length > 0
  );
  if (finalizedFinancialChange) {
    if (!authorizePermission(req, res, P.FINANCE_EDIT)) return;
    if (!String(req.body.reason || "").trim()) return res.status(400).json({ error: "Informe o motivo da alteração financeira." });
  }
  const scheduleChanged = (req.body.appointment_date !== undefined && req.body.appointment_date !== appointment.appointment_date)
    || (req.body.appointment_time !== undefined && req.body.appointment_time !== appointment.appointment_time);
  if (scheduleChanged && !String(req.body.reason || "").trim()) {
    return res.status(400).json({ error: "Informe o motivo do reagendamento." });
  }
  const willRecalculateReceivable = finalizedFinancialChange && !leavingFinalized &&
    String(req.body.status || appointment.status) === "atendido";
  if ((configuresReceivableSchedule(req.body) || willRecalculateReceivable) &&
      !(await requireFeature(req, res, "basic_finance"))) return;

  // Campos de dinheiro calculados NUNCA vêm do corpo: total, desconto total e
  // restante saem do recálculo central dentro da transação.
  const derived = {};
  const hasSubmittedItems = appointmentItemsFromBody(req.body).length > 0;
  let pendingItems = null;
  if (hasSubmittedItems) {
    const serviceId = optionalId(req.body.service_id ?? appointment.service_id);
    const service = serviceId ? await db.get("SELECT * FROM services WHERE id = ?", [serviceId]) : null;
    const items = await normalizeAppointmentItems(db, { ...appointment, ...req.body, service_id: serviceId });
    const stockError = await validateAppointmentItemsStock(db, items);
    if (stockError) return res.status(409).json({ error: stockError });
    const firstItem = items[0] || {};
    const totals = appointmentTotalsFromItems(items, { total_value: req.body.total_value ?? appointment.total_value });
    derived.service_id = serviceId || firstItem.service_id || null;
    derived.jewelry_id = optionalId(firstItem.jewelry_id);
    derived.jewelry_variant_id = optionalId(firstItem.jewelry_variant_id);
    derived.procedure = req.body.procedure || firstItem.procedure_name || service?.name || appointment.procedure;
    derived.piercing_region = req.body.piercing_region || firstItem.region || appointment.piercing_region;
    derived.end_time = req.body.appointment_time ? addMinutesToTime(req.body.appointment_time, totals.durationMinutes || Number(service?.duration_minutes || appointment.duration_minutes || 40)) : req.body.end_time;
    // Itens sem preço (legado): o total informado vira o bruto do serviço.
    if (totals.procedureValue + totals.jewelryValue === 0 && Number(req.body.total_value) > 0) {
      derived.service_value = Number(req.body.total_value);
      derived.jewelry_value = 0;
      derived.subtotal_value = Number(req.body.total_value);
    }
    const rules = items.filter((item) => item.service_id || item.procedure_id).map((item) => item.service_rules_snapshot);
    const clientProfile = await db.get("SELECT * FROM clients WHERE id=?", [appointment.client_id]);
    const clientRuleError = validateClientServiceRules({ rules, client: clientProfile, appointmentDate: req.body.appointment_date || appointment.appointment_date });
    if (clientRuleError) return res.status(400).json({ error: clientRuleError });
    if (req.body.appointment_date !== undefined || req.body.appointment_time !== undefined) {
      const timingRuleError = validateAppointmentTimingRules({ rules, appointmentDate: req.body.appointment_date || appointment.appointment_date, appointmentTime: req.body.appointment_time || appointment.appointment_time });
      if (timingRuleError) return res.status(400).json({ error: timingRuleError });
    }
    derived.service_rules_snapshot = JSON.stringify(rules);
    derived.operational_requirements_snapshot = JSON.stringify(mergeOperationalRequirements(items.map((item) => item.operational_requirements_snapshot)));
    pendingItems = items;
  }

  // Cupom: revalidado só quando o código muda (sem contar o uso do próprio
  // agendamento); com o mesmo código e itens novos, só o valor é recalculado.
  let coupon = null;
  if (couponChanged || hasSubmittedItems) {
    const couponBaseItems = pendingItems || await db.all("SELECT * FROM appointment_items WHERE appointment_id = ? ORDER BY id", [appointment.id]);
    const grossOnly = calculateOperationTotals(appointmentFinancialInput(appointment, { items: couponBaseItems }, {
      couponDiscount: 0, manualDiscount: 0, adjustmentTotal: 0, payments: []
    }));
    coupon = await resolveAppointmentCoupon(db, {
      appointment, body: req.body, items: couponBaseItems, itemsChanged: hasSubmittedItems,
      gross: derived.subtotal_value ?? grossOnly.grossTotal, clientId: appointment.client_id
    });
    if (coupon.error) return res.status(400).json({ error: coupon.error });
    derived.coupon_code = coupon.couponCode;
    derived.coupon_id = coupon.couponId;
    derived.coupon_snapshot = jsonParam(coupon.couponSnapshot);
  }
  if (discountChanged) {
    derived.manual_discount_value = manualDiscountValue(manualDiscountCents, appointment);
    derived.manual_discount_reason = manualReason === undefined ? appointment.manual_discount_reason : manualReason;
    derived.manual_discount_updated_by = req.user?.id || null;
    derived.manual_discount_updated_at = new Date();
  }

  if (req.body.status === "chegou" && !appointment.arrived_at) derived.arrived_at = localTimestamp();
  if (req.body.status === "em_atendimento") {
    if (!appointment.arrived_at) derived.arrived_at = localTimestamp();
    if (!appointment.started_at) derived.started_at = localTimestamp();
  }
  const fields = ["status", "appointment_date", "appointment_time", "end_time", "professional_id", "service_id", "jewelry_id", "jewelry_variant_id", "procedure", "description", "piercing_region", "deposit_value", "deposit_payment_method", "remaining_payment_method", "deposit_status", "deposit_paid_at", "financial_notes", "notes", "arrived_at", "started_at", "service_rules_snapshot", "operational_requirements_snapshot"];
  const values = { ...req.body, ...derived };
  const updates = [
    ...fields.filter((field) => values[field] !== undefined),
    ...Object.keys(derived).filter((field) => !fields.includes(field))
  ];
  const depositTouched = ["deposit_value", "deposit_status", "deposit_payment_method", "deposit_paid_at"].some((field) => req.body[field] !== undefined);
  const userId = req.user?.id || null;
  const financialReason = String(req.body.reason || "").trim();

  try {
    await db.transaction(async (tx) => {
      // Trava antes de qualquer escrita: leitura, cálculo e gravação do
      // dinheiro acontecem sob o mesmo FOR UPDATE. O recálculo de partida
      // normaliza linhas antigas (ex.: agendamento público que só gravou o
      // total com promoção) antes de a alteração ser aplicada.
      const baseline = await recalculateAppointmentFinancials(tx, req.params.id);
      const locked = baseline.appointment;
      if (pendingItems) {
        await replaceAppointmentItems(tx, req.params.id, pendingItems);
      }
      if (updates.length) {
        await tx.run(
          `UPDATE appointments SET ${updates.map((field) => `${field} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
          [...updates.map((field) => values[field]), localTimestamp(), req.params.id]
        );
      }
      if (scheduleChanged) {
        await tx.run(`INSERT INTO appointment_reschedule_history
          (appointment_id,previous_date,previous_time,new_date,new_time,reason,changed_by_user_id)
          VALUES (?,?,?,?,?,?,?)`, [
          appointment.id, appointment.appointment_date, appointment.appointment_time,
          req.body.appointment_date || appointment.appointment_date,
          req.body.appointment_time || appointment.appointment_time,
          String(req.body.reason).trim(), userId
        ]);
      }
      if (depositTouched) await syncDepositPayment(tx, req.params.id, userId);
      if (depositTouched) {
        const afterDeposit = await tx.get("SELECT deposit_value, deposit_status, deposit_payment_method, deposit_paid_at FROM appointments WHERE id=?", [req.params.id]);
        const beforeDeposit = Object.fromEntries(Object.keys(afterDeposit).map((key) => [key, locked[key]]));
        if (JSON.stringify(beforeDeposit) !== JSON.stringify(afterDeposit)) {
          await tx.run("INSERT INTO appointment_financial_audit (appointment_id,user_id,action,reason,before_snapshot,after_snapshot) VALUES (?,?,'deposit_correction',?,?,?)", [req.params.id, userId, financialReason || "Conferência do sinal recebido", JSON.stringify(beforeDeposit), JSON.stringify(afterDeposit)]);
          await recordAudit(tx, { req, module: "appointments", action: "deposit_correction", entityType: "appointment", entityId: req.params.id, reason: financialReason || "Conferência do sinal recebido", before: beforeDeposit, after: afterDeposit });
        }
      }
      // `discount_value` é cupom + manual, e o recálculo deduz a parte do cupom
      // (ou desconto legado) como `discount_value − manual`. Ao mudar o manual
      // ou o cupom, regrava o total com a parte do cupom da linha de partida:
      // sem isso, reduzir o manual ou remover o cupom deixava o valor antigo
      // como "desconto de cupom" fantasma.
      if (discountChanged || coupon) {
        const couponPart = !coupon
          ? storedCouponDiscount(locked)
          : coupon.couponId || coupon.couponCode ? coupon.couponDiscount : (coupon.changed ? 0 : storedCouponDiscount(locked));
        const manualPart = discountChanged ? derived.manual_discount_value : Number(locked.manual_discount_value || 0);
        await tx.run("UPDATE appointments SET discount_value = ? WHERE id = ?", [(cents(couponPart) + cents(manualPart)) / 100, req.params.id]);
      }

      const recalculated = await recalculateAppointmentFinancials(tx, req.params.id);
      if (recalculated.totals.discountExceedsGross) {
        throw new FinancialRuleError(discountChanged || couponChanged
          ? DISCOUNT_ABOVE_GROSS_MESSAGE
          : `${DISCOUNT_ABOVE_GROSS_MESSAGE} Revise o desconto: os itens alterados reduziram o valor bruto.`);
      }
      if (recalculated.totals.negativeNet) {
        throw new FinancialRuleError("Os abatimentos deixariam o valor líquido negativo. Anule o abatimento antes de reduzir os itens ou o valor.");
      }
      // Atendimento fechado com parcela já baixada: mudar o valor reescreveria
      // um título recebido. A correção vai pelo Financeiro (SPEC 9, item 9).
      if (locked.status === "atendido" && !leavingFinalized &&
          cents(recalculated.appointment.total_value) !== cents(locked.total_value) &&
          await hasSettledServiceExecutionReceivable(tx, req.params.id)) {
        throw new FinancialRuleError(SETTLED_RECEIVABLE_MESSAGE, 409);
      }
      if (coupon) await syncCouponUsage(tx, recalculated.appointment, coupon, recalculated.totals);
      if (discountChanged) await recordManualDiscountChange(tx, req, locked, recalculated.appointment);

      if (req.body.status === "atendido") {
        await assertCompletionServiceRules(tx, req.params.id);
        await deductJewelryStock(tx, req.params.id);
        await consumeAppointmentRecipe(tx, req.params.id, userId);
        const configuredReceivable = configuresReceivableSchedule(req.body);
        if (configuredReceivable) {
          await supersedePendingDeposit(tx, req.params.id);
          await recalculateAppointmentFinancials(tx, req.params.id);
        } else {
          await registerRemainingPayment(tx, req.params.id);
        }
        // ensureServiceExecution vincula ajustes e indicadores químicos.
        await ensureServiceExecution(tx, req.params.id, req.user, req.body);
        await refreshAppointmentCommissions(tx, req.params.id, { userId, reason: financialReason || "Atendimento finalizado" });
        await ensurePostCareFollowups(tx, req.params.id);
        await awardLoyaltyForAppointment(tx, req.params.id);
      }
      if (leavingFinalized) {
        await restoreJewelryStock(tx, req.params.id);
        await restoreAppointmentConsumptions(tx, req.params.id, userId, req.body.reason || "Atendimento reaberto ou cancelado");
      }
      if (finalizedFinancialChange && req.body.status !== "atendido") {
        const after = await tx.get("SELECT status FROM appointments WHERE id=?", [req.params.id]);
        if (after?.status === "atendido") {
          await ensureServiceExecution(tx, req.params.id, req.user, req.body);
          await refreshAppointmentCommissions(tx, req.params.id, { userId, reason: financialReason });
        } else {
          await cancelServiceExecution(tx, req.params.id, req.body.reason || "Atendimento reaberto");
          await reverseAppointmentCommissions(tx, req.params.id, { userId, reason: financialReason || "Atendimento reaberto" });
        }
      }
      if (finalizedFinancialChange) {
        const after = await tx.get("SELECT * FROM appointments WHERE id = ?", [req.params.id]);
        await tx.run("INSERT INTO appointment_financial_audit (appointment_id, user_id, action, reason, before_snapshot, after_snapshot) VALUES (?, ?, 'financial_correction', ?, ?, ?)", [req.params.id, userId, financialReason, JSON.stringify(appointment), JSON.stringify(after)]);
      }
      if (updates.length || pendingItems || depositTouched) {
        const after = await tx.get("SELECT id, client_id, professional_id, service_id, appointment_date, appointment_time, status, subtotal_value, discount_value, adjustment_total, total_value, remaining_value FROM appointments WHERE id=?", [req.params.id]);
        await recordAudit(tx, {
          req, module: "appointments", action: "update", entityType: "appointment", entityId: req.params.id,
          reason: String(req.body?.reason || "Alteração de agendamento"),
          before: {
            id: appointment.id, client_id: appointment.client_id, professional_id: appointment.professional_id,
            service_id: appointment.service_id, appointment_date: appointment.appointment_date,
            appointment_time: appointment.appointment_time, status: appointment.status,
            subtotal_value: appointment.subtotal_value, discount_value: appointment.discount_value,
            adjustment_total: appointment.adjustment_total, total_value: appointment.total_value,
            remaining_value: appointment.remaining_value
          },
          after,
          metadata: { changed_fields: updates.filter((field) => !["notes", "description", "financial_notes", "coupon_snapshot"].includes(field)) },
          severity: finalizedFinancialChange ? "critical" : "info"
        });
      }
    });
  } catch (error) {
    if (financialError(res, error)) return;
    throw error;
  }

  const updated = await listAppointments(db, "WHERE a.id = ?", [req.params.id]).then((rows) => rows[0]);
  const justConfirmed = updated?.status === "confirmado" && appointment.status !== "confirmado";
  if (scheduleChanged || justConfirmed) {
    await cancelPendingAppointmentCommunications(db, req.params.id);
    const context = `${updated.appointment_date}-${updated.appointment_time}`;
    if (scheduleChanged) await scheduleClientAutomationEvent(db, req.params.id, "appointment_rescheduled", { uniqueContext: context });
    if (justConfirmed) await scheduleClientAutomationEvent(db, req.params.id, "appointment_confirmed", { uniqueContext: context });
    await scheduleClientAutomationEvent(db, req.params.id, "appointment_upcoming", { uniqueContext: context });
  }
  if (["confirmado", "remarcado"].includes(updated?.status) || req.body.appointment_date || req.body.appointment_time) {
    await queueAppointmentReminderNotifications(db, updated);
  }
  res.json(updated);
}));

// Toda tabela com FK RESTRICT para appointments entra aqui: o bloqueio sai
// como 409 explicando o vínculo, em vez de erro 500 na hora do DELETE.
async function appointmentDeletionImpact(db, id) {
  const row = await db.get(`SELECT
    (SELECT COUNT(*) FROM payments WHERE appointment_id = ?) AS payments,
    (SELECT COUNT(*) FROM service_executions WHERE appointment_id = ?) AS executions,
    (SELECT COUNT(*) FROM client_medical_records WHERE appointment_id = ?) AS medical_records,
    (SELECT COUNT(*) FROM digital_terms WHERE appointment_id = ?) AS terms,
    (SELECT COUNT(*) FROM post_care_followups WHERE appointment_id = ?) AS followups,
    (SELECT COUNT(*) FROM coupon_usages WHERE appointment_id = ?) AS coupon_usages,
    (SELECT COUNT(*) FROM promotion_usages WHERE appointment_id = ?) AS promotion_usages,
    (SELECT COUNT(*) FROM loyalty_points WHERE appointment_id = ?) AS loyalty_points,
    (SELECT COUNT(*) FROM payment_intents WHERE appointment_id = ?) AS payment_intents,
    (SELECT COUNT(*) FROM inventory_reservations WHERE appointment_id = ? AND status IN ('confirmed','active')) AS inventory_links,
    (SELECT COUNT(*) FROM appointment_value_adjustments WHERE appointment_id = ?) AS value_adjustments,
    (SELECT COUNT(*) FROM procedure_chemical_indicators WHERE appointment_id = ?) AS chemical_indicators,
    (SELECT COUNT(*) FROM commission_entries WHERE appointment_id = ?) AS commission_entries
  `, Array(13).fill(id));
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
    await recordAudit(tx, {
      req, module: "appointments", action: "delete", entityType: "appointment", entityId: req.params.id,
      reason,
      before: {
        id: appointment.id, client_id: appointment.client_id, professional_id: appointment.professional_id,
        service_id: appointment.service_id, appointment_date: appointment.appointment_date,
        appointment_time: appointment.appointment_time, status: appointment.status,
        total_value: appointment.total_value
      },
      metadata: { impact }, severity: "critical"
    });
  });
  // A cota conta agendamentos CRIADOS no mês; apagar um do mês corrente devolve
  // a vaga, então a medição cacheada não serve mais.
  invalidateUsageCache(req.tenant?.id);
  res.json({ ok: true, deleted: true });
}));

export default router;
