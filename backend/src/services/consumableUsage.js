import { localTimestamp } from "./utils.js";

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} deve ser um número inteiro positivo.`);
  return number;
}

export async function serviceRecipe(db, serviceId) {
  return db.all(`
    SELECT r.*, i.name AS inventory_item_name, i.stock_unit,
      i.quantity AS available_quantity, i.status AS inventory_item_status,
      i.track_stock, i.track_lots
      FROM service_inventory_recipes r
      JOIN jewelry_inventory i ON i.id=r.inventory_item_id
     WHERE r.service_id=?
     ORDER BY i.name, r.id
  `, [serviceId]);
}

export async function replaceServiceRecipe(db, serviceId, rawItems = []) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const seen = new Set();
  const normalized = items.map((item, index) => {
    const inventoryItemId = positiveInteger(item?.inventory_item_id ?? item?.consumable_id, `Item ${index + 1}`);
    if (seen.has(inventoryItemId)) throw new Error("Um item só pode aparecer uma vez na ficha técnica.");
    seen.add(inventoryItemId);
    return { inventoryItemId, quantity: positiveInteger(item?.quantity, `Quantidade do item ${index + 1}`), notes: String(item?.notes || "").trim() };
  });
  await db.transaction(async (tx) => {
    const service = await tx.get("SELECT id FROM services WHERE id=? FOR UPDATE", [serviceId]);
    if (!service) throw new Error("Serviço não encontrado.");
    for (const item of normalized) {
      const inventoryItem = await tx.get("SELECT id,status,can_use_in_service FROM jewelry_inventory WHERE id=? FOR UPDATE", [item.inventoryItemId]);
      if (!inventoryItem || inventoryItem.status === "arquivado" || !inventoryItem.can_use_in_service) {
        throw new Error(`Item ${item.inventoryItemId} não está disponível para procedimentos.`);
      }
    }
    await tx.run("DELETE FROM service_inventory_recipes WHERE service_id=?", [serviceId]);
    for (const item of normalized) {
      await tx.run(
        "INSERT INTO service_inventory_recipes (service_id, inventory_item_id, quantity, notes) VALUES (?, ?, ?, ?)",
        [serviceId, item.inventoryItemId, item.quantity, item.notes]
      );
    }
  });
  return serviceRecipe(db, serviceId);
}

export async function consumeAppointmentRecipe(db, appointmentId, userId = null) {
  const appointment = await db.get("SELECT id,service_id FROM appointments WHERE id=? FOR UPDATE", [appointmentId]);
  if (!appointment?.service_id) return [];
  const recipes = await serviceRecipe(db, appointment.service_id);
  const applied = [];
  for (const recipe of recipes) {
    const existing = await db.get(
      "SELECT id FROM appointment_consumptions WHERE appointment_id=? AND inventory_item_id=? AND source='service_recipe' AND reversed_at IS NULL",
      [appointmentId, recipe.inventory_item_id]
    );
    if (existing) continue;
    const item = await db.get("SELECT * FROM jewelry_inventory WHERE id=? FOR UPDATE", [recipe.inventory_item_id]);
    if (!item || item.status === "arquivado" || !item.can_use_in_service) throw new Error(`Item da ficha técnica indisponível: ${recipe.inventory_item_name}.`);
    if (item.track_stock && Number(item.quantity) < Number(recipe.quantity)) throw new Error(`Estoque insuficiente de ${item.name} para concluir o atendimento.`);
    const consumed = await db.run(
      `INSERT INTO appointment_consumptions (appointment_id, service_id, inventory_item_id, quantity, source, notes, consumed_by_user_id)
       VALUES (?, ?, ?, ?, 'service_recipe', ?, ?) RETURNING id`,
      [appointmentId, appointment.service_id, recipe.inventory_item_id, recipe.quantity, recipe.notes || `Ficha técnica do serviço #${appointment.service_id}`, userId]
    );
    if (item.track_stock) {
      let remaining = Number(recipe.quantity);
      if (item.track_lots) {
        const lots = await db.all(`SELECT * FROM inventory_item_lots
          WHERE inventory_item_id=? AND active=true AND remaining_quantity>0
          ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date NULLS LAST, id FOR UPDATE`, [item.id]);
        for (const lot of lots) {
          if (!remaining) break;
          const allocated = Math.min(remaining, Number(lot.remaining_quantity));
          await db.run("UPDATE inventory_item_lots SET remaining_quantity=remaining_quantity-?,updated_at=now() WHERE id=?", [allocated, lot.id]);
          await db.run("INSERT INTO inventory_item_lot_allocations (appointment_consumption_id,inventory_item_lot_id,quantity) VALUES (?,?,?)", [consumed.returnedId, lot.id, allocated]);
          remaining -= allocated;
        }
        if (remaining > 0) throw new Error(`Lotes insuficientes de ${item.name}.`);
      }
      await db.run("UPDATE jewelry_inventory SET quantity=quantity-?,updated_at=? WHERE id=?", [recipe.quantity, localTimestamp(), item.id]);
      await db.run("INSERT INTO stock_movements (jewelry_id,movement_type,quantity,notes,movement_date) VALUES (?,'Saida',?,?,?)", [item.id, recipe.quantity, `Consumo automático do atendimento #${appointmentId}`, localTimestamp()]);
    }
    applied.push({ inventory_item_id: item.id, quantity: recipe.quantity });
  }
  return applied;
}

export async function restoreAppointmentConsumptions(db, appointmentId, userId = null, reason = "Reabertura ou cancelamento do atendimento") {
  const rows = await db.all("SELECT * FROM appointment_consumptions WHERE appointment_id=? AND reversed_at IS NULL FOR UPDATE", [appointmentId]);
  for (const row of rows) {
    const item = await db.get("SELECT id,track_stock FROM jewelry_inventory WHERE id=? FOR UPDATE", [row.inventory_item_id]);
    if (!item) continue;
    if (item.track_stock) {
      const allocations = await db.all("SELECT * FROM inventory_item_lot_allocations WHERE appointment_consumption_id=? FOR UPDATE", [row.id]);
      for (const allocation of allocations) {
        await db.run("UPDATE inventory_item_lots SET remaining_quantity=LEAST(received_quantity,remaining_quantity+?),updated_at=now() WHERE id=?", [allocation.quantity, allocation.inventory_item_lot_id]);
      }
      await db.run("UPDATE jewelry_inventory SET quantity=quantity+?,updated_at=? WHERE id=?", [row.quantity, localTimestamp(), item.id]);
      await db.run("INSERT INTO stock_movements (jewelry_id,movement_type,quantity,notes,movement_date) VALUES (?,'Entrada',?,?,?)", [item.id, row.quantity, `Estorno do consumo do atendimento #${appointmentId}: ${reason}`, localTimestamp()]);
    }
    await db.run("UPDATE appointment_consumptions SET reversed_at=now(),reversed_by_user_id=?,reversal_reason=? WHERE id=?", [userId, String(reason || "").trim(), row.id]);
  }
  return rows.length;
}
