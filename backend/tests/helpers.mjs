// Helpers compartilhados para os testes de endpoint (node:test + fetch).
// Batem contra um servidor JÁ rodando em TEST_API_URL (default :4000/api).
// O runner tests/run-suite.mjs sobe um servidor em produção numa porta dedicada.

export const BASE = process.env.TEST_API_URL || "http://localhost:4000/api";

// Requisição genérica. Retorna { status, json }.
export async function req(path, { method = "GET", token, tenant, platform, body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined && !(body instanceof FormData)) h["Content-Type"] = "application/json";
  if (token) h.Authorization = `Bearer ${token}`;
  if (tenant) h["X-Tenant"] = tenant;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo JSON */ }
  return { status: res.status, json };
}

// Gera um slug único de clínica de teste (evita colisão entre execuções paralelas).
export function testSlug(prefix = "qa") {
  const rand = Math.floor(performance.now() * 1000) % 1000000;
  return `${prefix}-${rand}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

// Cria uma clínica (tenant) via signup público. Retorna { slug, adminEmail, adminPassword, tenant }.
export async function createTenant(prefix = "qa") {
  const slug = testSlug(prefix);
  const adminEmail = `admin@${slug}.test`;
  const adminPassword = "SenhaForte123";
  const { status, json } = await req("/signup", {
    method: "POST",
    body: { name: `Clinica ${slug}`, slug, admin_email: adminEmail, admin_password: adminPassword },
  });
  if (status !== 201) throw new Error(`Falha ao criar tenant ${slug}: ${status} ${JSON.stringify(json)}`);
  return { slug, adminEmail, adminPassword, tenant: json.tenant };
}

// Login numa clínica. Retorna { token, user, tenant }.
export async function loginTenant(slug, email, password) {
  const { status, json } = await req("/login", { method: "POST", tenant: slug, body: { email, password } });
  if (status !== 200) throw new Error(`Login falhou (${slug}): ${status} ${JSON.stringify(json)}`);
  return json;
}

// Login na plataforma (superadmin). Retorna token.
export async function platformLogin() {
  const email = process.env.PLATFORM_ADMIN_EMAIL || "superadmin@aura.local";
  const password = process.env.PLATFORM_ADMIN_PASSWORD || "superadmin123";
  const { status, json } = await req("/platform/login", { method: "POST", body: { email, password } });
  if (status !== 200) throw new Error(`Login de plataforma falhou: ${status} ${JSON.stringify(json)}`);
  return json.token;
}

// Remove uma clínica de teste (limpeza). Ignora erros.
export async function deleteTenant(platformToken, tenantId, slug) {
  try {
    await req(`/platform/tenants/${tenantId}`, {
      method: "DELETE",
      token: platformToken,
      platform: true,
      body: { confirmation: slug },
    });
  } catch { /* limpeza best-effort */ }
}
