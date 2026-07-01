// Autenticação por token HMAC próprio (sem dependências externas de JWT).
// Multi-tenant: o token de clínica carrega {tid, tslug} e só vale para o
// tenant resolvido na requisição. Tokens de plataforma ({plt: true}) são
// separados e não acessam rotas de clínica (nem o contrário).
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

// Assina um payload (objeto) e devolve o token "payload.assinatura".
function signPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

// Decodifica e verifica um token (assinatura HMAC + expiração).
// Retorna o payload decodificado ou null. Não consulta o banco.
export function decodeToken(token) {
  try {
    if (!token) return null;
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
    if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded.exp || decoded.exp < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

// Extrai o token Bearer do header Authorization (ou string vazia).
export function extractBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

// Token de usuário de clínica: amarrado ao tenant (tid/tslug).
export function createToken(user, tenant) {
  return signPayload({
    sub: user.id,
    role: user.role,
    tid: tenant?.id,
    tslug: tenant?.slug,
    exp: Date.now() + 1000 * 60 * 60 * 12
  });
}

// Token do painel de plataforma (super-admin). Marca plt: true para nunca
// ser aceito nas rotas de clínica (e tokens de clínica não têm plt).
export function createPlatformToken(user) {
  return signPayload({
    sub: user.id,
    role: "superadmin",
    plt: true,
    exp: Date.now() + 1000 * 60 * 60 * 12
  });
}

// Verifica o token de plataforma da requisição. Exige plt === true.
export function verifyPlatformToken(req) {
  const decoded = decodeToken(extractBearerToken(req));
  if (!decoded || decoded.plt !== true || !decoded.sub) return null;
  return decoded;
}

export async function authenticateRequest(req, db) {
  try {
    if (isLocalDevRequest(req)) {
      // Bypass de dev: retorna o admin do tenant RESOLVIDO (o db já está com
      // o search_path do schema da clínica desta requisição).
      const localAdmin = await db.get("SELECT id, name, email, role FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
      return localAdmin || { id: 1, name: "Administrador Aura", email: "admin@auraclinic.com", role: "admin" };
    }
    const decoded = decodeToken(extractBearerToken(req));
    if (!decoded || !decoded.sub) return null;
    // Tokens de plataforma não autenticam em rotas de clínica.
    if (decoded.plt === true) return null;
    // O token só vale para o tenant desta requisição (token de outra clínica → 401).
    if (!req.tenant || decoded.tid !== req.tenant.id) return null;
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
