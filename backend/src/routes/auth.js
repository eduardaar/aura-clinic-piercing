// Rota de login (autenticação).
import { Router } from "express";
import bcrypt from "bcryptjs";
import { withDb } from "../middleware/withDb.js";
import { loginLimiter } from "../middleware/rateLimit.js";
import { createToken, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { loginSchema } from "../schemas/index.js";
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  createClinicSession,
  readCookie,
  revokeClinicSession,
  rotateClinicSession,
  setRefreshCookie
} from "../services/sessions.js";
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, otpauthUri, verifyTotp } from "../services/totp.js";

const router = Router();

router.post("/api/login", loginLimiter, withDb(async (req, res, db) => {
  if (!validateBody(loginSchema, req, res)) return;
  const { email, password } = req.body;
  const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Credenciais inválidas." });
  }
  if (user.mfa_enabled) {
    const secret = decryptTotpSecret(user.mfa_totp_secret_encrypted);
    if (!secret || !verifyTotp(secret, req.body?.mfa_code)) {
      return res.status(401).json({ error: "Informe o código do seu autenticador.", code: "mfa_required" });
    }
  }
  const session = await createClinicSession(db, user, req);
  setRefreshCookie(res, session.refreshToken);
  // Token amarrado à clínica resolvida (multi-tenant); devolve também a clínica.
  res.json({
    token: createToken(user, req.tenant, { sessionId: session.id }),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    tenant: { id: req.tenant.id, name: req.tenant.name, slug: req.tenant.slug }
  });
}));

// Renova o access token curto usando refresh opaco e rotativo em cookie. A rota
// não exige Authorization porque é justamente usada após ele expirar.
router.post("/api/auth/refresh", withDb(async (req, res, db) => {
  const current = readCookie(req, REFRESH_COOKIE);
  const rotated = await rotateClinicSession(db, current, req);
  if (!rotated) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: "Sessão expirada. Entre novamente." });
  }
  setRefreshCookie(res, rotated.refreshToken);
  res.json({
    token: createToken(rotated.user, req.tenant, { sessionId: rotated.sessionId }),
    user: { id: rotated.user.id, name: rotated.user.name, email: rotated.user.email, role: rotated.user.role }
  });
}));

router.post("/api/auth/logout", withDb(async (req, res, db) => {
  await revokeClinicSession(db, req.user?.session_id || "", req.user.id);
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

router.get("/api/account/sessions", withDb(async (req, res, db) => {
  const sessions = await db.all(
    `SELECT id, created_at, last_used_at, expires_at, ip_address, user_agent,
            (id = ?) AS current
       FROM user_sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > now()
      ORDER BY last_used_at DESC`,
    [req.user.session_id || "", req.user.id]
  );
  res.json({ sessions });
}));

router.delete("/api/account/sessions/:id", withDb(async (req, res, db) => {
  const target = String(req.params.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(target)) return res.status(400).json({ error: "Sessão inválida." });
  const revoked = await revokeClinicSession(db, target, req.user.id);
  if (!revoked) return res.status(404).json({ error: "Sessão não encontrada." });
  if (target === req.user.session_id) clearRefreshCookie(res);
  res.json({ ok: true });
}));

router.post("/api/account/sessions/revoke-all", withDb(async (req, res, db) => {
  // Incrementar a versão protege também contra uma corrida entre a listagem e
  // a revogação; cada access/refresh token anterior perde validade.
  await db.run("UPDATE users SET session_version = session_version + 1 WHERE id = ?", [req.user.id]);
  await db.run("UPDATE user_sessions SET revoked_at = now() WHERE user_id = ? AND revoked_at IS NULL", [req.user.id]);
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

router.get("/api/account/mfa", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const user = await db.get("SELECT mfa_enabled FROM users WHERE id = ?", [req.user.id]);
  res.json({ enabled: Boolean(user?.mfa_enabled) });
}));

router.post("/api/account/mfa/setup", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const currentPassword = String(req.body?.current_password || "");
  const user = await db.get("SELECT id, email, password_hash FROM users WHERE id = ?", [req.user.id]);
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    return res.status(400).json({ error: "Confirme sua senha atual para configurar o autenticador." });
  }
  const secret = generateTotpSecret();
  await db.run("UPDATE users SET mfa_totp_secret_encrypted = ?, mfa_enabled = false WHERE id = ?", [encryptTotpSecret(secret), user.id]);
  res.json({ secret, otpauth_url: otpauthUri({ secret, email: user.email }) });
}));

router.post("/api/account/mfa/verify", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const user = await db.get("SELECT mfa_totp_secret_encrypted FROM users WHERE id = ?", [req.user.id]);
  const secret = decryptTotpSecret(user?.mfa_totp_secret_encrypted);
  if (!secret || !verifyTotp(secret, req.body?.code)) return res.status(400).json({ error: "Código do autenticador inválido." });
  await db.run("UPDATE users SET mfa_enabled = true WHERE id = ?", [req.user.id]);
  res.json({ ok: true, enabled: true });
}));

router.post("/api/account/mfa/disable", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const user = await db.get("SELECT password_hash, mfa_totp_secret_encrypted FROM users WHERE id = ?", [req.user.id]);
  const secret = decryptTotpSecret(user?.mfa_totp_secret_encrypted);
  if (!user || !(await bcrypt.compare(String(req.body?.current_password || ""), user.password_hash)) || !verifyTotp(secret, req.body?.code)) {
    return res.status(400).json({ error: "Senha ou código do autenticador inválido." });
  }
  await db.run("UPDATE users SET mfa_enabled = false, mfa_totp_secret_encrypted = NULL, session_version = session_version + 1 WHERE id = ?", [req.user.id]);
  await db.run("UPDATE user_sessions SET revoked_at = now() WHERE user_id = ? AND revoked_at IS NULL", [req.user.id]);
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

export default router;
