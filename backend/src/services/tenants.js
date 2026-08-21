// Serviço de tenants (clínicas): provisionamento/desprovisionamento de
// schemas Postgres, bootstrap do schema de controle `platform`, schemas
// idempotentes legados e runner incremental opt-in de migrations.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import { pool, query } from "../database/connection.js";
import { applySchemaSql } from "../db/postgres.js";
import { applyMigrationsForTarget } from "../db/migrations.js";
import { TENANT_SLUG_REGEX, invalidateTenantCache } from "../middleware/tenant.js";
import { isProduction } from "../config/index.js";
import { normalizePlanCode, planByCode, trialWindow } from "./plans.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Slugs que jamais podem virar clínica (colidem com schemas/rotas do sistema).
export const RESERVED_SLUGS = [
  "platform",
  "public",
  "admin",
  "api",
  "www",
  "app",
  "pg_catalog",
  "information_schema"
];

// Erro de serviço com status HTTP — as rotas convertem em resposta.
export class TenantServiceError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "TenantServiceError";
    this.statusCode = statusCode;
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeAdminEmail(value) {
  return String(value || "").trim().toLowerCase();
}

// Nome do schema Postgres da clínica: "tenant_" + slug com "_" no lugar de
// "-" (schema não aceita hífen sem aspas, e "_" mantém o nome legível de
// relance — "tenant_aura_clinic" em vez de "tenant_2"). Calculado UMA VEZ no
// provisionamento e gravado em platform.tenants.schema_name: nunca
// recalculado depois. O slug hoje não tem rota de edição, mas se um dia
// ganhar uma, o schema não pode sair andando atrás dele — mesmo motivo já
// documentado em services/storage/keys.js para as chaves do storage usarem o
// id, não o slug.
export function schemaNameForSlug(slug) {
  return `tenant_${String(slug || "").trim().toLowerCase().replace(/-/g, "_")}`;
}

// Gera um slug "url-safe" a partir de um texto livre (nome da clínica):
// remove acentos, troca não-alfanuméricos por hífen e limita a 30 chars.
export function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
}

// Deriva um slug ÚNICO a partir do nome da clínica (para o cadastro público,
// onde o slug não é digitado). Garante 3-30 chars, evita reservados e resolve
// colisões acrescentando -2, -3, ... até achar um livre.
export async function generateUniqueSlug(name) {
  let base = slugify(name);
  if (base.length < 3) base = `${base || "clinica"}-app`.slice(0, 30);
  if (RESERVED_SLUGS.includes(base)) base = `${base}-clinica`.slice(0, 30);
  let candidate = base;
  for (let n = 2; n < 1000; n += 1) {
    const existing = await query("SELECT id FROM platform.tenants WHERE slug = $1", [candidate]);
    if (!existing.rows[0]) return candidate;
    const suffix = `-${n}`;
    candidate = `${base.slice(0, 30 - suffix.length)}${suffix}`;
  }
  throw new TenantServiceError(409, "Não foi possível gerar um identificador único. Tente outro nome.");
}

// O nome comercial não é exclusivo: dois estúdios podem ter o mesmo nome em
// cidades diferentes. O endereço derivado (slug), sim, precisa ser único. A
// consulta pública dá feedback antes do envio, mas o provisionamento abaixo é
// a garantia final contra corrida entre duas abas ou dois usuários.
export async function signupAvailability({ name = "", adminEmail = "" } = {}) {
  const normalizedName = String(name || "").trim();
  const normalizedEmail = normalizeAdminEmail(adminEmail);
  const result = { name: null, email: null };

  if (normalizedName) {
    const [sameName, suggestedSlug] = await Promise.all([
      query(
        "SELECT id FROM platform.tenants WHERE lower(name) = lower($1) LIMIT 1",
        [normalizedName]
      ),
      generateUniqueSlug(normalizedName)
    ]);
    result.name = {
      valid: slugify(normalizedName).length >= 3,
      exists: Boolean(sameName.rows[0]),
      suggested_slug: suggestedSlug
    };
  }

  if (normalizedEmail) {
    const valid = EMAIL_REGEX.test(normalizedEmail);
    let exists = false;
    if (valid) {
      const found = await query(
        "SELECT id FROM platform.tenants WHERE lower(signup_admin_email) = $1 LIMIT 1",
        [normalizedEmail]
      );
      exists = Boolean(found.rows[0]);
    }
    result.email = { valid, exists, available: valid && !exists };
  }

  return result;
}

// Valida os dados de criação de uma clínica. Lança TenantServiceError (400/409).
function validateProvisionInput({ name, slug, adminEmail, adminPassword }) {
  if (!name || !String(name).trim()) {
    throw new TenantServiceError(400, "Nome da clínica é obrigatório.");
  }
  if (!TENANT_SLUG_REGEX.test(String(slug || ""))) {
    throw new TenantServiceError(
      400,
      "Identificador (slug) inválido. Use minúsculas, números e hífens (3 a 30 caracteres)."
    );
  }
  if (RESERVED_SLUGS.includes(slug)) {
    throw new TenantServiceError(400, "Este identificador é reservado. Escolha outro.");
  }
  if (!EMAIL_REGEX.test(String(adminEmail || ""))) {
    throw new TenantServiceError(400, "E-mail do administrador inválido.");
  }
  if (!adminPassword || String(adminPassword).length < 8) {
    throw new TenantServiceError(400, "A senha do administrador deve ter pelo menos 8 caracteres.");
  }
}

// Cria a clínica: registro em platform.tenants + schema "tenant_<slug>" com
// as tabelas do app, o admin inicial e o tema padrão do catálogo.
// Em erro, desfaz tudo (DROP SCHEMA + DELETE do registro) e propaga.
export async function provisionTenant({ name, slug, adminName, adminEmail, adminPassword, phone = "", city = "", state = "", logoUrl = "", plan = "profissional" }) {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  const normalizedAdminEmail = normalizeAdminEmail(adminEmail);
  validateProvisionInput({ name, slug: normalizedSlug, adminEmail, adminPassword });
  const planCode = normalizePlanCode(plan);
  const schemaName = schemaNameForSlug(normalizedSlug);

  const existing = await query("SELECT id FROM platform.tenants WHERE slug = $1", [normalizedSlug]);
  if (existing.rows[0]) {
    throw new TenantServiceError(409, "Já existe uma clínica com este identificador.");
  }

  const existingEmail = await query(
    "SELECT id FROM platform.tenants WHERE lower(signup_admin_email) = $1 LIMIT 1",
    [normalizedAdminEmail]
  );
  if (existingEmail.rows[0]) {
    throw new TenantServiceError(409, "Este e-mail já possui uma clínica cadastrada. Faça login ou use outro e-mail.");
  }

  let inserted;
  try {
    inserted = await query(
      `INSERT INTO platform.tenants (name, slug, plan, store_short_name, responsible_name, phone, city, state, logo_url, signup_admin_email, schema_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, name, slug, status, plan, created_at`,
      [String(name).trim(), normalizedSlug, planCode, String(name).trim(), String(adminName || "").trim().toUpperCase(), String(phone || "").trim(), String(city || "").trim(), String(state || "").trim(), String(logoUrl || "").trim(), normalizedAdminEmail, schemaName]
    );
  } catch (error) {
    // A consulta acima melhora a UX; o índice único é quem fecha a corrida
    // entre duas requisições simultâneas com o mesmo e-mail.
    if (error?.code === "23505" && error?.constraint === "ux_tenants_signup_admin_email") {
      throw new TenantServiceError(409, "Este e-mail já possui uma clínica cadastrada. Faça login ou use outro e-mail.");
    }
    throw error;
  }
  const tenant = inserted.rows[0];
  const schema = schemaName;
  const selectedPlan = planByCode(planCode);
  const trial = trialWindow(selectedPlan.trial_days);
  let admin = null;

  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    // Só o schema do tenant no search_path durante a criação: garante que os
    // CREATE TABLE IF NOT EXISTS criem as tabelas AQUI (e não achem homônimas
    // em public).
    await client.query(`SET search_path TO "${schema}"`);
    await applySchemaSql(client);
    await applyMigrationsForTarget(client, { scope: "tenant", targetSchema: schema });
    const passwordHash = await bcrypt.hash(String(adminPassword), 12);
    const adminInsert = await client.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id, name, email, role",
      [String(adminName || "Administrador").trim().toUpperCase() || "ADMINISTRADOR", normalizedAdminEmail, passwordHash]
    );
    admin = adminInsert.rows[0];
    // Tema padrão do catálogo (linha única id=1) para o catálogo não quebrar.
    await client.query("INSERT INTO catalog_theme (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
    await client.query("UPDATE catalog_theme SET brand_name = $1, slogan = $2, logo_url = $3 WHERE id = 1", [String(name).trim(), "Catálogo e agendamento online", String(logoUrl || "").trim()]);
    await client.query(
      `INSERT INTO catalog_settings (key, value) VALUES
        ('brand_name', $1),
        ('whatsapp_phone', $2),
        ('company_address', $3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(name).trim(), String(phone || "").trim(), [city, state].filter(Boolean).join(" - ")]
    );
  } catch (error) {
    // Rollback do provisionamento: nada de clínica meio-criada.
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } catch (dropError) {
      console.error(`Falha ao remover schema ${schema} após erro de provisionamento:`, dropError);
    }
    try {
      await query("DELETE FROM platform.tenants WHERE id = $1", [tenant.id]);
    } catch (deleteError) {
      console.error(`Falha ao remover registro do tenant ${tenant.id} após erro:`, deleteError);
    }
    invalidateTenantCache(normalizedSlug);
    throw error;
  } finally {
    try {
      await client.query("SET search_path TO public");
      client.release();
    } catch {
      client.release(true);
    }
  }

  await query(
    `INSERT INTO platform.tenant_subscriptions (tenant_id, plan_code, status, trial_started_at, trial_ends_at, current_period_ends_at)
     VALUES ($1, $2, 'trial_active', $3, $4, $4)
     ON CONFLICT (tenant_id) DO UPDATE SET updated_at = now()`,
    [tenant.id, planCode, trial.trial_started_at, trial.trial_ends_at]
  );

  invalidateTenantCache(normalizedSlug);
  // Devolve o admin recém-criado para que o cadastro público possa emitir um
  // token e logar automaticamente (sem obrigar re-login digitando o slug).
  return { ...tenant, schema_name: schemaName, admin };
}

// Remove a clínica por completo: schema (com todos os dados), registro e o
// ledger de migrations do schema — sem isso, a versão do schema dropado ficava
// para trás em platform.schema_migrations, um resíduo que colidiria se o
// mesmo id de tenant fosse reaproveitado. As três exclusões rodam na mesma
// transação: uma falha no meio não pode deixar o tenant "meio-excluído".
export async function deprovisionTenant(id) {
  const tenantId = Number(id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new TenantServiceError(400, "Id de clínica inválido.");
  }
  const result = await query("SELECT id, slug, schema_name FROM platform.tenants WHERE id = $1", [tenantId]);
  const tenant = result.rows[0];
  if (!tenant) throw new TenantServiceError(404, "Clínica não encontrada.");

  // Fallback para o formato antigo: cobre a clínica provisionada antes da
  // migration 0005 preencher schema_name (nunca deveria acontecer em produção
  // depois do deploy da migration, mas um DROP SCHEMA do schema errado não tem
  // volta — não vale a pena arriscar).
  const schema = tenant.schema_name || `tenant_${tenantId}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.query(
      "DELETE FROM platform.schema_migrations WHERE scope = 'tenant' AND target_schema = $1",
      [schema]
    );
    await client.query("DELETE FROM platform.tenants WHERE id = $1", [tenantId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  invalidateTenantCache(tenant.slug);
  return tenant;
}

// Bootstrap do schema de controle: aplica platformSchema.sql e, se não houver
// nenhum usuário de plataforma, semeia o superadmin inicial.
// - Em dev: usa PLATFORM_ADMIN_EMAIL/PLATFORM_ADMIN_PASSWORD com defaults e avisa.
// - Em produção: exige as envs; sem elas, apenas avisa e NÃO semeia default.
export async function ensurePlatform() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "platformSchema.sql"), "utf8");
  await query(sql);

  const count = await query("SELECT COUNT(*)::int AS total FROM platform.platform_users");
  if (count.rows[0].total > 0) return;

  const envEmail = process.env.PLATFORM_ADMIN_EMAIL;
  const envPassword = process.env.PLATFORM_ADMIN_PASSWORD;

  if (isProduction && (!envEmail || !envPassword)) {
    console.warn(
      "[platform] Nenhum superadmin cadastrado e PLATFORM_ADMIN_EMAIL/PLATFORM_ADMIN_PASSWORD não definidas. " +
      "Em produção o superadmin NÃO é semeado com credenciais padrão — defina as envs e reinicie."
    );
    return;
  }

  const email = envEmail || "superadmin@aura.local";
  const password = envPassword || "superadmin123";
  const passwordHash = await bcrypt.hash(String(password), 12);
  await query(
    "INSERT INTO platform.platform_users (name, email, password_hash, role) VALUES ($1, $2, $3, 'superadmin') ON CONFLICT (email) DO NOTHING",
    ["Super Admin", String(email).trim().toLowerCase(), passwordHash]
  );
  if (!envEmail || !envPassword) {
    console.warn(
      `[platform] Superadmin semeado com credenciais padrão de desenvolvimento (${email}). ` +
      "TROQUE a senha definindo PLATFORM_ADMIN_EMAIL/PLATFORM_ADMIN_PASSWORD antes de expor o servidor."
    );
  } else {
    console.log(`[platform] Superadmin inicial criado: ${email}`);
  }
}

// Migrations do schema de controle. O schema idempotente continua sendo
// aplicado por ensurePlatform durante a transição; a partir do marco 0001,
// mudanças novas devem entrar apenas em src/db/migrations/platform.
export async function applyPlatformMigrations() {
  const client = await pool.connect();
  try {
    return await applyMigrationsForTarget(client, {
      scope: "platform",
      targetSchema: "platform"
    });
  } finally {
    client.release();
  }
}

// Compatibilidade legada: aplica schema.sql idempotente em TODOS os tenants a
// cada boot. O runner incremental só entra aqui quando a flag explícita está
// ligada; no deploy, prefira `npm run migrations:apply` antes de subir a API.
export async function applySchemaToAllTenants() {
  const tenants = await query("SELECT id, slug, schema_name FROM platform.tenants ORDER BY id");
  for (const tenant of tenants.rows) {
    // Fallback ao formato antigo: no boot logo após o deploy deste código mas
    // antes de "migrations:apply" rodar (que preenche schema_name), o schema
    // físico ainda se chama "tenant_<id>" — usar isso agora e o nome novo
    // depois que a migration 0005 aplicar é o que evita apontar para um schema
    // que não existe.
    const schema = tenant.schema_name || `tenant_${tenant.id}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      // Apenas o schema do tenant no search_path (ver provisionTenant).
      await client.query(`SET search_path TO "${schema}"`);
      await applySchemaSql(client);
      if (process.env.RUN_MIGRATIONS_ON_BOOT === "true") {
        await applyMigrationsForTarget(client, { scope: "tenant", targetSchema: schema });
      }
    } catch (error) {
      console.error(`[platform] Falha ao aplicar schema no tenant "${tenant.slug}" (${schema}):`, error.message);
      throw error;
    } finally {
      try {
        await client.query("SET search_path TO public");
        client.release();
      } catch {
        client.release(true);
      }
    }
  }
  if (tenants.rows.length) {
    console.log(`[platform] Schema aplicado em ${tenants.rows.length} clínica(s).`);
  }
}
