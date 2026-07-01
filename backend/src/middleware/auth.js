// Autenticação por token HMAC próprio (sem dependências externas de JWT).
// Em dev local a autenticação é bypassada via isLocalDevRequest.
import crypto from "crypto";
import { AUTH_SECRET, isProduction } from "../config/index.js";

// Define se a rota exige autenticação. Rotas públicas ficam de fora.
export function requiresAuth(req) {
  if (!req.path.startsWith("/api")) return false;
  if (["/api/login", "/api/health", "/api/catalog", "/api/sales-orders/public"].includes(req.path)) return false;
  if (req.path.startsWith("/api/booking")) return false;
  return true;
}

// Requisição de desenvolvimento local (localhost) — auth é dispensada.
export function isLocalDevRequest(req) {
  const host = String(req.hostname || "").toLowerCase();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").toLowerCase();
  return !isProduction && ["localhost", "127.0.0.1", "::1"].includes(host || forwardedHost);
}

export function createToken(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    role: user.role,
    exp: Date.now() + 1000 * 60 * 60 * 12
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export async function authenticateRequest(req, db) {
  try {
    if (isLocalDevRequest(req)) {
      const localAdmin = await db.get("SELECT id, name, email, role FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
      return localAdmin || { id: 1, name: "Administrador Aura", email: "admin@auraclinic.com", role: "admin" };
    }
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return null;
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
    if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded.sub || decoded.exp < Date.now()) return null;
    return db.get("SELECT id, name, email, role FROM users WHERE id = ?", [decoded.sub]);
  } catch {
    return null;
  }
}

export function requireRole(req, res, roles) {
  if (!roles.includes(req.user?.role)) {
    res.status(403).json({ error: "Você não tem permissão para esta ação." });
    return false;
  }
  return true;
}
