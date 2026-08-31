// Testes da fundação de paginação/filtro das listagens.
//
// Cobre o contrato acordado com o frontend:
//   - sem limit/offset  -> array puro (retrocompatível)
//   - com limit/offset  -> envelope { items, total, limit, offset }
//   - total respeita os filtros do WHERE (não é o total da tabela)
//   - páginas não se sobrepõem
//   - sort é whitelist (valor malicioso é ignorado, nunca 500)
// Clínica própria criada no before — nunca usa a clínica de demonstração.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { req, createTenant, loginTenant, platformLogin, deleteTenant } from "./helpers.mjs";

const ctx = { slug: null, token: null, tenant: null, platformToken: null, professionalId: null };
const TOTAL_CLIENTES = 12;
const AMANHA = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function api(path, opts = {}) {
  return req(path, { token: ctx.token, tenant: ctx.slug, ...opts });
}

before(async () => {
  const created = await createTenant("qapag");
  ctx.slug = created.slug;
  ctx.tenant = created.tenant;
  const login = await loginTenant(created.slug, created.adminEmail, created.adminPassword);
  ctx.token = login.token;
  ctx.platformToken = await platformLogin();

  const prof = await api("/professionals", { method: "POST", body: { name: "Prof Paginação" } });
  ctx.professionalId = prof.json.id;

  // Massa previsível: nomes com prefixo fixo para conferir a ordenação.
  for (let i = 0; i < TOTAL_CLIENTES; i += 1) {
    const ordem = String(i).padStart(2, "0");
    await api("/clients", {
      method: "POST",
      body: { full_name: `Cliente Pag ${ordem}`, whatsapp: `1198888${ordem}00` }
    });
  }
});

after(async () => {
  if (ctx.platformToken && ctx.tenant?.id) {
    await deleteTenant(ctx.platformToken, ctx.tenant.id, ctx.slug);
  }
});

// ---------- Retrocompatibilidade ----------

test("sem limit/offset a listagem continua devolvendo array puro", async () => {
  const res = await api("/clients");
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.ok(Array.isArray(res.json), "resposta sem paginação deve ser array");
  assert.equal(res.json.length, TOTAL_CLIENTES);
});

test("outras listagens também seguem retrocompatíveis sem paginação", async () => {
  for (const path of ["/jewelry", "/appointments", "/sales-orders"]) {
    const res = await api(path);
    assert.equal(res.status, 200, `${path}: ${JSON.stringify(res.json)}`);
    assert.ok(Array.isArray(res.json), `${path} deve devolver array puro`);
  }
});

// ---------- Envelope ----------

test("com limit vem o envelope { items, total, limit, offset }", async () => {
  const res = await api("/clients?limit=5");
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.ok(!Array.isArray(res.json), "resposta paginada deve ser envelope");
  assert.equal(res.json.items.length, 5);
  assert.equal(res.json.total, TOTAL_CLIENTES, "total deve ser o total real, não o da página");
  assert.equal(res.json.limit, 5);
  assert.equal(res.json.offset, 0);
});

test("só offset já envelopa (limit assume o padrão)", async () => {
  const res = await api("/clients?offset=0");
  assert.equal(res.status, 200);
  assert.ok(!Array.isArray(res.json), "offset sozinho deve envelopar");
  assert.equal(res.json.limit, 50, "limit padrão");
  assert.equal(res.json.total, TOTAL_CLIENTES);
});

test("offset traz página diferente, sem sobreposição com a primeira", async () => {
  const p1 = await api("/clients?limit=5&offset=0");
  const p2 = await api("/clients?limit=5&offset=5");
  const ids1 = p1.json.items.map((item) => item.id);
  const ids2 = p2.json.items.map((item) => item.id);
  assert.equal(ids2.length, 5);
  assert.equal(ids1.filter((id) => ids2.includes(id)).length, 0, "páginas não podem se sobrepor");
  assert.equal(p2.json.total, TOTAL_CLIENTES, "total não muda entre páginas");
});

test("offset além do fim devolve página vazia mantendo o total", async () => {
  const res = await api(`/clients?limit=5&offset=${TOTAL_CLIENTES + 50}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.items.length, 0);
  assert.equal(res.json.total, TOTAL_CLIENTES);
});

// ---------- Clamp de limit/offset ----------

test("limit e offset são saneados (clamp 1..200 e >= 0)", async () => {
  const alto = await api("/clients?limit=9999");
  assert.equal(alto.json.limit, 200, "limit deve ser limitado a 200");

  const zero = await api("/clients?limit=0");
  assert.equal(zero.json.limit, 1, "limit deve ter piso 1");

  const texto = await api("/clients?limit=abc");
  assert.equal(texto.json.limit, 50, "limit inválido cai no padrão");

  const negativo = await api("/clients?limit=5&offset=-30");
  assert.equal(negativo.json.offset, 0, "offset negativo vira 0");
  assert.equal(negativo.json.items.length, 5);
});

// ---------- total respeita os filtros ----------

test("total reflete o filtro de busca, não a tabela inteira", async () => {
  // A busca de clientes passou a extrair os dígitos do termo e casar também
  // com telefone, CPF e CEP. Por isso "Cliente Pag 0" não é mais um filtro só
  // de texto: o "0" alcança todos os WhatsApp da massa. O termo puramente
  // textual continua sendo o caso que prova o contrato do `total`.
  const texto = await api("/clients?search=Cliente Pag&limit=3");
  assert.equal(texto.status, 200, JSON.stringify(texto.json));
  assert.equal(texto.json.total, TOTAL_CLIENTES, "total deve considerar o filtro");
  assert.equal(texto.json.items.length, 3);
  for (const item of texto.json.items) {
    assert.match(item.full_name, /^Cliente Pag /);
  }

  // Filtro seletivo pelo caminho dos dígitos: o WhatsApp de um único cliente.
  const porTelefone = await api("/clients?search=11988880500&limit=3");
  assert.equal(porTelefone.status, 200, JSON.stringify(porTelefone.json));
  assert.equal(porTelefone.json.total, 1, "total deve considerar o filtro");
  assert.equal(porTelefone.json.items[0].full_name, "Cliente Pag 05");
});

test("total de agendamentos respeita o filtro de status", async () => {
  const cliente = await api("/clients?limit=1");
  const clientId = cliente.json.items[0].id;
  for (const hora of ["09:00", "10:00", "11:00"]) {
    const criado = await api("/appointments", {
      method: "POST",
      body: {
        client_id: clientId,
        full_name: "Cliente Pag 00",
        whatsapp: "119888880000",
        professional_id: ctx.professionalId,
        appointment_date: AMANHA,
        appointment_time: hora,
        procedure: "Piercing",
        piercing_region: "Orelha"
      }
    });
    assert.equal(criado.status, 201, JSON.stringify(criado.json));
  }
  const confirmado = await api("/appointments?limit=2");
  assert.equal(confirmado.json.total, 3, "total sem filtro = todos os agendamentos");

  const cancelados = await api("/appointments?status=cancelado&limit=2");
  assert.equal(cancelados.json.total, 0, "total com filtro deve zerar");
  assert.equal(cancelados.json.items.length, 0);
});

// ---------- sort (whitelist) ----------

test("sort válido ordena nos dois sentidos", async () => {
  const asc = await api("/clients?limit=3&sort=name:asc");
  const desc = await api("/clients?limit=3&sort=name:desc");
  assert.equal(asc.json.items[0].full_name, "Cliente Pag 00");
  assert.equal(desc.json.items[0].full_name, `Cliente Pag ${String(TOTAL_CLIENTES - 1).padStart(2, "0")}`);
});

test("sort inválido ou malicioso é ignorado, sem erro 500", async () => {
  const maliciosos = [
    "id;DROP TABLE clients",
    "name:asc;DELETE FROM clients",
    "full_name--",
    "campo_inexistente:desc",
    "1) OR (1=1"
  ];
  const padrao = await api("/clients?limit=3");
  for (const sort of maliciosos) {
    const res = await api(`/clients?limit=3&sort=${encodeURIComponent(sort)}`);
    assert.equal(res.status, 200, `sort="${sort}" não pode dar erro: ${JSON.stringify(res.json)}`);
    assert.deepEqual(
      res.json.items.map((item) => item.id),
      padrao.json.items.map((item) => item.id),
      `sort="${sort}" deve cair na ordenação padrão`
    );
  }
  // A tabela precisa continuar de pé depois das tentativas de injeção.
  const depois = await api("/clients?limit=1");
  assert.equal(depois.json.total, TOTAL_CLIENTES);
});

// ---------- lista enxuta x detalhe ----------

test("listagem de clientes é enxuta e o detalhe traz o enriquecimento", async () => {
  const lista = await api("/clients?limit=1");
  const item = lista.json.items[0];
  for (const campo of ["history", "payments", "medicalRecords", "loyalty", "timeline", "terms", "followups"]) {
    assert.equal(item[campo], undefined, `listagem não deve trazer "${campo}"`);
  }
  assert.ok(item.full_name && item.whatsapp, "listagem mantém as colunas da tabela");

  const detalhe = await api(`/clients/${item.id}`);
  assert.equal(detalhe.status, 200, JSON.stringify(detalhe.json));
  for (const campo of ["history", "payments", "medicalRecords", "timeline", "terms", "followups"]) {
    assert.ok(Array.isArray(detalhe.json[campo]), `detalhe deve trazer "${campo}" como array`);
  }
  assert.ok(detalhe.json.loyalty, "detalhe deve trazer loyalty");
  assert.equal(detalhe.json.id, item.id);
});

test("detalhe de cliente inexistente devolve 404", async () => {
  const res = await api("/clients/99999999");
  assert.equal(res.status, 404, JSON.stringify(res.json));
});

// ---------- registro recém-criado não some (armadilha do .find) ----------

test("registro criado é devolvido mesmo fora da primeira página", async () => {
  // O padrão antigo era "listar tudo e procurar": com paginação isso devolveria
  // undefined em silêncio para o registro novo que cai fora da página 1.
  const criado = await api("/clients", {
    method: "POST",
    body: { full_name: "Zzz Ultimo Da Lista", whatsapp: "11977770000" }
  });
  assert.equal(criado.status, 201, JSON.stringify(criado.json));
  assert.ok(criado.json.id, "cliente criado deve voltar com id");
  assert.equal(criado.json.full_name, "Zzz Ultimo Da Lista");

  const servico = await api("/services", {
    method: "POST",
    body: { name: "Serviço Pag", price: 100, duration_minutes: 30 }
  });
  assert.equal(servico.status, 201, JSON.stringify(servico.json));
  assert.ok(servico.json?.id, "serviço criado deve voltar com id");

  const profissional = await api("/professionals", { method: "POST", body: { name: "Zzz Prof Novo" } });
  assert.equal(profissional.status, 201, JSON.stringify(profissional.json));
  assert.ok(profissional.json?.id, "profissional criado deve voltar com id");
  assert.ok(Array.isArray(profissional.json.service_ids), "profissional deve vir com service_ids");
});
