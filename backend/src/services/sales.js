// Serviços de vendas (pedidos avulsos e vinculados a atendimentos).
import { normalizeSalesOrderItems, variantStatus, localTimestamp } from "./utils.js";
import { upsertClient } from "./appointments.js";
import { syncProductInventory } from "./inventory.js";
import { limitOffset, countRows } from "./pagination.js";
import { validateCoupon } from "./discounts.js";
import { availableStock, releaseExpiredReservations } from "./reservations.js";

export class SalesOrderValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function authoritativePublicItems(db, submitted) {
  const items = [];
  for (const raw of submitted) {
    const productId = Number(raw.product_id || 0);
    let variantId = Number(raw.product_variant_id || 0) || null;
    const quantity = Number(raw.quantity || 0);
    if (!Number.isInteger(quantity) || quantity < 1) throw new SalesOrderValidationError("Quantidade inválida.");
    const product = await db.get("SELECT id,name,category,sale_value,status,is_catalog_active,is_published FROM jewelry_inventory WHERE id=?", [productId]);
    if (!product || Number(product.is_catalog_active) !== 1 || Number(product.is_published) !== 1 || product.status === "arquivado") {
      throw new SalesOrderValidationError("Produto indisponível.", 409);
    }
    if (!variantId) {
      const variants = await db.all("SELECT id FROM jewelry_variants WHERE jewelry_id=? AND is_active=1 AND quantity>0 ORDER BY id", [productId]);
      if (variants.length === 1) variantId = variants[0].id;
      else if (variants.length > 1) throw new SalesOrderValidationError("Selecione a variação do produto.");
    }
    const variant = variantId
      ? await db.get("SELECT id,jewelry_id,variation_name,sale_value,quantity,is_active,status FROM jewelry_variants WHERE id=? AND jewelry_id=?", [variantId, productId])
      : null;
    if (variantId && (!variant || Number(variant.is_active) !== 1 || variant.status === "esgotado")) {
      throw new SalesOrderValidationError("Variação indisponível.", 409);
    }
    const available = await availableStock(db, productId, variantId);
    if (available === null || available < quantity) throw new SalesOrderValidationError("Estoque insuficiente para este item.", 409);
    const unitPrice = Number(variant?.sale_value || product.sale_value || 0);
    items.push({
      ...raw,
      product_id: productId,
      product_variant_id: variantId,
      item_name: variant?.variation_name ? `${product.name} - ${variant.variation_name}` : product.name,
      category: product.category,
      quantity,
      unit_price: unitPrice
    });
  }
  return items;
}

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
  const submittedItems = normalizeSalesOrderItems(body.items || []);
  const publicOrder = !user;
  if (publicOrder && !body.accepted_policies) throw new SalesOrderValidationError("É necessário aceitar as políticas.");
  if (publicOrder && body.fulfillment_method === "delivery" && !String(body.delivery_address || "").trim()) {
    throw new SalesOrderValidationError("Informe o endereço de entrega.");
  }
  const items = publicOrder ? await authoritativePublicItems(db, submittedItems) : submittedItems;
  if (!items.length) return null;
  const fullName = String(body.full_name || body.customer_name || body.name || "").trim();
  const whatsapp = String(body.whatsapp || "").trim();
  if (!fullName || !whatsapp) return null;

  const subtotal = Number(items.reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 1), 0).toFixed(2));
  let couponQuote = null;
  if (body.coupon_code) {
    couponQuote = await validateCoupon(db, body.coupon_code, { amount: subtotal, items });
    if (!couponQuote.valid) throw new SalesOrderValidationError(couponQuote.error);
  }
  const discount = Number(couponQuote?.discount_amount || 0);
  const total = Number(Math.max(subtotal - discount, 0).toFixed(2));
  const orderType = String(body.order_type || "produto");
  const source = String(body.source || "site");
  // Chamadas públicas nunca podem escolher um estado financeiro conclusivo.
  // Pagamento só é confirmado por um usuário autenticado (ou, futuramente,
  // pelo webhook autenticado do gateway).
  const status = user ? String(body.status || "concluida") : "pendente";
  const idempotencyKey = publicOrder ? String(body.idempotency_key || "").trim().slice(0, 100) : "";
  if (idempotencyKey) {
    const existing = await db.get("SELECT id FROM sales_orders WHERE idempotency_key=?", [idempotencyKey]);
    if (existing) return getSalesOrder(db, existing.id);
  }

  // Cliente, pedido, itens, baixa de estoque e pagamento são uma coisa só:
  // metade disso gravado deixaria estoque baixado sem venda (ou venda sem
  // pagamento) e o financeiro do dia não fecharia.
  const orderId = await db.transaction(async (tx) => {
    const client = await upsertClient(tx, {
      client_id: body.client_id,
      full_name: fullName,
      whatsapp,
      instagram: body.instagram || "",
      birth_date: body.birth_date || "",
      client_notes: body.notes || body.client_notes || ""
    });
    if (!client?.id) return null;

    const result = await tx.run(
      `INSERT INTO sales_orders
      (client_id, appointment_id, order_type, source, status, payment_method, subtotal_value, discount_value,
       total_value, coupon_id, coupon_code, coupon_snapshot, fulfillment_method, delivery_address,
       customer_email, customer_cpf, accepted_policies_at, idempotency_key, notes, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        client.id,
        body.appointment_id ? Number(body.appointment_id) : null,
        orderType,
        source,
        status,
        body.payment_method || "Pix",
        subtotal,
        discount,
        total,
        couponQuote?.coupon?.id || null,
        couponQuote?.coupon?.code || null,
        couponQuote ? JSON.stringify(couponQuote) : null,
        body.fulfillment_method === "delivery" ? "delivery" : "pickup",
        body.fulfillment_method === "delivery" ? String(body.delivery_address || "") : null,
        String(body.email || "") || null,
        String(body.cpf || "") || null,
        body.accepted_policies ? localTimestamp() : null,
        idempotencyKey || null,
        body.notes || "",
        user?.id || null
      ]
    );

    for (const item of items) {
      await tx.run(
        `INSERT INTO sales_order_items (sales_order_id, item_type, product_id, product_variant_id, service_id, item_name, quantity, unit_price, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.returnedId,
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
      if (publicOrder && item.product_id) {
        await releaseExpiredReservations(tx);
        if (item.product_variant_id) await tx.get("SELECT id FROM jewelry_variants WHERE id=? FOR UPDATE", [item.product_variant_id]);
        else await tx.get("SELECT id FROM jewelry_inventory WHERE id=? FOR UPDATE", [item.product_id]);
        const available = await availableStock(tx, item.product_id, item.product_variant_id || null);
        if (available === null || available < Number(item.quantity)) throw new SalesOrderValidationError("Estoque esgotado durante a finalização.", 409);
        await tx.run(
          `INSERT INTO inventory_reservations
           (reservation_key, sales_order_id, client_id, jewelry_id, jewelry_variant_id, quantity, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP + INTERVAL '30 minutes')`,
          [`order-${result.returnedId}-${item.product_id}-${item.product_variant_id || 0}`, result.returnedId, client.id, item.product_id, item.product_variant_id || null, item.quantity]
        );
      }
      if (status === "concluida" || status === "pago") {
        await deductSoldProductStock(tx, item, result.returnedId);
      }
    }

    if (total > 0 && (status === "concluida" || status === "pago")) {
      await tx.run(
        "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          body.appointment_id ? Number(body.appointment_id) : null,
          client.id,
          total,
          orderType,
          body.payment_method || "Pix",
          "pago",
          localTimestamp()
        ]
      );
    }
    return result.returnedId;
  });

  if (!orderId) return null;
  return getSalesOrder(db, orderId);
}

export async function ensureSalesOrderForAppointment(db, appointmentId, user) {
  const existing = await db.get(
    "SELECT id FROM sales_orders WHERE appointment_id = ? AND order_type = 'ordem_servico' LIMIT 1",
    [appointmentId]
  );
  if (existing) return getSalesOrder(db, existing.id);

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
    VALUES (?, ?, 'ordem_servico', 'agenda', 'concluida', ?, ?, ?, ?) RETURNING id`,
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
            result.returnedId,
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
            result.returnedId,
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
        result.returnedId,
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
          result.returnedId,
          appointment.jewelry_id,
          appointment.jewelry_variant_id || null,
          appointment.variant_name ? `${appointment.jewelry_name} - ${appointment.variant_name}` : appointment.jewelry_name,
          fallbackProductValue,
          "Joia vinculada ao atendimento"
        ]
      );
    }
  }

  return getSalesOrder(db, result.returnedId);
}

const SALES_ORDER_COLUMNS = `
  so.*,
  c.full_name,
  c.whatsapp,
  c.instagram,
  a.procedure AS appointment_procedure,
  a.appointment_date,
  a.appointment_time
`;

const SALES_ORDER_FROM = `
  sales_orders so
  JOIN clients c ON c.id = so.client_id
  LEFT JOIN appointments a ON a.id = so.appointment_id
`;

// Carrega os itens de um lote de pedidos numa query só (evita N+1).
async function attachSalesOrderItems(db, orders) {
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

// Busca DIRETA por id. Existe para não depender de "listar tudo e procurar":
// com a lista paginada o pedido recém-criado pode nem estar na primeira página.
export async function getSalesOrder(db, id) {
  const order = await db.get(
    `SELECT ${SALES_ORDER_COLUMNS} FROM ${SALES_ORDER_FROM} WHERE so.id = ?`,
    [id]
  );
  if (!order) return null;
  return (await attachSalesOrderItems(db, [order]))[0];
}

export async function listSalesOrders(db, { where = "", params = [], paging = null } = {}) {
  const page = limitOffset(paging);
  const orderBy = paging?.orderBy || "ORDER BY so.created_at DESC, so.id DESC";
  const orders = await db.all(
    `SELECT ${SALES_ORDER_COLUMNS} FROM ${SALES_ORDER_FROM} ${where} ${orderBy}${page.clause}`,
    [...params, ...page.params]
  );
  return attachSalesOrderItems(db, orders);
}

export async function countSalesOrders(db, { where = "", params = [] } = {}) {
  return countRows(db, { from: SALES_ORDER_FROM, where, params });
}
