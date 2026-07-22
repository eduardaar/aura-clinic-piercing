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

function sameDateTimeDate(value, date) {
  return String(value || "").slice(0, 10) === date;
}

function blockType(block) {
  return String(block.block_type || "block");
}

function bookingDebug(message, payload = {}) {
  console.info(`[booking-slots] ${message}`, payload);
}

export async function listAppointments(db, where = "", params = []) {
  const rows = await db.all(`
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
  return attachAppointmentItems(db, rows);
}

function parseItems(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appointmentItemsFromBody(body = {}) {
  return parseItems(body.appointment_items ?? body.appointmentItems ?? body.items);
}

export async function normalizeAppointmentItems(db, body = {}) {
  const submittedItems = appointmentItemsFromBody(body);
  const baseItems = submittedItems.length ? submittedItems : [{
    procedure_id: body.procedure_id || null,
    service_id: body.service_id || null,
    region: body.piercing_region || "",
    jewelry_id: body.jewelry_id || null,
    jewelry_variant_id: body.jewelry_variant_id || null,
    quantity: 1,
    procedure_price: body.procedure_value || body.service_value || "",
    jewelry_unit_price: body.jewelry_value || "",
    duration_minutes: body.duration_minutes || 0,
    notes: body.notes || ""
  }];

  const items = [];
  for (const raw of baseItems) {
    const serviceId = raw.service_id ? Number(raw.service_id) : (body.service_id ? Number(body.service_id) : null);
    const procedureId = raw.procedure_id ? Number(raw.procedure_id) : null;
    const jewelryId = raw.jewelry_id ? Number(raw.jewelry_id) : null;
    const variantId = raw.jewelry_variant_id ? Number(raw.jewelry_variant_id) : null;
    const quantity = Math.max(1, Number(raw.quantity || 1));
    const service = serviceId ? await db.get("SELECT * FROM services WHERE id = ?", [serviceId]) : null;
    const procedure = procedureId ? await db.get("SELECT * FROM procedures WHERE id = ?", [procedureId]) : null;
    const jewelry = jewelryId ? await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [jewelryId]) : null;
    const variant = variantId ? await db.get("SELECT * FROM jewelry_variants WHERE id = ?", [variantId]) : null;
    const procedurePrice = Number(raw.procedure_price || raw.service_price || procedure?.price || service?.price || body.procedure_value || body.service_value || 0);
    const jewelryUnitPrice = jewelryId ? Number(raw.jewelry_unit_price || raw.unit_price || variant?.sale_value || jewelry?.sale_value || body.jewelry_value || 0) : 0;
    const duration = Number(raw.duration_minutes || procedure?.duration_minutes || service?.duration_minutes || body.duration_minutes || 0);
    items.push({
      procedure_id: procedureId,
      service_id: serviceId,
      service_name: service?.name || "",
      procedure_name: procedure?.name || raw.procedure || body.procedure || service?.name || "Atendimento",
      region: raw.region || raw.piercing_region || procedure?.body_area || body.piercing_region || "",
      jewelry_id: jewelryId,
      jewelry_variant_id: variantId,
      quantity,
      procedure_price: procedurePrice,
      jewelry_unit_price: jewelryUnitPrice,
      duration_minutes: duration,
      subtotal: procedurePrice + jewelryUnitPrice * quantity,
      notes: raw.notes || ""
    });
  }
  return items.filter((item) => item.service_id || item.procedure_id || item.jewelry_id || item.region);
}

export function appointmentTotalsFromItems(items = [], fallback = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  const procedureValue = safeItems.reduce((sum, item) => sum + Number(item.procedure_price || 0), 0);
  const jewelryValue = safeItems.reduce((sum, item) => sum + Number(item.jewelry_unit_price || 0) * Number(item.quantity || 1), 0);
  const durationMinutes = safeItems.reduce((sum, item) => sum + Number(item.duration_minutes || 0), 0);
  const calculatedTotal = procedureValue + jewelryValue;
  const totalValue = calculatedTotal > 0 ? calculatedTotal : Number(fallback.total_value || 0);
  const depositValue = Number(fallback.deposit_value ?? 0);
  return {
    procedureValue,
    jewelryValue,
    durationMinutes,
    totalValue,
    depositValue,
    remainingValue: Math.max(totalValue - depositValue, 0)
  };
}

export async function replaceAppointmentItems(db, appointmentId, items = []) {
  await db.run("DELETE FROM appointment_items WHERE appointment_id = ?", [appointmentId]);
  for (const item of Array.isArray(items) ? items : []) {
    await db.run(
      `INSERT INTO appointment_items
      (appointment_id, procedure_id, service_id, region, jewelry_id, jewelry_variant_id, quantity, procedure_price, jewelry_unit_price, duration_minutes, subtotal, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        appointmentId,
        item.procedure_id || null,
        item.service_id || null,
        item.region || "",
        item.jewelry_id || null,
        item.jewelry_variant_id || null,
        Number(item.quantity || 1),
        Number(item.procedure_price || 0),
        Number(item.jewelry_unit_price || 0),
        Number(item.duration_minutes || 0),
        Number(item.subtotal || 0),
        item.notes || ""
      ]
    );
  }
}

async function attachAppointmentItems(db, rows = []) {
  const ids = rows.map((item) => item.id).filter(Boolean);
  if (!ids.length) return rows;
  const placeholders = ids.map(() => "?").join(",");
  const items = await db.all(`
    SELECT ai.*, s.name AS service_name, p.name AS procedure_name,
      j.name AS jewelry_name, j.photo_url AS jewelry_photo,
      v.variation_name AS jewelry_variation_name, v.sku AS jewelry_variant_sku
    FROM appointment_items ai
    LEFT JOIN services s ON s.id = ai.service_id
    LEFT JOIN procedures p ON p.id = ai.procedure_id
    LEFT JOIN jewelry_inventory j ON j.id = ai.jewelry_id
    LEFT JOIN jewelry_variants v ON v.id = ai.jewelry_variant_id
    WHERE ai.appointment_id IN (${placeholders})
    ORDER BY ai.id
  `, ids);
  const grouped = items.reduce((acc, item) => {
    acc[item.appointment_id] ||= [];
    acc[item.appointment_id].push(item);
    return acc;
  }, {});
  return rows.map((row) => ({ ...row, items: grouped[row.id] || [] }));
}

export async function listServices(db) {
  const services = await db.all("SELECT * FROM services ORDER BY active_online_booking DESC, name");
  for (const service of services) {
    // O frontend lê base_price/is_active; as colunas reais são price/active_online_booking.
    service.base_price = service.price;
    service.is_active = service.active_online_booking;
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
  const fullDayBlocks = blocks.filter((block) => blockType(block) !== "special_hours" && Number(block.is_full_day || 0));
  if (fullDayBlocks.length) {
    bookingDebug("data bloqueada por regra de dia inteiro", { professionalId, serviceId: service.id, date, fullDayBlocks: fullDayBlocks.length });
    return [];
  }

  const specialHours = blocks.filter((block) => blockType(block) === "special_hours" && sameDateTimeDate(block.start_datetime, date));
  const availabilityWindows = specialHours.length
    ? specialHours.map((block) => ({
      start_time: String(block.start_datetime).slice(11, 16),
      end_time: String(block.end_datetime).slice(11, 16),
      lunch_start: block.lunch_start || "",
      lunch_end: block.lunch_end || "",
      duration_minutes: Number(block.duration_minutes || availability?.duration_minutes || 40),
      buffer_minutes: Number(block.buffer_minutes || availability?.buffer_minutes || 0),
      source: "special_hours"
    }))
    : availability
      ? [{ ...availability, source: "weekly" }]
      : [];

  if (!availabilityWindows.length) {
    bookingDebug("sem disponibilidade para a data", { professionalId, serviceId: service.id, date, weekday });
    return [];
  }

  const slots = [];
  for (const window of availabilityWindows) {
    const duration = Number(service.duration_minutes || window.duration_minutes || 40);
    const step = duration + Number(window.buffer_minutes || 0);
    for (let cursor = timeToMinutes(window.start_time); cursor + duration <= timeToMinutes(window.end_time); cursor += step) {
      const start = cursor;
      const end = cursor + duration;
      if (window.lunch_start && window.lunch_end && rangesOverlap(start, end, timeToMinutes(window.lunch_start), timeToMinutes(window.lunch_end))) continue;
      if (appointments.some((item) => rangesOverlap(start, end, timeToMinutes(item.appointment_time), timeToMinutes(item.end_time || addMinutesToTime(item.appointment_time, duration))))) continue;
      if (blocks.some((block) => blockType(block) !== "special_hours" && !Number(block.is_full_day || 0) && rangesOverlap(start, end, dateTimeToDayMinutes(block.start_datetime), dateTimeToDayMinutes(block.end_datetime)))) continue;
      slots.push({ time: minutesToTime(start), end_time: minutesToTime(end), source: window.source });
    }
  }
  const uniqueSlots = Array.from(new Map(slots.map((slot) => [slot.time, slot])).values())
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  bookingDebug("slots gerados", {
    professionalId,
    serviceId: service.id,
    date,
    weekday,
    duration: Number(service.duration_minutes || 0),
    weekly: Boolean(availability),
    specialHours: specialHours.length,
    blocks: blocks.filter((block) => blockType(block) !== "special_hours").length,
    appointments: appointments.length,
    slots: uniqueSlots.length
  });
  return uniqueSlots;
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
    // Só sobrescreve campos que vieram preenchidos — antes um re-save por outro
    // fluxo (agenda/venda/termo) apagava instagram/notes do cliente existente.
    await db.run(
      `UPDATE clients SET
        full_name = COALESCE(NULLIF(?, ''), full_name),
        instagram = COALESCE(NULLIF(?, ''), instagram),
        birth_date = COALESCE(?, birth_date),
        notes = COALESCE(NULLIF(?, ''), notes)
       WHERE id = ?`,
      [body.full_name ?? "", body.instagram ?? "", body.birth_date || null, body.client_notes ?? "", existing.id]
    );
    return { ...existing, full_name: body.full_name || existing.full_name };
  }
  const result = await db.run(
    "INSERT INTO clients (full_name, whatsapp, instagram, birth_date, notes) VALUES (?, ?, ?, ?, ?)",
    [body.full_name, body.whatsapp, body.instagram, body.birth_date || null, body.client_notes || ""]
  );
  return { id: result.lastID };
}

async function deductLegacyJewelryStock(db, appointmentId) {
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

async function appointmentStockItems(db, appointment) {
  const items = await db.all("SELECT * FROM appointment_items WHERE appointment_id = ? AND jewelry_id IS NOT NULL", [appointment.id]);
  if (items.length) return items;
  return appointment.jewelry_id ? [{
    appointment_id: appointment.id,
    jewelry_id: appointment.jewelry_id,
    jewelry_variant_id: appointment.jewelry_variant_id,
    quantity: 1
  }] : [];
}

export async function deductJewelryStock(db, appointmentId) {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [appointmentId]);
  if (!appointment || appointment.stock_deducted) return;
  const items = await appointmentStockItems(db, appointment);
  if (!items.length) {
    await db.run("UPDATE appointments SET stock_deducted = 1 WHERE id = ?", [appointmentId]);
    return;
  }
  for (const item of items) {
    let variantId = item.jewelry_variant_id;
    if (!variantId) {
      const firstAvailable = await db.get(
        "SELECT id FROM jewelry_variants WHERE jewelry_id = ? AND is_active = 1 AND quantity > 0 ORDER BY id LIMIT 1",
        [item.jewelry_id]
      );
      variantId = firstAvailable?.id;
    }
    if (!variantId) {
      await deductLegacyJewelryStock(db, appointmentId);
      continue;
    }
    const variant = await db.get("SELECT * FROM jewelry_variants WHERE id = ?", [variantId]);
    if (!variant) continue;
    const quantity = Math.max(1, Number(item.quantity || 1));
    const nextQuantity = Math.max(0, Number(variant.quantity || 0) - quantity);
    await db.run(
      "UPDATE jewelry_variants SET quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [nextQuantity, variantStatus(nextQuantity, variant.low_stock_threshold), variantId]
    );
    await db.run(
      "INSERT INTO stock_movements (jewelry_id, variant_id, movement_type, quantity, notes) VALUES (?, ?, 'Saida', ?, ?)",
      [item.jewelry_id, variantId, quantity, `Baixa automatica do atendimento #${appointmentId}`]
    );
    if (item.id && !item.jewelry_variant_id) {
      await db.run("UPDATE appointment_items SET jewelry_variant_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [variantId, item.id]);
    }
    await syncProductInventory(db, item.jewelry_id);
  }
  await db.run("UPDATE appointments SET stock_deducted = 1 WHERE id = ?", [appointmentId]);
}

export async function restoreJewelryStock(db, appointmentId) {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [appointmentId]);
  if (!appointment || !appointment.stock_deducted) return;
  const items = await appointmentStockItems(db, appointment);
  for (const item of items) {
    if (!item.jewelry_variant_id) continue;
    const variant = await db.get("SELECT * FROM jewelry_variants WHERE id = ?", [item.jewelry_variant_id]);
    if (!variant) continue;
    const quantity = Math.max(1, Number(item.quantity || 1));
    const nextQuantity = Number(variant.quantity || 0) + quantity;
    await db.run(
      "UPDATE jewelry_variants SET quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [nextQuantity, variantStatus(nextQuantity, variant.low_stock_threshold), item.jewelry_variant_id]
    );
    await db.run(
      "INSERT INTO stock_movements (jewelry_id, variant_id, movement_type, quantity, notes) VALUES (?, ?, 'Entrada', ?, ?)",
      [item.jewelry_id, item.jewelry_variant_id, quantity, `Estorno do atendimento cancelado #${appointmentId}`]
    );
    await syncProductInventory(db, item.jewelry_id);
  }
  await db.run("UPDATE appointments SET stock_deducted = 0 WHERE id = ?", [appointmentId]);
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
