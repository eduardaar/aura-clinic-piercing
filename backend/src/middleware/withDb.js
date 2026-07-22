// Wrapper padrão de todos os handlers (multi-tenant por schema):
// - resolve o tenant da requisição (token/X-Tenant/DEFAULT_TENANT);
// - pega UM client do pool e fixa o search_path no schema da clínica;
// - injeta o adaptador `db` (Postgres com interface estilo SQLite) desse client;
// - normaliza o corpo das respostas (paliativo de encoding via normalizeDbValue);
// - aplica autenticação quando a rota exige (token amarrado ao tenant);
// - captura erros e devolve 500 padronizado;
// - SEMPRE reseta o search_path antes de devolver o client ao pool — um client
//   devolvido "sujo" vazaria dados entre clínicas.
import { pool } from "../database/connection.js";
import { createDbAdapter } from "../db/sqliteCompat.js";
import { resolveTenant, TenantError } from "./tenant.js";
import { normalizeDbValue } from "../text-normalizer.js";
import { requiresAuth, authenticateRequest } from "./auth.js";
import { isProduction } from "../config/index.js";
import { recordError } from "../services/errorLogs.js";
import { requireFeature } from "../services/subscriptions.js";

// Defesa em profundidade: o schema vem sempre de "tenant_" + id inteiro do
// banco, mas validamos o formato antes de interpolar no SET search_path.
const TENANT_SCHEMA_REGEX = /^tenant_\d+$/;

export const withDb = (handler) => async (req, res) => {
  const originalJson = res.json.bind(res);
  res.json = (payload) => originalJson(normalizeDbValue(payload));

  // 1) Resolve a clínica. Falhas viram 400/403/404 (nunca tocam o banco do app).
  let tenant;
  try {
    tenant = await resolveTenant(req);
  } catch (error) {
    if (error instanceof TenantError) {
      return res.status(error.statusCode).json({ error: error.message });
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
    db = createDbAdapter(client);
    if (requiresAuth(req)) {
      const user = await authenticateRequest(req, db);
      if (!user) return res.status(401).json({ error: "Sessão inválida ou expirada." });
      req.user = user;
    }
    await handler(req, res, db);
  } catch (error) {
    console.error(error);
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
    // CRÍTICO: nunca devolver o client ao pool com search_path de tenant.
    // Se o reset falhar, descartamos a conexão (release(true) destrói o client).
    try {
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
