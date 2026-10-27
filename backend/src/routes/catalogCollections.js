// Gestão da vitrine comercial: categorias hierárquicas e campanhas.
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { requireFeature } from "../services/subscriptions.js";
import { recordAudit } from "../services/audit.js";
import {
  CatalogCollectionError,
  addCampaignProducts,
  addCategoryProducts,
  changeCampaignStatus,
  createCampaign,
  createCatalogCategory,
  createSuggestedCategories,
  deleteCampaign,
  deleteCampaignSection,
  deleteCatalogCategory,
  getCampaign,
  getStoreTimezone,
  listCampaigns,
  listCatalogCategories,
  listCategoryProducts,
  publicCampaignState,
  removeCampaignProduct,
  removeCategoryProduct,
  reorderCatalogCategories,
  saveCampaignSection,
  searchCatalogProducts,
  setStoreTimezone,
  updateCampaign,
  updateCampaignProduct,
  updateCatalogCategory
} from "../services/catalogCollections.js";

const router = Router();
const EDITORS = ["admin", "reception"];

// Categorias fazem parte do catálogo básico; campanhas usam a mesma feature
// das promoções ("Campanhas").
const withCategories = (handler) => withFeature("basic_catalog", handler);
const withCampaigns = (handler) => withFeature("basic_catalog", async (req, res, db) => {
  if (!(await requireFeature(req, res, "campaigns"))) return;
  return handler(req, res, db);
});

// Erros de regra viram resposta própria; os demais seguem para o `withDb`.
const handled = (roles, handler) => async (req, res, db) => {
  if (!requireRole(req, res, roles)) return;
  try {
    await handler(req, res, db);
  } catch (error) {
    if (!(error instanceof CatalogCollectionError)) throw error;
    res.status(error.statusCode).json({ error: error.message, code: error.code, ...error.details });
  }
};

// Toda escrita roda numa transação: validação e gravação entram juntas.
const transactional = (roles, handler) => handled(roles, (req, res, db) => db.transaction((tx) => handler(req, res, tx)));

const audit = (db, req, action, entityType, entityId, before, after) =>
  recordAudit(db, { req, module: "catalog", action, entityType, entityId, before, after });

// ---------------------------------------------------------------------------
// Público
// ---------------------------------------------------------------------------

router.get("/api/catalog/campaigns/:slug", withFeature("basic_catalog", async (req, res, db) => {
  const state = await publicCampaignState(db, req.params.slug);
  res.status(state.state === "not_found" ? 404 : 200).json(state);
}));

// ---------------------------------------------------------------------------
// Produtos para os seletores
// ---------------------------------------------------------------------------

router.get("/api/catalog-products", withCategories(handled(EDITORS, async (req, res, db) => {
  res.json(await searchCatalogProducts(db, req.query.search, req.query.limit));
})));

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

router.get("/api/catalog-categories", withCategories(handled(EDITORS, async (_req, res, db) => {
  res.json(await listCatalogCategories(db));
})));

router.post("/api/catalog-categories", withCategories(transactional(EDITORS, async (req, res, db) => {
  const category = await createCatalogCategory(db, req.body || {});
  await audit(db, req, "catalog_category_created", "catalog_category", category.id, null, category);
  res.status(201).json(category);
})));

router.post("/api/catalog-categories/suggested", withCategories(transactional(EDITORS, async (req, res, db) => {
  const result = await createSuggestedCategories(db);
  await audit(db, req, "catalog_categories_suggested", "catalog_category", null, null, result);
  res.status(201).json(result);
})));

router.patch("/api/catalog-categories/order", withCategories(transactional(EDITORS, async (req, res, db) => {
  await reorderCatalogCategories(db, req.body?.parent_id ?? null, req.body?.ids);
  res.json(await listCatalogCategories(db));
})));

router.patch("/api/catalog-categories/:id", withCategories(transactional(EDITORS, async (req, res, db) => {
  const { before, after } = await updateCatalogCategory(db, req.params.id, req.body || {});
  await audit(db, req, "catalog_category_updated", "catalog_category", after.id, before, after);
  res.json(after);
})));

router.delete("/api/catalog-categories/:id", withCategories(transactional(["admin"], async (req, res, db) => {
  const category = await deleteCatalogCategory(db, req.params.id);
  await audit(db, req, "catalog_category_deleted", "catalog_category", category.id, category, null);
  res.json({ ok: true });
})));

router.get("/api/catalog-categories/:id/products", withCategories(handled(EDITORS, async (req, res, db) => {
  res.json(await listCategoryProducts(db, req.params.id));
})));

router.post("/api/catalog-categories/:id/products", withCategories(transactional(EDITORS, async (req, res, db) => {
  const result = await addCategoryProducts(db, req.params.id, req.body?.product_ids);
  await audit(db, req, "catalog_category_products_added", "catalog_category", req.params.id, null, { product_ids: req.body?.product_ids, ...result });
  res.status(201).json(result);
})));

router.delete("/api/catalog-categories/:id/products/:productId", withCategories(transactional(EDITORS, async (req, res, db) => {
  const result = await removeCategoryProduct(db, req.params.id, req.params.productId);
  await audit(db, req, "catalog_category_product_removed", "catalog_category", req.params.id, { product_id: req.params.productId }, result);
  res.json(result);
})));

// ---------------------------------------------------------------------------
// Campanhas
// ---------------------------------------------------------------------------

router.get("/api/catalog-campaigns", withCampaigns(handled(EDITORS, async (_req, res, db) => {
  res.json(await listCampaigns(db));
})));

router.get("/api/catalog-campaigns/settings", withCampaigns(handled(EDITORS, async (_req, res, db) => {
  res.json({ timezone: await getStoreTimezone(db) });
})));

router.put("/api/catalog-campaigns/settings", withCampaigns(transactional(["admin"], async (req, res, db) => {
  const before = await getStoreTimezone(db);
  const timezone = await setStoreTimezone(db, req.body?.timezone);
  await audit(db, req, "store_timezone_updated", "clinic_settings", 1, { timezone: before }, { timezone });
  res.json({ timezone });
})));

router.post("/api/catalog-campaigns", withCampaigns(transactional(EDITORS, async (req, res, db) => {
  const campaign = await createCampaign(db, req.body || {}, req.user?.id || null);
  await audit(db, req, "catalog_campaign_created", "catalog_campaign", campaign.id, null, campaign);
  res.status(201).json(campaign);
})));

router.get("/api/catalog-campaigns/:id", withCampaigns(handled(EDITORS, async (req, res, db) => {
  res.json(await getCampaign(db, req.params.id));
})));

router.patch("/api/catalog-campaigns/:id", withCampaigns(transactional(EDITORS, async (req, res, db) => {
  const { before, after } = await updateCampaign(db, req.params.id, req.body || {});
  await audit(db, req, "catalog_campaign_updated", "catalog_campaign", after.id, before, after);
  res.json(after);
})));

router.post("/api/catalog-campaigns/:id/status", withCampaigns(transactional(EDITORS, async (req, res, db) => {
  const { before, after } = await changeCampaignStatus(db, req.params.id, String(req.body?.action || ""));
  await audit(db, req, `catalog_campaign_${String(req.body?.action || "")}`, "catalog_campaign", after.id, { status: before.status, state: before.state }, { status: after.status, state: after.state });
  res.json(after);
})));

router.delete("/api/catalog-campaigns/:id", withCampaigns(transactional(["admin"], async (req, res, db) => {
  const campaign = await deleteCampaign(db, req.params.id);
  await audit(db, req, "catalog_campaign_deleted", "catalog_campaign", campaign.id, campaign, null);
  res.json({ ok: true });
})));

router.post("/api/catalog-campaigns/:id/sections", withCampaigns(transactional(EDITORS, async (req, res, db) => {
  res.status(201).json(await saveCampaignSection(db, req.params.id, req.body || {}));
})));

router.patch("/api/catalog-campaigns/:id/sections/:sectionId", withCampaigns(transactional(EDITORS, async (req, res, db) => {
  res.json(await saveCampaignSection(db, req.params.id, req.body || {}, req.params.sectionId));
})));

router.delete("/api/catalog-campaigns/:id/sections/:sectionId", withCampaigns(transactional(EDITORS, async (req, res, db) => {
  await deleteCampaignSection(db, req.params.id, req.params.sectionId);
  res.json({ ok: true });
})));

router.post("/api/catalog-campaigns/:id/products", withCampaigns(transactional(EDITORS, async (req, res, db) => {
  const result = await addCampaignProducts(db, req.params.id, req.body?.product_ids, req.body?.section_id || null);
  await audit(db, req, "catalog_campaign_products_added", "catalog_campaign", req.params.id, null, { product_ids: req.body?.product_ids, ...result });
  res.status(201).json(result);
})));

router.patch("/api/catalog-campaigns/:id/products/:productId", withCampaigns(transactional(EDITORS, async (req, res, db) => {
  res.json(await updateCampaignProduct(db, req.params.id, req.params.productId, req.body || {}));
})));

router.delete("/api/catalog-campaigns/:id/products/:productId", withCampaigns(transactional(EDITORS, async (req, res, db) => {
  const result = await removeCampaignProduct(db, req.params.id, req.params.productId);
  await audit(db, req, "catalog_campaign_product_removed", "catalog_campaign", req.params.id, { product_id: req.params.productId }, result);
  res.json(result);
})));

export default router;
