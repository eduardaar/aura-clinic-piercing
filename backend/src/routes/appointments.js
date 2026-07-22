// Rotas de agendamentos.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { upload } from "../middleware/upload.js";
import { normalizeAppointment, addMinutesToTime } from "../services/utils.js";
import {
  listAppointments,
  upsertClient,
  deductJewelryStock,
  registerRemainingPayment,
  restoreJewelryStock,
  normalizeAppointmentItems,
  appointmentTotalsFromItems,
  replaceAppointmentItems,
  appointmentItemsFromBody
} from "../services/appointments.js";
import { ensurePostCareFollowups } from "../services/postcare.js";
import { awardLoyaltyForAppointment } from "../services/loyalty.js";
import { ensureSalesOrderForAppointment } from "../services/sales.js";
import { validateBody } from "../middleware/validate.js";
import { appointmentCreateSchema } from "../schemas/index.js";
import { queueAppointmentReminderNotifications } from "../services/notifications.js";

const router = Router();

function optionalId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

async function validateAppointmentItemsStock(db, items = []) {
  for (const item of Array.isArray(items) ? items : []) {
    if (!item.jewelry_id) continue;
    const quantity = Math.max(1, Number(item.quantity || 1));
    if (item.jewelry_variant_id) {
      const variant = await db.get("SELECT quantity FROM jewelry_variants WHERE id = ?", [item.jewelry_variant_id]);
      if (variant && Number(variant.quantity || 0) < quantity) {
        return "Quantidade indisponível para a variação de joia selecionada.";
      }
      continue;
    }
    const stock = await db.get("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM jewelry_variants WHERE jewelry_id = ? AND is_active = 1", [item.jewelry_id]);
    if (Number(stock?.quantity || 0) < quantity) return "Quantidade indisponível para a joia selecionada.";
  }
  return "";
}

router.get("/api/appointments", withDb(async (req, res, db) => {
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
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  res.json(await listAppointments(db, where, params));
}));

router.post("/api/appointments", upload.single("reference_photo"), withDb(async (req, res, db) => {
  // Payload chega como multipart (multer já populou req.body). Valida os
  // obrigatórios (profissional/data/hora) preservando os demais campos.
  if (!validateBody(appointmentCreateSchema, req, res)) return;
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
  const photoUrl = req.file ? `/uploads/${req.file.filename}` : body.reference_photo_url || "";
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
  const totalValue = totals.totalValue;
  const remainingValue = totals.remainingValue;
  const duration = totals.durationMinutes || Number(service?.duration_minutes || body.duration_minutes || 40);
  const endTime = addMinutesToTime(body.appointment_time, duration);
  const result = await db.run(
    `INSERT INTO appointments
    (client_id, professional_id, service_id, jewelry_id, jewelry_variant_id, procedure, description, piercing_region, appointment_date, appointment_time, end_time, total_value, deposit_value, remaining_value, deposit_payment_method, remaining_payment_method, status, notes, reference_photo_url, duration_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [client.id, body.professional_id, serviceId || firstItem.service_id || null, jewelryId, variantId, body.procedure || firstItem.procedure_name || service?.name || "Atendimento", body.description, body.piercing_region || firstItem.region || "Atendimento", body.appointment_date, body.appointment_time, endTime, totalValue, depositValue, remainingValue, body.deposit_payment_method, body.remaining_payment_method, body.status || "pendente", body.notes, photoUrl, duration]
  );
  await replaceAppointmentItems(db, result.lastID, items);
  if (depositValue > 0) {
    await db.run(
      "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, 'sinal', ?, 'pago', ?)",
      [result.lastID, client.id, depositValue, body.deposit_payment_method || "Pix", `${body.appointment_date}T${body.appointment_time}:00`]
    );
  }
  const created = await listAppointments(db, "WHERE a.id = ?", [result.lastID]).then((rows) => rows[0]);
  res.status(201).json(created);
}));

router.patch("/api/appointments/:id", withDb(async (req, res, db) => {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [req.params.id]);
  if (!appointment) return res.status(404).json({ error: "Agendamento não encontrado." });

  if (req.body.status === "cancelado") {
    req.body.remaining_value = 0;
  }

  const hasSubmittedItems = appointmentItemsFromBody(req.body).length > 0;
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
    req.body.service_id = serviceId || firstItem.service_id || null;
    req.body.jewelry_id = optionalId(firstItem.jewelry_id);
    req.body.jewelry_variant_id = optionalId(firstItem.jewelry_variant_id);
    req.body.procedure = req.body.procedure || firstItem.procedure_name || service?.name || appointment.procedure;
    req.body.piercing_region = req.body.piercing_region || firstItem.region || appointment.piercing_region;
    req.body.total_value = totals.totalValue;
    req.body.remaining_value = Math.max(totals.totalValue - Number(req.body.deposit_value ?? appointment.deposit_value ?? 0), 0);
    req.body.end_time = req.body.appointment_time ? addMinutesToTime(req.body.appointment_time, totals.durationMinutes || Number(service?.duration_minutes || appointment.duration_minutes || 40)) : req.body.end_time;
    await replaceAppointmentItems(db, req.params.id, items);
  }
  if (req.body.status === "cancelado") {
    req.body.remaining_value = 0;
  }

  const fields = ["status", "appointment_date", "appointment_time", "end_time", "professional_id", "service_id", "jewelry_id", "jewelry_variant_id", "procedure", "description", "piercing_region", "total_value", "deposit_value", "remaining_value", "deposit_payment_method", "remaining_payment_method", "notes"];
  const updates = fields.filter((field) => req.body[field] !== undefined);
  if (updates.length) {
    await db.run(
      `UPDATE appointments SET ${updates.map((field) => `${field} = ?`).join(", ")} WHERE id = ?`,
      [...updates.map((field) => req.body[field]), req.params.id]
    );
  }

  if (req.body.status === "atendido") {
    await deductJewelryStock(db, req.params.id);
    await registerRemainingPayment(db, req.params.id);
    await ensureSalesOrderForAppointment(db, req.params.id, req.user);
    await ensurePostCareFollowups(db, req.params.id);
    await awardLoyaltyForAppointment(db, req.params.id);
  }
  if (req.body.status === "cancelado") {
    await restoreJewelryStock(db, req.params.id);
    await db.run("UPDATE payments SET status = 'cancelado' WHERE appointment_id = ? AND status != 'pago'", [req.params.id]);
  }
  const updated = await listAppointments(db, "WHERE a.id = ?", [req.params.id]).then((rows) => rows[0]);
  if (["confirmado", "remarcado"].includes(updated?.status) || req.body.appointment_date || req.body.appointment_time) {
    await queueAppointmentReminderNotifications(db, updated);
  }
  res.json(updated);
}));

export default router;
