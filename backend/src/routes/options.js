// Rotas de opções gerais e opções de inventário (categorias, tamanhos, espessuras).
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { JEWELRY_CATEGORIES, ARGOLA_SUBCATEGORIES } from "../config/index.js";
import { groupInventoryOptions } from "../services/utils.js";
import { attachVariants, countOptionUsage } from "../services/inventory.js";
import { getPricingSettings, savePricingSettings } from "../services/pricing.js";

const router = Router();

router.get("/api/options", withDb(async (_req, res, db) => {
  const professionals = await db.all("SELECT * FROM professionals WHERE active = 1 ORDER BY name");
  const jewelry = await attachVariants(db, await db.all("SELECT * FROM jewelry_inventory ORDER BY name"));
  const inventoryOptions = await db.all("SELECT * FROM inventory_options ORDER BY type, name");
  const pricingSettings = await getPricingSettings(db);
  res.json({
    professionals,
    jewelry,
    jewelryCategories: JEWELRY_CATEGORIES,
    jewelrySubcategories: { Argolas: ARGOLA_SUBCATEGORIES },
    inventoryOptions: groupInventoryOptions(inventoryOptions),
    pricingSettings
  });
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
