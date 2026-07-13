// Rotas de agendamentos.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { upload } from "../middleware/upload.js";
import { normalizeAppointment, addMinutesToTime } from "../services/utils.js";
import {
  listAppointments,
  upsertClient,
  deductJewelryStock,
  registerRemainingPayment
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

router.get("/api/appointments", withDb(async (req, res, db) => {
  const clauses = [];
  const params = [];
  if (req.query.professional_id) {
    clauses.push("a.professional_id = ?");
    params.push(req.query.professional_id);
  }
  if (req.query.status) {
    clauses.push("a.status = ?");
    params.push(req.query.status);
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
  const jewelryId = optionalId(body.jewelry_id);
  const variantId = optionalId(body.jewelry_variant_id);
  const service = serviceId ? await db.get("SELECT * FROM services WHERE id = ?", [serviceId]) : null;
  const jewelry = jewelryId ? await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [jewelryId]) : null;
  const variant = variantId ? await db.get("SELECT * FROM jewelry_variants WHERE id = ?", [variantId]) : null;
  const procedureValue = Number(service?.price || body.procedure_value || body.service_value || 0);
  const jewelryValue = jewelryId ? Number(variant?.sale_value || jewelry?.sale_value || body.jewelry_value || 0) : 0;
  const calculatedTotal = procedureValue + jewelryValue;
  const totalValue = calculatedTotal > 0 ? calculatedTotal : Number(body.total_value || 0);
  const depositValue = Number(body.deposit_value ?? service?.deposit_value ?? 0);
  const remainingValue = Math.max(totalValue - depositValue, 0);
  const endTime = service ? addMinutesToTime(body.appointment_time, Number(service.duration_minutes || 40)) : null;
  const result = await db.run(
    `INSERT INTO appointments
    (client_id, professional_id, service_id, jewelry_id, jewelry_variant_id, procedure, description, piercing_region, appointment_date, appointment_time, end_time, total_value, deposit_value, remaining_value, deposit_payment_method, remaining_payment_method, status, notes, reference_photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [client.id, body.professional_id, serviceId, jewelryId, variantId, body.procedure, body.description, body.piercing_region, body.appointment_date, body.appointment_time, endTime, totalValue, depositValue, remainingValue, body.deposit_payment_method, body.remaining_payment_method, body.status || "pendente", body.notes, photoUrl]
  );
  if (depositValue > 0) {
    await db.run(
      "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, 'sinal', ?, 'pago', ?)",
      [result.lastID, client.id, depositValue, body.deposit_payment_method || "Pix", `${body.appointment_date}T${body.appointment_time}:00`]
    );
  }
  res.status(201).json(await db.get("SELECT * FROM appointments WHERE id = ?", [result.lastID]));
}));

router.patch("/api/appointments/:id", withDb(async (req, res, db) => {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [req.params.id]);
  if (!appointment) return res.status(404).json({ error: "Agendamento não encontrado." });

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
  const updated = await listAppointments(db, "WHERE a.id = ?", [req.params.id]).then((rows) => rows[0]);
  if (["confirmado", "remarcado"].includes(updated?.status) || req.body.appointment_date || req.body.appointment_time) {
    await queueAppointmentReminderNotifications(db, updated);
  }
  res.json(updated);
}));

export default router;
