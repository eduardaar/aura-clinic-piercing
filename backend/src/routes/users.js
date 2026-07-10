// Rotas de gestão de usuários (administrativo).
import { Router } from "express";
import bcrypt from "bcryptjs";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { userCreateSchema, userUpdateSchema } from "../schemas/index.js";

const router = Router();
const LAST_ADMIN_MESSAGE = "Não é possível remover o acesso do último administrador geral. Cadastre ou promova outro administrador antes de alterar esta conta.";

async function assertAdminContinuity(db, targetUser, nextRole) {
  if (targetUser.role !== "admin" || nextRole === "admin") return null;
  const admins = await db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
  if (Number(admins?.count || 0) <= 1) return LAST_ADMIN_MESSAGE;
  return null;
}

router.get("/api/users", withDb(async (_req, res, db) => {
  if (!requireRole(_req, res, ["admin"])) return;
  res.json(await db.all("SELECT id, name, email, role, created_at FROM users ORDER BY name"));
}));

router.post("/api/users", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  // Valida presença/tipo dos campos e exige senha com no mínimo 8 caracteres.
  if (!validateBody(userCreateSchema, req, res)) return;
  const { name, email, password, role } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await db.run(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
    [name.trim(), email.trim(), passwordHash, role]
  );
  res.status(201).json(await db.get("SELECT id, name, email, role, created_at FROM users WHERE id = ?", [result.lastID]));
}));

router.patch("/api/users/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  // Valida tipos dos campos presentes; se vier password, exige mínimo de 8 caracteres.
  if (!validateBody(userUpdateSchema, req, res)) return;
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  const role = req.body.role || user.role;
  const continuityError = await assertAdminContinuity(db, user, role);
  if (continuityError) return res.status(409).json({ error: continuityError });
  // Só faz bcrypt hash quando o password vier no body (senão preserva o hash atual).
  const passwordHash = req.body.password ? await bcrypt.hash(req.body.password, 10) : user.password_hash;
  await db.run(
    "UPDATE users SET name = ?, email = ?, role = ?, password_hash = ? WHERE id = ?",
    [req.body.name || user.name, req.body.email || user.email, role, passwordHash, req.params.id]
  );
  res.json(await db.get("SELECT id, name, email, role, created_at FROM users WHERE id = ?", [req.params.id]));
}));

router.delete("/api/users/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  if (Number(req.params.id) === Number(req.user.id)) {
    return res.status(409).json({ error: "Você não pode apagar o próprio acesso." });
  }
  const target = await db.get("SELECT id, role FROM users WHERE id = ?", [req.params.id]);
  if (!target) return res.status(404).json({ error: "Usuário não encontrado." });
  if (target.role === "admin") {
    const continuityError = await assertAdminContinuity(db, target, "deleted");
    if (continuityError) return res.status(409).json({ error: continuityError });
  }
  await db.run("DELETE FROM users WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

export default router;
