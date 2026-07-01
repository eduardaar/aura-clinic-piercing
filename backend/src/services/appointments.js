// Serviços de agendamentos, clientes vinculados, serviços e slots de agenda.
import {
  timeToMinutes,
  minutesToTime,
  addMinutesToTime,
  dateTimeToDayMinutes,
  rangesOverlap,
  variantStatus
} from "./utils.js";
import { syncProductInventory } from "./inventory.js";

export async function listAppointments(db, where = "", params = []) {
  return db.all(`
    SELECT a.*, c.full_name, c.whatsapp, c.instagram, p.name AS professional_name,
      j.name AS jewelry_name, j.photo_url AS jewelry_photo,
      v.variation_name AS jewelry_variation_name, v.sku AS jewelry_variant_sku,
      s.name AS service_name
    FROM appointments a
    JOIN clients c ON c.id = a.client_id
    JOIN professionals p ON p.id = a.professional_id
    LEFT JOIN jewelry_inventory j ON j.id = a.jewelry_id
    LEFT JOIN jewelry_variants v ON v.id = a.jewelry_variant_id
    LEFT JOIN services s ON s.id = a.service_id
    ${where}
    ORDER BY a.appointment_date, a.appointment_time
  `, params);
}

export async function listServices(db) {
  const services = await db.all("SELECT * FROM services ORDER BY active_online_booking DESC, name");
  for (const service of services) {
    service.professional_ids = (await db.all("SELECT professional_id FROM professional_services WHERE service_id = ?", [service.id])).map((item) => item.professional_id);
  }
  return services;
}

export async function replaceProfessionalServices(db, serviceId, professionalIds) {
  const ids = Array.isArray(professionalIds) ? professionalIds : String(professionalIds || "").split(",");
  await db.run("DELETE FROM professional_services WHERE service_id = ?", [serviceId]);
  for (const id of ids.filter(Boolean)) {
    await db.run("INSERT INTO professional_services (professional_id, service_id) VALUES (?, ?) ON CONFLICT (professional_id, service_id) DO NOTHING", [Number(id), Number(serviceId)]);
  }
}

export async function availableBookingSlots(db, { service, professionalId, date }) {
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const availability = await db.get(
    "SELECT * FROM professional_availability WHERE professional_id = ? AND weekday = ? AND is_active = 1",
    [professionalId, weekday]
  );
  if (!availability) return [];
  const duration = Number(service.duration_minutes || availability.duration_minutes || 40);
  const step = duration + Number(availability.buffer_minutes || 0);
  const appointments = await db.all(
    `SELECT appointment_time, end_time
     FROM appointments
     WHERE professional_id = ? AND appointment_date = ? AND status NOT IN ('cancelado', 'recusado')`,
    [professionalId, date]
  );
  const blocks = await db.all(
    `SELECT *
     FROM schedule_blocks
     WHERE professional_id = ? AND DATE(start_datetime) <= DATE(?) AND DATE(end_datetime) >= DATE(?)`,
    [professionalId, date, date]
  );
  const slots = [];
  for (let cursor = timeToMinutes(availability.start_time); cursor + duration <= timeToMinutes(availability.end_time); cursor += step) {
    const start = cursor;
    const end = cursor + duration;
    if (availability.lunch_start && availability.lunch_end && rangesOverlap(start, end, timeToMinutes(availability.lunch_start), timeToMinutes(availability.lunch_end))) continue;
    if (appointments.some((item) => rangesOverlap(start, end, timeToMinutes(item.appointment_time), timeToMinutes(item.end_time || addMinutesToTime(item.appointment_time, duration))))) continue;
    if (blocks.some((block) => block.is_full_day || rangesOverlap(start, end, dateTimeToDayMinutes(block.start_datetime), dateTimeToDayMinutes(block.end_datetime)))) continue;
    slots.push({ time: minutesToTime(start), end_time: minutesToTime(end) });
  }
  return slots;
}

export async function listMedicalRecords(db, clientId) {
  return db.all(`
    SELECT
      r.*,
      a.procedure,
      a.piercing_region,
      a.appointment_date,
      p.name AS professional_name,
      j.name AS appointment_jewelry
    FROM client_medical_records r
    LEFT JOIN appointments a ON a.id = r.appointment_id
    LEFT JOIN professionals p ON p.id = a.professional_id
    LEFT JOIN jewelry_inventory j ON j.id = a.jewelry_id
    WHERE r.client_id = ?
    ORDER BY r.record_date DESC, r.id DESC
  `, [clientId]);
}

export async function upsertClient(db, body) {
  if (body.client_id) {
    const selected = await db.get("SELECT * FROM clients WHERE id = ?", [body.client_id]);
    if (selected) return selected;
  }

  const existing = await db.get("SELECT * FROM clients WHERE whatsapp = ?", [body.whatsapp]);
  if (existing) {
    await db.run(
      "UPDATE clients SET full_name = ?, instagram = ?, birth_date = COALESCE(?, birth_date), notes = ? WHERE id = ?",
      [body.full_name, body.instagram, body.birth_date || null, body.client_notes || "", existing.id]
    );
    return { ...existing, full_name: body.full_name };
  }
  const result = await db.run(
    "INSERT INTO clients (full_name, whatsapp, instagram, birth_date, notes) VALUES (?, ?, ?, ?, ?)",
    [body.full_name, body.whatsapp, body.instagram, body.birth_date || null, body.client_notes || ""]
  );
  return { id: result.lastID };
}

export async function deductJewelryStock(db, appointmentId) {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [appointmentId]);
  if (!appointment?.jewelry_id || appointment.stock_deducted) return;
  let variantId = appointment.jewelry_variant_id;
  if (!variantId) {
    const firstAvailable = await db.get(
      "SELECT id FROM jewelry_variants WHERE jewelry_id = ? AND is_active = 1 AND quantity > 0 ORDER BY id LIMIT 1",
      [appointment.jewelry_id]
    );
    variantId = firstAvailable?.id;
  }
  if (variantId) {
    const variant = await db.get("SELECT * FROM jewelry_variants WHERE id = ?", [variantId]);
    const nextQuantity = Math.max(0, Number(variant.quantity || 0) - 1);
    await db.run(
      "UPDATE jewelry_variants SET quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [nextQuantity, variantStatus(nextQuantity, variant.low_stock_threshold), variantId]
    );
    await db.run(
      "INSERT INTO stock_movements (jewelry_id, variant_id, movement_type, quantity, notes) VALUES (?, ?, 'Saída', 1, ?)",
      [appointment.jewelry_id, variantId, `Baixa automática do atendimento #${appointmentId}`]
    );
    await db.run("UPDATE appointments SET jewelry_variant_id = ? WHERE id = ?", [variantId, appointmentId]);
    await syncProductInventory(db, appointment.jewelry_id);
  }
  await db.run("UPDATE appointments SET stock_deducted = 1 WHERE id = ?", [appointmentId]);
}

export async function registerRemainingPayment(db, appointmentId) {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [appointmentId]);
  if (!appointment || Number(appointment.remaining_value || 0) <= 0) return;

  const existing = await db.get(
    "SELECT id FROM payments WHERE appointment_id = ? AND payment_type = 'restante'",
    [appointmentId]
  );
  if (existing) return;

  await db.run(
    "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, 'restante', ?, 'pago', ?)",
    [
      appointment.id,
      appointment.client_id,
      Number(appointment.remaining_value || 0),
      appointment.remaining_payment_method || "Pix",
      new Date().toISOString().slice(0, 19)
    ]
  );
}
