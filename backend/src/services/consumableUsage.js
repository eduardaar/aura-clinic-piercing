import { localTimestamp } from "./utils.js";

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} deve ser um número inteiro positivo.`);
  return number;
}

export async function serviceRecipe(db, serviceId) {
  return db.all(`
    SELECT r.*, c.name AS consumable_name, c.unit, c.quantity AS available_quantity, c.status AS consumable_status
      FROM service_consumable_recipes r
      JOIN consumables c ON c.id=r.consumable_id
     WHERE r.service_id=?
     ORDER BY c.name, r.id
  `, [serviceId]);
}

export async function replaceServiceRecipe(db, serviceId, rawItems = []) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const seen = new Set();
  const normalized = items.map((item, index) => {
    const consumableId = positiveInteger(item?.consumable_id, `Material ${index + 1}`);
    if (seen.has(consumableId)) throw new Error("Um material só pode aparecer uma vez na ficha técnica.");
    seen.add(consumableId);
    return { consumableId, quantity: positiveInteger(item?.quantity, `Quantidade do material ${index + 1}`), notes: String(item?.notes || "").trim() };
  });
  await db.transaction(async (tx) => {
    const service = await tx.get("SELECT id FROM services WHERE id=? FOR UPDATE", [serviceId]);
    if (!service) throw new Error("Serviço não encontrado.");
    for (const item of normalized) {
      const consumable = await tx.get("SELECT id, status FROM consumables WHERE id=? FOR UPDATE", [item.consumableId]);
      if (!consumable || consumable.status !== "active") throw new Error(`Material ${item.consumableId} não está ativo.`);
    }
    await tx.run("DELETE FROM service_consumable_recipes WHERE service_id=?", [serviceId]);
    for (const item of normalized) {
      await tx.run(
        "INSERT INTO service_consumable_recipes (service_id, consumable_id, quantity, notes) VALUES (?, ?, ?, ?)",
        [serviceId, item.consumableId, item.quantity, item.notes]
      );
    }
  });
  return serviceRecipe(db, serviceId);
}

// Deduz exatamente uma vez por atendimento. A receita é lida no fechamento e
// vira snapshot em appointment_consumptions; editar o serviço depois não muda o
// histórico. Lotes com validade são consumidos por FEFO; saldo legado sem lote
// continua utilizável, evitando bloquear clínicas que já têm estoque cadastrado.
export async function consumeAppointmentRecipe(db, appointmentId, userId = null) {
  const appointment = await db.get("SELECT id, service_id, status FROM appointments WHERE id=? FOR UPDATE", [appointmentId]);
  if (!appointment?.service_id) return [];
  const recipes = await serviceRecipe(db, appointment.service_id);
  const applied = [];
  for (const recipe of recipes) {
    const existing = await db.get(
      "SELECT id FROM appointment_consumptions WHERE appointment_id=? AND consumable_id=? AND source='service_recipe' AND reversed_at IS NULL",
      [appointmentId, recipe.consumable_id]
    );
    if (existing) continue;
    const consumable = await db.get("SELECT * FROM consumables WHERE id=? FOR UPDATE", [recipe.consumable_id]);
    if (!consumable || consumable.status !== "active") throw new Error(`Material da ficha técnica não está ativo: ${recipe.consumable_name}.`);
    if (Number(consumable.quantity) < Number(recipe.quantity)) throw new Error(`Estoque insuficiente de ${consumable.name} para concluir o atendimento.`);
    const consumed = await db.run(
      `INSERT INTO appointment_consumptions (appointment_id, service_id, consumable_id, quantity, source, notes, consumed_by_user_id)
       VALUES (?, ?, ?, ?, 'service_recipe', ?, ?) RETURNING id`,
      [appointmentId, appointment.service_id, recipe.consumable_id, recipe.quantity, recipe.notes || `Ficha técnica do serviço #${appointment.service_id}`, userId]
    );
    let remaining = Number(recipe.quantity);
    const lots = await db.all(`
      SELECT * FROM consumable_lots
       WHERE consumable_id=? AND active=true AND remaining_quantity>0
       ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date NULLS LAST, id
       FOR UPDATE`, [recipe.consumable_id]);
    for (const lot of lots) {
      if (!remaining) break;
      const allocated = Math.min(remaining, Number(lot.remaining_quantity));
      await db.run("UPDATE consumable_lots SET remaining_quantity=remaining_quantity-?, updated_at=now() WHERE id=?", [allocated, lot.id]);
      await db.run("INSERT INTO consumable_lot_allocations (appointment_consumption_id, consumable_lot_id, quantity) VALUES (?, ?, ?)", [consumed.returnedId, lot.id, allocated]);
      remaining -= allocated;
    }
    await db.run("UPDATE consumables SET quantity=quantity-?, updated_at=to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id=?", [recipe.quantity, recipe.consumable_id]);
    await db.run("INSERT INTO consumable_stock_movements (consumable_id, movement_type, quantity, notes) VALUES (?, 'Saida', ?, ?)", [recipe.consumable_id, recipe.quantity, `Consumo automático do atendimento #${appointmentId}`]);
    applied.push({ consumable_id: recipe.consumable_id, quantity: recipe.quantity });
  }
  return applied;
}

export async function restoreAppointmentConsumptions(db, appointmentId, userId = null, reason = "Reabertura ou cancelamento do atendimento") {
  const rows = await db.all("SELECT * FROM appointment_consumptions WHERE appointment_id=? AND reversed_at IS NULL FOR UPDATE", [appointmentId]);
  for (const row of rows) {
    const consumable = await db.get("SELECT id FROM consumables WHERE id=? FOR UPDATE", [row.consumable_id]);
    if (!consumable) continue;
    const allocations = await db.all("SELECT * FROM consumable_lot_allocations WHERE appointment_consumption_id=? FOR UPDATE", [row.id]);
    for (const allocation of allocations) {
      await db.run("UPDATE consumable_lots SET remaining_quantity=LEAST(received_quantity, remaining_quantity+?), updated_at=now() WHERE id=?", [allocation.quantity, allocation.consumable_lot_id]);
    }
    await db.run("UPDATE consumables SET quantity=quantity+?, updated_at=to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id=?", [row.quantity, row.consumable_id]);
    await db.run("INSERT INTO consumable_stock_movements (consumable_id, movement_type, quantity, notes, movement_date) VALUES (?, 'Entrada', ?, ?, ?)", [row.consumable_id, row.quantity, `Estorno do consumo do atendimento #${appointmentId}: ${reason}`, localTimestamp()]);
    await db.run("UPDATE appointment_consumptions SET reversed_at=now(), reversed_by_user_id=?, reversal_reason=? WHERE id=?", [userId, String(reason || "").trim(), row.id]);
  }
  return rows.length;
}
