// Serviços de vendas (pedidos avulsos e vinculados a atendimentos).
import { normalizeSalesOrderItems } from "./utils.js";
import { upsertClient } from "./appointments.js";

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
      `INSERT INTO sales_order_items (sales_order_id, item_type, product_id, service_id, item_name, quantity, unit_price, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        result.lastID,
        item.item_type || "produto",
        item.product_id ? Number(item.product_id) : null,
        item.service_id ? Number(item.service_id) : null,
        item.item_name,
        Number(item.quantity || 1),
        Number(item.unit_price || 0),
        item.notes || ""
      ]
    );
  }

  if (total > 0) {
    await db.run(
      "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        body.appointment_id ? Number(body.appointment_id) : result.lastID,
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
