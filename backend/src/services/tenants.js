// Serviço de tenants (clínicas): provisionamento/desprovisionamento de
// schemas Postgres, bootstrap do schema de controle `platform` e o runner de
// migrations multi-schema (aplica o schema.sql idempotente em todos os tenants).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import { pool, query } from "../database/connection.js";
import { applySchemaSql } from "../db/sqliteCompat.js";
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

// Cria a clínica: registro em platform.tenants + schema "tenant_<id>" com as
// tabelas do app, o admin inicial e o tema padrão do catálogo.
// Em erro, desfaz tudo (DROP SCHEMA + DELETE do registro) e propaga.
export async function provisionTenant({ name, slug, adminName, adminEmail, adminPassword, phone = "", city = "", state = "", logoUrl = "", plan = "profissional" }) {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  validateProvisionInput({ name, slug: normalizedSlug, adminEmail, adminPassword });
  const planCode = normalizePlanCode(plan);

  const existing = await query("SELECT id FROM platform.tenants WHERE slug = $1", [normalizedSlug]);
  if (existing.rows[0]) {
    throw new TenantServiceError(409, "Já existe uma clínica com este identificador.");
  }

  const inserted = await query(
    `INSERT INTO platform.tenants (name, slug, plan, store_short_name, responsible_name, phone, city, state, logo_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, name, slug, status, plan, created_at`,
    [String(name).trim(), normalizedSlug, planCode, String(name).trim(), String(adminName || "").trim(), String(phone || "").trim(), String(city || "").trim(), String(state || "").trim(), String(logoUrl || "").trim()]
  );
  const tenant = inserted.rows[0];
  const schema = `tenant_${tenant.id}`;
  const selectedPlan = planByCode(planCode);
  const trial = trialWindow(selectedPlan.trial_days);

  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    // Só o schema do tenant no search_path durante a criação: garante que os
    // CREATE TABLE IF NOT EXISTS criem as tabelas AQUI (e não achem homônimas
    // em public).
    await client.query(`SET search_path TO "${schema}"`);
    await applySchemaSql(client);
    const passwordHash = await bcrypt.hash(String(adminPassword), 10);
    await client.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')",
      [String(adminName || "Administrador").trim() || "Administrador", String(adminEmail).trim().toLowerCase(), passwordHash]
    );
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
  return tenant;
}

// Remove a clínica por completo: schema (com todos os dados) + registro.
export async function deprovisionTenant(id) {
  const tenantId = Number(id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new TenantServiceError(400, "Id de clínica inválido.");
  }
  const result = await query("SELECT id, slug FROM platform.tenants WHERE id = $1", [tenantId]);
  const tenant = result.rows[0];
  if (!tenant) throw new TenantServiceError(404, "Clínica não encontrada.");

  await query(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`);
  await query("DELETE FROM platform.tenants WHERE id = $1", [tenantId]);
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
  const passwordHash = await bcrypt.hash(String(password), 10);
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

// Runner de migrations multi-schema: aplica o schema.sql (idempotente) em
// TODOS os tenants cadastrados. Roda a cada boot do servidor.
export async function applySchemaToAllTenants() {
  const tenants = await query("SELECT id, slug FROM platform.tenants ORDER BY id");
  for (const tenant of tenants.rows) {
    const schema = `tenant_${tenant.id}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      // Apenas o schema do tenant no search_path (ver provisionTenant).
      await client.query(`SET search_path TO "${schema}"`);
      await applySchemaSql(client);
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
