import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { P } from "../config/permissions.js";
import {
  PurchaseValidationError,
  confirmPurchase,
  createPurchase,
  deleteDraftPurchase,
  getPurchase,
  listPurchases
} from "../services/purchases.js";

const router = Router();

function purchaseError(res, error) {
  if (!(error instanceof PurchaseValidationError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

router.get("/api/purchases", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_VIEW)) return;
  const status = String(req.query.status || "").trim();
  if (status && !["draft", "confirmed", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "Status de compra inválido." });
  }
  const supplierId = req.query.supplier_id ? Number(req.query.supplier_id) : null;
  if (supplierId !== null && (!Number.isInteger(supplierId) || supplierId <= 0)) {
    return res.status(400).json({ error: "Fornecedor inválido." });
  }
  res.json(await listPurchases(db, { status, supplierId }));
}));

router.get("/api/purchases/:id", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_VIEW)) return;
  const purchase = await getPurchase(db, req.params.id);
  if (!purchase) return res.status(404).json({ error: "Compra não encontrada." });
  res.json(purchase);
}));

router.post("/api/purchases", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_CREATE)) return;
  try {
    const purchase = await createPurchase(db, req.body || {}, {
      idempotencyKey: req.get("Idempotency-Key"),
      userId: req.user?.id || null
    });
    res.status(purchase.idempotent ? 200 : 201).json(purchase);
  } catch (error) {
    if (!purchaseError(res, error)) throw error;
  }
}));

router.post("/api/purchases/:id/confirm", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_CREATE)) return;
  try {
    res.json(await confirmPurchase(db, req.params.id, req.user?.id || null));
  } catch (error) {
    if (!purchaseError(res, error)) throw error;
  }
}));

router.delete("/api/purchases/:id", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_CANCEL)) return;
  try {
    res.json(await deleteDraftPurchase(db, req.params.id));
  } catch (error) {
    if (!purchaseError(res, error)) throw error;
  }
}));

export default router;
