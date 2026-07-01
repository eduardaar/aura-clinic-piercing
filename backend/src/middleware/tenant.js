// Resolução do tenant (clínica) da requisição — multi-tenant por schema.
//
// Ordem de resolução do slug:
//   1. Token Bearer válido com `tslug` (se o header X-Tenant divergir → 403);
//   2. Header X-Tenant;
//   3. Env DEFAULT_TENANT;
//   4. Sem tenant → 400.
//
// O slug é validado por regex, buscado em platform.tenants (com cache em
// memória de 60s) e o schema retornado é SEMPRE derivado do id do banco
// ("tenant_<id>"), nunca de input do usuário.
import { query } from "../database/connection.js";
import { decodeToken, extractBearerToken } from "./auth.js";

// Slug de clínica: minúsculas/dígitos/hífen, 3 a 30 chars, sem hífen nas pontas.
export const TENANT_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

// Erro de resolução com status HTTP — o withDb converte em resposta.
export class TenantError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "TenantError";
    this.statusCode = statusCode;
  }
}

// Cache em memória slug → { tenant, expiresAt } (TTL 60s). Evita uma consulta
// a platform.tenants por requisição. As rotas de plataforma que alteram
// tenants invalidam o cache via invalidateTenantCache().
const TENANT_CACHE_TTL_MS = 60 * 1000;
const tenantCache = new Map();

export function invalidateTenantCache(slug) {
  if (slug) tenantCache.delete(slug);
  else tenantCache.clear();
}

async function findTenantBySlug(slug) {
  const cached = tenantCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.tenant;
  const result = await query(
    "SELECT id, name, slug, status FROM platform.tenants WHERE slug = $1",
    [slug]
  );
  const tenant = result.rows[0] || null;
  tenantCache.set(slug, { tenant, expiresAt: Date.now() + TENANT_CACHE_TTL_MS });
  return tenant;
}

// Resolve o tenant da requisição e seta req.tenant.
// Lança TenantError (400/403/404) quando não for possível resolver.
export async function resolveTenant(req) {
  const headerSlug = String(req.headers["x-tenant"] || "").trim().toLowerCase();

  let slug = "";
  const decoded = decodeToken(extractBearerToken(req));
  if (decoded && decoded.tslug) {
    // Token manda; header divergente indica tentativa de acessar outra clínica.
    if (headerSlug && headerSlug !== decoded.tslug) {
      throw new TenantError(403, "Clínica do token não corresponde à requisição.");
    }
    slug = String(decoded.tslug);
  } else if (headerSlug) {
    slug = headerSlug;
  } else if (process.env.DEFAULT_TENANT) {
    slug = String(process.env.DEFAULT_TENANT).trim().toLowerCase();
  } else {
    throw new TenantError(400, "Informe a clínica (header X-Tenant).");
  }

  if (!TENANT_SLUG_REGEX.test(slug)) {
    throw new TenantError(400, "Identificador de clínica inválido.");
  }

  const tenant = await findTenantBySlug(slug);
  if (!tenant) throw new TenantError(404, "Clínica não encontrada.");
  if (tenant.status === "suspenso") {
    throw new TenantError(403, "Clínica suspensa. Contate o suporte.");
  }

  const resolved = {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    schema: `tenant_${tenant.id}`
  };
  req.tenant = resolved;
  return resolved;
}
