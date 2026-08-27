import { localTimestamp, variantStatus } from "./utils.js";
import { syncProductInventory } from "./inventory.js";

const FINANCIAL_ACTIONS = new Set(["none", "client_credit", "manual_refund"]);
const CONDITIONS = new Set(["sellable", "damaged", "discarded"]);

function requiredReason(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("Motivo da devolução é obrigatório.");
  return text;
}

function normalizeItems(rawItems) {
  const seen = new Set();
  if (!Array.isArray(rawItems) || !rawItems.length) throw new Error("Informe ao menos um item devolvido.");
  return rawItems.map((item, index) => {
    const itemId = Number(item?.sales_order_item_id);
    const quantity = Number(item?.quantity);
    if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(quantity) || quantity <= 0) throw new Error(`Item ${index + 1} inválido.`);
    if (seen.has(itemId)) throw new Error("Um item só pode constar uma vez na devolução.");
    seen.add(itemId);
    const condition = String(item?.condition || "sellable");
    if (!CONDITIONS.has(condition)) throw new Error("Condição do item devolvido inválida.");
    return { itemId, quantity, returnToStock: item?.return_to_stock !== false && condition === "sellable", condition, notes: String(item?.notes || "").trim() };
  });
}

async function reducePendingReceivables(db, orderId, amount, reason) {
  let remaining = Number(amount || 0);
  const entries = await db.all(`
    SELECT * FROM financial_entries
     WHERE source_type='sales_order' AND source_id=? AND entry_type='receivable'
       AND status IN ('pending','overdue','partially_paid')
     ORDER BY due_date DESC, id DESC FOR UPDATE`, [orderId]);
  for (const entry of entries) {
    if (remaining <= 0) break;
    const openAmount = Math.max(0, Number(entry.amount || 0) - Number(entry.paid_amount || 0));
    if (!openAmount) continue;
    const reduced = Math.min(openAmount, remaining);
    const nextAmount = Number((Number(entry.amount) - reduced).toFixed(2));
    if (nextAmount <= Number(entry.paid_amount || 0) + 0.0001) {
      await db.run(`UPDATE financial_entries SET status='canceled', lifecycle_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [reason, entry.id]);
    } else {
      await db.run("UPDATE financial_entries SET amount=?, lifecycle_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [nextAmount, reason, entry.id]);
    }
    await db.run("INSERT INTO financial_entry_audit (entry_id, user_id, action, before_data, after_data) VALUES (?, NULL, 'sales_return_reduce_receivable', ?, ?)",
      [entry.id, JSON.stringify({ amount: entry.amount, status: entry.status }), JSON.stringify({ amount: nextAmount, reduced, reason })]);
    remaining = Number((remaining - reduced).toFixed(2));
  }
  return Number((amount - remaining).toFixed(2));
}

async function restoreReturnedStock(db, item, returnItemId, returnId) {
  if (!item.returnToStock || !item.product_id) return;
  const originalMovement = await db.get(`
    SELECT variant_id FROM stock_movements
     WHERE sales_order_item_id=? AND movement_type='Saida'
     ORDER BY id DESC LIMIT 1`, [item.itemId]);
  const variantId = originalMovement?.variant_id || item.product_variant_id || null;
  if (variantId) {
    const variant = await db.get("SELECT * FROM jewelry_variants WHERE id=? FOR UPDATE", [variantId]);
    if (!variant) throw new Error("Variação original da venda não foi encontrada.");
    const quantity = Number(variant.quantity || 0) + item.quantity;
    await db.run("UPDATE jewelry_variants SET quantity=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [quantity, variantStatus(quantity, variant.low_stock_threshold), variant.id]);
    await db.run(`INSERT INTO stock_movements
      (jewelry_id, variant_id, movement_type, quantity, notes, sales_return_item_id)
      VALUES (?, ?, 'Entrada', ?, ?, ?)`, [item.product_id, variant.id, item.quantity, `Devolução #${returnId}`, returnItemId]);
    await syncProductInventory(db, item.product_id);
    return;
  }
  const product = await db.get("SELECT * FROM jewelry_inventory WHERE id=? FOR UPDATE", [item.product_id]);
  if (!product) throw new Error("Produto original da venda não foi encontrado.");
  const quantity = Number(product.quantity || 0) + item.quantity;
  await db.run("UPDATE jewelry_inventory SET quantity=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [quantity, variantStatus(quantity, product.low_stock_threshold), product.id]);
  await db.run(`INSERT INTO stock_movements
    (jewelry_id, movement_type, quantity, notes, sales_return_item_id)
    VALUES (?, 'Entrada', ?, ?, ?)`, [item.product_id, item.quantity, `Devolução #${returnId}`, returnItemId]);
}

export async function createSalesReturn(db, orderId, body = {}, userId = null) {
  const financialAction = String(body.financial_action || "none");
  if (!FINANCIAL_ACTIONS.has(financialAction)) throw new Error("Ação financeira da devolução inválida.");
  const reason = requiredReason(body.reason);
  const items = normalizeItems(body.items);
  return db.transaction(async (tx) => {
    const order = await tx.get("SELECT * FROM sales_orders WHERE id=? FOR UPDATE", [orderId]);
    if (!order) throw new Error("Venda não encontrada.");
    if (order.source === "agenda") throw new Error("Atendimentos da agenda usam o cancelamento do atendimento, não devolução de venda avulsa.");
    if (!Number(order.stock_deducted)) throw new Error("A devolução só pode ocorrer depois da conclusão e baixa do estoque.");
    const resolved = [];
    for (const requested of items) {
      const item = await tx.get("SELECT * FROM sales_order_items WHERE id=? AND sales_order_id=? FOR UPDATE", [requested.itemId, order.id]);
      if (!item || item.item_type !== "produto" || !item.product_id) throw new Error("Item de produto da venda não encontrado.");
      const returned = await tx.get(`SELECT COALESCE(SUM(ri.quantity),0) AS quantity
        FROM sales_return_items ri JOIN sales_returns sr ON sr.id=ri.sales_return_id
        WHERE ri.sales_order_item_id=?`, [item.id]);
      const available = Number(item.quantity || 0) - Number(returned?.quantity || 0);
      if (requested.quantity > available) throw new Error(`A devolução de ${item.item_name} supera a quantidade ainda devolvível (${available}).`);
      resolved.push({ ...requested, ...item, unit_price: Number(item.unit_price || 0) });
    }
    const totalValue = Number(resolved.reduce((sum, item) => sum + item.quantity * item.unit_price, 0).toFixed(2));
    const pendingReduction = await reducePendingReceivables(tx, order.id, totalValue, `Redução pela devolução de venda #${order.id}`);
    const paidValue = Number((totalValue - pendingReduction).toFixed(2));
    if (paidValue > 0 && financialAction === "none") throw new Error("A devolução alcança valor já recebido; escolha crédito do cliente ou reembolso manual.");
    if (paidValue === 0 && financialAction !== "none") throw new Error("A devolução foi totalmente abatida de títulos pendentes; não há valor recebido para crédito ou reembolso.");
    const created = await tx.run(`
      INSERT INTO sales_returns (sales_order_id, client_id, financial_action, total_value, financial_value, refund_method, reason, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, [order.id, order.client_id, financialAction, totalValue, paidValue,
        financialAction === "manual_refund" ? requiredReason(body.refund_method) : null, reason, userId]);
    for (const item of resolved) {
      const inserted = await tx.run(`INSERT INTO sales_return_items
        (sales_return_id, sales_order_item_id, quantity, unit_price, return_to_stock, condition, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, [created.returnedId, item.id, item.quantity, item.unit_price, item.returnToStock, item.condition, item.notes]);
      await restoreReturnedStock(tx, item, inserted.returnedId, created.returnedId);
    }
    if (financialAction === "client_credit" && paidValue > 0) {
      await tx.run(`INSERT INTO client_credits (client_id, sales_return_id, amount, remaining_amount, reason, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?)`, [order.client_id, created.returnedId, paidValue, paidValue, reason, userId]);
    }
    if (financialAction === "manual_refund" && paidValue > 0) {
      await tx.run(`INSERT INTO financial_entries
        (entry_type, description, category, amount, paid_amount, due_date, competence_date, status, payment_method, paid_at, responsible_user_id, notes, source_type, source_id, source_key)
        VALUES ('expense', ?, 'Estornos e reembolsos', ?, ?, ?, ?, 'paid', ?, ?, ?, ?, 'sales_return', ?, ?)
        ON CONFLICT (source_key) DO NOTHING`, [`Reembolso de devolução — venda #${order.id}`, paidValue, paidValue,
        localTimestamp().slice(0, 10), localTimestamp().slice(0, 10), body.refund_method, localTimestamp(), userId, reason,
        created.returnedId, `sales-return:${created.returnedId}:refund`]);
    }
    const totals = await tx.get(`SELECT COALESCE(SUM(ri.quantity),0) AS returned_quantity,
      (SELECT COALESCE(SUM(quantity),0) FROM sales_order_items WHERE sales_order_id=?) AS sold_quantity
      FROM sales_return_items ri JOIN sales_returns sr ON sr.id=ri.sales_return_id WHERE sr.sales_order_id=?`, [order.id, order.id]);
    if (Number(totals.returned_quantity || 0) >= Number(totals.sold_quantity || 0)) {
      await tx.run("UPDATE sales_orders SET status='devolvida' WHERE id=?", [order.id]);
    }
    return getSalesReturn(tx, created.returnedId);
  });
}

export async function getSalesReturn(db, id) {
  const row = await db.get(`SELECT sr.*, c.full_name AS client_name FROM sales_returns sr JOIN clients c ON c.id=sr.client_id WHERE sr.id=?`, [id]);
  if (!row) return null;
  const items = await db.all(`SELECT ri.*, soi.item_name, soi.product_id, soi.product_variant_id FROM sales_return_items ri
    JOIN sales_order_items soi ON soi.id=ri.sales_order_item_id WHERE ri.sales_return_id=? ORDER BY ri.id`, [id]);
  return { ...row, items };
}

export async function listSalesReturns(db, orderId) {
  const rows = await db.all("SELECT id FROM sales_returns WHERE sales_order_id=? ORDER BY id DESC", [orderId]);
  return Promise.all(rows.map((row) => getSalesReturn(db, row.id)));
}
