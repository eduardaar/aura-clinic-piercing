// Serviços de vendas (pedidos avulsos e vinculados a atendimentos).
import { normalizeSalesOrderItems, variantStatus, localTimestamp } from "./utils.js";
import { upsertClient } from "./appointments.js";
import { syncProductInventory } from "./inventory.js";
import { limitOffset, countRows } from "./pagination.js";
import { validateCoupon } from "./discounts.js";
import { availableStock, releaseExpiredReservations } from "./reservations.js";
import {
  normalizeExplicitInstallments,
  normalizeInstallmentCount,
  normalizeReceivableMode,
  parseStoredInstallments,
  serializeInstallments,
  syncSalesOrderReceivables
} from "./receivables.js";

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

// Qual linha de estoque uma venda debita, e quanto ela tem.
//
// Espelha de propósito a escolha feita por `deductSoldProductStock`: sem
// variação informada a baixa cai na primeira variação ativa com saldo e, se o
// produto não tiver variação nenhuma, cai na própria linha de
// `jewelry_inventory`. Conferir saldo numa linha e debitar de outra deixaria a
// validação passar e o estoque negativo do mesmo jeito.
async function resolveStockTarget(db, item) {
  if (item.item_type !== "produto" || !item.product_id) return null;
  const productId = Number(item.product_id);
  let variantId = item.product_variant_id ? Number(item.product_variant_id) : null;
  if (!variantId) {
    const firstAvailable = await db.get(
      "SELECT id FROM jewelry_variants WHERE jewelry_id = ? AND is_active = 1 AND quantity > 0 ORDER BY id LIMIT 1",
      [productId]
    );
    variantId = firstAvailable?.id || null;
  }
  if (variantId) {
    const variant = await db.get(
      `SELECT v.id, v.quantity, v.variation_name, v.sku, j.name AS product_name
       FROM jewelry_variants v LEFT JOIN jewelry_inventory j ON j.id = v.jewelry_id
       WHERE v.id = ?`,
      [variantId]
    );
    if (!variant) return null;
    const variantLabel = variant.variation_name || variant.sku || "";
    return {
      key: `variant:${variant.id}`,
      available: Number(variant.quantity || 0),
      label: [variant.product_name, variantLabel].filter(Boolean).join(" - ")
    };
  }
  const product = await db.get("SELECT id, name, quantity FROM jewelry_inventory WHERE id = ?", [productId]);
  if (!product) return null;
  return { key: `product:${product.id}`, available: Number(product.quantity || 0), label: product.name || "" };
}

function insufficientStockError(name, requested, available) {
  const item = String(name || "").trim() || "este item";
  return new SalesOrderValidationError(
    `Estoque insuficiente para "${item}": a venda pede ${requested} un. e há ${available} un. disponível(is).`
  );
}

// Confere o estoque de TODOS os itens antes de a venda gravar qualquer coisa.
//
// Duas linhas do mesmo produto no mesmo pedido somam: 2 + 2 sobre um saldo de 3
// tem de ser recusado, e conferir linha a linha isoladamente deixaria passar.
export async function assertStockForSoldItems(db, items = []) {
  const requestedByTarget = new Map();
  for (const item of items) {
    const target = await resolveStockTarget(db, item);
    if (!target) continue;
    const requested = (requestedByTarget.get(target.key) || 0) + Math.max(1, Number(item.quantity || 1));
    requestedByTarget.set(target.key, requested);
    if (requested > target.available) {
      throw insufficientStockError(target.label || item.item_name, requested, target.available);
    }
  }
}

// Exportada porque a venda deixou de ser sempre paga no ato: quando o
// pagamento chega depois (webhook do gateway confirmando PIX), a baixa precisa
// acontecer NAQUELE momento, e não na criação do pedido.
//
// A baixa também é o último portão do estoque: se o saldo não cobre o item, ela
// LANÇA em vez de zerar o saldo. Isso inclui o caminho do webhook — pagamento
// confirmado sobre estoque que sumiu no meio do caminho é inconsistência que
// precisa aparecer, não ser silenciada com um `Math.max(0, ...)`.
export async function deductSoldProductStock(db, item, orderId) {
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
    const variant = await db.get("SELECT * FROM jewelry_variants WHERE id = ? FOR UPDATE", [variantId]);
    if (!variant) return;
    const nextQuantity = Number(variant.quantity || 0) - quantity;
    if (nextQuantity < 0) {
      throw insufficientStockError(item.item_name || variant.variation_name || variant.sku, quantity, Number(variant.quantity || 0));
    }
    const movement = item.id ? await db.run(
      `INSERT INTO stock_movements
        (jewelry_id, variant_id, movement_type, quantity, notes, sales_order_id, sales_order_item_id)
       VALUES (?, ?, 'Saida', ?, ?, ?, ?)
       ON CONFLICT DO NOTHING RETURNING id`,
      [item.product_id, variantId, quantity, `Baixa automatica da venda #${orderId}`, orderId, item.id]
    ) : await db.run(
      "INSERT INTO stock_movements (jewelry_id, variant_id, movement_type, quantity, notes) VALUES (?, ?, 'Saida', ?, ?) RETURNING id",
      [item.product_id, variantId, quantity, `Baixa automatica da venda #${orderId}`]
    );
    if (!movement.returnedId) return false;
    await db.run(
      "UPDATE jewelry_variants SET quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [nextQuantity, variantStatus(nextQuantity, variant.low_stock_threshold), variantId]
    );
    await syncProductInventory(db, item.product_id);
    return true;
  }

  const product = await db.get("SELECT * FROM jewelry_inventory WHERE id = ? FOR UPDATE", [item.product_id]);
  if (!product) return;
  const nextQuantity = Number(product.quantity || 0) - quantity;
  if (nextQuantity < 0) {
    throw insufficientStockError(item.item_name || product.name, quantity, Number(product.quantity || 0));
  }
  const movement = item.id ? await db.run(
    `INSERT INTO stock_movements
      (jewelry_id, movement_type, quantity, notes, sales_order_id, sales_order_item_id)
     VALUES (?, 'Saida', ?, ?, ?, ?)
     ON CONFLICT DO NOTHING RETURNING id`,
    [item.product_id, quantity, `Baixa automatica da venda #${orderId}`, orderId, item.id]
  ) : await db.run(
    "INSERT INTO stock_movements (jewelry_id, movement_type, quantity, notes) VALUES (?, 'Saida', ?, ?) RETURNING id",
    [item.product_id, quantity, `Baixa automatica da venda #${orderId}`]
  );
  if (!movement.returnedId) return false;
  await db.run(
    "UPDATE jewelry_inventory SET quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [nextQuantity, variantStatus(nextQuantity, product.low_stock_threshold), item.product_id]
  );
  return true;
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
  // "ordem_servico" é reservado ao título gerado sozinho por
  // ensureSalesOrderForAppointment ao concluir um atendimento da agenda —
  // essa função nunca passa por createSalesOrder, então nenhuma chamada
  // legítima chega aqui com este tipo. Bloquear evita que balcão/catálogo
  // criem manualmente um "atendimento" que na verdade não existiu na agenda,
  // a origem de duplicidade de baixa que este pacote corrige.
  if (orderType === "ordem_servico") {
    throw new SalesOrderValidationError("Ordem de serviço é gerada automaticamente pela agenda ao concluir um atendimento — não pode ser criada manualmente.");
  }
  if (orderType !== "produto" || items.some((item) => item.item_type !== "produto" || item.service_id)) {
    throw new SalesOrderValidationError("Vendas registram apenas produtos. Serviços são criados automaticamente ao finalizar um agendamento.");
  }
  const source = String(body.source || "site");
  const requestedOpenStatus = ["pendente", "aberta"].includes(String(body.status || ""));
  let receivableMode;
  let installmentCount;
  let explicitInstallments;
  try {
    explicitInstallments = normalizeExplicitInstallments(body.installments, {
      total,
      defaultPaymentMethod: body.payment_method || "Pix"
    });
    receivableMode = normalizeReceivableMode(
      body.receivable_mode,
      explicitInstallments || publicOrder || requestedOpenStatus ? "pending" : "paid"
    );
    if (explicitInstallments && receivableMode !== "pending") {
      throw new Error("Parcelas explícitas exigem recebimento pendente.");
    }
    installmentCount = explicitInstallments?.length || normalizeInstallmentCount(body.installment_count ?? 1);
  } catch (error) {
    throw new SalesOrderValidationError(error.message);
  }
  const firstDueDate = explicitInstallments?.[0]?.dueDate || String(body.first_due_date || localTimestamp().slice(0, 10));
  const paymentMethod = String(body.payment_method || explicitInstallments?.[0]?.paymentMethod || "Pix");
  const installmentsJson = explicitInstallments ? JSON.stringify(serializeInstallments(explicitInstallments)) : null;
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
    // Estoque é conferido ANTES da primeira escrita.
    //
    // O rollback já desfaria um erro lançado lá na baixa, mas conferir antes é
    // o que garante que nenhum id de cliente/pedido seja consumido à toa e que
    // a mensagem devolvida ao caixa fale do item, não da transação.
    //
    // O pedido público tem o portão próprio em `authoritativePublicItems` (e o
    // recheck sob `FOR UPDATE` mais abaixo), que enxerga também as reservas
    // ativas do catálogo — checar duas vezes só duplicaria a recusa.
    if (!publicOrder) await assertStockForSoldItems(tx, items);

    const client = await upsertClient(tx, {
      client_id: body.client_id,
      full_name: fullName,
      whatsapp,
      instagram: body.instagram || "",
      birth_date: body.birth_date || "",
      client_notes: body.notes || body.client_notes || "",
      // O checkout do catálogo já pedia CPF e e-mail, mas eles paravam em
      // `sales_orders.customer_cpf/customer_email` e nunca chegavam à ficha do
      // cliente. Sem CPF em `clients`, o Asaas recusa criar o pagador e a
      // cobrança online do pedido não sai.
      tax_id: body.cpf || body.customer_cpf || body.tax_id || "",
      email: body.email || body.customer_email || ""
    });
    if (!client?.id) return null;

    const result = await tx.run(
      `INSERT INTO sales_orders
      (client_id, appointment_id, order_type, source, status, payment_method, receivable_mode, installment_count,
       first_due_date, installments_json, subtotal_value, discount_value,
       total_value, coupon_id, coupon_code, coupon_snapshot, fulfillment_method, delivery_address,
       customer_email, customer_cpf, accepted_policies_at, idempotency_key, notes, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        client.id,
        body.appointment_id ? Number(body.appointment_id) : null,
        orderType,
        source,
        status,
        paymentMethod,
        receivableMode,
        installmentCount,
        firstDueDate,
        installmentsJson,
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

    let stockTouched = false;
    for (const item of items) {
      const itemResult = await tx.run(
        `INSERT INTO sales_order_items (sales_order_id, item_type, product_id, product_variant_id, service_id, item_name, quantity, unit_price, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
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
        stockTouched = Boolean(await deductSoldProductStock(tx, { ...item, id: itemResult.returnedId }, result.returnedId)) || stockTouched;
      }
    }

    if (stockTouched) {
      await tx.run("UPDATE sales_orders SET stock_deducted=1 WHERE id=?", [result.returnedId]);
    }

    if (total > 0 && (status === "concluida" || status === "pago") && receivableMode === "paid") {
      // `sales_order_id` é o que faz este pagamento ser reconhecido como a
      // baixa do título — sem ele, `payments` e `sales_orders` só se
      // encontrariam por acaso (mesmo cliente, mesmo valor).
      await tx.run(
        `INSERT INTO payments
          (appointment_id, client_id, sales_order_id, amount, payment_type, method, status, paid_at, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        [
          body.appointment_id ? Number(body.appointment_id) : null,
          client.id,
          result.returnedId,
          total,
          orderType,
          paymentMethod,
          "pago",
          localTimestamp(),
          `sales-order:${result.returnedId}:paid`
        ]
      );
    } else if (total > 0 && (status === "concluida" || status === "pago") && receivableMode === "pending") {
      await syncSalesOrderReceivables(tx, {
        salesOrderId: result.returnedId,
        amount: total,
        installmentCount,
        firstDueDate,
        paymentMethod,
        installments: explicitInstallments
      });
    }
    return result.returnedId;
  });

  if (!orderId) return null;
  return getSalesOrder(db, orderId);
}

export async function ensureSalesOrderForAppointment(db, appointmentId, user, options = {}) {
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
    FOR UPDATE OF a
  `, [appointmentId]);
  if (!appointment) return null;
  const existing = await db.get(
    "SELECT * FROM sales_orders WHERE appointment_id = ? AND order_type = 'ordem_servico' LIMIT 1 FOR UPDATE",
    [appointmentId]
  );

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
  const grossTotal = appointmentItems.length
    ? appointmentItems.reduce((sum, item) => sum + Number(item.procedure_price || 0) + Number(item.jewelry_unit_price || 0) * Number(item.quantity || 1), 0)
    : fallbackServiceValue + fallbackProductValue;
  // A ordem de serviço é o snapshot documental do atendimento, não uma nova
  // receita. Seu total precisa preservar o líquido realizado do agendamento;
  // os itens continuam registrando o bruto para explicar o desconto.
  const total = Number(appointment.total_value || Math.max(0, grossTotal - Number(appointment.discount_value || 0)));
  const outstanding = Math.max(0, Number(appointment.remaining_value || 0));
  const explicitConfigProvided = Array.isArray(options.installments)
    ? options.installments.length > 0
    : options.installments !== undefined && options.installments !== null;
  const automaticConfigProvided = ["installmentCount", "installment_count", "firstDueDate", "first_due_date", "paymentMethod", "payment_method"]
    .some((key) => options[key] !== undefined);
  const storedInstallments = existing && !explicitConfigProvided && !automaticConfigProvided
    ? parseStoredInstallments(existing.installments_json)
    : null;
  const rawInstallments = explicitConfigProvided ? options.installments : storedInstallments;
  const fallbackPaymentMethod = String(options.paymentMethod || options.payment_method || appointment.remaining_payment_method || appointment.deposit_payment_method || "Pix");
  const explicitInstallments = normalizeExplicitInstallments(rawInstallments, {
    total: outstanding,
    defaultPaymentMethod: fallbackPaymentMethod
  });
  const paymentMethod = String(explicitInstallments?.[0]?.paymentMethod || fallbackPaymentMethod);
  const installmentCount = explicitInstallments?.length || normalizeInstallmentCount(options.installmentCount ?? options.installment_count ?? existing?.installment_count ?? 1);
  const firstDueDate = explicitInstallments?.[0]?.dueDate || String(options.firstDueDate || options.first_due_date || existing?.first_due_date || localTimestamp().slice(0, 10));
  const installmentsJson = explicitInstallments ? JSON.stringify(serializeInstallments(explicitInstallments)) : null;
  let orderId = existing?.id || null;
  if (existing) {
    await db.run(
      `UPDATE sales_orders SET client_id=?, status='concluida', payment_method=?, receivable_mode=?,
         installment_count=?, first_due_date=?, installments_json=?, subtotal_value=?, discount_value=?, total_value=?,
         coupon_id=?, coupon_code=?, coupon_snapshot=?, stock_deducted=?, notes=? WHERE id=?`,
      [
        appointment.client_id, paymentMethod, outstanding > 0 ? "pending" : "paid", installmentCount,
        firstDueDate, installmentsJson, grossTotal, Number(appointment.discount_value || 0), total,
        appointment.coupon_id || null, appointment.coupon_code || null, appointment.coupon_snapshot || null,
        Number(appointment.stock_deducted || 0),
        `Ordem atualizada automaticamente ao finalizar o atendimento #${appointment.id}`, existing.id
      ]
    );
  } else {
    const result = await db.run(
      `INSERT INTO sales_orders
      (client_id, appointment_id, order_type, source, status, payment_method, receivable_mode,
       installment_count, first_due_date, installments_json, stock_deducted, subtotal_value, discount_value,
       total_value, coupon_id, coupon_code, coupon_snapshot, notes, created_by_user_id)
      VALUES (?, ?, 'ordem_servico', 'agenda', 'concluida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        appointment.client_id,
        appointment.id,
        paymentMethod,
        outstanding > 0 ? "pending" : "paid",
        installmentCount,
        firstDueDate,
        installmentsJson,
        Number(appointment.stock_deducted || 0),
        grossTotal,
        Number(appointment.discount_value || 0),
        total,
        appointment.coupon_id || null,
        appointment.coupon_code || null,
        appointment.coupon_snapshot || null,
        `Ordem gerada automaticamente ao finalizar o atendimento #${appointment.id}`,
        user?.id || null
      ]
    );
    orderId = result.returnedId;
  }

  // O sinal (pago na reserva) e o restante (pago aqui, na finalização) já
  // existem em `payments` antes deste título existir — o vínculo só pode ser
  // feito agora, retroativo, pelo appointment_id que os dois compartilham.
  await db.run(
    "UPDATE payments SET sales_order_id = ? WHERE appointment_id = ? AND sales_order_id IS NULL",
    [orderId, appointmentId]
  );

  if (!existing && appointmentItems.length) {
    for (const item of appointmentItems) {
      if (Number(item.procedure_price || 0) > 0 || item.service_id || item.procedure_id) {
        await db.run(
          `INSERT INTO sales_order_items (sales_order_id, item_type, service_id, item_name, quantity, unit_price, notes)
           VALUES (?, 'servico', ?, ?, 1, ?, ?)`,
          [
            orderId,
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
            orderId,
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
  } else if (!existing) {
    await db.run(
      `INSERT INTO sales_order_items (sales_order_id, item_type, service_id, item_name, quantity, unit_price, notes)
       VALUES (?, 'servico', ?, ?, 1, ?, ?)`,
      [
        orderId,
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
          orderId,
          appointment.jewelry_id,
          appointment.jewelry_variant_id || null,
          appointment.variant_name ? `${appointment.jewelry_name} - ${appointment.variant_name}` : appointment.jewelry_name,
          fallbackProductValue,
          "Joia vinculada ao atendimento"
        ]
      );
    }
  }

  await syncSalesOrderReceivables(db, {
    salesOrderId: orderId,
    amount: outstanding,
    installmentCount,
    firstDueDate,
    paymentMethod,
    installments: explicitInstallments,
    description: `Atendimento #${appointment.id}`
  });
  return getSalesOrder(db, orderId);
}

const SALES_ORDER_COLUMNS = `
  so.*,
  c.full_name,
  c.whatsapp,
  c.instagram,
  a.procedure AS appointment_procedure,
  a.appointment_date,
  a.appointment_time,
  (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
   WHERE p.sales_order_id=so.id AND p.status IN ('pago','confirmado')) AS paid_value
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
  return orders.map((order) => {
    const { installments_json: installmentsJson, ...orderData } = order;
    return {
      ...orderData,
      installments: parseStoredInstallments(installmentsJson),
      items: grouped[order.id] || []
    };
  });
}

// Busca DIRETA por id. Existe para não depender de "listar tudo e procurar":
// com a lista paginada o pedido recém-criado pode nem estar na primeira página.
export async function getSalesOrder(db, id) {
  const order = await db.get(
    `SELECT ${SALES_ORDER_COLUMNS} FROM ${SALES_ORDER_FROM} WHERE so.id = ?`,
    [id]
  );
  if (!order) return null;
  const withItems = (await attachSalesOrderItems(db, [order]))[0];
  const receivables = await db.all(
    `SELECT id, amount, paid_amount, due_date, competence_date, status, payment_method,
      installment_number, installment_count, source_key
     FROM financial_entries
     WHERE source_type='sales_order' AND source_id=? AND entry_type='receivable' AND status!='canceled'
     ORDER BY installment_number, id`,
    [id]
  );
  return { ...withItems, receivables };
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
