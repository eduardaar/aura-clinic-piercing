// Rotas de opções gerais e opções de inventário (categorias, tamanhos, espessuras).
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { JEWELRY_CATEGORIES, ARGOLA_SUBCATEGORIES } from "../config/index.js";
import { groupInventoryOptions } from "../services/utils.js";
import { attachVariants, countOptionUsage } from "../services/inventory.js";
import { getPricingSettings, savePricingSettings } from "../services/pricing.js";
import { boolNumber } from "../services/utils.js";

const router = Router();

router.get("/api/options", withDb(async (_req, res, db) => {
  const professionals = await db.all("SELECT * FROM professionals WHERE active = 1 ORDER BY name");
  const jewelry = await attachVariants(db, await db.all("SELECT * FROM jewelry_inventory ORDER BY name"));
  const inventoryOptions = await db.all("SELECT * FROM inventory_options ORDER BY type, name");
  const pricingSettings = await getPricingSettings(db);
  const categoryManagement = await listInventoryCategories(db);
  res.json({
    professionals,
    jewelry,
    jewelryCategories: JEWELRY_CATEGORIES,
    jewelrySubcategories: { Argolas: ARGOLA_SUBCATEGORIES },
    inventoryOptions: groupInventoryOptions(inventoryOptions),
    categoryManagement,
    pricingSettings
  });
}));

async function listInventoryCategories(db) {
  const rows = await db.all(`
    SELECT
      o.*,
      COALESCE(product_stats.product_count, 0) AS product_count,
      COALESCE(product_stats.total_stock, 0) AS total_stock,
      COALESCE(variant_stats.variant_count, 0) AS variant_count
    FROM inventory_options o
    LEFT JOIN (
      SELECT category, COUNT(*)::int AS product_count, COALESCE(SUM(quantity), 0)::int AS total_stock
      FROM jewelry_inventory
      WHERE status != 'arquivado'
      GROUP BY category
    ) product_stats ON product_stats.category = o.name
    LEFT JOIN (
      SELECT j.category, COUNT(v.id)::int AS variant_count
      FROM jewelry_inventory j
      LEFT JOIN jewelry_variants v ON v.jewelry_id = j.id AND v.is_active = 1
      WHERE j.status != 'arquivado'
      GROUP BY j.category
    ) variant_stats ON variant_stats.category = o.name
    WHERE o.type = 'category'
    ORDER BY o.is_active DESC, o.name
  `);
  const optionNames = new Set(rows.map((row) => row.name));
  const missingRows = await db.all(`
    SELECT
      category AS name,
      COUNT(*)::int AS product_count,
      COALESCE(SUM(quantity), 0)::int AS total_stock,
      1 AS is_active,
      '' AS description
    FROM jewelry_inventory
    WHERE status != 'arquivado' AND COALESCE(category, '') != ''
    GROUP BY category
    ORDER BY category
  `);
  const missing = [];
  for (const item of missingRows) {
    if (optionNames.has(item.name)) continue;
    const variant = await db.get(`
      SELECT COUNT(v.id)::int AS variant_count
      FROM jewelry_inventory j
      LEFT JOIN jewelry_variants v ON v.jewelry_id = j.id AND v.is_active = 1
      WHERE j.status != 'arquivado' AND j.category = ?
    `, [item.name]);
    missing.push({ ...item, id: null, type: "category", variant_count: Number(variant?.variant_count || 0), virtual: true });
  }
  return [...rows, ...missing];
}

async function ensureCategoryExists(db, name, { activeOnly = false } = {}) {
  const category = await db.get("SELECT * FROM inventory_options WHERE type = 'category' AND name = ?", [name]);
  if (!category) return null;
  if (activeOnly && !Number(category.is_active ?? 1)) return null;
  return category;
}

async function categoryById(db, id) {
  return db.get("SELECT * FROM inventory_options WHERE type = 'category' AND id = ?", [id]);
}

async function moveCategoryProducts(db, fromName, toName) {
  const result = await db.run("UPDATE jewelry_inventory SET category = ? WHERE category = ?", [toName, fromName]);
  return result.changes || 0;
}

router.get("/api/inventory-categories", withDb(async (_req, res, db) => {
  res.json(await listInventoryCategories(db));
}));

router.post("/api/inventory-categories", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Nome da categoria é obrigatório." });
  const existing = await ensureCategoryExists(db, name);
  if (existing) return res.status(409).json({ error: "Já existe uma categoria com esse nome." });
  const result = await db.run(
    "INSERT INTO inventory_options (type, name, description, is_active) VALUES ('category', ?, ?, ?)",
    [name, String(req.body.description || "").trim(), boolNumber(req.body.is_active ?? 1)]
  );
  res.status(201).json(await db.get("SELECT * FROM inventory_options WHERE id = ?", [result.lastID]));
}));

router.patch("/api/inventory-categories/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const category = await categoryById(db, req.params.id);
  if (!category) return res.status(404).json({ error: "Categoria não encontrada." });
  const nextName = req.body.name !== undefined ? String(req.body.name || "").trim() : category.name;
  if (!nextName) return res.status(400).json({ error: "Nome da categoria é obrigatório." });
  const duplicate = await db.get("SELECT id FROM inventory_options WHERE type = 'category' AND name = ? AND id != ?", [nextName, category.id]);
  if (duplicate) return res.status(409).json({ error: "Já existe uma categoria com esse nome." });
  await db.run("BEGIN");
  try {
    await db.run(
      "UPDATE inventory_options SET name = ?, description = ?, is_active = ? WHERE id = ?",
      [
        nextName,
        req.body.description !== undefined ? String(req.body.description || "").trim() : category.description || "",
        req.body.is_active !== undefined ? boolNumber(req.body.is_active) : Number(category.is_active ?? 1),
        category.id
      ]
    );
    if (nextName !== category.name) {
      await moveCategoryProducts(db, category.name, nextName);
    }
    await db.run("COMMIT");
    res.json((await listInventoryCategories(db)).find((item) => Number(item.id) === Number(category.id)));
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    throw error;
  }
}));

router.post("/api/inventory-categories/:id/move-products", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const source = await categoryById(db, req.params.id);
  if (!source) return res.status(404).json({ error: "Categoria de origem não encontrada." });
  const target = await ensureCategoryExists(db, String(req.body.target_category || "").trim(), { activeOnly: true });
  if (!target) return res.status(400).json({ error: "Categoria de destino ativa não encontrada." });
  if (source.name === target.name) return res.status(400).json({ error: "Origem e destino não podem ser iguais." });
  await db.run("BEGIN");
  try {
    const moved = await moveCategoryProducts(db, source.name, target.name);
    await db.run("COMMIT");
    res.json({ ok: true, moved, source: source.name, target: target.name });
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    throw error;
  }
}));

router.post("/api/inventory-categories/merge", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const source = await ensureCategoryExists(db, String(req.body.source_category || "").trim());
  const target = await ensureCategoryExists(db, String(req.body.target_category || "").trim(), { activeOnly: true });
  if (!source || !target) return res.status(400).json({ error: "Categoria de origem ou destino não encontrada." });
  if (source.name === target.name) return res.status(400).json({ error: "Origem e destino não podem ser iguais." });
  await db.run("BEGIN");
  try {
    const moved = await moveCategoryProducts(db, source.name, target.name);
    if (req.body.delete_source) {
      await db.run("DELETE FROM inventory_options WHERE id = ?", [source.id]);
    } else {
      await db.run("UPDATE inventory_options SET is_active = 0 WHERE id = ?", [source.id]);
    }
    await db.run("COMMIT");
    res.json({ ok: true, moved, source: source.name, target: target.name, source_deleted: Boolean(req.body.delete_source) });
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    throw error;
  }
}));

router.post("/api/jewelry/move-category", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const ids = Array.isArray(req.body.product_ids) ? req.body.product_ids.map(Number).filter(Boolean) : [];
  const target = await ensureCategoryExists(db, String(req.body.target_category || "").trim(), { activeOnly: true });
  if (!ids.length) return res.status(400).json({ error: "Selecione ao menos um produto." });
  if (!target) return res.status(400).json({ error: "Categoria de destino ativa não encontrada." });
  const placeholders = ids.map(() => "?").join(", ");
  await db.run("BEGIN");
  try {
    const result = await db.run(`UPDATE jewelry_inventory SET category = ? WHERE id IN (${placeholders})`, [target.name, ...ids]);
    await db.run("COMMIT");
    res.json({ ok: true, moved: result.changes || 0, target: target.name });
  } catch (error) {
    await db.run("ROLLBACK").catch(() => {});
    throw error;
  }
}));

router.delete("/api/inventory-categories/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const category = await categoryById(db, req.params.id);
  if (!category) return res.status(404).json({ error: "Categoria não encontrada." });
  const stats = await db.get(`
    SELECT
      COUNT(j.id)::int AS product_count,
      COUNT(v.id)::int AS variant_count
    FROM jewelry_inventory j
    LEFT JOIN jewelry_variants v ON v.jewelry_id = j.id AND v.is_active = 1
    WHERE j.status != 'arquivado' AND j.category = ?
  `, [category.name]);
  const action = String(req.query.action || req.body?.action || "").trim();
  if (Number(stats.product_count || 0) > 0) {
    if (action === "deactivate") {
      await db.run("UPDATE inventory_options SET is_active = 0 WHERE id = ?", [category.id]);
      return res.json({ ok: true, deactivated: true, product_count: stats.product_count, variant_count: stats.variant_count });
    }
    return res.status(409).json({
      error: "Categoria possui produtos. Mova os produtos ou desative a categoria antes de excluir.",
      product_count: stats.product_count,
      variant_count: stats.variant_count
    });
  }
  await db.run("DELETE FROM inventory_options WHERE id = ?", [category.id]);
  res.json({ ok: true, deleted: true, product_count: 0, variant_count: 0 });
}));

router.patch("/api/pricing-settings", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  res.json(await savePricingSettings(db, req.body));
}));

router.post("/api/inventory-options", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const { type, name } = req.body;
  if (!["category", "size", "thickness"].includes(type) || !name?.trim()) {
    return res.status(400).json({ error: "Opção inválida." });
  }
  const cleanName = name.trim();
  const existing = await db.get("SELECT * FROM inventory_options WHERE type = ? AND name = ?", [type, cleanName]);
  if (existing) return res.json(existing);
  const result = await db.run("INSERT INTO inventory_options (type, name) VALUES (?, ?)", [type, cleanName]);
  res.status(201).json(await db.get("SELECT * FROM inventory_options WHERE id = ?", [result.lastID]));
}));

router.patch("/api/inventory-options/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const option = await db.get("SELECT * FROM inventory_options WHERE id = ?", [req.params.id]);
  if (!option) return res.status(404).json({ error: "Opção não encontrada." });
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: "Nome obrigatório." });
  const duplicate = await db.get("SELECT id FROM inventory_options WHERE type = ? AND name = ? AND id != ?", [option.type, name, req.params.id]);
  if (duplicate) return res.status(409).json({ error: "Já existe uma opção com esse nome." });
  const fieldByType = { category: "category", size: "size", thickness: "thickness" };
  const field = fieldByType[option.type];
  if (!field) return res.status(400).json({ error: "Observação de cor agora é texto livre." });
  await db.run("UPDATE inventory_options SET name = ? WHERE id = ?", [name, req.params.id]);
  await db.run(`UPDATE jewelry_inventory SET ${field} = ? WHERE ${field} = ?`, [name, option.name]);
  res.json(await db.get("SELECT * FROM inventory_options WHERE id = ?", [req.params.id]));
}));

router.delete("/api/inventory-options/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const option = await db.get("SELECT * FROM inventory_options WHERE id = ?", [req.params.id]);
  if (!option) return res.status(404).json({ error: "Opção não encontrada." });
  const usage = await countOptionUsage(db, option);
  if (usage > 0) return res.status(409).json({ error: "Esta opção está em uso no estoque e não pode ser apagada." });
  await db.run("DELETE FROM inventory_options WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

export default router;
