// Rotas públicas de agendamento online (booking).
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { upload } from "../middleware/upload.js";
import { addMinutesToTime } from "../services/utils.js";
import {
  availableBookingSlots,
  upsertClient,
  listAppointments
} from "../services/appointments.js";

const router = Router();

async function bookingReadiness(db) {
  const activeServices = await db.get("SELECT COUNT(*) AS count FROM services WHERE active_online_booking = 1");
  const activeProcedures = await db.get(`
    SELECT COUNT(*) AS count
    FROM procedures p
    JOIN services s ON s.id = p.service_id
    WHERE p.is_active = 1 AND s.active_online_booking = 1
  `);
  const activeProfessionals = await db.get("SELECT COUNT(*) AS count FROM professionals WHERE active = 1");
  const weeklyAvailability = await db.get(`
    SELECT COUNT(*) AS count
    FROM professional_availability a
    JOIN professionals p ON p.id = a.professional_id
    WHERE a.is_active = 1 AND p.active = 1
  `);
  const linkedProfessionals = await db.get(`
    SELECT COUNT(*) AS count
    FROM professional_services ps
    JOIN professionals p ON p.id = ps.professional_id
    JOIN services s ON s.id = ps.service_id
    WHERE p.active = 1 AND s.active_online_booking = 1
  `);
  const checklist = [
    { key: "services", label: "Serviços cadastrados", done: Number(activeServices.count || 0) > 0 },
    { key: "procedures", label: "Procedimentos cadastrados", done: Number(activeProcedures.count || 0) > 0 },
    { key: "professionals", label: "Profissionais cadastrados", done: Number(activeProfessionals.count || 0) > 0 },
    { key: "weeklySchedule", label: "Agenda semanal configurada", done: Number(weeklyAvailability.count || 0) > 0 },
    { key: "links", label: "Profissionais vinculados aos serviços", done: Number(linkedProfessionals.count || 0) > 0 }
  ];
  const ready = checklist.every((item) => item.done);
  return {
    ready,
    checklist,
    missing: checklist.filter((item) => !item.done).map((item) => item.label),
    counts: {
      activeServices: Number(activeServices.count || 0),
      activeProcedures: Number(activeProcedures.count || 0),
      activeProfessionals: Number(activeProfessionals.count || 0),
      weeklyAvailability: Number(weeklyAvailability.count || 0),
      linkedProfessionals: Number(linkedProfessionals.count || 0)
    }
  };
}

router.get("/api/booking/readiness", withDb(async (_req, res, db) => {
  res.json(await bookingReadiness(db));
}));

router.get("/api/booking/config", withDb(async (_req, res, db) => {
  console.info("[booking-config] tenant recebido", _req.tenant);
  const services = await db.all("SELECT * FROM services WHERE active_online_booking = 1 ORDER BY name");
  const professionalsRows = await db.all(`
    SELECT DISTINCT p.*
    FROM professionals p
    JOIN professional_services ps ON ps.professional_id = p.id
    JOIN services s ON s.id = ps.service_id
    WHERE p.active = 1 AND s.active_online_booking = 1
    ORDER BY p.name
  `);
  const links = await db.all(`
    SELECT ps.professional_id, ps.service_id
    FROM professional_services ps
    JOIN professionals p ON p.id = ps.professional_id
    JOIN services s ON s.id = ps.service_id
    WHERE p.active = 1 AND s.active_online_booking = 1
  `);
  const professionals = professionalsRows.map((professional) => ({
    ...professional,
    service_ids: links
      .filter((link) => Number(link.professional_id) === Number(professional.id))
      .map((link) => link.service_id)
  }));
  res.json({
    services,
    professionals,
    rules: {
      cancellation: "Remarcações e cancelamentos devem ser solicitados com antecedência.",
      payment: "O sinal reserva o horário; a confirmação é feita manualmente pela Aura Clinic."
    }
  });
}));

router.get("/api/booking/slots", withDb(async (req, res, db) => {
  const serviceId = Number(req.query.service_id || 0);
  const professionalId = Number(req.query.professional_id || 0);
  const date = String(req.query.date || "");
  console.info("[booking-slots] request recebido", { tenant: req.tenant, serviceId, professionalId, date });
  if (!serviceId || !professionalId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Serviço, profissional e data são obrigatórios." });
  }
  const service = await db.get("SELECT * FROM services WHERE id = ? AND active_online_booking = 1", [serviceId]);
  if (!service) return res.status(404).json({ error: "Serviço não encontrado." });
  const linked = await db.get("SELECT id FROM professional_services WHERE professional_id = ? AND service_id = ?", [professionalId, serviceId]);
  if (!linked) return res.status(409).json({ error: "Este profissional não realiza o serviço selecionado." });
  const slots = await availableBookingSlots(db, { service, professionalId, date });
  res.json({ date, slots });
}));

router.post("/api/booking/requests", upload.fields([{ name: "reference_photo", maxCount: 1 }, { name: "payment_proof", maxCount: 1 }]), withDb(async (req, res, db) => {
  const body = req.body;
  console.info("[booking-request] request recebido", { tenant: req.tenant, service_id: body.service_id, professional_id: body.professional_id, appointment_date: body.appointment_date, appointment_time: body.appointment_time });
  const service = await db.get("SELECT * FROM services WHERE id = ? AND active_online_booking = 1", [body.service_id]);
  if (!service) return res.status(404).json({ error: "Serviço não encontrado." });
  const professionalId = Number(body.professional_id || 0);
  const date = String(body.appointment_date || "");
  const time = String(body.appointment_time || "");
  const slots = await availableBookingSlots(db, { service, professionalId, date });
  if (!slots.some((slot) => slot.time === time)) return res.status(409).json({ error: "Este horário não está mais disponível." });
  if (!body.full_name?.trim() || !body.whatsapp?.trim()) return res.status(400).json({ error: "Nome e WhatsApp são obrigatórios." });
  const totalValue = Number(service.price || service.base_price || 0);
  const depositValue = Number(service.deposit_value || 25);
  const remainingValue = Math.max(totalValue - depositValue, 0);
  const client = await upsertClient(db, {
    full_name: body.full_name,
    whatsapp: body.whatsapp,
    instagram: body.instagram || "",
    birth_date: "",
    notes: body.notes || ""
  });
  const referencePhoto = req.files?.reference_photo?.[0] ? `/uploads/${req.files.reference_photo[0].filename}` : "";
  const paymentProof = req.files?.payment_proof?.[0] ? `/uploads/${req.files.payment_proof[0].filename}` : "";
  const endTime = addMinutesToTime(time, Number(service.duration_minutes || 40));
  const result = await db.run(
    `INSERT INTO appointments
    (client_id, professional_id, service_id, procedure, description, piercing_region, appointment_date, appointment_time, end_time, total_value, deposit_value, remaining_value, deposit_payment_method, remaining_payment_method, status, notes, reference_photo_url, payment_proof_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      client.id,
      professionalId,
      service.id,
      service.name,
      service.description || "",
      service.name,
      date,
      time,
      endTime,
      totalValue,
      depositValue,
      remainingValue,
      "Pix",
      "Pix",
      "pendente",
      body.notes || "",
      referencePhoto,
      paymentProof
    ]
  );
  await db.run(
    "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, 'sinal', 'Pix', 'pago', ?)",
    [result.lastID, client.id, depositValue, `${date}T${time}:00`]
  );
  res.status(201).json(await listAppointments(db, "WHERE a.id = ?", [result.lastID]).then((rows) => rows[0]));
}));

export default router;
