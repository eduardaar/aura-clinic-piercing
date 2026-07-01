// Testes de casos de BORDA / VALIDAÇÃO dos endpoints de escrita.
// Foca em payloads inválidos (400), autorização e coerência dos schemas Zod
// versus as constraints reais do banco. Clínica própria criada no before.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { req, createTenant, loginTenant, platformLogin, deleteTenant } from "./helpers.mjs";

const ctx = { slug: null, token: null, tenant: null, platformToken: null, professionalId: null };
const AMANHA = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function api(path, opts = {}) {
  return req(path, { token: ctx.token, tenant: ctx.slug, ...opts });
}

before(async () => {
  const created = await createTenant("qacrud");
  ctx.slug = created.slug;
  ctx.tenant = created.tenant;
  const login = await loginTenant(created.slug, created.adminEmail, created.adminPassword);
  ctx.token = login.token;
  ctx.platformToken = await platformLogin();

  // Um profissional para os testes de agendamento que precisam de FK válida.
  const prof = await api("/professionals", { method: "POST", body: { name: "Prof Borda" } });
  ctx.professionalId = prof.json.id;
});

after(async () => {
  if (ctx.platformToken && ctx.tenant?.id) {
    await deleteTenant(ctx.platformToken, ctx.tenant.id, ctx.slug);
  }
});

// ---------- Autenticação / tenant ----------

test("sem token → 401", async () => {
  const res = await req("/clients", { tenant: ctx.slug });
  assert.equal(res.status, 401, JSON.stringify(res.json));
});

test("sem header de clínica e sem token → rejeitado (400 sem DEFAULT_TENANT, 401 com)", async () => {
  // Se DEFAULT_TENANT estiver no ambiente, a clínica é resolvida e a rejeição
  // vem do auth (401). Sem ele, a resolução de tenant falha antes (400).
  // O essencial: a rota NUNCA responde 200 sem credenciais.
  const res = await req("/clients");
  assert.ok([400, 401].includes(res.status), `esperado 400 ou 401, recebeu ${res.status} ${JSON.stringify(res.json)}`);
});

// ---------- Clientes ----------

test("cliente sem full_name → 400", async () => {
  const res = await api("/clients", { method: "POST", body: { whatsapp: "11988887777" } });
  assert.equal(res.status, 400, JSON.stringify(res.json));
  assert.match(res.json.error, /Nome do cliente/i);
});

test("cliente sem whatsapp → 400", async () => {
  const res = await api("/clients", { method: "POST", body: { full_name: "Sem Zap" } });
  assert.equal(res.status, 400, JSON.stringify(res.json));
  assert.match(res.json.error, /WhatsApp/i);
});

test("cliente com full_name em branco (só espaços) → 400", async () => {
  const res = await api("/clients", { method: "POST", body: { full_name: "   ", whatsapp: "11988887777" } });
  assert.equal(res.status, 400, JSON.stringify(res.json));
});

// ---------- Serviços ----------

test("serviço sem name → 400", async () => {
  const res = await api("/services", { method: "POST", body: { price: 100 } });
  assert.equal(res.status, 400, JSON.stringify(res.json));
  assert.match(res.json.error, /Nome do serviço/i);
});

// ---------- Procedimentos ----------

test("procedimento sem service_id → 400", async () => {
  const res = await api("/procedures", { method: "POST", body: { name: "Solto" } });
  assert.equal(res.status, 400, JSON.stringify(res.json));
  assert.match(res.json.error, /Serviço vinculado/i);
});

test("procedimento sem name → 400", async () => {
  const res = await api("/procedures", { method: "POST", body: { service_id: 1 } });
  assert.equal(res.status, 400, JSON.stringify(res.json));
  assert.match(res.json.error, /Nome do procedimento/i);
});

// ---------- Profissionais ----------

test("profissional sem name → 400", async () => {
  const res = await api("/professionals", { method: "POST", body: { specialty: "X" } });
  assert.equal(res.status, 400, JSON.stringify(res.json));
});

// ---------- Joias ----------

test("joia sem category → 400", async () => {
  const res = await api("/jewelry", { method: "POST", body: { name: "Sem categoria", material: "Titânio", color: "Prata" } });
  assert.equal(res.status, 400, JSON.stringify(res.json));
  assert.match(res.json.error, /categoria/i);
});

test("joia com category inválida → 400", async () => {
  const res = await api("/jewelry", {
    method: "POST",
    body: { name: "Categoria errada", category: "CategoriaInexistente", material: "Titânio", color: "Prata" },
  });
  assert.equal(res.status, 400, JSON.stringify(res.json));
});

test("joia sem name → 400", async () => {
  const res = await api("/jewelry", { method: "POST", body: { category: "Labret", material: "Titânio", color: "Prata" } });
  assert.equal(res.status, 400, JSON.stringify(res.json));
  assert.match(res.json.error, /Nome do produto/i);
});

// ---------- Agendamentos ----------

test("agendamento sem professional_id → 400", async () => {
  const res = await api("/appointments", {
    method: "POST",
    body: {
      full_name: "Cliente X",
      whatsapp: "11977776666",
      procedure: "Furo",
      piercing_region: "Orelha",
      appointment_date: AMANHA,
      appointment_time: "10:00",
    },
  });
  assert.equal(res.status, 400, JSON.stringify(res.json));
  assert.match(res.json.error, /Profissional/i);
});

test("agendamento sem appointment_date → 400", async () => {
  const res = await api("/appointments", {
    method: "POST",
    body: {
      full_name: "Cliente X",
      whatsapp: "11977776666",
      professional_id: ctx.professionalId,
      procedure: "Furo",
      piercing_region: "Orelha",
      appointment_time: "10:00",
    },
  });
  assert.equal(res.status, 400, JSON.stringify(res.json));
  assert.match(res.json.error, /Data do agendamento/i);
});

// CORRIGIDO: o appointmentCreateSchema (Zod) agora exige procedure e
// piercing_region, então um payload sem esses campos é rejeitado com 400 de
// validação limpo (antes estourava a constraint NOT NULL do banco em 500).
test("agendamento sem procedure/piercing_region retorna 400 de validação", async () => {
  const res = await api("/appointments", {
    method: "POST",
    body: {
      full_name: "Cliente Sem Procedimento",
      whatsapp: "11955554444",
      professional_id: ctx.professionalId,
      appointment_date: AMANHA,
      appointment_time: "11:30",
    },
  });
  assert.equal(
    res.status,
    400,
    `Deveria rejeitar com 400 (procedure/piercing_region obrigatórios). Recebido: ${res.status} ${JSON.stringify(res.json)}`
  );
  assert.match(res.json.error, /procedimento|regi[aã]o/i);
});

// ---------- Despesas ----------

test("despesa com expense_type inválido → 400", async () => {
  const res = await api("/expenses", {
    method: "POST",
    body: { description: "X", expense_type: "invalido", amount: 10, due_date: "2026-07-01" },
  });
  assert.equal(res.status, 400, JSON.stringify(res.json));
});

test("despesa sem due_date → 400", async () => {
  const res = await api("/expenses", {
    method: "POST",
    body: { description: "X", expense_type: "fixa", amount: 10 },
  });
  assert.equal(res.status, 400, JSON.stringify(res.json));
});

// ---------- Vendas ----------

test("venda sem itens → 400", async () => {
  const res = await api("/sales-orders", {
    method: "POST",
    body: { full_name: "Cliente", whatsapp: "11933332222", items: [] },
  });
  assert.equal(res.status, 400, JSON.stringify(res.json));
});

test("venda sem dados do cliente → 400", async () => {
  const res = await api("/sales-orders", {
    method: "POST",
    body: { items: [{ item_name: "Item", quantity: 1, unit_price: 10 }] },
  });
  assert.equal(res.status, 400, JSON.stringify(res.json));
});

// ---------- Termo digital ----------

test("termo digital sem assinatura → 400", async () => {
  const res = await api("/digital-terms", {
    method: "POST",
    body: { appointment_id: 1, client_id: 1, full_name: "X", orientations_confirmed: true },
  });
  assert.equal(res.status, 400, JSON.stringify(res.json));
});

test("termo digital sem orientações confirmadas → 400", async () => {
  const res = await api("/digital-terms", {
    method: "POST",
    body: {
      appointment_id: 1,
      client_id: 1,
      full_name: "X",
      signature_data_url: "data:image/png;base64,AAAA",
      orientations_confirmed: false,
    },
  });
  assert.equal(res.status, 400, JSON.stringify(res.json));
});

// ---------- Recursos inexistentes ----------

test("prontuário para cliente inexistente → 404", async () => {
  const res = await api("/clients/999999/medical-records", {
    method: "POST",
    body: { record_date: "2026-07-01", guidance: "x" },
  });
  assert.equal(res.status, 404, JSON.stringify(res.json));
});

test("resgate de fidelidade para cliente inexistente → 404", async () => {
  const res = await api("/clients/999999/loyalty-redemptions", {
    method: "POST",
    body: { points_used: 1 },
  });
  assert.equal(res.status, 404, JSON.stringify(res.json));
});
