// Paginação da SEGUNDA leva de listagens: pós-atendimento, termos digitais,
// notificações, cupons, promoções, ledger financeiro, procedimentos,
// profissionais, serviços, usuários e bloqueios de agenda.
//
// Mesmo contrato de tests/pagination.test.mjs:
//   - sem limit/offset  -> array puro (retrocompatível)
//   - com limit/offset  -> envelope { items, total, limit, offset }
//   - total respeita os filtros do WHERE
//   - páginas não se sobrepõem
//   - sort é whitelist (valor malicioso é ignorado, nunca 500)
// Clínica própria criada no before — nunca usa a clínica de demonstração.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { req, createTenant, loginTenant, platformLogin, deleteTenant } from "./helpers.mjs";

const ctx = {
  slug: null, token: null, tenant: null, platformToken: null,
  professionalId: null, serviceId: null, clientId: null, appointmentIds: []
};

// 3 atendimentos concluídos × 3 lembretes (7/15/30) = 9 acompanhamentos.
const ATENDIMENTOS = 3;
const FOLLOWUPS = ATENDIMENTOS * 3;
const TERMOS = 6;
const AMANHA = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const ASSINATURA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGPgEpHjEpFjgFAABk4A8Z5vd+AAAAAASUVORK5CYII=";

function api(path, opts = {}) {
  return req(path, { token: ctx.token, tenant: ctx.slug, ...opts });
}

before(async () => {
  const created = await createTenant("qapag2");
  ctx.slug = created.slug;
  ctx.tenant = created.tenant;
  ctx.token = (await loginTenant(created.slug, created.adminEmail, created.adminPassword)).token;
  ctx.platformToken = await platformLogin();

  // Cupons, campanhas e financeiro avançado só existem no plano studio.
  const plano = await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } });
  assert.equal(plano.status, 200, JSON.stringify(plano.json));

  const prof = await api("/professionals", { method: "POST", body: { name: "Prof Lista 00", specialty: "Piercer" } });
  assert.equal(prof.status, 201, JSON.stringify(prof.json));
  ctx.professionalId = prof.json.id;
  for (let i = 1; i < 4; i += 1) {
    await api("/professionals", { method: "POST", body: { name: `Prof Lista ${String(i).padStart(2, "0")}` } });
  }

  const servico = await api("/services", { method: "POST", body: { name: "Servico Lista 00", price: 120, duration_minutes: 30 } });
  assert.equal(servico.status, 201, JSON.stringify(servico.json));
  ctx.serviceId = servico.json.id;
  for (let i = 1; i < 4; i += 1) {
    await api("/services", { method: "POST", body: { name: `Servico Lista ${String(i).padStart(2, "0")}`, price: 50 + i, duration_minutes: 30 } });
  }

  for (let i = 0; i < 4; i += 1) {
    const proc = await api("/procedures", {
      method: "POST",
      body: { service_id: ctx.serviceId, name: `Procedimento Lista ${String(i).padStart(2, "0")}`, body_area: "Orelha", price: 90 + i }
    });
    assert.equal(proc.status, 201, JSON.stringify(proc.json));
  }

  const cliente = await api("/clients", { method: "POST", body: { full_name: "Cliente Lista 00", whatsapp: "11955550000" } });
  assert.equal(cliente.status, 201, JSON.stringify(cliente.json));
  ctx.clientId = cliente.json.id;

  // Agendamentos atendidos: é o que dispara os acompanhamentos de pós-atendimento.
  for (let i = 0; i < ATENDIMENTOS; i += 1) {
    const criado = await api("/appointments", {
      method: "POST",
      body: {
        client_id: ctx.clientId,
        full_name: "Cliente Lista 00",
        whatsapp: "11955550000",
        professional_id: ctx.professionalId,
        service_id: ctx.serviceId,
        appointment_date: AMANHA,
        appointment_time: `${String(9 + i).padStart(2, "0")}:00`,
        procedure: `Piercing Lista ${i}`,
        piercing_region: "Orelha"
      }
    });
    assert.equal(criado.status, 201, JSON.stringify(criado.json));
    ctx.appointmentIds.push(criado.json.id);
    const atendido = await api(`/appointments/${criado.json.id}`, { method: "PATCH", body: { status: "atendido" } });
    assert.equal(atendido.status, 200, JSON.stringify(atendido.json));
  }

  for (let i = 0; i < TERMOS; i += 1) {
    const termo = await api("/digital-terms", {
      method: "POST",
      body: {
        client_id: ctx.clientId,
        full_name: `Termo Lista ${String(i).padStart(2, "0")}`,
        document_number: `9999900${i}`,
        whatsapp: "11955550000",
        procedure: "Anamnese",
        piercing_region: "Orelha",
        orientations_confirmed: true,
        signature_data_url: ASSINATURA,
        form_data: { health_history: { diabetes: false } }
      }
    });
    assert.equal(termo.status, 201, JSON.stringify(termo.json));
  }

  for (let i = 0; i < 4; i += 1) {
    const cupom = await api("/coupons", {
      method: "POST",
      body: {
        code: `LISTA${String(i).padStart(2, "0")}`,
        internal_name: `Cupom Lista ${String(i).padStart(2, "0")}`,
        discount_type: "percent",
        discount_value: 10 + i,
        status: i % 2 ? "paused" : "active"
      }
    });
    assert.equal(cupom.status, 201, JSON.stringify(cupom.json));

    const promocao = await api("/promotions", {
      method: "POST",
      body: {
        name: `Campanha Lista ${String(i).padStart(2, "0")}`,
        discount_type: "percent",
        discount_value: 5 + i,
        priority: i,
        status: i % 2 ? "paused" : "active"
      }
    });
    assert.equal(promocao.status, 201, JSON.stringify(promocao.json));
  }

  for (let i = 0; i < 3; i += 1) {
    const usuario = await api("/users", {
      method: "POST",
      body: { name: `Usuario Lista ${String(i).padStart(2, "0")}`, email: `lista${i}@${ctx.slug}.test`, password: "SenhaForte123", role: "reception" }
    });
    assert.equal(usuario.status, 201, JSON.stringify(usuario.json));
  }

  for (let i = 0; i < 4; i += 1) {
    const dia = new Date(Date.now() + (i + 2) * 86400000).toISOString().slice(0, 10);
    const bloqueio = await api("/schedule-blocks", {
      method: "POST",
      body: {
        professional_id: ctx.professionalId,
        block_type: "block",
        reason: `Bloqueio Lista ${String(i).padStart(2, "0")}`,
        start_datetime: `${dia}T14:00`,
        end_datetime: `${dia}T15:00`
      }
    });
    assert.equal(bloqueio.status, 201, JSON.stringify(bloqueio.json));
  }

  for (let i = 0; i < 8; i += 1) {
    const lancamento = await api("/finance/entries", {
      method: "POST",
      body: {
        entry_type: i % 2 ? "receivable" : "payable",
        description: `Lancamento Lista ${String(i).padStart(2, "0")}`,
        amount: 100 + i,
        due_date: `${AMANHA.slice(0, 8)}01`,
        competence_date: `${AMANHA.slice(0, 8)}01`,
        status: i % 4 === 0 ? "paid" : "pending"
      }
    });
    assert.equal(lancamento.status, 201, JSON.stringify(lancamento.json));
  }
});

after(async () => {
  if (ctx.platformToken && ctx.tenant?.id) {
    await deleteTenant(ctx.platformToken, ctx.tenant.id, ctx.slug);
  }
});

// Listagens cobertas pelo contrato genérico (rotas que devolvem array puro).
const LISTAGENS = [
  "/post-care",
  "/digital-terms",
  "/notifications",
  "/coupons",
  "/promotions",
  "/procedures",
  "/professionals",
  "/services",
  "/users",
  "/schedule-blocks"
];

// ---------- Retrocompatibilidade ----------

test("sem limit/offset as novas listagens continuam devolvendo array puro", async () => {
  for (const path of LISTAGENS) {
    const res = await api(path);
    assert.equal(res.status, 200, `${path}: ${JSON.stringify(res.json)}`);
    assert.ok(Array.isArray(res.json), `${path} deve devolver array puro`);
  }
});

// ---------- Envelope ----------

test("com limit as novas listagens envelopam { items, total, limit, offset }", async () => {
  for (const path of LISTAGENS) {
    const res = await api(`${path}?limit=2`);
    assert.equal(res.status, 200, `${path}: ${JSON.stringify(res.json)}`);
    assert.ok(!Array.isArray(res.json), `${path} paginado deve ser envelope`);
    assert.ok(Array.isArray(res.json.items), `${path} deve trazer items`);
    assert.equal(res.json.limit, 2, `${path} deve ecoar o limit`);
    assert.equal(res.json.offset, 0, `${path} deve ecoar o offset`);
    assert.equal(typeof res.json.total, "number", `${path} deve trazer total numérico`);
    assert.ok(res.json.total >= res.json.items.length, `${path}: total não pode ser menor que a página`);
  }
});

test("só offset já envelopa e o limit assume o padrão", async () => {
  const res = await api("/post-care?offset=0");
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.ok(!Array.isArray(res.json), "offset sozinho deve envelopar");
  assert.equal(res.json.limit, 50, "limit padrão");
  assert.equal(res.json.total, FOLLOWUPS);
});

test("total do envelope bate com o tamanho da lista sem paginação", async () => {
  for (const path of LISTAGENS) {
    const completa = await api(path);
    const pagina = await api(`${path}?limit=1`);
    assert.equal(pagina.json.total, completa.json.length, `${path}: total deve ser o da lista inteira`);
  }
});

test("pós-atendimento e termos trazem a massa esperada", async () => {
  const followups = await api("/post-care?limit=4");
  assert.equal(followups.json.total, FOLLOWUPS, "3 atendimentos × 3 lembretes");
  assert.equal(followups.json.items.length, 4);

  const termos = await api("/digital-terms?limit=4");
  assert.equal(termos.json.total, TERMOS);
  assert.equal(termos.json.items.length, 4);
});

// ---------- Páginas ----------

test("offset traz página diferente, sem sobreposição com a primeira", async () => {
  for (const path of ["/post-care", "/digital-terms", "/procedures", "/schedule-blocks"]) {
    const p1 = await api(`${path}?limit=2&offset=0`);
    const p2 = await api(`${path}?limit=2&offset=2`);
    const ids1 = p1.json.items.map((item) => item.id);
    const ids2 = p2.json.items.map((item) => item.id);
    assert.equal(ids2.length, 2, `${path}: segunda página deve estar cheia`);
    assert.equal(ids1.filter((id) => ids2.includes(id)).length, 0, `${path}: páginas não podem se sobrepor`);
    assert.equal(p1.json.total, p2.json.total, `${path}: total não muda entre páginas`);
  }
});

test("offset além do fim devolve página vazia mantendo o total", async () => {
  const res = await api(`/post-care?limit=5&offset=${FOLLOWUPS + 50}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.items.length, 0);
  assert.equal(res.json.total, FOLLOWUPS);
});

test("limit e offset são saneados também nas novas listagens", async () => {
  assert.equal((await api("/post-care?limit=9999")).json.limit, 200, "limit deve ser limitado a 200");
  assert.equal((await api("/post-care?limit=0")).json.limit, 1, "limit deve ter piso 1");
  assert.equal((await api("/post-care?limit=abc")).json.limit, 50, "limit inválido cai no padrão");
  assert.equal((await api("/post-care?limit=2&offset=-30")).json.offset, 0, "offset negativo vira 0");
});

// ---------- total respeita os filtros ----------

test("total do pós-atendimento respeita status, período e busca", async () => {
  const todos = await api("/post-care?limit=1");
  const pendentes = await api("/post-care?limit=1&status=pendente");
  assert.equal(pendentes.json.total, todos.json.total, "todos nascem pendentes");

  const inexistente = await api("/post-care?limit=1&status=status_que_nao_existe");
  assert.equal(inexistente.json.total, 0, "status desconhecido deve zerar o total");
  assert.equal(inexistente.json.items.length, 0);

  const busca = await api("/post-care?limit=10&search=Piercing Lista 0");
  assert.equal(busca.json.total, 3, "3 followups do primeiro atendimento");
  for (const item of busca.json.items) assert.match(item.procedure, /^Piercing Lista 0$/);

  const passado = await api("/post-care?limit=1&from=2000-01-01&to=2000-12-31");
  assert.equal(passado.json.total, 0, "período sem vencimentos deve zerar");
});

test("total dos termos digitais respeita a busca textual", async () => {
  const res = await api("/digital-terms?limit=2&search=Termo Lista 0");
  assert.equal(res.json.total, TERMOS, "todos os termos começam com o prefixo");
  const um = await api("/digital-terms?limit=2&search=Termo Lista 03");
  assert.equal(um.json.total, 1);
  assert.equal(um.json.items[0].full_name, "Termo Lista 03");
});

test("total de cupons e promoções respeita o filtro de status", async () => {
  const cupons = await api("/coupons?limit=5&status=active");
  assert.equal(cupons.json.total, 2, "2 cupons ativos entre os 4 criados");
  for (const item of cupons.json.items) assert.equal(item.status, "active");

  const promocoes = await api("/promotions?limit=5&status=paused");
  assert.equal(promocoes.json.total, 2, "2 campanhas pausadas entre as 4 criadas");
  for (const item of promocoes.json.items) assert.equal(item.status, "paused");
});

test("total de usuários respeita o filtro de papel", async () => {
  const recepcao = await api("/users?limit=2&role=reception");
  assert.equal(recepcao.json.total, 3);
  for (const item of recepcao.json.items) assert.equal(item.role, "reception");
  assert.equal((await api("/users?limit=2&role=admin")).json.total, 1, "só o admin da criação da clínica");
});

test("total de notificações respeita o filtro de status", async () => {
  const todas = await api("/notifications?limit=2");
  assert.equal(typeof todas.json.total, "number");
  const inexistente = await api("/notifications?limit=2&status=status_que_nao_existe");
  assert.equal(inexistente.json.total, 0);
  assert.equal(inexistente.json.items.length, 0);
});

test("total de serviços e profissionais respeita o filtro de atividade", async () => {
  const servicos = await api("/services?limit=2&status=active");
  assert.equal(servicos.json.total, 4, "os 4 serviços criados nascem ativos");
  const profissionais = await api("/professionals?limit=2&status=inactive");
  assert.equal(profissionais.json.total, 0, "nenhum profissional inativo");
});

test("procedimentos filtram por serviço e por busca", async () => {
  const doServico = await api(`/procedures?limit=2&service_id=${ctx.serviceId}`);
  assert.equal(doServico.json.total, 4);
  const busca = await api("/procedures?limit=5&search=Procedimento Lista 02");
  assert.equal(busca.json.total, 1);
  assert.equal(busca.json.items[0].name, "Procedimento Lista 02");
});

// ---------- Ledger: relatório, não lista ----------

test("ledger pagina só as entries e mantém os indicadores do período inteiro", async () => {
  const periodo = `from=${AMANHA.slice(0, 8)}01&to=${AMANHA.slice(0, 8)}28`;
  const completo = await api(`/finance/ledger?${periodo}`);
  assert.equal(completo.status, 200, JSON.stringify(completo.json));
  assert.ok(Array.isArray(completo.json.entries), "sem paginação o ledger mantém o formato de sempre");
  assert.equal(completo.json.total, undefined, "sem paginação não há total/limit/offset");
  assert.equal(completo.json.limit, undefined);

  const pagina = await api(`/finance/ledger?${periodo}&limit=3`);
  assert.equal(pagina.status, 200, JSON.stringify(pagina.json));
  assert.equal(pagina.json.entries.length, 3, "a página recorta apenas entries");
  assert.equal(pagina.json.total, completo.json.entries.length, "total conta o período filtrado inteiro");
  assert.equal(pagina.json.limit, 3);
  assert.equal(pagina.json.offset, 0);
  assert.deepEqual(pagina.json.cashflow, completo.json.cashflow, "indicadores somam o período, não a página");
  assert.deepEqual(pagina.json.dre, completo.json.dre);

  const segunda = await api(`/finance/ledger?${periodo}&limit=3&offset=3`);
  const ids1 = pagina.json.entries.map((item) => item.id);
  const ids2 = segunda.json.entries.map((item) => item.id);
  assert.equal(ids1.filter((id) => ids2.includes(id)).length, 0, "páginas do ledger não podem se sobrepor");

  const pagos = await api(`/finance/ledger?${periodo}&limit=5&status=paid`);
  assert.ok(pagos.json.total > 0 && pagos.json.total < completo.json.entries.length, "filtro deve reduzir o total");
  for (const item of pagos.json.entries) assert.equal(item.status, "paid");
});

// ---------- sort (whitelist) ----------

test("sort válido ordena nos dois sentidos", async () => {
  const asc = await api("/procedures?limit=1&sort=name:asc");
  const desc = await api("/procedures?limit=1&sort=name:desc");
  assert.equal(asc.json.items[0].name, "Procedimento Lista 00");
  assert.equal(desc.json.items[0].name, "Procedimento Lista 03");

  const recentes = await api("/digital-terms?limit=1&sort=name:desc");
  assert.equal(recentes.json.items[0].full_name, `Termo Lista ${String(TERMOS - 1).padStart(2, "0")}`);
});

test("sort inválido ou malicioso é ignorado em todas as novas listagens", async () => {
  // Nenhum destes resolve para uma chave do whitelist: têm que cair na
  // ordenação padrão do servidor.
  const desconhecidos = [
    "id;DROP TABLE clients",
    "full_name--",
    "campo_inexistente:desc",
    "1) OR (1=1",
    "'; DROP TABLE users; --"
  ];
  for (const path of LISTAGENS) {
    const padrao = await api(`${path}?limit=3`);
    for (const sort of desconhecidos) {
      const res = await api(`${path}?limit=3&sort=${encodeURIComponent(sort)}`);
      assert.equal(res.status, 200, `${path} sort="${sort}" não pode dar erro: ${JSON.stringify(res.json)}`);
      assert.deepEqual(
        res.json.items.map((item) => item.id),
        padrao.json.items.map((item) => item.id),
        `${path} sort="${sort}" deve cair na ordenação padrão`
      );
    }
    // Chave válida com direção suja: a direção não é interpolada, é comparada
    // com "desc" — logo o resultado é o mesmo de um "name:asc" legítimo.
    const sujo = await api(`${path}?limit=3&sort=${encodeURIComponent("name:asc;DELETE FROM clients")}`);
    const limpo = await api(`${path}?limit=3&sort=name:asc`);
    assert.equal(sujo.status, 200, `${path}: direção suja não pode dar erro: ${JSON.stringify(sujo.json)}`);
    assert.deepEqual(
      sujo.json.items.map((item) => item.id),
      limpo.json.items.map((item) => item.id),
      `${path}: direção suja deve se comportar como ascendente`
    );
  }
  // As tabelas precisam continuar de pé depois das tentativas de injeção.
  const clientes = await api("/clients?limit=1");
  assert.equal(clientes.status, 200, JSON.stringify(clientes.json));
  assert.ok(clientes.json.total >= 1);
  const usuarios = await api("/users?limit=1");
  assert.equal(usuarios.status, 200, JSON.stringify(usuarios.json));
  assert.ok(usuarios.json.total >= 1);
});

// ---------- registro recém-criado não some (armadilha do .find) ----------

test("registro criado é devolvido inteiro mesmo com a lista paginada", async () => {
  const profissional = await api("/professionals", { method: "POST", body: { name: "Zzz Prof Ultimo", service_ids: [ctx.serviceId] } });
  assert.equal(profissional.status, 201, JSON.stringify(profissional.json));
  assert.ok(profissional.json?.id, "profissional criado deve voltar com id");
  assert.deepEqual(profissional.json.service_ids, [ctx.serviceId], "service_ids devem vir preenchidos");

  const servico = await api("/services", { method: "POST", body: { name: "Zzz Servico Ultimo", price: 10, duration_minutes: 20 } });
  assert.equal(servico.status, 201, JSON.stringify(servico.json));
  assert.ok(servico.json?.id && Array.isArray(servico.json.professional_ids), "serviço deve voltar decorado");

  const bloqueio = await api("/schedule-blocks", {
    method: "POST",
    body: {
      professional_id: ctx.professionalId,
      reason: "Zzz Bloqueio Ultimo",
      start_datetime: `${AMANHA}T20:00`,
      end_datetime: `${AMANHA}T21:00`
    }
  });
  assert.equal(bloqueio.status, 201, JSON.stringify(bloqueio.json));
  assert.ok(bloqueio.json?.id, "bloqueio criado deve voltar com id");

  const termo = await api("/digital-terms", {
    method: "POST",
    body: {
      client_id: ctx.clientId,
      full_name: "Zzz Termo Ultimo",
      orientations_confirmed: true,
      signature_data_url: ASSINATURA,
      form_data: {}
    }
  });
  assert.equal(termo.status, 201, JSON.stringify(termo.json));
  assert.equal(termo.json.full_name, "Zzz Termo Ultimo", "termo criado deve voltar preenchido");
});

// ---------- listagem de usuários não vaza hash ----------

test("listagem paginada de usuários não expõe password_hash", async () => {
  const res = await api("/users?limit=10");
  assert.ok(res.json.items.length > 0);
  for (const item of res.json.items) {
    assert.equal(item.password_hash, undefined, "a lista de colunas é fixa no servidor");
  }
});
