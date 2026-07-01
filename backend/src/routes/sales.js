// Rotas de vendas (pedidos).
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { createSalesOrder, listSalesOrders } from "../services/sales.js";

const router = Router();

router.get("/api/sales-orders", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance", "reception", "piercer"])) return;
  res.json(await listSalesOrders(db));
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
  res.json((await listSalesOrders(db)).find((item) => item.id === Number(req.params.id)));
}));

export default router;
