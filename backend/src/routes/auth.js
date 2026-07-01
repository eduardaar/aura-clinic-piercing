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
  res.json({
    token: createToken(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
}));

export default router;
