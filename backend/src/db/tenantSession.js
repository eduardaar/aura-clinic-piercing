// Acesso ao schema de uma clínica FORA do ciclo de requisição autenticada.
//
// O `withDb` resolve o tenant a partir do token/header — o que não existe num
// webhook: o Asaas posta sem sessão, sem X-Tenant e sem saber o que é um
// tenant. Este helper cobre esse caso (e servirá a jobs/workers), preservando
// as mesmas garantias que tornam o isolamento confiável:
//
//   - o schema vem SEMPRE de platform.tenants.schema_name (com fallback para
//     "tenant_" + id, nunca de input);
//   - o formato é revalidado antes de entrar no SET search_path;
//   - o search_path é resetado no finally, e o client é DESTRUÍDO se o reset
//     falhar — devolver um client "sujo" ao pool vazaria dados entre clínicas.
import { pool, query } from "../database/connection.js";
import { createDb } from "./postgres.js";

// Aceita tanto o nome novo (derivado do slug: letras/dígitos/underscore)
// quanto o formato legado ("tenant_<id>"), usado no fallback abaixo enquanto
// a migration 0005 não roda (ver services/tenants.js).
const TENANT_SCHEMA_REGEX = /^tenant_[a-z0-9_]{1,58}$/;

// Cache id → schema_name (TTL 60s, mesmo padrão do cache de slug em
// middleware/tenant.js). O nome do schema nunca muda depois de gravado, então
// o único motivo do TTL é não guardar "não encontrado" para sempre.
const SCHEMA_CACHE_TTL_MS = 60 * 1000;
const schemaCache = new Map();

async function resolveSchemaName(id) {
  const cached = schemaCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.schema;
  const result = await query("SELECT schema_name FROM platform.tenants WHERE id = $1", [id]);
  const schema = result.rows[0]?.schema_name || `tenant_${id}`;
  schemaCache.set(id, { schema, expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS });
  return schema;
}

/**
 * Executa `fn(db)` com o search_path fixado no schema da clínica.
 * @param {number} tenantId id em platform.tenants
 * @param {(db: ReturnType<typeof createDb>) => Promise<any>} fn
 */
export async function withTenantSchema(tenantId, fn) {
  const id = Number(tenantId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Id de clínica inválido: ${tenantId}`);
  }
  const schema = await resolveSchemaName(id);
  if (!TENANT_SCHEMA_REGEX.test(schema)) {
    throw new Error(`Schema de clínica inválido: ${schema}`);
  }

  const client = await pool.connect();
  let db;
  try {
    await client.query(`SET search_path TO "${schema}", public`);
    db = createDb(client);
    return await fn(db);
  } catch (error) {
    // Mesma rede de segurança do withDb: dentro de uma transação abortada
    // nenhuma query passa, então desfazer vem antes de qualquer outra coisa.
    if (db) await db.abortOpenTransaction();
    throw error;
  } finally {
    try {
      if (db?.inTransaction()) {
        console.error("Transação deixada aberta; desfazendo antes de devolver o client.");
        await db.abortOpenTransaction();
      }
      await client.query("SET search_path TO public");
      client.release();
    } catch {
      client.release(true);
    }
  }
}
