import { localTimestamp } from "./utils.js";
import { syncProductInventory } from "./inventory.js";
import { availableStock } from "./reservations.js";

export async function procedureKits(db, includeCost = false) {
  const rows =
    await db.all(`SELECT r.*,s.name AS service_name,s.inventory_kit_name,i.name AS material_name,i.quantity AS stock_quantity,
    i.track_stock,i.track_lots,COALESCE(v.cost_value,i.cost_value) AS unit_cost,i.status,v.quantity AS variant_quantity
    FROM service_inventory_recipes r JOIN services s ON s.id=r.service_id
    JOIN jewelry_inventory i ON i.id=r.inventory_item_id LEFT JOIN jewelry_variants v ON v.id=r.inventory_variant_id
    WHERE s.is_active=true ORDER BY s.name,r.id`);
  const kits = new Map();
  for (const row of rows) {
    let kit = kits.get(row.service_id);
    if (!kit) {
      kit = {
        id: row.service_id,
        name: row.inventory_kit_name || `Kit de ${row.service_name}`,
        service_name: row.service_name,
        components: 0,
        available_kits: null,
        cost_value: includeCost ? 0 : null,
      };
      kits.set(row.service_id, kit);
    }
    kit.components += 1;
    if (row.auto_consume && row.usage_stage !== "reusable") {
      if (includeCost) kit.cost_value += Number(row.quantity) * Number(row.unit_cost);
      if (row.is_required && row.track_stock) {
        let available =
          row.status === "arquivado" ? 0 : await availableStock(db, row.inventory_item_id, row.inventory_variant_id);
        if (row.track_lots) {
          const lots = await db.get(
            "SELECT COALESCE(SUM(remaining_quantity),0) AS quantity FROM inventory_item_lots WHERE inventory_item_id=? AND active=true AND (expiry_date IS NULL OR expiry_date>=CURRENT_DATE)",
            [row.inventory_item_id],
          );
          available = Math.min(available, Number(lots.quantity));
        }
        const count = Math.floor(available / Number(row.quantity));
        kit.available_kits = kit.available_kits === null ? count : Math.min(kit.available_kits, count);
      }
    }
  }
  return [...kits.values()].map((kit) => ({
    ...kit,
    cost_value: kit.cost_value == null ? null : Math.round(kit.cost_value * 100) / 100,
  }));
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} deve ser um número inteiro positivo.`);
  return number;
}

export async function serviceRecipe(db, serviceId) {
  return db.all(
    `
    SELECT r.*, i.name AS inventory_item_name, i.stock_unit,
      i.quantity AS available_quantity, i.status AS inventory_item_status,
      i.track_stock, i.track_lots, v.quantity AS variant_quantity, v.variation_name
      FROM service_inventory_recipes r
      JOIN jewelry_inventory i ON i.id=r.inventory_item_id
      LEFT JOIN jewelry_variants v ON v.id=r.inventory_variant_id
     WHERE r.service_id=?
     ORDER BY i.name, r.id
  `,
    [serviceId],
  );
}

export async function replaceServiceRecipe(db, serviceId, rawItems = []) {
  if (!Array.isArray(rawItems)) throw new Error("Informe a lista de materiais do kit.");
  const items = Array.isArray(rawItems) ? rawItems : [];
  const seen = new Set();
  const normalized = items.map((item, index) => {
    const inventoryItemId = positiveInteger(item?.inventory_item_id ?? item?.consumable_id, `Item ${index + 1}`);
    if (seen.has(inventoryItemId)) throw new Error("Um item só pode aparecer uma vez na ficha técnica.");
    seen.add(inventoryItemId);
    const stage = item.usage_stage || "procedure";
    if (!["procedure", "preparation", "sterilization", "hygiene", "reusable"].includes(stage))
      throw new Error("Finalidade do material inválida.");
    return {
      inventoryItemId,
      quantity: positiveInteger(item?.quantity, `Quantidade do item ${index + 1}`),
      notes: String(item?.notes || "").trim(),
      required: item.is_required !== false,
      stage,
      auto: stage !== "reusable" && item.auto_consume !== false,
      variantId: Number(item.inventory_variant_id || 0) || null,
    };
  });
  await db.transaction(async (tx) => {
    const service = await tx.get("SELECT id FROM services WHERE id=? FOR UPDATE", [serviceId]);
    if (!service) throw new Error("Serviço não encontrado.");
    for (const item of normalized) {
      const inventoryItem = await tx.get(
        "SELECT id,status,can_use_in_service FROM jewelry_inventory WHERE id=? FOR UPDATE",
        [item.inventoryItemId],
      );
      if (!inventoryItem || inventoryItem.status === "arquivado" || !inventoryItem.can_use_in_service) {
        throw new Error(`Item ${item.inventoryItemId} não está disponível para procedimentos.`);
      }
      if (
        item.variantId &&
        !(await tx.get("SELECT id FROM jewelry_variants WHERE id=? AND jewelry_id=? AND is_active=1", [
          item.variantId,
          item.inventoryItemId,
        ]))
      )
        throw new Error("Variação do material não encontrada.");
      if (
        !item.variantId &&
        Number(
          (
            await tx.get("SELECT COUNT(*) AS count FROM jewelry_variants WHERE jewelry_id=? AND is_active=1", [
              item.inventoryItemId,
            ])
          ).count,
        ) > 1
      )
        throw new Error("Escolha a variação do material na composição do kit.");
    }
    await tx.run("DELETE FROM service_inventory_recipes WHERE service_id=?", [serviceId]);
    for (const item of normalized) {
      await tx.run(
        "INSERT INTO service_inventory_recipes (service_id, inventory_item_id, quantity, notes,is_required,usage_stage,auto_consume,inventory_variant_id) VALUES (?, ?, ?, ?,?,?,?,?)",
        [
          serviceId,
          item.inventoryItemId,
          item.quantity,
          item.notes,
          item.required,
          item.stage,
          item.auto,
          item.variantId,
        ],
      );
    }
  });
  return serviceRecipe(db, serviceId);
}

export async function appointmentRecipePreview(db, appointmentId, serviceIds = null) {
  const appointment = await db.get("SELECT id,service_id FROM appointments WHERE id=?", [appointmentId]);
  if (!appointment) return [];
  const lines = await db.all(
    "SELECT service_id,quantity FROM appointment_items WHERE appointment_id=? AND service_id IS NOT NULL",
    [appointmentId],
  );
  const services = serviceIds
    ? serviceIds.map((service_id) => ({ service_id }))
    : lines.length
      ? lines
      : appointment.service_id
        ? [{ service_id: appointment.service_id, quantity: 1 }]
        : [];
  const materials = new Map();
  for (const line of services)
    for (const recipe of await serviceRecipe(db, line.service_id)) {
      const existing = materials.get(Number(recipe.inventory_item_id));
      if (existing && Number(existing.inventory_variant_id || 0) !== Number(recipe.inventory_variant_id || 0))
        throw new Error(
          "Os procedimentos usam variações diferentes do mesmo material. Separe os atendimentos para conferir o consumo.",
        );
      // A row is one procedure; its quantity counts jewelry, not procedures.
      const quantity = Number(recipe.quantity);
      if (existing) {
        existing.quantity += quantity;
        existing.is_required ||= recipe.is_required;
      } else materials.set(Number(recipe.inventory_item_id), { ...recipe, quantity });
    }
  return [...materials.values()];
}

export async function consumeAppointmentRecipe(db, appointmentId, userId = null, actualConsumption) {
  const appointment = await db.get(
    "SELECT id,service_id,consumption_confirmed_at FROM appointments WHERE id=? FOR UPDATE",
    [appointmentId],
  );
  if (!appointment) return [];
  if (appointment.consumption_confirmed_at)
    return db.all(
      "SELECT inventory_item_id,quantity FROM appointment_consumptions WHERE appointment_id=? AND reversed_at IS NULL",
      [appointmentId],
    );
  const recipes = await appointmentRecipePreview(db, appointmentId);
  if (actualConsumption !== undefined && !Array.isArray(actualConsumption))
    throw new Error("Confira os materiais consumidos.");
  const overrides = new Map();
  for (const row of actualConsumption || []) {
    const id = Number(row.inventory_item_id);
    const quantity = Number(row.quantity);
    if (
      overrides.has(id) ||
      !recipes.some((recipe) => Number(recipe.inventory_item_id) === id) ||
      !Number.isInteger(quantity) ||
      quantity < 0
    )
      throw new Error("Quantidade ou material de consumo inválido.");
    overrides.set(id, quantity);
  }
  const applied = [];
  for (const recipe of recipes) {
    const existing = await db.get(
      "SELECT id FROM appointment_consumptions WHERE appointment_id=? AND inventory_item_id=? AND source='service_recipe' AND reversed_at IS NULL",
      [appointmentId, recipe.inventory_item_id],
    );
    if (existing) continue;
    const quantity = overrides.has(Number(recipe.inventory_item_id))
      ? overrides.get(Number(recipe.inventory_item_id))
      : recipe.auto_consume && recipe.is_required
        ? Number(recipe.quantity)
        : 0;
    if (recipe.usage_stage === "reusable" && quantity)
      throw new Error("Materiais reutilizáveis não têm baixa por consumo. Registre o processamento separadamente.");
    if (recipe.auto_consume && recipe.is_required && !quantity)
      throw new Error(`Confirme o consumo obrigatório de ${recipe.inventory_item_name}.`);
    if (!quantity) continue;
    recipe.quantity = quantity;
    const item = await db.get("SELECT * FROM jewelry_inventory WHERE id=? FOR UPDATE", [recipe.inventory_item_id]);
    if (!item || item.status === "arquivado" || !item.can_use_in_service)
      throw new Error(`Item da ficha técnica indisponível: ${recipe.inventory_item_name}.`);
    const variants = await db.all(
      "SELECT * FROM jewelry_variants WHERE jewelry_id=? AND is_active=1 ORDER BY id FOR UPDATE",
      [item.id],
    );
    const variant = recipe.inventory_variant_id
      ? variants.find((row) => Number(row.id) === Number(recipe.inventory_variant_id))
      : variants.length === 1
        ? variants[0]
        : null;
    if (variants.length > 1 && !variant) throw new Error(`Escolha a variação de ${item.name} na composição do kit.`);
    if (item.track_stock && (await availableStock(db, item.id, variant?.id || null)) < quantity)
      throw new Error(`Estoque disponível insuficiente de ${item.name} para o kit.`);
    if (item.track_stock && variant && Number(variant.quantity) < quantity)
      throw new Error(`Estoque insuficiente da variação de ${item.name}.`);
    if (item.track_stock && Number(item.quantity) < Number(recipe.quantity))
      throw new Error(`Estoque insuficiente de ${item.name} para concluir o atendimento.`);
    const consumed = await db.run(
      `INSERT INTO appointment_consumptions (appointment_id, service_id, inventory_item_id, quantity, source, notes, consumed_by_user_id,inventory_variant_id,unit_cost,usage_stage)
       VALUES (?, ?, ?, ?, 'service_recipe', ?, ?,?,?,?) RETURNING id`,
      [
        appointmentId,
        appointment.service_id,
        recipe.inventory_item_id,
        recipe.quantity,
        recipe.notes || `Kit do atendimento #${appointmentId}`,
        userId,
        variant?.id || null,
        variant?.cost_value ?? item.cost_value ?? 0,
        recipe.usage_stage,
      ],
    );
    if (item.track_stock) {
      let remaining = Number(recipe.quantity);
      if (item.track_lots) {
        const lots = await db.all(
          `SELECT * FROM inventory_item_lots
          WHERE inventory_item_id=? AND active=true AND remaining_quantity>0 AND (expiry_date IS NULL OR expiry_date>=CURRENT_DATE)
          ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date NULLS LAST, id FOR UPDATE`,
          [item.id],
        );
        for (const lot of lots) {
          if (!remaining) break;
          const allocated = Math.min(remaining, Number(lot.remaining_quantity));
          await db.run(
            "UPDATE inventory_item_lots SET remaining_quantity=remaining_quantity-?,updated_at=now() WHERE id=?",
            [allocated, lot.id],
          );
          await db.run(
            "INSERT INTO inventory_item_lot_allocations (appointment_consumption_id,inventory_item_lot_id,quantity) VALUES (?,?,?)",
            [consumed.returnedId, lot.id, allocated],
          );
          remaining -= allocated;
        }
        if (remaining > 0) throw new Error(`Lotes insuficientes de ${item.name}.`);
      }
      await db.run("UPDATE jewelry_inventory SET quantity=quantity-?,updated_at=? WHERE id=?", [
        recipe.quantity,
        localTimestamp(),
        item.id,
      ]);
      if (variant) {
        await db.run("UPDATE jewelry_variants SET quantity=quantity-? WHERE id=?", [quantity, variant.id]);
        await syncProductInventory(db, item.id);
      }
      await db.run(
        "INSERT INTO stock_movements (jewelry_id,variant_id,movement_type,quantity,notes,movement_date) VALUES (?,?,'Saida',?,?,?)",
        [
          item.id,
          variant?.id || null,
          recipe.quantity,
          `Consumo do atendimento #${appointmentId}, profissional responsável, ${recipe.usage_stage}`,
          localTimestamp(),
        ],
      );
    }
    applied.push({ inventory_item_id: item.id, quantity: recipe.quantity });
  }
  await db.run("UPDATE appointments SET consumption_confirmed_at=now() WHERE id=?", [appointmentId]);
  return applied;
}

export async function restoreAppointmentConsumptions(
  db,
  appointmentId,
  userId = null,
  reason = "Reabertura ou cancelamento do atendimento",
) {
  await db.run("UPDATE appointments SET consumption_confirmed_at=NULL WHERE id=?", [appointmentId]);
  const rows = await db.all(
    "SELECT * FROM appointment_consumptions WHERE appointment_id=? AND reversed_at IS NULL FOR UPDATE",
    [appointmentId],
  );
  for (const row of rows) {
    const item = await db.get("SELECT id,track_stock FROM jewelry_inventory WHERE id=? FOR UPDATE", [
      row.inventory_item_id,
    ]);
    if (!item) continue;
    if (item.track_stock) {
      const allocations = await db.all(
        "SELECT * FROM inventory_item_lot_allocations WHERE appointment_consumption_id=? FOR UPDATE",
        [row.id],
      );
      for (const allocation of allocations) {
        await db.run(
          "UPDATE inventory_item_lots SET remaining_quantity=LEAST(received_quantity,remaining_quantity+?),updated_at=now() WHERE id=?",
          [allocation.quantity, allocation.inventory_item_lot_id],
        );
      }
      await db.run("UPDATE jewelry_inventory SET quantity=quantity+?,updated_at=? WHERE id=?", [
        row.quantity,
        localTimestamp(),
        item.id,
      ]);
      if (row.inventory_variant_id) {
        await db.run("UPDATE jewelry_variants SET quantity=quantity+? WHERE id=?", [
          row.quantity,
          row.inventory_variant_id,
        ]);
        await syncProductInventory(db, item.id);
      }
      await db.run(
        "INSERT INTO stock_movements (jewelry_id,movement_type,quantity,notes,movement_date) VALUES (?,'Entrada',?,?,?)",
        [item.id, row.quantity, `Estorno do consumo do atendimento #${appointmentId}: ${reason}`, localTimestamp()],
      );
    }
    await db.run(
      "UPDATE appointment_consumptions SET reversed_at=now(),reversed_by_user_id=?,reversal_reason=? WHERE id=?",
      [userId, String(reason || "").trim(), row.id],
    );
  }
  return rows.length;
}
