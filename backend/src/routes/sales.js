// Rotas de vendas (pedidos).
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { createSalesOrder, listSalesOrders, countSalesOrders, getSalesOrder } from "../services/sales.js";
import { parsePaging, pageResponse } from "../services/pagination.js";

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
  const order = await createSalesOrder(db, req.body || {}, req.user);
  if (!order) return res.status(400).json({ error: "Não foi possível criar a venda." });
  res.status(201).json(order);
}));

router.post("/api/sales-orders/public", withDb(async (req, res, db) => {
  const order = await createSalesOrder(db, req.body || {}, null);
  if (!order) return res.status(400).json({ error: "Não foi possível criar a venda." });
  res.status(201).json(order);
}));

router.patch("/api/sales-orders/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance", "reception"])) return;
  const current = await db.get("SELECT * FROM sales_orders WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Venda não encontrada." });
  await db.run(
    "UPDATE sales_orders SET status = ?, payment_method = ?, notes = ? WHERE id = ?",
    [req.body.status || current.status, req.body.payment_method || current.payment_method, req.body.notes || current.notes, req.params.id]
  );
  res.json(await getSalesOrder(db, req.params.id));
}));

export default router;
