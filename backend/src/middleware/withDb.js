// Wrapper padrão de todos os handlers (multi-tenant por schema):
// - resolve o tenant da requisição (token/X-Tenant/DEFAULT_TENANT);
// - pega UM client do pool e fixa o search_path no schema da clínica;
// - injeta o `db` (camada fina de acesso ao Postgres) desse client;
// - normaliza o corpo das respostas (paliativo de encoding via normalizeDbValue);
// - aplica autenticação quando a rota exige (token amarrado ao tenant);
// - captura erros e devolve 500 padronizado;
// - SEMPRE reseta o search_path antes de devolver o client ao pool — um client
//   devolvido "sujo" vazaria dados entre clínicas.
import { pool } from "../database/connection.js";
import { createDb } from "../db/postgres.js";
import { resolveTenant, TenantError } from "./tenant.js";
import { normalizeDbValue } from "../text-normalizer.js";
import { requiresAuth, authenticateRequest } from "./auth.js";
import { isProduction } from "../config/index.js";
import { recordError } from "../services/errorLogs.js";
import { requireFeature } from "../services/subscriptions.js";
import { hydrateUserPermissions } from "../services/permissionService.js";

// Defesa em profundidade: o schema vem sempre de platform.tenants.schema_name
// (ou do fallback "tenant_" + id enquanto essa coluna não foi preenchida —
// ver middleware/tenant.js), mas validamos o formato antes de interpolar no
// SET search_path.
const TENANT_SCHEMA_REGEX = /^tenant_[a-z0-9_]{1,58}$/;

// O caractere de substituição (�) significa que uma conversão anterior perdeu
// o byte original. Depois de persistido não há como deduzir a letra com
// segurança; recusamos a entrada para não espalhar uma corrupção irreversível.
function findReplacementCharacter(value, path = "corpo") {
  if (typeof value === "string") return value.includes("\uFFFD") ? path : null;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = findReplacementCharacter(entry, `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const found = findReplacementCharacter(entry, `${path}.${key}`);
      if (found) return found;
    }
  }
  return null;
}

export const withDb = (handler) => async (req, res) => {
  const originalJson = res.json.bind(res);
  res.json = (payload) => originalJson(normalizeDbValue(payload));

  const invalidTextPath = findReplacementCharacter(req.body);
  if (invalidTextPath) {
    return res.status(400).json({
      error: `O texto recebido possui um caractere inválido em ${invalidTextPath}. Revise a origem do conteúdo e tente novamente.`
    });
  }

  // 1) Resolve a clínica. Falhas viram 400/403/404 (nunca tocam o banco do app).
  let tenant;
  try {
    tenant = await resolveTenant(req);
  } catch (error) {
    if (error instanceof TenantError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    console.error(error);
    return res.status(500).json({
      error: isProduction ? "Erro interno no servidor." : `Erro interno: ${error.message}`
    });
  }
  if (!TENANT_SCHEMA_REGEX.test(tenant.schema)) {
    console.error(`Schema de tenant inválido: ${tenant.schema}`);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }

  // 2) Client dedicado à requisição, com search_path do tenant.
  const client = await pool.connect();
  let db;
  try {
    await client.query(`SET search_path TO "${tenant.schema}", public`);
    db = createDb(client);
    if (requiresAuth(req)) {
      const user = await authenticateRequest(req, db);
      if (!user) return res.status(401).json({ error: "Sessão inválida ou expirada." });
      req.user = await hydrateUserPermissions(db, user);
    }
    await handler(req, res, db);
  } catch (error) {
    console.error(error);
    // Se o handler morreu com transação aberta, desfaz ANTES de qualquer coisa:
    // dentro de uma transação abortada nenhuma query passa (nem o log de erro
    // abaixo) e as escritas parciais não podem sobreviver ao 500.
    if (db) await db.abortOpenTransaction();
    // Captura central: grava o erro do backend na tabela de logs (best-effort;
    // o search_path ainda aponta para o tenant, pois o reset ocorre no finally).
    if (db) {
      await recordError(db, {
        source: "backend",
        message: error?.message || String(error),
        stack: error?.stack,
        url: req.originalUrl || req.url,
        method: req.method,
        status_code: 500,
        user_id: req.user?.id ?? null,
        user_email: req.user?.email ?? null,
        user_agent: req.headers["user-agent"]
      });
    }
    // Em produção nunca expomos detalhes do erro ao cliente (evita vazamento de
    // stack/SQL/mensagens internas). Em dev mantemos o detalhe para diagnóstico.
    if (!res.headersSent) {
      res.status(500).json({
        error: isProduction ? "Erro interno no servidor." : `Erro interno: ${error.message}`
      });
    }
  } finally {
    // CRÍTICO: nunca devolver o client ao pool com search_path de tenant nem
    // com transação aberta — o próximo tenant herdaria a transação (e os locks)
    // e o reset do search_path viajaria junto no rollback dela.
    try {
      if (db?.inTransaction()) {
        console.error("Transação deixada aberta pelo handler; desfazendo antes de devolver o client.");
        await db.abortOpenTransaction();
      }
      await client.query("SET search_path TO public");
      client.release();
    } catch {
      client.release(true);
    }
  }
};

// Igual a withDb, mas antes de chamar o handler exige que o plano do tenant
// inclua `feature` (e que a assinatura esteja ativa). Bloqueia com 402/403.
// Uso: router.post(path, withFeature("online_booking", async (req,res,db)=>{...}))
export const withFeature = (feature, handler) => withDb(async (req, res, db) => {
  if (!(await requireFeature(req, res, feature))) return;
  return handler(req, res, db);
});
