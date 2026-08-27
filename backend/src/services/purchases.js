import { syncProductInventory } from "./inventory.js";
import { applyPriceRounding } from "./pricing.js";
import {
  normalizeExplicitInstallments,
  parseStoredInstallments,
  resolveInstallmentSchedule,
  serializeInstallments
} from "./receivables.js";
import { localTimestamp } from "./utils.js";

export class PurchaseValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function requiredId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new PurchaseValidationError(`${label} inválido.`);
  return id;
}

function requiredDate(value, label) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new PurchaseValidationError(`${label} inválido.`);
  const date = new Date(`${text}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new PurchaseValidationError(`${label} inválido.`);
  }
  return text;
}

// Todo cálculo de compra é feito em centavos inteiros. Além de preservar o
// total das parcelas, isto recusa silenciosamente valores com frações menores
// que um centavo em vez de arredondá-los de maneiras diferentes por camada.
export function moneyToCents(value, label = "Valor") {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new PurchaseValidationError(`${label} inválido.`);
  const [integer, decimal = ""] = text.split(".");
  const cents = Number(integer) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 999_999_999_999) {
    throw new PurchaseValidationError(`${label} fora do limite permitido.`);
  }
  return cents;
}

export function splitInstallmentCents(totalCents, count) {
  const installments = Number(count);
  if (!Number.isInteger(installments) || installments < 1 || installments > 120) {
    throw new PurchaseValidationError("Quantidade de parcelas deve estar entre 1 e 120.");
  }
  const base = Math.floor(totalCents / installments);
  const remainder = totalCents % installments;
  return Array.from({ length: installments }, (_, index) => base + (index < remainder ? 1 : 0));
}

function normalizePurchase(body = {}, idempotencyKey = "") {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new PurchaseValidationError("Adicione ao menos um item à compra.");
  const seenTargets = new Set();
  const normalizedItems = items.map((item, index) => {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new PurchaseValidationError(`Quantidade inválida no item ${index + 1}.`);
    }
    const unitCostCents = moneyToCents(item.unit_cost, `Custo unitário do item ${index + 1}`);
    if (unitCostCents <= 0) throw new PurchaseValidationError(`Custo unitário do item ${index + 1} deve ser maior que zero.`);
    const lineTotalCents = unitCostCents * quantity;
    if (!Number.isSafeInteger(lineTotalCents)) throw new PurchaseValidationError(`Total do item ${index + 1} fora do limite permitido.`);
    const itemType = String(item.item_type || "product").toLowerCase() === "consumable" ? "consumable" : "product";
    const productId = itemType === "product" ? requiredId(item.product_id, `Produto do item ${index + 1}`) : null;
    const consumableId = itemType === "consumable" ? requiredId(item.consumable_id, `Material do item ${index + 1}`) : null;
    const productVariantId = itemType === "product" && item.product_variant_id ? requiredId(item.product_variant_id, `Variação do item ${index + 1}`) : null;
    const target = itemType === "consumable" ? `consumable:${consumableId}` : `product:${productId}:${productVariantId || 0}`;
    if (seenTargets.has(target)) throw new PurchaseValidationError(`O item ${index + 1} repete o mesmo produto/variação na compra.`);
    seenTargets.add(target);
    return {
      item_type: itemType,
      product_id: productId,
      consumable_id: consumableId,
      product_variant_id: productVariantId,
      quantity,
      unit_cost_cents: unitCostCents,
      line_total_cents: lineTotalCents,
      batch_code: itemType === "consumable" ? String(item.batch_code || "").trim() : null,
      expiry_date: itemType === "consumable" && item.expiry_date ? requiredDate(item.expiry_date, `Validade do item ${index + 1}`) : null
    };
  });
  const totalCents = normalizedItems.reduce((sum, item) => sum + item.line_total_cents, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new PurchaseValidationError("Total da compra inválido.");
  let explicitInstallments;
  try {
    explicitInstallments = normalizeExplicitInstallments(body.installments, {
      total: totalCents / 100,
      defaultPaymentMethod: body.payment_method || "Pix"
    });
  } catch (error) {
    throw new PurchaseValidationError(error.message);
  }
  const installmentCount = explicitInstallments?.length || Number(body.installment_count || 1);
  splitInstallmentCents(totalCents, installmentCount);
  const key = String(idempotencyKey || body.idempotency_key || "").trim();
  if (!key) throw new PurchaseValidationError("Informe a chave de idempotência da compra.");
  if (key.length > 120) throw new PurchaseValidationError("Idempotency-Key deve ter no máximo 120 caracteres.");
  const requestedStatus = String(body.status || "confirmed").toLowerCase();
  if (!new Set(["draft", "confirmed"]).has(requestedStatus)) throw new PurchaseValidationError("Status inicial da compra inválido.");
  return {
    supplier_id: requiredId(body.supplier_id, "Fornecedor"),
    purchase_date: requiredDate(body.purchase_date, "Data da compra"),
    first_due_date: explicitInstallments?.[0]?.dueDate || requiredDate(body.first_due_date, "Primeiro vencimento"),
    installment_count: installmentCount,
    payment_method: String(body.payment_method || explicitInstallments?.[0]?.paymentMethod || "Pix").trim() || "Pix",
    installments: explicitInstallments,
    category: String(body.category || "Fornecedores").trim() || "Fornecedores",
    cost_center_id: body.cost_center_id ? requiredId(body.cost_center_id, "Centro de custo") : null,
    notes: String(body.notes || "").trim(),
    idempotency_key: key,
    status: requestedStatus,
    items: normalizedItems,
    total_cents: totalCents
  };
}

export async function getPurchase(db, id) {
  const purchase = await db.get(`
    SELECT po.*, s.name AS supplier_name, s.person_type AS supplier_person_type,
      c.name AS cost_center_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN financial_cost_centers c ON c.id = po.cost_center_id
    WHERE po.id = ?
  `, [id]);
  if (!purchase) return null;
  const items = await db.all(`
    SELECT poi.*, COALESCE(j.name, cm.name) AS item_name, poi.item_type,
      j.name AS product_name, cm.name AS consumable_name, cm.unit AS consumable_unit, j.sku AS product_sku,
      v.variation_name, v.sku AS variant_sku
    FROM purchase_order_items poi
    LEFT JOIN jewelry_inventory j ON j.id = poi.product_id
    LEFT JOIN consumables cm ON cm.id = poi.consumable_id
    LEFT JOIN jewelry_variants v ON v.id = poi.product_variant_id
    WHERE poi.purchase_order_id = ?
    ORDER BY poi.id
  `, [id]);
  const payables = await db.all(`
    SELECT id, amount, paid_amount, due_date, status, payment_method,
      installment_number, installment_count, source_key
    FROM financial_entries
    WHERE source_type = 'purchase_order' AND source_id = ?
    ORDER BY installment_number, id
  `, [id]);
  const storedInstallments = parseStoredInstallments(purchase.installments_json);
  const { installments_json: _installmentsJson, ...purchaseData } = purchase;
  return { ...purchaseData, installments: storedInstallments, items, payables };
}

export async function listPurchases(db, { status = "", supplierId = null } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push("po.status = ?");
    params.push(status);
  }
  if (supplierId) {
    clauses.push("po.supplier_id = ?");
    params.push(supplierId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const purchases = await db.all(`
    SELECT po.*, s.name AS supplier_name, s.person_type AS supplier_person_type,
      c.name AS cost_center_name,
      (SELECT COUNT(*)::int FROM purchase_order_items poi WHERE poi.purchase_order_id = po.id) AS item_count
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN financial_cost_centers c ON c.id = po.cost_center_id
    ${where}
    ORDER BY po.purchase_date DESC, po.id DESC
  `, params);
  return purchases.map((purchase) => {
    const { installments_json: installmentsJson, ...purchaseData } = purchase;
    return { ...purchaseData, installments: parseStoredInstallments(installmentsJson) };
  });
}

async function validatePurchaseReferences(db, purchase) {
  const supplier = await db.get("SELECT * FROM suppliers WHERE id = ? AND is_active = 1", [purchase.supplier_id]);
  if (!supplier) throw new PurchaseValidationError("Fornecedor ativo não encontrado.", 404);
  if (purchase.cost_center_id) {
    const center = await db.get("SELECT id FROM financial_cost_centers WHERE id = ? AND is_active = 1", [purchase.cost_center_id]);
    if (!center) throw new PurchaseValidationError("Centro de custo ativo não encontrado.", 404);
  }
  return supplier;
}

async function confirmPurchaseLocked(tx, purchase, userId) {
  if (purchase.status === "confirmed") return { purchaseId: purchase.id, idempotent: true };
  if (purchase.status !== "draft") throw new PurchaseValidationError("Somente compra em rascunho pode ser confirmada.", 409);
  const items = await tx.all("SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY id", [purchase.id]);
  if (!items.length) throw new PurchaseValidationError("A compra não possui itens.");

  const touchedProducts = new Set();
  for (const item of items) {
    if (item.item_type === "consumable") {
      const consumable = await tx.get("SELECT * FROM consumables WHERE id = ? FOR UPDATE", [item.consumable_id]);
      if (!consumable || consumable.status === "archived") throw new PurchaseValidationError(`Material ${item.consumable_id} não está disponível para entrada.`, 409);
      const previousQuantity = Number(consumable.quantity || 0);
      const nextQuantity = previousQuantity + Number(item.quantity);
      const previousCost = Number(consumable.cost_value || 0);
      const incomingCost = Number(item.unit_cost || 0);
      const averageCost = nextQuantity > 0 ? Number(((previousQuantity * previousCost + Number(item.quantity) * incomingCost) / nextQuantity).toFixed(2)) : incomingCost;
      await tx.run("UPDATE consumables SET quantity=?, cost_value=?, updated_at=to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id=?", [nextQuantity, averageCost, consumable.id]);
      await tx.run(
        `INSERT INTO consumable_stock_movements
          (consumable_id, movement_type, quantity, notes, movement_date, purchase_order_id, purchase_order_item_id)
         VALUES (?, 'Entrada', ?, ?, ?, ?, ?)`,
        [consumable.id, item.quantity, `Entrada automática da compra #${purchase.id}`, purchase.purchase_date, purchase.id, item.id]
      );
      if (item.batch_code || item.expiry_date) {
        await tx.run(`
          INSERT INTO consumable_lots
            (consumable_id, purchase_order_id, purchase_order_item_id, batch_code, expiry_date, received_quantity, remaining_quantity, unit_cost, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [consumable.id, purchase.id, item.id, item.batch_code || "", item.expiry_date || null, item.quantity, item.quantity, item.unit_cost || 0,
          `Lote criado automaticamente pela compra #${purchase.id}`]);
      }
      continue;
    }
    const product = await tx.get("SELECT * FROM jewelry_inventory WHERE id = ? FOR UPDATE", [item.product_id]);
    if (!product || product.status === "arquivado") throw new PurchaseValidationError(`Produto ${item.product_id} não está disponível para entrada.`, 409);
    if (item.product_variant_id) {
      const variant = await tx.get("SELECT * FROM jewelry_variants WHERE id = ? FOR UPDATE", [item.product_variant_id]);
      if (!variant || Number(variant.jewelry_id) !== Number(item.product_id) || Number(variant.is_active) !== 1) {
        throw new PurchaseValidationError(`Variação inválida para o produto ${product.name}.`, 409);
      }
      const previousQuantity = Number(variant.quantity || 0);
      const nextQuantity = previousQuantity + Number(item.quantity);
      const previousCostCents = Number(variant.purchase_cost_cents || 0) || moneyToCents(variant.cost_value || 0, "Custo anterior");
      const incomingCostCents = moneyToCents(item.unit_cost, "Custo da compra");
      const averageCostCents = Math.round((previousQuantity * previousCostCents + Number(item.quantity) * incomingCostCents) / nextQuantity);
      const totalCostCents = averageCostCents + Number(variant.allocated_freight_cents || 0) + Number(variant.additional_cost_cents || 0);
      const suggestedPriceCents = applyPriceRounding(Math.round(totalCostCents * Number(variant.price_multiplier || 3)), variant.price_rounding_mode || "exact");
      const manualPrice = Number(variant.price_manually_overridden || 0) === 1;
      const salePriceCents = manualPrice
        ? Number(variant.sale_price_cents || 0) || moneyToCents(variant.sale_value || 0, "Preço de venda")
        : suggestedPriceCents;
      await tx.run(
        `UPDATE jewelry_variants SET quantity = ?, cost_value = ?, purchase_cost_cents = ?,
          total_cost_cents = ?, suggested_price_cents = ?, sale_price_cents = ?, sale_value = ?,
          cost_estimated = 0, status = 'disponível', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [nextQuantity, averageCostCents / 100, averageCostCents, totalCostCents, suggestedPriceCents, salePriceCents, salePriceCents / 100, variant.id]
      );
      touchedProducts.add(Number(item.product_id));
    } else {
      const activeVariants = await tx.get("SELECT COUNT(*)::int AS total FROM jewelry_variants WHERE jewelry_id = ? AND is_active = 1", [item.product_id]);
      if (Number(activeVariants.total || 0) > 0) {
        throw new PurchaseValidationError(`Selecione a variação que recebeu estoque em ${product.name}.`, 409);
      }
      const previousQuantity = Number(product.quantity || 0);
      const nextQuantity = previousQuantity + Number(item.quantity);
      const previousCostCents = Number(product.purchase_cost_cents || 0) || moneyToCents(product.cost_value || 0, "Custo anterior");
      const incomingCostCents = moneyToCents(item.unit_cost, "Custo da compra");
      const averageCostCents = Math.round((previousQuantity * previousCostCents + Number(item.quantity) * incomingCostCents) / nextQuantity);
      const totalCostCents = averageCostCents + Number(product.allocated_freight_cents || 0) + Number(product.additional_cost_cents || 0);
      const suggestedPriceCents = applyPriceRounding(Math.round(totalCostCents * Number(product.price_multiplier || 3)), product.price_rounding_mode || "exact");
      const manualPrice = Number(product.price_manually_overridden || 0) === 1;
      const salePriceCents = manualPrice
        ? Number(product.sale_price_cents || 0) || moneyToCents(product.sale_value || 0, "Preço de venda")
        : suggestedPriceCents;
      await tx.run(
        `UPDATE jewelry_inventory SET quantity = ?, cost_value = ?, purchase_cost_cents = ?,
          total_cost_cents = ?, suggested_price_cents = ?, sale_price_cents = ?, sale_value = ?,
          cost_estimated = 0, status = 'disponível', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [nextQuantity, averageCostCents / 100, averageCostCents, totalCostCents, suggestedPriceCents, salePriceCents, salePriceCents / 100, product.id]
      );
    }
    await tx.run(`
      INSERT INTO stock_movements
        (jewelry_id, variant_id, movement_type, quantity, notes, movement_date, purchase_order_id, purchase_order_item_id)
      VALUES (?, ?, 'Entrada', ?, ?, ?, ?, ?)
    `, [
      item.product_id,
      item.product_variant_id,
      item.quantity,
      `Entrada automática da compra #${purchase.id}`,
      purchase.purchase_date,
      purchase.id,
      item.id
    ]);
  }
  for (const productId of touchedProducts) await syncProductInventory(tx, productId);

  const totalCents = moneyToCents(purchase.total_value, "Total da compra");
  let installments;
  try {
    installments = resolveInstallmentSchedule({
      total: totalCents / 100,
      installments: parseStoredInstallments(purchase.installments_json),
      installmentCount: purchase.installment_count,
      firstDueDate: purchase.first_due_date,
      paymentMethod: purchase.payment_method || "Pix"
    });
  } catch (error) {
    throw new PurchaseValidationError(error.message);
  }
  for (const installment of installments) {
    const number = installment.number;
    await tx.run(`
      INSERT INTO financial_entries
        (entry_type, description, category, amount, paid_amount, due_date, competence_date, status,
         payment_method, cost_center_id, supplier_id, responsible_user_id, notes,
         installment_number, installment_count, source_type, source_id, source_key)
      VALUES ('payable', ?, ?, ?, 0, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, 'purchase_order', ?, ?)
      ON CONFLICT (source_key) DO NOTHING
    `, [
      `Compra #${purchase.id}`,
      purchase.category || "Fornecedores",
      installment.amount,
      installment.dueDate,
      purchase.purchase_date,
      installment.paymentMethod,
      purchase.cost_center_id,
      purchase.supplier_id,
      userId || purchase.created_by_user_id || null,
      purchase.notes || "",
      number,
      installment.count,
      purchase.id,
      `purchase:${purchase.id}:installment:${number}`
    ]);
  }
  await tx.run(
    "UPDATE purchase_orders SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ?",
    [localTimestamp(), localTimestamp(), purchase.id]
  );
  return { purchaseId: purchase.id, idempotent: false };
}

export async function confirmPurchase(db, id, userId = null) {
  const result = await db.transaction(async (tx) => {
    const purchase = await tx.get("SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE", [id]);
    if (!purchase) throw new PurchaseValidationError("Compra não encontrada.", 404);
    await validatePurchaseReferences(tx, purchase);
    return confirmPurchaseLocked(tx, purchase, userId);
  });
  return { ...(await getPurchase(db, result.purchaseId)), idempotent: result.idempotent };
}

export async function createPurchase(db, body, { idempotencyKey = "", userId = null } = {}) {
  const purchase = normalizePurchase(body, idempotencyKey);
  const existing = await db.get("SELECT id FROM purchase_orders WHERE idempotency_key = ?", [purchase.idempotency_key]);
  if (existing) return { ...(await getPurchase(db, existing.id)), idempotent: true };

  try {
    const result = await db.transaction(async (tx) => {
      await validatePurchaseReferences(tx, purchase);
      const inserted = await tx.run(`
        INSERT INTO purchase_orders
          (supplier_id, purchase_date, first_due_date, installment_count, payment_method, category,
           installments_json, cost_center_id, total_value, status, idempotency_key, notes, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?) RETURNING id
      `, [
        purchase.supplier_id, purchase.purchase_date, purchase.first_due_date, purchase.installment_count,
        purchase.payment_method, purchase.category,
        purchase.installments ? JSON.stringify(serializeInstallments(purchase.installments)) : null,
        purchase.cost_center_id, purchase.total_cents / 100,
        purchase.idempotency_key, purchase.notes, userId
      ]);
      for (const item of purchase.items) {
        await tx.run(`
          INSERT INTO purchase_order_items
          (purchase_order_id, item_type, product_id, consumable_id, product_variant_id, quantity, unit_cost, line_total, batch_code, expiry_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [inserted.returnedId, item.item_type, item.product_id, item.consumable_id, item.product_variant_id, item.quantity, item.unit_cost_cents / 100, item.line_total_cents / 100, item.batch_code, item.expiry_date]);
      }
      if (purchase.status === "draft") return { purchaseId: inserted.returnedId, idempotent: false };
      const locked = await tx.get("SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE", [inserted.returnedId]);
      return confirmPurchaseLocked(tx, locked, userId);
    });
    return { ...(await getPurchase(db, result.purchaseId)), idempotent: result.idempotent };
  } catch (error) {
    if (error?.code === "23505" && String(error.constraint || "").includes("purchase_orders_idempotency")) {
      const duplicate = await db.get("SELECT id FROM purchase_orders WHERE idempotency_key = ?", [purchase.idempotency_key]);
      if (duplicate) return { ...(await getPurchase(db, duplicate.id)), idempotent: true };
    }
    throw error;
  }
}

export async function deleteDraftPurchase(db, id) {
  return db.transaction(async (tx) => {
    const purchase = await tx.get("SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE", [id]);
    if (!purchase) throw new PurchaseValidationError("Compra não encontrada.", 404);
    if (purchase.status !== "draft") {
      throw new PurchaseValidationError("Compra confirmada não pode ser apagada porque já movimentou estoque e financeiro.", 409);
    }
    await tx.run("DELETE FROM purchase_orders WHERE id = ?", [id]);
    return { ok: true };
  });
}
