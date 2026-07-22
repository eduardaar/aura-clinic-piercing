// Serviços de vendas (pedidos avulsos e vinculados a atendimentos).
import { normalizeSalesOrderItems, variantStatus } from "./utils.js";
import { upsertClient } from "./appointments.js";
import { syncProductInventory } from "./inventory.js";

async function deductSoldProductStock(db, item, orderId) {
  if (item.item_type !== "produto" || !item.product_id) return;
  const quantity = Number(item.quantity || 1);
  let variantId = item.product_variant_id;
  if (!variantId) {
    const firstAvailable = await db.get(
      "SELECT id FROM jewelry_variants WHERE jewelry_id = ? AND is_active = 1 AND quantity > 0 ORDER BY id LIMIT 1",
      [item.product_id]
    );
    variantId = firstAvailable?.id;
  }
  if (variantId) {
    const variant = await db.get("SELECT * FROM jewelry_variants WHERE id = ?", [variantId]);
    if (!variant) return;
    const nextQuantity = Math.max(0, Number(variant.quantity || 0) - quantity);
    await db.run(
      "UPDATE jewelry_variants SET quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [nextQuantity, variantStatus(nextQuantity, variant.low_stock_threshold), variantId]
    );
    await db.run(
      "INSERT INTO stock_movements (jewelry_id, variant_id, movement_type, quantity, notes) VALUES (?, ?, 'Saida', ?, ?)",
      [item.product_id, variantId, quantity, `Baixa automatica da venda #${orderId}`]
    );
    await syncProductInventory(db, item.product_id);
    return;
  }

  const product = await db.get("SELECT * FROM jewelry_inventory WHERE id = ?", [item.product_id]);
  if (!product) return;
  const nextQuantity = Math.max(0, Number(product.quantity || 0) - quantity);
  await db.run(
    "UPDATE jewelry_inventory SET quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [nextQuantity, variantStatus(nextQuantity, product.low_stock_threshold), item.product_id]
  );
  await db.run(
    "INSERT INTO stock_movements (jewelry_id, movement_type, quantity, notes) VALUES (?, 'Saida', ?, ?)",
    [item.product_id, quantity, `Baixa automatica da venda #${orderId}`]
  );
}

export async function createSalesOrder(db, body, user) {
  const items = normalizeSalesOrderItems(body.items || []);
  if (!items.length) return null;
  const fullName = String(body.full_name || body.customer_name || body.name || "").trim();
  const whatsapp = String(body.whatsapp || "").trim();
  if (!fullName || !whatsapp) return null;

  const client = await upsertClient(db, {
    client_id: body.client_id,
    full_name: fullName,
    whatsapp,
    instagram: body.instagram || "",
    birth_date: body.birth_date || "",
    client_notes: body.notes || body.client_notes || ""
  });
  if (!client?.id) return null;

  const total = items.reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 1), 0);
  const orderType = String(body.order_type || "produto");
  const source = String(body.source || "site");
  const status = String(body.status || "concluida");
  const result = await db.run(
    `INSERT INTO sales_orders
    (client_id, appointment_id, order_type, source, status, payment_method, total_value, notes, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      client.id,
      body.appointment_id ? Number(body.appointment_id) : null,
      orderType,
      source,
      status,
      body.payment_method || "Pix",
      total,
      body.notes || "",
      user?.id || null
    ]
  );

  for (const item of items) {
    await db.run(
      `INSERT INTO sales_order_items (sales_order_id, item_type, product_id, product_variant_id, service_id, item_name, quantity, unit_price, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        result.lastID,
        item.item_type || "produto",
        item.product_id ? Number(item.product_id) : null,
        item.product_variant_id ? Number(item.product_variant_id) : null,
        item.service_id ? Number(item.service_id) : null,
        item.item_name,
        Number(item.quantity || 1),
        Number(item.unit_price || 0),
        item.notes || ""
      ]
    );
    if (status !== "cancelada") await deductSoldProductStock(db, item, result.lastID);
  }

  if (total > 0) {
    await db.run(
      "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        body.appointment_id ? Number(body.appointment_id) : null,
        client.id,
        total,
        orderType,
        body.payment_method || "Pix",
        status === "cancelada" ? "pendente" : "pago",
        new Date().toISOString().slice(0, 19)
      ]
    );
  }

  return (await listSalesOrders(db)).find((item) => item.id === result.lastID) || null;
}

export async function ensureSalesOrderForAppointment(db, appointmentId, user) {
  const existing = await db.get(
    "SELECT id FROM sales_orders WHERE appointment_id = ? AND order_type = 'ordem_servico' LIMIT 1",
    [appointmentId]
  );
  if (existing) return (await listSalesOrders(db)).find((item) => item.id === existing.id) || null;

  const appointment = await db.get(`
    SELECT
      a.*,
      c.full_name,
      c.whatsapp,
      c.instagram,
      s.name AS service_name,
      s.price AS service_price,
      j.name AS jewelry_name,
      j.sale_value AS jewelry_sale_value,
      v.variation_name AS variant_name,
      v.sale_value AS variant_sale_value
    FROM appointments a
    JOIN clients c ON c.id = a.client_id
    LEFT JOIN services s ON s.id = a.service_id
    LEFT JOIN jewelry_inventory j ON j.id = a.jewelry_id
    LEFT JOIN jewelry_variants v ON v.id = a.jewelry_variant_id
    WHERE a.id = ?
  `, [appointmentId]);
  if (!appointment) return null;

  const appointmentItems = await db.all(`
    SELECT ai.*, s.name AS service_name, p.name AS procedure_name,
      j.name AS jewelry_name, v.variation_name AS variant_name
    FROM appointment_items ai
    LEFT JOIN services s ON s.id = ai.service_id
    LEFT JOIN procedures p ON p.id = ai.procedure_id
    LEFT JOIN jewelry_inventory j ON j.id = ai.jewelry_id
    LEFT JOIN jewelry_variants v ON v.id = ai.jewelry_variant_id
    WHERE ai.appointment_id = ?
    ORDER BY ai.id
  `, [appointmentId]);
  const fallbackServiceValue = Number(appointment.service_price || 0);
  const fallbackProductValue = appointment.jewelry_id ? Number(appointment.variant_sale_value || appointment.jewelry_sale_value || 0) : 0;
  const total = appointmentItems.length
    ? appointmentItems.reduce((sum, item) => sum + Number(item.procedure_price || 0) + Number(item.jewelry_unit_price || 0) * Number(item.quantity || 1), 0)
    : fallbackServiceValue + fallbackProductValue;
  const result = await db.run(
    `INSERT INTO sales_orders
    (client_id, appointment_id, order_type, source, status, payment_method, total_value, notes, created_by_user_id)
    VALUES (?, ?, 'ordem_servico', 'agenda', 'concluida', ?, ?, ?, ?)`,
    [
      appointment.client_id,
      appointment.id,
      appointment.remaining_payment_method || appointment.deposit_payment_method || "Pix",
      total,
      `Ordem gerada automaticamente ao finalizar o atendimento #${appointment.id}`,
      user?.id || null
    ]
  );

  if (appointmentItems.length) {
    for (const item of appointmentItems) {
      if (Number(item.procedure_price || 0) > 0 || item.service_id || item.procedure_id) {
        await db.run(
          `INSERT INTO sales_order_items (sales_order_id, item_type, service_id, item_name, quantity, unit_price, notes)
           VALUES (?, 'servico', ?, ?, 1, ?, ?)`,
          [
            result.lastID,
            item.service_id || null,
            item.procedure_name || item.service_name || appointment.procedure || "Atendimento",
            Number(item.procedure_price || 0),
            item.region || ""
          ]
        );
      }
      if (item.jewelry_id) {
        await db.run(
          `INSERT INTO sales_order_items (sales_order_id, item_type, product_id, product_variant_id, item_name, quantity, unit_price, notes)
           VALUES (?, 'produto', ?, ?, ?, ?, ?, ?)`,
          [
            result.lastID,
            item.jewelry_id,
            item.jewelry_variant_id || null,
            item.variant_name ? `${item.jewelry_name} - ${item.variant_name}` : item.jewelry_name,
            Number(item.quantity || 1),
            Number(item.jewelry_unit_price || 0),
            "Joia vinculada ao atendimento"
          ]
        );
      }
    }
  } else {
    await db.run(
      `INSERT INTO sales_order_items (sales_order_id, item_type, service_id, item_name, quantity, unit_price, notes)
       VALUES (?, 'servico', ?, ?, 1, ?, ?)`,
      [
        result.lastID,
        appointment.service_id || null,
        appointment.service_name || appointment.procedure || "Atendimento",
        fallbackServiceValue,
        appointment.piercing_region || ""
      ]
    );

    if (appointment.jewelry_id) {
      await db.run(
      `INSERT INTO sales_order_items (sales_order_id, item_type, product_id, product_variant_id, item_name, quantity, unit_price, notes)
       VALUES (?, 'produto', ?, ?, ?, 1, ?, ?)`,
        [
          result.lastID,
          appointment.jewelry_id,
          appointment.jewelry_variant_id || null,
          appointment.variant_name ? `${appointment.jewelry_name} - ${appointment.variant_name}` : appointment.jewelry_name,
          fallbackProductValue,
          "Joia vinculada ao atendimento"
        ]
      );
    }
  }

  return (await listSalesOrders(db)).find((item) => item.id === result.lastID) || null;
}

export async function listSalesOrders(db) {
  const orders = await db.all(`
    SELECT
      so.*,
      c.full_name,
      c.whatsapp,
      c.instagram,
      a.procedure AS appointment_procedure,
      a.appointment_date,
      a.appointment_time
    FROM sales_orders so
    JOIN clients c ON c.id = so.client_id
    LEFT JOIN appointments a ON a.id = so.appointment_id
    ORDER BY so.created_at DESC, so.id DESC
    LIMIT 120
  `);
  const ids = orders.map((item) => item.id);
  const items = ids.length ? await db.all(`
    SELECT *
    FROM sales_order_items
    WHERE sales_order_id IN (${ids.map(() => "?").join(",")})
    ORDER BY id
  `, ids) : [];
  const grouped = items.reduce((acc, item) => {
    acc[item.sales_order_id] ||= [];
    acc[item.sales_order_id].push(item);
    return acc;
  }, {});
  return orders.map((order) => ({ ...order, items: grouped[order.id] || [] }));
}
