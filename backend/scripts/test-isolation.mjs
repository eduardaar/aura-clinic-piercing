// Teste de isolamento multi-tenant (requer o servidor JÁ rodando).
// Prova que dados de uma clínica jamais aparecem em outra:
//   1. Login de plataforma (superadmin).
//   2. Cria os tenants de teste 'isolatest-a' e 'isolatest-b'.
//   3. Login nos dois tenants.
//   4. Cria um cliente no A.
//   5. GET /api/clients no B → não pode conter o cliente do A (deve ser []).
//   6. Token do A + header X-Tenant do B → 403.
//   7. Suspende o B → acesso ao B → 403 "suspensa".
//   8. 30 requests alternando A/B → contagens continuam corretas (pool não vaza).
//   9. Limpa os tenants de teste e imprime PASS/FAIL por item.
//
// Uso (a partir de backend/): node scripts/test-isolation.mjs
import "dotenv/config";

const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
const PLATFORM_EMAIL = process.env.PLATFORM_ADMIN_EMAIL || "superadmin@aura.local";
const PLATFORM_PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD || "superadmin123";

const TENANT_A = "isolatest-a";
const TENANT_B = "isolatest-b";
const TEST_PASSWORD = "senhaForte1";

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// Helper de requisição: retorna { status, body } (body já parseado se JSON).
async function req(method, path, { token, tenant, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (tenant) headers["X-Tenant"] = tenant;
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

// Remove tenants de teste que possam ter sobrado de execuções anteriores.
async function cleanupTestTenants(platformToken) {
  const list = await req("GET", "/api/platform/tenants", { token: platformToken });
  if (!Array.isArray(list.body)) return;
  for (const tenant of list.body) {
    if ([TENANT_A, TENANT_B].includes(tenant.slug)) {
      await req("DELETE", `/api/platform/tenants/${tenant.id}`, {
        token: platformToken,
        body: { confirmation: tenant.slug }
      });
    }
  }
}

async function main() {
  console.log(`== Teste de isolamento multi-tenant em ${BASE_URL} ==\n`);

  // 1) Login de plataforma.
  const platformLogin = await req("POST", "/api/platform/login", {
    body: { email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD }
  });
  const platformToken = platformLogin.body?.token;
  record("1. Login de plataforma (superadmin)", platformLogin.status === 200 && !!platformToken,
    `status=${platformLogin.status}`);
  if (!platformToken) throw new Error("Sem token de plataforma — abortando.");

  await cleanupTestTenants(platformToken);

  // 2) Cria os dois tenants de teste.
  const createA = await req("POST", "/api/platform/tenants", {
    token: platformToken,
    body: { name: "Isolamento A", slug: TENANT_A, admin_name: "Admin A", admin_email: "a@iso.test", admin_password: TEST_PASSWORD }
  });
  const createB = await req("POST", "/api/platform/tenants", {
    token: platformToken,
    body: { name: "Isolamento B", slug: TENANT_B, admin_name: "Admin B", admin_email: "b@iso.test", admin_password: TEST_PASSWORD }
  });
  const idA = createA.body?.tenant?.id;
  const idB = createB.body?.tenant?.id;
  record("2. Criação dos tenants de teste (A e B)",
    createA.status === 201 && createB.status === 201 && !!idA && !!idB,
    `A: status=${createA.status} id=${idA}; B: status=${createB.status} id=${idB}`);

  // 3) Login em cada tenant.
  const loginA = await req("POST", "/api/login", {
    tenant: TENANT_A,
    body: { email: "a@iso.test", password: TEST_PASSWORD }
  });
  const loginB = await req("POST", "/api/login", {
    tenant: TENANT_B,
    body: { email: "b@iso.test", password: TEST_PASSWORD }
  });
  const tokenA = loginA.body?.token;
  const tokenB = loginB.body?.token;
  record("3. Login nos tenants A e B",
    loginA.status === 200 && loginB.status === 200 && !!tokenA && !!tokenB &&
    loginA.body?.tenant?.slug === TENANT_A && loginB.body?.tenant?.slug === TENANT_B,
    `A: status=${loginA.status} tenant=${loginA.body?.tenant?.slug}; B: status=${loginB.status} tenant=${loginB.body?.tenant?.slug}`);

  // 4) Cria um cliente no A.
  const createClient = await req("POST", "/api/clients", {
    token: tokenA,
    body: { full_name: "Cliente Do A", whatsapp: "11999990000" }
  });
  record("4. Criação de cliente no tenant A", createClient.status === 201,
    `status=${createClient.status}`);

  // 5) O B não pode ver o cliente do A.
  const clientsB = await req("GET", "/api/clients", { token: tokenB });
  const bList = Array.isArray(clientsB.body) ? clientsB.body : null;
  const bLeak = bList ? bList.some((c) => c.full_name === "Cliente Do A") : true;
  record("5. GET /api/clients no B não contém o cliente do A (lista vazia)",
    clientsB.status === 200 && bList !== null && bList.length === 0 && !bLeak,
    `status=${clientsB.status} total=${bList ? bList.length : "?"}`);

  // 6) Token do A com header do B → 403.
  const crossTenant = await req("GET", "/api/clients", { token: tokenA, tenant: TENANT_B });
  record("6. Token do A + X-Tenant do B é rejeitado (403)", crossTenant.status === 403,
    `status=${crossTenant.status} erro="${crossTenant.body?.error || ""}"`);

  // 7) Suspende o B → acesso bloqueado com mensagem de suspensão.
  const suspend = await req("PATCH", `/api/platform/tenants/${idB}`, {
    token: platformToken,
    body: { status: "suspenso" }
  });
  const suspendedAccess = await req("GET", "/api/clients", { token: tokenB });
  record("7. Tenant B suspenso responde 403 'suspensa'",
    suspend.status === 200 && suspendedAccess.status === 403 &&
    String(suspendedAccess.body?.error || "").toLowerCase().includes("suspensa"),
    `patch=${suspend.status} get=${suspendedAccess.status} erro="${suspendedAccess.body?.error || ""}"`);

  // Reativa o B para o teste de alternância.
  await req("PATCH", `/api/platform/tenants/${idB}`, {
    token: platformToken,
    body: { status: "ativo" }
  });

  // 8) 30 requests alternando A/B — contagens têm que permanecer corretas
  // (prova que nenhum client volta ao pool com search_path de outro tenant).
  let alternationOk = true;
  let alternationDetail = "";
  for (let i = 0; i < 30; i++) {
    const useA = i % 2 === 0;
    const { status, body } = await req("GET", "/api/clients", { token: useA ? tokenA : tokenB });
    const list = Array.isArray(body) ? body : null;
    const expected = useA ? 1 : 0;
    if (status !== 200 || !list || list.length !== expected ||
        (useA && list[0]?.full_name !== "Cliente Do A")) {
      alternationOk = false;
      alternationDetail = `iteração ${i} (${useA ? "A" : "B"}): status=${status} total=${list ? list.length : "?"} esperado=${expected}`;
      break;
    }
  }
  record("8. 30 requests alternando A/B mantêm contagens corretas (sem vazamento do pool)",
    alternationOk, alternationDetail || "A=1 cliente, B=0 em todas as iterações");

  // 9) Limpeza dos tenants de teste (com confirmação).
  const deleteA = await req("DELETE", `/api/platform/tenants/${idA}`, {
    token: platformToken,
    body: { confirmation: TENANT_A }
  });
  const deleteB = await req("DELETE", `/api/platform/tenants/${idB}`, {
    token: platformToken,
    body: { confirmation: TENANT_B }
  });
  record("9. Exclusão dos tenants de teste",
    deleteA.status === 200 && deleteB.status === 200,
    `A=${deleteA.status} B=${deleteB.status}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n== Resultado: ${results.length - failed.length}/${results.length} itens PASS ==`);
  if (failed.length) {
    console.log("Itens com falha:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("ERRO no teste de isolamento:", error);
  process.exitCode = 1;
});
