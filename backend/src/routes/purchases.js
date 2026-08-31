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
import { NfeImportError, previewNfeImport } from "../services/nfeImport.js";
import { recordAudit } from "../services/audit.js";

const router = Router();

function purchaseError(res, error) {
  if (!(error instanceof PurchaseValidationError) && !(error instanceof NfeImportError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

router.post("/api/purchases/nfe/preview", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_CREATE)) return;
  try {
    const preview = await previewNfeImport(db, req.body?.xml);
    await recordAudit(db, {
      req,
      module: "purchases",
      action: "nfe_preview",
      entityType: "nfe",
      entityId: preview.access_key,
      metadata: { xml_hash: preview.xml_hash, issuer_document: preview.issuer.document, item_count: preview.items.length }
    });
    res.json(preview);
  } catch (error) {
    if (!purchaseError(res, error)) throw error;
  }
}));

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
    if (!purchase.idempotent) {
      await recordAudit(db, {
        req, module: "purchases", action: "create", entityType: "purchase", entityId: purchase.id,
        reason: purchase.fiscal_document_id ? "Compra criada por importação fiscal" : "Compra criada",
        after: { id: purchase.id, supplier_id: purchase.supplier_id, status: purchase.status, total_value: purchase.total_value }
      });
    }
    res.status(purchase.idempotent ? 200 : 201).json(purchase);
  } catch (error) {
    if (!purchaseError(res, error)) throw error;
  }
}));

router.post("/api/purchases/:id/confirm", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_CREATE)) return;
  try {
    const purchase = await confirmPurchase(db, req.params.id, req.user?.id || null);
    await recordAudit(db, {
      req, module: "purchases", action: "confirm", entityType: "purchase", entityId: req.params.id,
      reason: "Entrada de compra confirmada", after: { id: purchase.id, status: purchase.status, total_value: purchase.total_value }, severity: "warning"
    });
    res.json(purchase);
  } catch (error) {
    if (!purchaseError(res, error)) throw error;
  }
}));

router.delete("/api/purchases/:id", withFeature("basic_finance", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_CANCEL)) return;
  try {
    const result = await deleteDraftPurchase(db, req.params.id);
    await recordAudit(db, {
      req, module: "purchases", action: "delete_draft", entityType: "purchase", entityId: req.params.id,
      reason: String(req.body?.reason || "Rascunho de compra removido"), severity: "warning"
    });
    res.json(result);
  } catch (error) {
    if (!purchaseError(res, error)) throw error;
  }
}));

export default router;
