// Serviços de agendamentos, clientes vinculados, serviços e slots de agenda.
import {
  timeToMinutes,
  minutesToTime,
  addMinutesToTime,
  dateTimeToDayMinutes,
  rangesOverlap,
  variantStatus,
  localTimestamp
} from "./utils.js";
import { syncProductInventory } from "./inventory.js";
import { limitOffset, countRows } from "./pagination.js";
import { getAppointmentFinancialSnapshot } from "./finance.js";

function sameDateTimeDate(value, date) {
  return String(value || "").slice(0, 10) === date;
}

function blockType(block) {
  return String(block.block_type || "block");
}

function bookingDebug(message, payload = {}) {
  console.info(`[booking-slots] ${message}`, payload);
}

const APPOINTMENT_FROM = `
  appointments a
  JOIN clients c ON c.id = a.client_id
  JOIN professionals p ON p.id = a.professional_id
  LEFT JOIN jewelry_inventory j ON j.id = a.jewelry_id
  LEFT JOIN jewelry_variants v ON v.id = a.jewelry_variant_id
  LEFT JOIN services s ON s.id = a.service_id
`;

// `paging` é opcional e só entra em ação quando o chamador o fornece: sem ele o
// comportamento é o de sempre (array completo), preservando os 5 chamadores
// internos que dependem da lista inteira.
export async function listAppointments(db, where = "", params = [], paging = null) {
  const page = limitOffset(paging);
  const orderBy = paging?.orderBy || "ORDER BY a.appointment_date, a.appointment_time";
  const rows = await db.all(`
    SELECT a.*, c.full_name, c.whatsapp, c.instagram, p.name AS professional_name,
      j.name AS jewelry_name, j.photo_url AS jewelry_photo,
      v.variation_name AS jewelry_variation_name, v.sku AS jewelry_variant_sku,
      s.name AS service_name
    FROM ${APPOINTMENT_FROM}
    ${where}
    ${orderBy}${page.clause}
  `, [...params, ...page.params]);
  return attachAppointmentItems(db, rows);
}

export async function countAppointments(db, where = "", params = []) {
  return countRows(db, { from: APPOINTMENT_FROM, where, params });
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

// O frontend lê base_price/is_active; as colunas reais são price/active_online_booking.
async function decorateService(db, service) {
  if (!service) return service;
  service.base_price = service.price;
  service.is_active = service.active_online_booking;
  service.professional_ids = (await db.all("SELECT professional_id FROM professional_services WHERE service_id = ?", [service.id])).map((item) => item.professional_id);
  return service;
}

// `paging` é opcional: sem ele o comportamento é o de sempre (lista inteira).
// O N+1 do professional_ids virou uma consulta só, restrita à página.
export async function listServices(db, { where = "", params = [], paging = null } = {}) {
  const page = limitOffset(paging);
  const orderBy = paging?.orderBy || "ORDER BY active_online_booking DESC, name";
  const services = await db.all(
    `SELECT * FROM services ${where} ${orderBy}${page.clause}`,
    [...params, ...page.params]
  );
  if (!services.length) return services;
  const links = await db.all(
    `SELECT service_id, professional_id FROM professional_services WHERE service_id IN (${services.map(() => "?").join(",")})`,
    services.map((service) => service.id)
  );
  return services.map((service) => ({
    ...service,
    base_price: service.price,
    is_active: service.active_online_booking,
    professional_ids: links.filter((link) => link.service_id === service.id).map((link) => link.professional_id)
  }));
}

export async function countServices(db, { where = "", params = [] } = {}) {
  return countRows(db, { from: "services", where, params });
}

// Busca direta por id, para responder a criação/edição sem varrer a lista.
export async function getService(db, id) {
  return decorateService(db, await db.get("SELECT * FROM services WHERE id = ?", [id]));
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
     WHERE professional_id = ? AND appointment_date = ? AND status NOT IN ('cancelado', 'recusado', 'remarcado', 'nao_compareceu')`,
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

const MEDICAL_RECORD_QUERY = `
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
`;

export async function listMedicalRecords(db, clientId) {
  return db.all(`${MEDICAL_RECORD_QUERY} WHERE r.client_id = ? ORDER BY r.record_date DESC, r.id DESC`, [clientId]);
}

// Busca direta pelo id do prontuário, sem depender da posição dele na lista.
export async function getMedicalRecord(db, recordId) {
  return db.get(`${MEDICAL_RECORD_QUERY} WHERE r.id = ?`, [recordId]);
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
        notes = COALESCE(NULLIF(?, ''), notes),
        tax_id = COALESCE(NULLIF(?, ''), tax_id),
        email = COALESCE(NULLIF(?, ''), email)
       WHERE id = ?`,
      [
        body.full_name ?? "",
        body.instagram ?? "",
        body.birth_date || null,
        body.client_notes ?? "",
        clientTaxId(body),
        body.email ?? body.customer_email ?? "",
        existing.id
      ]
    );
    return { ...existing, full_name: body.full_name || existing.full_name };
  }
  const result = await db.run(
    "INSERT INTO clients (full_name, whatsapp, instagram, birth_date, notes, tax_id, email) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    [
      body.full_name,
      body.whatsapp,
      body.instagram,
      body.birth_date || null,
      body.client_notes || "",
      clientTaxId(body) || null,
      body.email ?? body.customer_email ?? null
    ]
  );
  return { id: result.returnedId };
}

// CPF do cliente, só com dígitos.
//
// Existe porque o dado chega com nomes diferentes conforme a porta de entrada:
// a agenda manda `tax_id`/`cpf`, o checkout público do catálogo manda
// `customer_cpf`. Sem centralizar aqui, o CPF ficava preso em
// `sales_orders.customer_cpf` e nunca chegava à tabela `clients` — e o Asaas
// recusa criar pagador sem CPF, o que derrubaria toda cobrança online.
function clientTaxId(body) {
  const raw = body.tax_id ?? body.cpf ?? body.customer_cpf ?? "";
  return String(raw).replace(/\D/g, "");
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
    const variant = await db.get("SELECT * FROM jewelry_variants WHERE id = ? FOR UPDATE", [variantId]);
    const nextQuantity = Number(variant.quantity || 0) - 1;
    if (nextQuantity < 0) throw new Error(`Estoque insuficiente para concluir o atendimento #${appointmentId}.`);
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
  } else {
    const product = await db.get("SELECT * FROM jewelry_inventory WHERE id = ? FOR UPDATE", [appointment.jewelry_id]);
    if (!product || Number(product.quantity || 0) < 1) throw new Error(`Estoque insuficiente para concluir o atendimento #${appointmentId}.`);
    const nextQuantity = Number(product.quantity) - 1;
    await db.run("UPDATE jewelry_inventory SET quantity=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [nextQuantity, variantStatus(nextQuantity, product.low_stock_threshold), product.id]);
    await db.run(
      "INSERT INTO stock_movements (jewelry_id, movement_type, quantity, notes) VALUES (?, 'Saida', 1, ?)",
      [product.id, `Baixa automatica do atendimento #${appointmentId}`]
    );
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
    const variant = await db.get("SELECT * FROM jewelry_variants WHERE id = ? FOR UPDATE", [variantId]);
    if (!variant) continue;
    const quantity = Math.max(1, Number(item.quantity || 1));
    const nextQuantity = Number(variant.quantity || 0) - quantity;
    if (nextQuantity < 0) {
      throw new Error(`Estoque insuficiente para concluir o atendimento #${appointmentId}: ${quantity} un. solicitada(s), ${Number(variant.quantity || 0)} disponível(is).`);
    }
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
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ? FOR UPDATE", [appointmentId]);
  if (!appointment || !appointment.stock_deducted) return;
  const items = await appointmentStockItems(db, appointment);
  for (const item of items) {
    const quantity = Math.max(1, Number(item.quantity || 1));
    if (item.jewelry_variant_id) {
      const variant = await db.get("SELECT * FROM jewelry_variants WHERE id = ? FOR UPDATE", [item.jewelry_variant_id]);
      if (!variant) continue;
      const nextQuantity = Number(variant.quantity || 0) + quantity;
      await db.run(
        "UPDATE jewelry_variants SET quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [nextQuantity, variantStatus(nextQuantity, variant.low_stock_threshold), item.jewelry_variant_id]
      );
      await db.run(
        "INSERT INTO stock_movements (jewelry_id, variant_id, movement_type, quantity, notes) VALUES (?, ?, 'Entrada', ?, ?)",
        [item.jewelry_id, item.jewelry_variant_id, quantity, `Estorno da baixa do atendimento #${appointmentId}`]
      );
      await syncProductInventory(db, item.jewelry_id);
      continue;
    }

    const product = await db.get("SELECT * FROM jewelry_inventory WHERE id = ? FOR UPDATE", [item.jewelry_id]);
    if (!product) continue;
    const nextQuantity = Number(product.quantity || 0) + quantity;
    await db.run(
      "UPDATE jewelry_inventory SET quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [nextQuantity, variantStatus(nextQuantity, product.low_stock_threshold), item.jewelry_id]
    );
    await db.run(
      "INSERT INTO stock_movements (jewelry_id, movement_type, quantity, notes) VALUES (?, 'Entrada', ?, ?)",
      [item.jewelry_id, quantity, `Estorno da baixa do atendimento #${appointmentId}`]
    );
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
  if (existing) {
    await db.run("UPDATE appointments SET remaining_value=0, updated_at=? WHERE id=?", [localTimestamp(), appointmentId]);
    return;
  }

  await db.run(
    `INSERT INTO payments
      (appointment_id, client_id, amount, payment_type, method, status, paid_at, idempotency_key)
     VALUES (?, ?, ?, 'restante', ?, 'pago', ?, ?) ON CONFLICT DO NOTHING`,
    [
      appointment.id,
      appointment.client_id,
      Number(appointment.remaining_value || 0),
      appointment.remaining_payment_method || "Pix",
      localTimestamp(),
      `appointment:${appointmentId}:remaining`
    ]
  );
  await db.run("UPDATE appointments SET remaining_value=0, updated_at=? WHERE id=?", [localTimestamp(), appointmentId]);
}

export async function registerCompletionPayments(db, appointmentId, rawPayments = [], userId = null) {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ? FOR UPDATE", [appointmentId]);
  if (!appointment) throw new Error("Agendamento não encontrado.");

  const snapshot = await getAppointmentFinancialSnapshot(db, appointmentId);
  // O fechamento substitui os pagamentos finais existentes. Portanto o teto é
  // o líquido menos apenas o sinal realmente confirmado, e não o saldo do
  // snapshot (que já descontaria as linhas finais que serão substituídas).
  const maximum = Math.max(0, Number(snapshot?.netTotal ?? appointment.total_value ?? 0) - Number(snapshot?.depositPaid || 0));

  const payments = (Array.isArray(rawPayments) ? rawPayments : []).map((item) => ({
    amount: Number(item.amount || 0), method: String(item.method || "Pix"), status: String(item.status || "pago"),
    installments: Math.max(1, Number(item.installments || 1)), fee_amount: Math.max(0, Number(item.fee_amount || 0)),
    expected_receipt_date: item.expected_receipt_date || null, notes: String(item.notes || "")
  })).filter((item) => item.amount > 0);
  const paid = payments.filter((item) => item.status === "pago" || item.status === "confirmado").reduce((sum, item) => sum + item.amount, 0);
  if (paid > maximum + 0.009) throw new Error("A soma dos pagamentos não pode superar o saldo do atendimento.");
  // Preserva os ids das baixas ao refazer o fechamento. Apagar e reinserir
  // deixava para trás lançamentos espelhados no ledger e perdia sales_order_id.
  const existing = await db.all(
    "SELECT * FROM payments WHERE appointment_id=? AND payment_type IN ('restante','final','complementar') ORDER BY id FOR UPDATE",
    [appointmentId]
  );
  for (let index = 0; index < payments.length; index += 1) {
    const item = payments[index];
    const current = existing[index];
    if (current) {
      await db.run(
        `UPDATE payments SET amount=?, payment_type='restante', method=?, status=?, paid_at=?, installments=?,
           fee_amount=?, net_amount=?, expected_receipt_date=?, notes=?, created_by_user_id=? WHERE id=?`,
        [item.amount, item.method, item.status, current.paid_at || localTimestamp(),
          item.installments, item.fee_amount, Math.max(0, item.amount - item.fee_amount), item.expected_receipt_date,
          item.notes, userId, current.id]
      );
    } else {
      await db.run(
        `INSERT INTO payments
          (appointment_id, client_id, amount, payment_type, method, status, paid_at, installments,
           fee_amount, net_amount, expected_receipt_date, notes, created_by_user_id, idempotency_key)
         VALUES (?, ?, ?, 'restante', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
        [appointmentId, appointment.client_id, item.amount, item.method, item.status,
          localTimestamp(), item.installments, item.fee_amount,
          Math.max(0, item.amount - item.fee_amount), item.expected_receipt_date, item.notes, userId,
          `appointment:${appointmentId}:completion:${index + 1}`]
      );
    }
  }
  for (const stale of existing.slice(payments.length)) {
    await db.run("UPDATE payments SET status='cancelado' WHERE id=? AND status!='cancelado'", [stale.id]);
  }
  await db.run("UPDATE appointments SET remaining_value = ?, remaining_payment_method = ?, financial_closed_at = ?, financial_closed_by = ?, updated_at = ? WHERE id = ?", [Math.max(0, maximum - paid), payments[0]?.method || appointment.remaining_payment_method || "Pix", localTimestamp(), userId, localTimestamp(), appointmentId]);
  return { paid, remaining: Math.max(0, maximum - paid) };
}
