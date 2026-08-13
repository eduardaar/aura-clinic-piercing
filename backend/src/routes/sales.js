// Rotas de vendas (pedidos).
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { createSalesOrder, listSalesOrders, countSalesOrders, getSalesOrder, SalesOrderValidationError } from "../services/sales.js";
import { parsePaging, pageResponse } from "../services/pagination.js";
import { tenantClient } from "../services/asaas/credentials.js";
import { createSalesOrderCharge } from "../services/tenantCharges.js";
import { publicPaymentIntent } from "../services/payments.js";

const router = Router();

// Whitelist de ordenação: a query só escolhe a CHAVE, nunca a coluna.
const SALES_SORTABLE = {
  created_at: "so.created_at",
  total: "so.total_value",
  status: "so.status",
  client: "c.full_name"
};

router.get("/api/sales-orders", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance", "reception", "piercer"])) return;
  const clauses = [];
  const params = [];
  if (req.query.status) {
    clauses.push("so.status = ?");
    params.push(req.query.status);
  }
  if (req.query.client_id) {
    clauses.push("so.client_id = ?");
    params.push(req.query.client_id);
  }
  if (req.query.from) {
    clauses.push("so.created_at >= ?");
    params.push(req.query.from);
  }
  if (req.query.to) {
    clauses.push("so.created_at <= ?");
    params.push(`${req.query.to} 23:59:59`);
  }
  if (req.query.search) {
    clauses.push("(c.full_name ILIKE ? OR c.whatsapp ILIKE ?)");
    params.push(`%${req.query.search}%`, `%${req.query.search}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: SALES_SORTABLE,
    tieBreak: "so.id",
    defaultOrderBy: "ORDER BY so.created_at DESC, so.id DESC"
  });
  const items = await listSalesOrders(db, { where, params, paging });
  const total = paging.paginated ? await countSalesOrders(db, { where, params }) : items.length;
  res.json(pageResponse(items, total, paging));
}));

router.post("/api/sales-orders", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance", "reception", "piercer"])) return;
  let order;
  try {
    order = await createSalesOrder(db, req.body || {}, req.user);
  } catch (error) {
    // Recusa de regra de negócio (estoque insuficiente, cupom inválido) é 400
    // com o motivo em texto: sem isto virava 500 e a tela só dizia "erro".
    if (error instanceof SalesOrderValidationError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  if (!order) return res.status(400).json({ error: "Não foi possível criar a venda." });
  res.status(201).json(order);
}));

router.post("/api/sales-orders/public", withDb(async (req, res, db) => {
  let order;
  try {
    order = await createSalesOrder(db, req.body || {}, null);
  } catch (error) {
    if (error instanceof SalesOrderValidationError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  if (!order) return res.status(400).json({ error: "Não foi possível criar a venda." });

  // Cobrança online do pedido, quando a clínica tem gateway configurado.
  //
  // Fica FORA da transação de `createSalesOrder` de propósito: é uma chamada de
  // rede, e prendê-la ali seguraria o lock das reservas de estoque pelo tempo
  // do round-trip. Se o Asaas falhar, o pedido continua de pé e a clínica cobra
  // pelo caminho de sempre — o serviço devolve `online_payment_available:
  // false` em vez de lançar.
  //
  // Só pedido que ainda não está pago: venda registrada como paga (balcão) não
  // precisa de link.
  let paymentIntent = null;
  if (["pendente", "aberta"].includes(String(order.status)) && Number(order.total_value) > 0) {
    try {
      if (await tenantClient(db)) {
        paymentIntent = await createSalesOrderCharge(db, {
          salesOrderId: order.id,
          clientId: order.client_id,
          amount: order.total_value,
          description: `Pedido #${order.id}`,
          // Mesma chave do pedido: reenvio do formulário reaproveita a cobrança
          // em vez de emitir uma segunda fatura para o mesmo carrinho.
          idempotencyKey: `sales-order:${order.id}`
        });
      }
    } catch (error) {
      console.error(`[Asaas] cobrança do pedido ${order.id}: ${error.message}`);
    }
  }

  res.status(201).json({
    ...order,
    payment_intent: publicPaymentIntent(paymentIntent),
    payment_url: paymentIntent?.invoice_url || null,
    online_payment_available: Boolean(paymentIntent?.online_payment_available)
  });
}));

router.patch("/api/sales-orders/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance", "reception", "piercer"])) return;
  const current = await db.get("SELECT * FROM sales_orders WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Venda não encontrada." });
  await db.run(
    "UPDATE sales_orders SET status = ?, payment_method = ?, notes = ? WHERE id = ?",
    [req.body.status || current.status, req.body.payment_method || current.payment_method, req.body.notes || current.notes, req.params.id]
  );
  res.json(await getSalesOrder(db, req.params.id));
}));

export default router;
