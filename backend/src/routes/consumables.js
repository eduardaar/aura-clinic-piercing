import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { P } from "../config/permissions.js";

const router = Router();

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} deve ser um número inteiro positivo.`);
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} deve ser um número inteiro igual ou maior que zero.`);
  return number;
}

function money(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} inválido.`);
  return Number(number.toFixed(2));
}

function activeStatus(value) {
  return value === "archived" ? "archived" : "active";
}

router.get("/api/consumables", withFeature("basic_inventory", async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_VIEW)) return;
  const status = String(req.query.status || "").trim();
  const search = String(req.query.search || "").trim();
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push("status = ?");
    params.push(activeStatus(status));
  }
  if (search) {
    clauses.push("(name ILIKE ? OR description ILIKE ? OR supplier ILIKE ?)");
    params.push(...Array(3).fill(`%${search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  res.json(await db.all(`SELECT * FROM consumables ${where} ORDER BY status, name, id`, params));
}));

router.post("/api/consumables", withFeature("basic_inventory", async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_CREATE)) return;
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) throw new Error("Informe o nome do material.");
    const result = await db.run(
      `INSERT INTO consumables (name, description, unit, quantity, minimum_quantity, cost_value, supplier, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [name, String(req.body?.description || "").trim(), String(req.body?.unit || "unidade").trim() || "unidade",
        nonNegativeInteger(req.body?.quantity ?? 0, "Quantidade inicial"),
        nonNegativeInteger(req.body?.minimum_quantity ?? 0, "Estoque mínimo"),
        money(req.body?.cost_value, "Custo"), String(req.body?.supplier || "").trim(), activeStatus(req.body?.status)]
    );
    if (Number(req.body?.quantity || 0) > 0) {
      await db.run("INSERT INTO consumable_stock_movements (consumable_id, movement_type, quantity, notes) VALUES (?, 'Entrada', ?, 'Saldo inicial')", [result.returnedId, Number(req.body.quantity)]);
    }
    res.status(201).json(await db.get("SELECT * FROM consumables WHERE id = ?", [result.returnedId]));
  } catch (error) {
    res.status(400).json({ error: error.message || "Não foi possível cadastrar o material." });
  }
}));

router.patch("/api/consumables/:id", withFeature("basic_inventory", async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_EDIT)) return;
  const current = await db.get("SELECT * FROM consumables WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Material não encontrado." });
  try {
    const name = String(req.body?.name ?? current.name).trim();
    if (!name) throw new Error("Informe o nome do material.");
    await db.run(
      `UPDATE consumables SET name=?, description=?, unit=?, minimum_quantity=?, cost_value=?, supplier=?, status=?, updated_at=to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id=?`,
      [name, String(req.body?.description ?? current.description ?? "").trim(), String(req.body?.unit ?? current.unit ?? "unidade").trim() || "unidade",
        nonNegativeInteger(req.body?.minimum_quantity ?? current.minimum_quantity, "Estoque mínimo"),
        money(req.body?.cost_value ?? current.cost_value, "Custo"), String(req.body?.supplier ?? current.supplier ?? "").trim(),
        activeStatus(req.body?.status ?? current.status), req.params.id]
    );
    res.json(await db.get("SELECT * FROM consumables WHERE id = ?", [req.params.id]));
  } catch (error) {
    res.status(400).json({ error: error.message || "Não foi possível atualizar o material." });
  }
}));

router.post("/api/consumables/:id/movements", withFeature("basic_inventory", async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_ADJUST)) return;
  try {
    const movementType = String(req.body?.movement_type || "");
    if (!['Entrada', 'Saida', 'Ajuste'].includes(movementType)) throw new Error("Tipo de movimentação inválido.");
    const quantity = positiveInteger(req.body?.quantity, "Quantidade");
    await db.transaction(async (tx) => {
      const current = await tx.get("SELECT * FROM consumables WHERE id = ? FOR UPDATE", [req.params.id]);
      if (!current || current.status === "archived") throw new Error("Material ativo não encontrado.");
      const nextQuantity = movementType === "Saida" ? Number(current.quantity) - quantity : movementType === "Ajuste" ? quantity : Number(current.quantity) + quantity;
      if (nextQuantity < 0) throw new Error("A saída não pode deixar o estoque negativo.");
      await tx.run("UPDATE consumables SET quantity=?, updated_at=to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id=?", [nextQuantity, current.id]);
      await tx.run("INSERT INTO consumable_stock_movements (consumable_id, movement_type, quantity, notes) VALUES (?, ?, ?, ?)", [current.id, movementType, quantity, String(req.body?.notes || "").trim()]);
    });
    res.json(await db.get("SELECT * FROM consumables WHERE id = ?", [req.params.id]));
  } catch (error) {
    res.status(400).json({ error: error.message || "Não foi possível movimentar o material." });
  }
}));

router.delete("/api/consumables/:id", withFeature("basic_inventory", async (req, res, db) => {
  if (!authorizePermission(req, res, P.INVENTORY_DELETE)) return;
  const item = await db.get("SELECT id FROM consumables WHERE id = ?", [req.params.id]);
  if (!item) return res.status(404).json({ error: "Material não encontrado." });
  await db.run("UPDATE consumables SET status='archived', updated_at=to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id=?", [req.params.id]);
  res.json({ ok: true, archived: true });
}));

export default router;
