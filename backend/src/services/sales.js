// Serviços de vendas de produtos (balcão e catálogo).
import { normalizeSalesOrderItems, variantStatus, localTimestamp } from "./utils.js";
import { upsertClient } from "./appointments.js";
import { syncProductInventory } from "./inventory.js";
import { limitOffset, countRows } from "./pagination.js";
import { allocateCents, percentOfCents, salesItemDiscountCents, salesItemGrossCents, validateCoupon } from "./discounts.js";
import { availableStock, releaseExpiredReservations } from "./reservations.js";
import { calculateOperationTotals } from "./finance.js";
import { recordAudit } from "./audit.js";
import { hasPermission } from "./permissionService.js";
import { P } from "../config/permissions.js";
import {
  installmentMoneyCents,
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
    const product = await db.get("SELECT id,name,category,sale_value,status,is_catalog_active,is_published,can_sell,can_publish,track_stock FROM jewelry_inventory WHERE id=?", [productId]);
    if (!product || !product.can_sell || !product.can_publish || Number(product.is_catalog_active) !== 1 || Number(product.is_published) !== 1 || product.status === "arquivado") {
      throw new SalesOrderValidationError("Produto indisponível.", 409);
    }
    if (!variantId) {
      const variants = await db.all(`SELECT id FROM jewelry_variants
        WHERE jewelry_id=? AND is_active=1 AND (? = false OR quantity>0) ORDER BY id`, [productId, product.track_stock]);
      if (variants.length === 1) variantId = variants[0].id;
      else if (variants.length > 1) throw new SalesOrderValidationError("Selecione a variação do produto.");
    }
    const variant = variantId
      ? await db.get("SELECT id,jewelry_id,variation_name,sale_value,quantity,is_active,status FROM jewelry_variants WHERE id=? AND jewelry_id=?", [variantId, productId])
      : null;
    if (variantId && (!variant || Number(variant.is_active) !== 1 || variant.status === "esgotado")) {
      throw new SalesOrderValidationError("Variação indisponível.", 409);
    }
    if (product.track_stock) {
      const available = await availableStock(db, productId, variantId);
      if (available === null || available < quantity) throw new SalesOrderValidationError("Estoque insuficiente para este item.", 409);
    }
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
  const itemRecord = await db.get("SELECT id,name,quantity,can_sell,track_stock FROM jewelry_inventory WHERE id=?", [productId]);
  if (!itemRecord || !itemRecord.can_sell || !itemRecord.track_stock) return null;
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
      `SELECT v.id, v.quantity, v.variation_name, v.sku, j.name AS product_name, j.can_sell
       FROM jewelry_variants v LEFT JOIN jewelry_inventory j ON j.id = v.jewelry_id
       WHERE v.id = ?`,
      [variantId]
    );
    if (!variant || !variant.can_sell) return null;
    const variantLabel = variant.variation_name || variant.sku || "";
    return {
      key: `variant:${variant.id}`,
      available: Number(variant.quantity || 0),
      label: [variant.product_name, variantLabel].filter(Boolean).join(" - ")
    };
  }
  return { key: `product:${itemRecord.id}`, available: Number(itemRecord.quantity || 0), label: itemRecord.name || "" };
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
  const inventoryItem = await db.get("SELECT track_stock FROM jewelry_inventory WHERE id = ?", [item.product_id]);
  if (!inventoryItem?.track_stock) return;
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

// ---------------------------------------------------------------------------
// Precificação oficial da venda (criação e cotação usam a MESMA função).
// ---------------------------------------------------------------------------

const MANUAL_DISCOUNT_FIELDS = ["manual_discount_value", "manual_discount_percent", "manual_discount_reason"];
const MAX_DISCOUNT_REASON_LENGTH = 500;
// Limites das colunas: INTEGER (quantidade) e NUMERIC(12,2) (dinheiro).
const MAX_ITEM_QUANTITY = 2_147_483_647;
const MAX_MONEY_CENTS = 999_999_999_999;

const blank = (value) => value === undefined || value === null || String(value).trim() === "";
const fromCents = (cents) => cents / 100;

// Mesmo filtro de `normalizeSalesOrderItems` (linha sem nome é descartada),
// para que a validação olhe exatamente as linhas que vão ser gravadas.
const itemName = (item) => String(item?.item_name || item?.name || "").trim();

// Venda interna: o preço digitado pela equipe vira valor da venda, então ele
// precisa ser dinheiro de verdade. Antes, `unit_price` negativo ou NaN passava
// direto (`Number(...)`) e quantidade fracionada quebrava só no INSERT.
//
// Devolve, para cada linha com nome (na mesma ordem de
// `normalizeSalesOrderItems`), a quantidade e o preço já validados.
function validatedInternalItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  const validated = [];
  for (const raw of rawItems) {
    const name = itemName(raw);
    if (!name) continue;
    const quantity = blank(raw.quantity) ? 1 : Number(raw.quantity);
    if (typeof raw.quantity === "boolean" || !Number.isSafeInteger(quantity) || quantity < 1) {
      throw new SalesOrderValidationError(`Quantidade inválida em "${name}": informe um número inteiro maior ou igual a 1.`);
    }
    const price = blank(raw.unit_price) ? raw.price : raw.unit_price;
    if (blank(price) || typeof price === "boolean" || !Number.isFinite(Number(price))) {
      throw new SalesOrderValidationError(`Valor unitário inválido em "${name}": informe um valor em R$ maior ou igual a zero.`);
    }
    let unitCents;
    try {
      unitCents = installmentMoneyCents(price, "Valor unitário");
    } catch {
      throw new SalesOrderValidationError(`Valor unitário inválido em "${name}": use um valor maior ou igual a zero, com até 2 casas decimais.`);
    }
    // `sales_order_items.quantity` é INTEGER e os valores são NUMERIC(12,2):
    // quantidade ou bruto acima disso passaria pela validação e estouraria só
    // no INSERT (500) — ou perderia precisão no rateio em centavos.
    if (quantity > MAX_ITEM_QUANTITY || unitCents * quantity > MAX_MONEY_CENTS) {
      throw new SalesOrderValidationError(`Quantidade ou valor fora do limite permitido em "${name}".`);
    }
    validated.push({ quantity, unitCents });
  }
  return validated;
}

function hasManualDiscountFields(body = {}) {
  return MANUAL_DISCOUNT_FIELDS.some((field) => !blank(body[field]));
}

// Lê o desconto manual do corpo. O que se grava é sempre o valor em R$; o
// percentual é só um atalho, convertido sobre (bruto − cupom) na precificação.
// Se os dois vierem, o valor em R$ prevalece (é o que a tela mostra ao usuário).
export function parseManualDiscount(body = {}) {
  const reason = String(body.manual_discount_reason ?? "").trim();
  if (reason.length > MAX_DISCOUNT_REASON_LENGTH) {
    throw new SalesOrderValidationError(`O motivo do desconto deve ter no máximo ${MAX_DISCOUNT_REASON_LENGTH} caracteres.`);
  }
  let valueCents = null;
  let percentHundredths = null;
  if (!blank(body.manual_discount_value)) {
    try {
      valueCents = installmentMoneyCents(body.manual_discount_value, "Desconto manual");
    } catch {
      throw new SalesOrderValidationError("Desconto manual inválido: informe um valor em R$ maior ou igual a zero, com até 2 casas decimais.");
    }
  } else if (!blank(body.manual_discount_percent)) {
    try {
      percentHundredths = installmentMoneyCents(body.manual_discount_percent, "Percentual de desconto");
    } catch {
      percentHundredths = -1;
    }
    if (percentHundredths < 0 || percentHundredths > 10000) {
      throw new SalesOrderValidationError("Percentual de desconto inválido: use um valor entre 0 e 100, com até 2 casas decimais.");
    }
  }
  return {
    valueCents,
    percentHundredths,
    reason,
    requested: Number(valueCents || 0) > 0 || Number(percentHundredths || 0) > 0
  };
}

// Permissões de preço da venda interna, conferidas na criação E na cotação
// (a cotação não pode revelar/antecipar o que a criação recusaria).
export function assertSalesPricingPermissions(user, body = {}, manual = parseManualDiscount(body)) {
  if (manual.requested && !hasPermission(user, P.SALES_APPLY_DISCOUNT)) {
    throw new SalesOrderValidationError("Você não tem permissão para aplicar desconto.", 403);
  }
  if (!blank(body.coupon_code) && !hasPermission(user, P.COUPONS_APPLY)) {
    throw new SalesOrderValidationError("Você não tem permissão para aplicar cupom.", 403);
  }
}

// Itens prontos para precificar: venda pública usa o preço do banco; venda
// interna valida e normaliza o que a equipe digitou.
async function prepareSalesOrderItems(db, body, publicOrder) {
  const submittedItems = normalizeSalesOrderItems(body.items || []);
  if (publicOrder) return authoritativePublicItems(db, submittedItems);
  const validated = validatedInternalItems(body.items || []);
  return submittedItems.map((item, index) => ({
    ...item,
    quantity: validated[index].quantity,
    unit_price: fromCents(validated[index].unitCents)
  }));
}

// Categoria do produto, para cupons restritos por categoria. A venda interna
// não manda `category` (e não deve: viria do navegador), então lemos do banco.
async function withProductCategories(db, items) {
  const missing = [...new Set(items.filter((item) => item.product_id && !item.category).map((item) => Number(item.product_id)))];
  if (!missing.length) return items;
  const rows = await db.all(
    `SELECT id, category FROM jewelry_inventory WHERE id IN (${missing.map(() => "?").join(",")})`,
    missing
  );
  const categories = new Map(rows.map((row) => [Number(row.id), row.category]));
  return items.map((item) => (item.product_id && !item.category
    ? { ...item, category: categories.get(Number(item.product_id)) || "" }
    : item));
}

// Cálculo oficial da venda, em centavos inteiros:
//   bruto    = Σ unit_price × quantidade
//   cupom    = desconto do cupom sobre o bruto (limitado ao bruto)
//   manual   = valor em R$ (ou % convertido sobre bruto − cupom)
//   desconto = cupom + manual   (recusado se passar do bruto)
//   líquido  = bruto − desconto
// O desconto TOTAL é rateado entre os itens proporcionalmente ao bruto de cada
// um (maior resto), e a soma do rateio é exatamente o desconto.
//
// Promoções NÃO entram aqui: a venda nunca as aplicou, e a tela deixa de
// exibi-las como desconto (a cotação oficial é esta função).
export async function priceSalesOrder(db, {
  items = [],
  couponCode = "",
  clientId = null,
  manualDiscount = { valueCents: null, percentHundredths: null, reason: "", requested: false },
  lockCoupon = false,
  excludeSalesOrderId = null
} = {}) {
  const pricedItems = await withProductCategories(db, items);
  const grossByItem = pricedItems.map(salesItemGrossCents);
  const subtotalCents = grossByItem.reduce((sum, value) => sum + value, 0);
  if (subtotalCents > MAX_MONEY_CENTS) {
    throw new SalesOrderValidationError("O valor da venda está fora do limite permitido.");
  }

  let couponQuote = null;
  let couponCents = 0;
  const code = String(couponCode || "").trim();
  if (code) {
    couponQuote = await validateCoupon(db, code, {
      amount: fromCents(subtotalCents),
      client_id: clientId || null,
      items: pricedItems
    }, { forUpdate: lockCoupon, excludeSalesOrderId });
    if (!couponQuote.valid) throw new SalesOrderValidationError(couponQuote.error);
    couponCents = Math.min(subtotalCents, Math.max(0, Math.round(Number(couponQuote.discount_amount || 0) * 100)));
  }

  const manualCents = manualDiscount?.valueCents !== null && manualDiscount?.valueCents !== undefined
    ? manualDiscount.valueCents
    : manualDiscount?.percentHundredths
      ? percentOfCents(subtotalCents - couponCents, manualDiscount.percentHundredths)
      : 0;
  const discountCents = couponCents + manualCents;
  if (discountCents > subtotalCents) {
    throw new SalesOrderValidationError("O desconto não pode ser maior que o valor bruto.");
  }
  const totalCents = subtotalCents - discountCents;
  const discountByItem = allocateCents(discountCents, grossByItem);

  return {
    items: pricedItems.map((item, index) => ({
      ...item,
      gross_value: fromCents(grossByItem[index]),
      discount_value: fromCents(discountByItem[index]),
      net_value: fromCents(grossByItem[index] - discountByItem[index])
    })),
    coupon: couponQuote,
    cents: { subtotal: subtotalCents, coupon: couponCents, manual: manualCents, discount: discountCents, total: totalCents },
    subtotal_value: fromCents(subtotalCents),
    coupon_discount_value: fromCents(couponCents),
    manual_discount_value: fromCents(manualCents),
    manual_discount_percent: manualDiscount?.valueCents === null || manualDiscount?.valueCents === undefined
      ? (manualDiscount?.percentHundredths ? manualDiscount.percentHundredths / 100 : null)
      : null,
    manual_discount_reason: manualCents > 0 ? (manualDiscount?.reason || null) : null,
    discount_value: fromCents(discountCents),
    total_value: fromCents(totalCents)
  };
}

// Resposta pública da precificação: mesmos nomes de `calculateOperationTotals`
// no `summary` (o contrato do `FinancialSummary`), mais o detalhe por item.
export function salesPricingPayload(pricing) {
  const totals = calculateOperationTotals({
    serviceSubtotal: 0,
    productSubtotal: pricing.subtotal_value,
    discountTotal: pricing.discount_value,
    couponDiscount: pricing.coupon_discount_value,
    manualDiscount: pricing.manual_discount_value
  });
  return {
    subtotal_value: pricing.subtotal_value,
    coupon_discount_value: pricing.coupon_discount_value,
    manual_discount_value: pricing.manual_discount_value,
    manual_discount_percent: pricing.manual_discount_percent,
    manual_discount_reason: pricing.manual_discount_reason,
    discount_value: pricing.discount_value,
    total_value: pricing.total_value,
    coupon_code: pricing.coupon?.coupon?.code || null,
    coupon: pricing.coupon?.coupon
      ? { ...pricing.coupon.coupon, discount_amount: pricing.coupon_discount_value }
      : null,
    items: pricing.items.map((item, index) => ({
      index,
      item_name: item.item_name,
      product_id: item.product_id || null,
      product_variant_id: item.product_variant_id || null,
      quantity: Number(item.quantity || 1),
      unit_price: Number(item.unit_price || 0),
      gross_value: item.gross_value,
      discount_value: item.discount_value,
      net_value: item.net_value
    })),
    summary: {
      ...totals,
      couponDiscount: pricing.coupon_discount_value,
      manualDiscount: pricing.manual_discount_value,
      manualDiscountReason: pricing.manual_discount_reason,
      adjustmentTotal: 0
    }
  };
}

// Cliente que a venda vai usar, SEM gravar nada: mesma regra de `upsertClient`
// (id informado e existente; senão o cadastro com o mesmo WhatsApp). Cliente
// novo ainda não tem id — e também não tem usos de cupom. Assim a cotação e a
// criação validam o cupom contra os mesmos limites por cliente.
async function resolveExistingClientId(db, body = {}, publicOrder = false) {
  const requested = publicOrder ? null : Number(body.client_id) > 0 ? Number(body.client_id) : null;
  if (requested && (await db.get("SELECT id FROM clients WHERE id=?", [requested]))) return requested;
  const whatsapp = String(body.whatsapp || "").trim();
  if (!whatsapp) return null;
  return (await db.get("SELECT id FROM clients WHERE whatsapp=?", [whatsapp]))?.id || null;
}

// Venda registra só produto: atendimentos têm execução e financeiro próprios no
// fluxo da agenda. Conferido na criação E na cotação, para a cotação nunca
// aprovar um carrinho que a criação recusaria.
function assertProductOnlyOrder(body, items) {
  const orderType = String(body.order_type || "produto");
  if (orderType === "ordem_servico") {
    throw new SalesOrderValidationError("Ordem de serviço é gerada automaticamente pela agenda ao concluir um atendimento — não pode ser criada manualmente.");
  }
  if (orderType !== "produto" || items.some((item) => item.item_type !== "produto" || item.service_id)) {
    throw new SalesOrderValidationError("Vendas registram apenas produtos. Serviços são criados automaticamente ao finalizar um agendamento.");
  }
  return orderType;
}

// Cotação oficial da venda interna (`POST /api/sales-orders/quote`): mesmo
// cálculo da criação (`priceSalesOrder`), sem gravar nada.
export async function quoteSalesOrder(db, body = {}, user) {
  const manual = parseManualDiscount(body);
  assertSalesPricingPermissions(user, body, manual);
  const items = await prepareSalesOrderItems(db, body, false);
  if (!items.length) throw new SalesOrderValidationError("Adicione ao menos um item à venda.");
  assertProductOnlyOrder(body, items);
  const pricing = await priceSalesOrder(db, {
    items,
    couponCode: body.coupon_code,
    clientId: await resolveExistingClientId(db, body, false),
    manualDiscount: manual
  });
  return salesPricingPayload(pricing);
}

export async function createSalesOrder(db, body, user, { req = null } = {}) {
  const publicOrder = !user;
  // Desconto manual é decisão da equipe, com autor e motivo: o pedido do
  // catálogo público nunca pode trazê-lo (nem zerado).
  if (publicOrder && hasManualDiscountFields(body)) {
    throw new SalesOrderValidationError("Desconto manual não é permitido no pedido do catálogo.");
  }
  const manual = publicOrder ? parseManualDiscount({}) : parseManualDiscount(body);
  if (!publicOrder) assertSalesPricingPermissions(user, body, manual);
  if (publicOrder && !body.accepted_policies) throw new SalesOrderValidationError("É necessário aceitar as políticas.");
  if (publicOrder && body.fulfillment_method === "delivery" && !String(body.delivery_address || "").trim()) {
    throw new SalesOrderValidationError("Informe o endereço de entrega.");
  }
  const items = await prepareSalesOrderItems(db, body, publicOrder);
  if (!items.length) return null;
  const fullName = String(body.full_name || body.customer_name || body.name || "").trim();
  const whatsapp = String(body.whatsapp || "").trim();
  if (!fullName || !whatsapp) return null;

  const orderType = assertProductOnlyOrder(body, items);
  // O pedido público não escolhe origem nem vínculo com atendimento: com um
  // `appointment_id` arbitrário a resposta pública devolvia procedimento e
  // horário daquele atendimento (JOIN em SALES_ORDER_COLUMNS), e `source`
  // livre deixava o pedido se esconder da lista de vendas.
  const source = publicOrder ? "site" : String(body.source || "site");
  const appointmentId = !publicOrder && body.appointment_id ? Number(body.appointment_id) : null;
  const requestedOpenStatus = ["pendente", "aberta"].includes(String(body.status || ""));
  // Chamadas públicas nunca podem escolher um estado financeiro conclusivo.
  // Pagamento só é confirmado por um usuário autenticado (ou, futuramente,
  // pelo webhook autenticado do gateway).
  const status = user ? String(body.status || "concluida") : "pendente";
  const idempotencyKey = publicOrder ? String(body.idempotency_key || "").trim().slice(0, 100) : "";
  if (idempotencyKey) {
    const existing = await db.get("SELECT id FROM sales_orders WHERE idempotency_key=?", [idempotencyKey]);
    if (existing) return getSalesOrder(db, existing.id);
  }

  // Cliente, pedido, itens, cupom, baixa de estoque, pagamento e auditoria são
  // uma coisa só: metade disso gravado deixaria estoque baixado sem venda (ou
  // venda sem pagamento) e o financeiro do dia não fecharia.
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

    // Preço, cupom e desconto são calculados AQUI, dentro da transação e antes
    // de qualquer escrita: o cupom fica travado (`FOR UPDATE`) até o uso ser
    // gravado logo abaixo, então duas vendas simultâneas não consomem juntas a
    // última vaga dele. É a mesma função da cotação.
    const pricing = await priceSalesOrder(tx, {
      items,
      couponCode: body.coupon_code,
      clientId: await resolveExistingClientId(tx, body, publicOrder),
      manualDiscount: manual,
      lockCoupon: true
    });
    const total = pricing.total_value;
    const couponQuote = pricing.coupon;

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

    const client = await upsertClient(tx, {
      // Pedido público não escolhe a ficha por id: com um `client_id` qualquer
      // o pedido (e o CPF/e-mail digitados) iria parar na ficha de outra pessoa.
      client_id: publicOrder ? null : body.client_id,
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
    }, { publicFlow: publicOrder });
    if (!client?.id) return null;

    const manualCents = pricing.cents.manual;
    const result = await tx.run(
      `INSERT INTO sales_orders
      (client_id, appointment_id, order_type, source, status, payment_method, receivable_mode, installment_count,
       first_due_date, installments_json, subtotal_value, discount_value,
       total_value, coupon_id, coupon_code, coupon_snapshot, fulfillment_method, delivery_address,
       customer_email, customer_cpf, accepted_policies_at, idempotency_key, notes, created_by_user_id,
       manual_discount_value, manual_discount_reason, manual_discount_updated_by, manual_discount_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${manualCents > 0 ? "now()" : "NULL"}) RETURNING id`,
      [
        client.id,
        appointmentId,
        orderType,
        source,
        status,
        paymentMethod,
        receivableMode,
        installmentCount,
        firstDueDate,
        installmentsJson,
        pricing.subtotal_value,
        pricing.discount_value,
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
        user?.id || null,
        pricing.manual_discount_value,
        pricing.manual_discount_reason,
        manualCents > 0 ? user?.id || null : null
      ]
    );
    const orderId = result.returnedId;

    // Uso do cupom gravado com a venda: é o que faz o limite de usos, o limite
    // por cliente, o relatório de Cupons e o histórico do cliente enxergarem
    // vendas (antes só o agendamento gravava uso).
    if (couponQuote?.coupon?.id) {
      await tx.run(
        `INSERT INTO coupon_usages (coupon_id, client_id, sale_id, original_amount, discount_amount, final_amount)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          couponQuote.coupon.id,
          client.id,
          orderId,
          pricing.subtotal_value,
          pricing.coupon_discount_value,
          fromCents(pricing.cents.subtotal - pricing.cents.coupon)
        ]
      );
    }

    let stockTouched = false;
    for (const item of pricing.items) {
      const itemResult = await tx.run(
        `INSERT INTO sales_order_items (sales_order_id, item_type, product_id, product_variant_id, service_id, item_name, quantity, unit_price, discount_value, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [
          orderId,
          item.item_type || "produto",
          item.product_id ? Number(item.product_id) : null,
          item.product_variant_id ? Number(item.product_variant_id) : null,
          item.service_id ? Number(item.service_id) : null,
          item.item_name,
          Number(item.quantity || 1),
          Number(item.unit_price || 0),
          item.discount_value,
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
          [`order-${orderId}-${item.product_id}-${item.product_variant_id || 0}`, orderId, client.id, item.product_id, item.product_variant_id || null, item.quantity]
        );
      }
      if (status === "concluida" || status === "pago") {
        stockTouched = Boolean(await deductSoldProductStock(tx, { ...item, id: itemResult.returnedId }, orderId)) || stockTouched;
      }
    }

    if (stockTouched) {
      await tx.run("UPDATE sales_orders SET stock_deducted=1 WHERE id=?", [orderId]);
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
          appointmentId,
          client.id,
          orderId,
          total,
          orderType,
          paymentMethod,
          "pago",
          localTimestamp(),
          `sales-order:${orderId}:paid`
        ]
      );
    } else if (total > 0 && (status === "concluida" || status === "pago") && receivableMode === "pending") {
      await syncSalesOrderReceivables(tx, {
        salesOrderId: orderId,
        amount: total,
        installmentCount,
        firstDueDate,
        paymentMethod,
        installments: explicitInstallments
      });
    }

    // Auditoria na MESMA transação da venda: ou os dois existem, ou nenhum.
    const totalsSnapshot = {
      subtotal_value: pricing.subtotal_value,
      coupon_code: couponQuote?.coupon?.code || null,
      coupon_discount_value: pricing.coupon_discount_value,
      manual_discount_value: pricing.manual_discount_value,
      discount_value: pricing.discount_value,
      total_value: total
    };
    await recordAudit(tx, {
      req,
      actor: user || null,
      module: "sales",
      action: publicOrder ? "public_create" : "create",
      entityType: "sales_order",
      entityId: orderId,
      reason: publicOrder ? "Pedido criado pelo catálogo público" : "Venda interna criada",
      after: { id: orderId, client_id: client.id, status, ...totalsSnapshot }
    });
    if (manualCents > 0) {
      await recordAudit(tx, {
        req,
        actor: user,
        module: "sales",
        action: "discount",
        entityType: "sales_order",
        entityId: orderId,
        reason: pricing.manual_discount_reason || "Desconto manual na venda",
        before: { manual_discount_value: 0, manual_discount_reason: null },
        after: {
          manual_discount_value: pricing.manual_discount_value,
          manual_discount_percent: pricing.manual_discount_percent,
          manual_discount_reason: pricing.manual_discount_reason,
          ...totalsSnapshot
        },
        metadata: {
          items: pricing.items.map((item) => ({
            item_name: item.item_name,
            quantity: Number(item.quantity || 1),
            gross_value: item.gross_value,
            discount_value: item.discount_value,
            net_value: item.net_value
          }))
        },
        severity: "warning"
      });
    }
    return orderId;
  });

  if (!orderId) return null;
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
    const orderItems = grouped[order.id] || [];
    // Bruto, desconto e líquido por item. Venda antiga sem rateio gravado
    // recebe o rateio proporcional calculado na hora (o mesmo da devolução);
    // `discount_value` do item passa a refletir esse rateio na resposta.
    const discounts = salesItemDiscountCents(order.discount_value, orderItems);
    return {
      ...orderData,
      installments: parseStoredInstallments(installmentsJson),
      items: orderItems.map((item, index) => {
        const grossCents = salesItemGrossCents(item);
        return {
          ...item,
          gross_value: fromCents(grossCents),
          discount_value: fromCents(discounts[index]),
          net_value: fromCents(grossCents - discounts[index])
        };
      })
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
