// Autenticação por token HMAC próprio (sem dependências externas de JWT).
// Multi-tenant: o token de clínica carrega {tid, tslug} e só vale para o
// tenant resolvido na requisição. Tokens de plataforma ({plt: true}) são
// separados e não acessam rotas de clínica (nem o contrário).
// Em dev local a autenticação é bypassada via isLocalDevRequest.
import crypto from "crypto";
import { AUTH_SECRET, isProduction } from "../config/index.js";
import { ACCESS_TOKEN_MS, activeClinicSession } from "../services/sessions.js";

// Define se a rota exige autenticação. Rotas públicas ficam de fora.
export function requiresAuth(req) {
  if (!req.path.startsWith("/api")) return false;
  if (["/api/login", "/api/auth/refresh", "/api/health", "/api/catalog", "/api/catalog/coupon-quote", "/api/catalog/promotion-quote", "/api/catalog/price-quote", "/api/sales-orders/public"].includes(req.path)) return false;
  if (req.method === "POST" && req.path === "/api/catalog/events") return false;
  if (req.path.startsWith("/api/booking")) return false;
  // Ingestão de erros do frontend: pública (captura erros de telas sem sessão).
  // A leitura/gestão (GET/PATCH/DELETE) continua exigindo auth + papel admin.
  if (req.method === "POST" && req.path === "/api/error-logs") return false;
  // Webhooks de gateway: o provedor posta sem sessão e sem X-Tenant. A rota se
  // defende sozinha com o token compartilhado (ver routes/webhooks.js) e nem
  // passa pelo withDb — está aqui por completude, caso alguém a monte depois
  // dentro do ciclo padrão.
  if (req.path.startsWith("/api/webhooks/")) return false;
  // Pagamento do cliente final: ele acompanha a própria cobrança (PIX e status)
  // a partir da tela pública de agendamento/checkout, onde não há sessão.
  //
  // Só estas duas — a LISTAGEM de intents continua exigindo token. O recorte é
  // por regex e não por prefixo justamente para /api/payment-intents não virar
  // público inteiro por descuido.
  if (/^\/api\/payment-intents\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(pix|sync)$/i.test(req.path)) return false;
  // Conteúdo da landing: é a página pública da plataforma, servida antes de
  // qualquer login. O editor vive em /api/platform/landing/* e se autentica com
  // token de plataforma, não com este caminho.
  if (req.method === "GET" && req.path === "/api/landing") return false;
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
export function createToken(user, tenant, { sessionId } = {}) {
  return signPayload({
    sub: user.id,
    role: user.role,
    sv: Number(user.session_version || 1),
    tid: tenant?.id,
    tslug: tenant?.slug,
    ...(sessionId ? { sid: sessionId } : {}),
    exp: Date.now() + ACCESS_TOKEN_MS
  });
}

// Token do painel de plataforma (super-admin). Marca plt: true para nunca
// ser aceito nas rotas de clínica (e tokens de clínica não têm plt).
export function createPlatformToken(user) {
  return signPayload({
    sub: user.id,
    role: "superadmin",
    plt: true,
    sv: Number(user.session_version || 1),
    exp: Date.now() + ACCESS_TOKEN_MS
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
    const user = await db.get(
      "SELECT id, name, email, role, session_version FROM users WHERE id = ?",
      [decoded.sub]
    );
    // Tokens antigos, sem `sv`, são encerrados no primeiro deploy desta
    // proteção. Depois disso, trocar senha ou papel incrementa a versão e
    // invalida imediatamente todas as sessões emitidas anteriormente.
    if (!user || Number(decoded.sv) !== Number(user.session_version)) return null;
    // Credenciais emitidas pelo login atual sempre trazem `sid`; sem a linha
    // ativa no banco, cópia do access token deixa de valer imediatamente.
    // Tokens legados sem sid são recusados de propósito neste deploy.
    if (!(await activeClinicSession(db, decoded.sid, user.id, user.session_version))) return null;
    return { ...user, session_id: decoded.sid };
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
