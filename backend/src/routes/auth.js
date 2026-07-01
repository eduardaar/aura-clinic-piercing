// Rota de login (autenticação).
import { Router } from "express";
import bcrypt from "bcryptjs";
import { withDb } from "../middleware/withDb.js";
import { loginLimiter } from "../middleware/rateLimit.js";
import { createToken } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { loginSchema } from "../schemas/index.js";

const router = Router();

router.post("/api/login", loginLimiter, withDb(async (req, res, db) => {
  if (!validateBody(loginSchema, req, res)) return;
  const { email, password } = req.body;
  const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Credenciais inválidas." });
  }
  // Token amarrado à clínica resolvida (multi-tenant); devolve também a clínica.
  res.json({
    token: createToken(user, req.tenant),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    tenant: { id: req.tenant.id, name: req.tenant.name, slug: req.tenant.slug }
  });
}));

export default router;
