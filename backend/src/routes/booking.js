// Rotas publicas de agendamento online.
import { Router } from "express";
import { createHash } from "crypto";
import { withDb } from "../middleware/withDb.js";
import { upload } from "../middleware/upload.js";
import { addMinutesToTime } from "../services/utils.js";
import { availableBookingSlots, upsertClient, listAppointments } from "../services/appointments.js";
import { getStoreName, queueProfessionalBookingNotification, whatsappLink } from "../services/notifications.js";

const router = Router();

function publicBookingKey(req, body) {
  const provided = String(req.get("Idempotency-Key") || body.idempotency_key || body.public_booking_token || "").trim();
  if (provided) return provided.slice(0, 180);
  return createHash("sha256")
    .update([
      req.tenant?.slug || "",
      body.service_id || "",
      body.professional_id || "",
      body.appointment_date || "",
      body.appointment_time || "",
      String(body.whatsapp || "").replace(/\D/g, ""),
      String(body.full_name || "").trim().toLowerCase()
    ].join("|"))
    .digest("hex");
}

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
  return {
    ready: checklist.every((item) => item.done),
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

router.get("/api/booking/config", withDb(async (req, res, db) => {
  console.info("[booking-config] tenant recebido", req.tenant);
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
      payment: "O sinal obrigatório reserva o horário após conferência manual do comprovante pela equipe."
    }
  });
}));

router.get("/api/booking/slots", withDb(async (req, res, db) => {
  const serviceId = Number(req.query.service_id || 0);
  const professionalId = Number(req.query.professional_id || 0);
  const date = String(req.query.date || "");
  console.info("[booking-slots] request recebido", { tenant: req.tenant, serviceId, professionalId, date });
  if (!serviceId || !professionalId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Servico, profissional e data sao obrigatorios." });
  }
  const service = await db.get("SELECT * FROM services WHERE id = ? AND active_online_booking = 1", [serviceId]);
  if (!service) return res.status(404).json({ error: "Servico nao encontrado." });
  const linked = await db.get("SELECT id FROM professional_services WHERE professional_id = ? AND service_id = ?", [professionalId, serviceId]);
  if (!linked) return res.status(409).json({ error: "Este profissional nao realiza o servico selecionado." });
  const slots = await availableBookingSlots(db, { service, professionalId, date });
  res.json({ date, slots });
}));

router.post("/api/booking/requests", upload.fields([{ name: "reference_photo", maxCount: 1 }, { name: "payment_proof", maxCount: 1 }]), withDb(async (req, res, db) => {
  const body = req.body || {};
  console.info("[booking-request] request recebido", { tenant: req.tenant, service_id: body.service_id, professional_id: body.professional_id, appointment_date: body.appointment_date, appointment_time: body.appointment_time });

  const bookingKey = publicBookingKey(req, body);
  const existing = await listAppointments(db, "WHERE a.public_booking_key = ?", [bookingKey]).then((rows) => rows[0]);
  if (existing) return res.status(200).json({ ...existing, idempotent: true });

  const service = await db.get("SELECT * FROM services WHERE id = ? AND active_online_booking = 1", [body.service_id]);
  if (!service) return res.status(404).json({ error: "Servico nao encontrado." });

  const professionalId = Number(body.professional_id || 0);
  const professional = await db.get("SELECT * FROM professionals WHERE id = ? AND active = 1", [professionalId]);
  if (!professional) return res.status(404).json({ error: "Profissional nao encontrado ou inativo." });

  const linked = await db.get("SELECT id FROM professional_services WHERE professional_id = ? AND service_id = ?", [professionalId, service.id]);
  if (!linked) return res.status(409).json({ error: "Este profissional nao realiza o servico selecionado." });

  const date = String(body.appointment_date || "");
  const time = String(body.appointment_time || "");
  const slots = await availableBookingSlots(db, { service, professionalId, date });
  if (!slots.some((slot) => slot.time === time)) return res.status(409).json({ error: "Este horario nao esta mais disponivel." });
  if (!body.full_name?.trim() || !body.whatsapp?.trim()) return res.status(400).json({ error: "Nome e WhatsApp sao obrigatorios." });

  const jewelryId = Number(body.jewelry_id || 0) || null;
  const variantId = Number(body.jewelry_variant_id || 0) || null;
  const jewelry = jewelryId ? await db.get("SELECT * FROM jewelry_inventory WHERE id = ? AND is_catalog_active = 1 AND status != 'arquivado'", [jewelryId]) : null;
  if (jewelryId && !jewelry) return res.status(404).json({ error: "Joia selecionada não encontrada no catálogo." });
  const variant = variantId ? await db.get("SELECT * FROM jewelry_variants WHERE id = ? AND jewelry_id = ? AND is_active = 1", [variantId, jewelryId]) : null;
  if (variantId && !variant) return res.status(404).json({ error: "Variação selecionada não encontrada." });
  const serviceValue = Number(service.price || service.base_price || 0);
  const jewelryValue = jewelryId ? Number(variant?.sale_value || jewelry?.sale_value || 0) : 0;
  const totalValue = serviceValue + jewelryValue;
  const depositValue = Number(service.deposit_value || 25);
  const remainingValue = Math.max(totalValue - depositValue, 0);
  const client = await upsertClient(db, {
    full_name: body.full_name,
    whatsapp: body.whatsapp,
    instagram: body.instagram || "",
    birth_date: "",
    client_notes: body.notes || ""
  });
  const referencePhoto = req.files?.reference_photo?.[0] ? `/uploads/${req.files.reference_photo[0].filename}` : "";
  const paymentProof = req.files?.payment_proof?.[0] ? `/uploads/${req.files.payment_proof[0].filename}` : "";
  const durationMinutes = Number(service.duration_minutes || 40);
  const endTime = addMinutesToTime(time, durationMinutes);
  const result = await db.run(
    `INSERT INTO appointments
      (client_id, professional_id, service_id, jewelry_id, jewelry_variant_id, procedure, description, piercing_region, appointment_date, appointment_time, end_time, duration_minutes, total_value, deposit_value, remaining_value, deposit_payment_method, remaining_payment_method, status, source, public_booking_key, notes, reference_photo_url, payment_proof_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      client.id,
      professionalId,
      service.id,
      jewelryId,
      variantId,
      service.name,
      service.description || "",
      service.name,
      date,
      time,
      endTime,
      durationMinutes,
      totalValue,
      depositValue,
      remainingValue,
      "Pix",
      "Pix",
      "awaiting_deposit_proof",
      "public_booking",
      bookingKey,
      [body.notes || "", body.selected_color ? `Observação de cor: ${body.selected_color}` : ""].filter(Boolean).join("\n"),
      referencePhoto,
      paymentProof
    ]
  );
  if (depositValue > 0) {
    await db.run(
      "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, 'sinal', 'Pix', 'pendente', ?)",
      [result.lastID, client.id, depositValue, `${date}T${time}:00`]
    );
  }
  const appointment = await listAppointments(db, "WHERE a.id = ?", [result.lastID]).then((rows) => rows[0]);
  const proofMessage = [
    `Olá, ${professional.name}. Tudo bem?`,
    `Sou ${client.full_name || body.full_name} e acabei de solicitar meu agendamento na Aura Clinic.`,
    `Serviço: ${service.name}`,
    jewelry ? `Joia: ${jewelry.name}${variant ? ` - ${variant.variation_name}` : ""}` : "",
    `Data: ${date} às ${time}`,
    `Sinal: R$ ${depositValue.toFixed(2).replace(".", ",")}`,
    "Segue o comprovante do sinal para conferência."
  ].filter(Boolean).join("\n");
  const professionalWhatsappUrl = whatsappLink(professional.whatsapp || professional.phone, proofMessage);
  await queueProfessionalBookingNotification(db, {
    appointmentId: result.lastID,
    professionalId,
    client,
    service,
    appointment,
    storeName: await getStoreName(db, req.tenant?.name)
  });
  res.status(201).json({
    ...appointment,
    service_value: serviceValue,
    jewelry_value: jewelryValue,
    professional_whatsapp_url: professionalWhatsappUrl,
    payment_instructions: "Envie o comprovante do sinal pelo WhatsApp. A Aura confirma o horário após conferência manual."
  });
}));

export default router;
