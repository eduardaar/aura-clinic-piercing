// Testes das transações do adaptador `db` (backend/src/db/sqliteCompat.js).
//
// Parte 1: unitários do helper `db.transaction` sobre um client de mentira —
//          conferem os comandos SQL emitidos (BEGIN/COMMIT/ROLLBACK/SAVEPOINT).
// Parte 2: endpoint — provam que um erro NO MEIO de um fluxo multi-escrita não
//          deixa nenhuma escrita para trás (clínica de teste própria).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDbAdapter } from "../src/db/sqliteCompat.js";
import { req, createTenant, loginTenant, platformLogin, deleteTenant } from "./helpers.mjs";

// ---------------------------------------------------------------- parte 1 ---

// Client de mentira: registra o SQL executado e explode quando o comando
// contém "EXPLODE" (para simular falha no meio da transação).
function fakeClient() {
  const executed = [];
  return {
    executed,
    async query(text) {
      const sql = String(text).trim();
      executed.push(sql);
      if (sql.includes("EXPLODE")) throw new Error("falha simulada no banco");
      return { rows: [{ id: 7 }], rowCount: 1 };
    },
  };
}

test("transação de sucesso emite BEGIN ... COMMIT e devolve o valor do callback", async () => {
  const client = fakeClient();
  const db = createDbAdapter(client);
  const retorno = await db.transaction(async (tx) => {
    await tx.run("INSERT INTO clients (full_name) VALUES (?)", ["Ana"]);
    await tx.run("UPDATE clients SET full_name = ? WHERE id = ?", ["Ana", 7]);
    return "pronto";
  });
  assert.equal(retorno, "pronto");
  assert.equal(client.executed[0], "BEGIN");
  assert.equal(client.executed.at(-1), "COMMIT");
  assert.equal(client.executed.filter((sql) => sql.startsWith("SAVEPOINT")).length, 0);
  assert.equal(db.inTransaction(), false);
});

test("erro no meio da transação faz ROLLBACK e repropaga o erro original", async () => {
  const client = fakeClient();
  const db = createDbAdapter(client);
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.run("INSERT INTO sales_orders (total_value) VALUES (?)", [10]);
      await tx.run("INSERT INTO EXPLODE (x) VALUES (?)", [1]);
      await tx.run("INSERT INTO payments (amount) VALUES (?)", [10]);
    }),
    /falha simulada no banco/
  );
  assert.equal(client.executed[0], "BEGIN");
  assert.equal(client.executed.at(-1), "ROLLBACK");
  assert.ok(!client.executed.includes("COMMIT"), "não pode confirmar nada");
  assert.ok(!client.executed.some((sql) => sql.includes("INSERT INTO payments")), "não deve seguir após o erro");
  assert.equal(db.inTransaction(), false);
});

test("transação aninhada vira SAVEPOINT: o COMMIT interno não encerra a externa", async () => {
  const client = fakeClient();
  const db = createDbAdapter(client);
  await db.transaction(async (tx) => {
    await tx.run("INSERT INTO appointments (procedure) VALUES (?)", ["A"]);
    await tx.transaction(async (inner) => {
      await inner.run("INSERT INTO appointment_items (quantity) VALUES (?)", [1]);
    });
    await tx.run("INSERT INTO payments (amount) VALUES (?)", [10]);
  });
  assert.equal(client.executed.filter((sql) => sql === "BEGIN").length, 1, "só uma transação real");
  assert.ok(client.executed.some((sql) => sql.startsWith("SAVEPOINT aura_sp_")), "nível interno usa savepoint");
  assert.ok(client.executed.some((sql) => sql.startsWith("RELEASE SAVEPOINT")), "commit interno vira release");
  assert.equal(client.executed.at(-1), "COMMIT");
  // A escrita posterior ao bloco interno tem de acontecer ANTES do commit final.
  const posInsertFinal = client.executed.findIndex((sql) => sql.includes("INSERT INTO payments"));
  assert.ok(posInsertFinal > 0 && posInsertFinal < client.executed.length - 1, "transação externa seguia aberta");
});

test("falha do nível aninhado desfaz a transação inteira quando o erro sobe", async () => {
  const client = fakeClient();
  const db = createDbAdapter(client);
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.run("INSERT INTO appointments (procedure) VALUES (?)", ["A"]);
      await tx.transaction(async (inner) => {
        await inner.run("INSERT INTO EXPLODE (x) VALUES (?)", [1]);
      });
    }),
    /falha simulada/
  );
  assert.ok(client.executed.some((sql) => sql.startsWith("ROLLBACK TO SAVEPOINT")), "desfaz o nível interno");
  assert.equal(client.executed.at(-1), "ROLLBACK", "e também a transação externa");
  assert.equal(db.inTransaction(), false);
});

test("nível aninhado pode falhar sem derrubar a externa (erro tratado pelo chamador)", async () => {
  const client = fakeClient();
  const db = createDbAdapter(client);
  await db.transaction(async (tx) => {
    await tx.run("INSERT INTO appointments (procedure) VALUES (?)", ["A"]);
    await assert.rejects(tx.transaction(async (inner) => {
      await inner.run("INSERT INTO EXPLODE (x) VALUES (?)", [1]);
    }), /falha simulada/);
    await tx.run("INSERT INTO payments (amount) VALUES (?)", [10]);
  });
  assert.ok(client.executed.some((sql) => sql.startsWith("ROLLBACK TO SAVEPOINT")));
  assert.equal(client.executed.at(-1), "COMMIT", "a transação externa segue válida e confirma");
});

test("BEGIN/COMMIT escritos na mão viram SAVEPOINT quando já há transação aberta", async () => {
  const client = fakeClient();
  const db = createDbAdapter(client);
  await db.transaction(async (tx) => {
    // Padrão legado que ainda existe em várias rotas (routes/jewelry.js etc.).
    await tx.run("BEGIN");
    await tx.run("INSERT INTO inventory_reservations (quantity) VALUES (?)", [1]);
    await tx.run("COMMIT");
    await tx.run("INSERT INTO payments (amount) VALUES (?)", [10]);
  });
  assert.equal(client.executed.filter((sql) => sql === "BEGIN").length, 1, "o BEGIN legado não abre 2a transação");
  assert.equal(client.executed.filter((sql) => sql === "COMMIT").length, 1, "o COMMIT legado não encerra a externa");
  assert.ok(client.executed.some((sql) => sql.startsWith("SAVEPOINT")));
  assert.ok(client.executed.some((sql) => sql.startsWith("RELEASE SAVEPOINT")));
  assert.equal(client.executed.at(-1), "COMMIT");
});

test("BEGIN/COMMIT na mão fora de transação continuam sendo transação real", async () => {
  const client = fakeClient();
  const db = createDbAdapter(client);
  await db.run("BEGIN");
  assert.equal(db.inTransaction(), true);
  await db.run("INSERT INTO clients (full_name) VALUES (?)", ["Ana"]);
  await db.run("COMMIT");
  assert.equal(db.inTransaction(), false);
  assert.deepEqual(client.executed.filter((sql) => ["BEGIN", "COMMIT"].includes(sql)), ["BEGIN", "COMMIT"]);
});

test("abortOpenTransaction desfaz transação deixada aberta (rede de segurança do withDb)", async () => {
  const client = fakeClient();
  const db = createDbAdapter(client);
  await db.run("BEGIN");
  await db.run("INSERT INTO clients (full_name) VALUES (?)", ["Ana"]);
  assert.equal(await db.abortOpenTransaction(), true);
  assert.equal(db.inTransaction(), false);
  assert.equal(client.executed.at(-1), "ROLLBACK");
  assert.equal(await db.abortOpenTransaction(), false, "sem transação aberta, não faz nada");
});

// ---------------------------------------------------------------- parte 2 ---

const ctx = { slug: null, token: null, tenant: null, platformToken: null, serviceId: null, professionalId: null, jewelryId: null, variantId: null };
const HOJE = new Date().toISOString().slice(0, 10);
const api = (path, opts = {}) => req(path, { token: ctx.token, tenant: ctx.slug, ...opts });

// Próxima data que cai no dia da semana pedido (agenda semanal do teste).
function nextDateForWeekday(weekday, offsetDays = 1) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  while (date.getDay() !== weekday) date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

before(async () => {
  const created = await createTenant("qatx");
  ctx.slug = created.slug;
  ctx.tenant = created.tenant;
  ctx.token = (await loginTenant(created.slug, created.adminEmail, created.adminPassword)).token;
  ctx.platformToken = await platformLogin();

  const service = await api("/services", { method: "POST", body: { name: "Servico TX", duration_minutes: 30, price: 120, deposit_value: 40 } });
  ctx.serviceId = service.json.id;
  const professional = await api("/professionals", { method: "POST", body: { name: "Prof TX", specialty: "Piercing", phone: "11977776666" } });
  ctx.professionalId = professional.json.id;
  const jewelry = await api("/jewelry", {
    method: "POST",
    body: { name: "Joia TX", category: "Labret", material: "Titanio", color: "Prata", quantity: 10, cost_value: 15, sale_value: 60 },
  });
  ctx.jewelryId = jewelry.json.id;
  ctx.variantId = jewelry.json.variants[0].id;

  // Agenda pública mínima, para o teste de webhook concorrente ter uma
  // solicitação real (é ela que cria a intenção de pagamento do sinal).
  await api(`/professionals/${ctx.professionalId}`, { method: "PATCH", body: { service_ids: [ctx.serviceId], active: true } });
  await api("/availability/generate-weekly", {
    method: "POST",
    body: {
      professional_id: ctx.professionalId, weekdays: [1, 2, 3, 4, 5, 6],
      start_time: "09:00", end_time: "18:00", lunch_start: "12:00", lunch_end: "13:00",
      duration_minutes: 40, buffer_minutes: 10,
    },
  });
});

after(async () => {
  if (ctx.platformToken && ctx.tenant?.id) await deleteTenant(ctx.platformToken, ctx.tenant.id, ctx.slug);
});

async function estoqueDaJoia() {
  const list = await api("/jewelry");
  return Number(list.json.find((item) => Number(item.id) === Number(ctx.jewelryId))?.quantity ?? -1);
}

test("venda que falha no meio não deixa cliente, pedido, item, pagamento nem baixa de estoque", async () => {
  const pedidosAntes = (await api("/sales-orders")).json.length;
  const clientesAntes = (await api("/clients")).json.length;
  const estoqueAntes = await estoqueDaJoia();

  // O 2o item referencia um serviço inexistente: a violação de chave estrangeira
  // acontece DEPOIS do cliente, do pedido, do 1o item e da baixa de estoque.
  const falha = await api("/sales-orders", {
    method: "POST",
    body: {
      full_name: "Cliente Fantasma TX", whatsapp: "11900009999", payment_method: "Pix",
      items: [
        { item_name: "Joia TX", product_id: ctx.jewelryId, product_variant_id: ctx.variantId, quantity: 1, unit_price: 60 },
        { item_name: "Servico inexistente", service_id: 999999, quantity: 1, unit_price: 10 },
      ],
    },
  });
  assert.equal(falha.status, 500, JSON.stringify(falha.json));

  assert.equal((await api("/sales-orders")).json.length, pedidosAntes, "nenhum pedido pode ter sobrado");
  assert.equal((await api("/clients")).json.length, clientesAntes, "nenhum cliente pode ter sobrado");
  assert.equal(await estoqueDaJoia(), estoqueAntes, "o estoque não pode ter sido baixado");
  const busca = await api("/clients?search=11900009999");
  assert.equal(busca.json.length, 0, "o cliente da venda desfeita não pode existir");
});

test("venda válida continua gravando pedido, item, pagamento e baixa de estoque", async () => {
  const pedidosAntes = (await api("/sales-orders")).json.length;
  const estoqueAntes = await estoqueDaJoia();
  const venda = await api("/sales-orders", {
    method: "POST",
    body: {
      full_name: "Cliente TX", whatsapp: "11900008888", payment_method: "Pix",
      items: [{ item_name: "Joia TX", product_id: ctx.jewelryId, product_variant_id: ctx.variantId, quantity: 2, unit_price: 60 }],
    },
  });
  assert.equal(venda.status, 201, JSON.stringify(venda.json));
  assert.equal(venda.json.items.length, 1, "o pedido criado devolve seus itens");
  assert.equal((await api("/sales-orders")).json.length, pedidosAntes + 1);
  assert.equal(await estoqueDaJoia(), estoqueAntes - 2, "estoque deve cair 2 unidades");
});

test("atendimento marcado 'atendido' que falha no meio não deixa nenhuma das 5 escritas", async () => {
  const criado = await api("/appointments", {
    method: "POST",
    body: {
      full_name: "Cliente Atendido TX", whatsapp: "11900007777", professional_id: ctx.professionalId, service_id: ctx.serviceId,
      procedure: "Servico TX", piercing_region: "Orelha", appointment_date: HOJE, appointment_time: "15:00",
      jewelry_id: ctx.jewelryId, jewelry_variant_id: ctx.variantId, total_value: 180, deposit_value: 40,
      deposit_payment_method: "Pix", remaining_payment_method: "Pix", status: "confirmado",
    },
  });
  assert.equal(criado.status, 201, JSON.stringify(criado.json));
  const appointmentId = criado.json.id;
  const estoqueAntes = await estoqueDaJoia();
  const pedidosAntes = (await api("/sales-orders")).json.length;

  // appointment_date inválida quebra a geração do pós-atendimento (4a escrita),
  // depois da baixa de estoque, do pagamento do restante e da ordem de serviço.
  const falha = await api(`/appointments/${appointmentId}`, { method: "PATCH", body: { status: "atendido", appointment_date: "data-invalida" } });
  assert.equal(falha.status, 500, JSON.stringify(falha.json));

  const depois = await api(`/appointments?client_id=${criado.json.client_id}`);
  const agendamento = depois.json.find((item) => Number(item.id) === Number(appointmentId));
  assert.equal(agendamento.status, "confirmado", "o status não pode ter mudado");
  assert.equal(agendamento.appointment_date, HOJE, "a data inválida não pode ter sido gravada");
  assert.equal(Number(agendamento.stock_deducted || 0), 0, "a baixa de estoque tem de ter sido desfeita");
  assert.equal(await estoqueDaJoia(), estoqueAntes, "o estoque não pode ter caído");
  assert.equal((await api("/sales-orders")).json.length, pedidosAntes, "a ordem de serviço tem de ter sido desfeita");
  const postCare = await api("/post-care");
  assert.equal(postCare.json.filter((item) => Number(item.appointment_id) === Number(appointmentId)).length, 0);

  // Mesma chamada sem o erro: agora as cinco escritas acontecem.
  const sucesso = await api(`/appointments/${appointmentId}`, { method: "PATCH", body: { status: "atendido" } });
  assert.equal(sucesso.status, 200, JSON.stringify(sucesso.json));
  assert.equal(sucesso.json.status, "atendido");
  assert.equal(await estoqueDaJoia(), estoqueAntes - 1, "agora sim o estoque cai");
  assert.equal((await api("/sales-orders")).json.length, pedidosAntes + 1, "ordem de serviço gerada");
  const postCareDepois = await api("/post-care");
  assert.equal(postCareDepois.json.filter((item) => Number(item.appointment_id) === Number(appointmentId)).length, 3);
});

test("erro dentro da transação não devolve o client ao pool com transação aberta", async () => {
  // Intenção inexistente: o throw acontece com a transação já aberta.
  const inexistente = await api("/payment-intents/999999/status", { method: "PATCH", body: { status: "confirmed" } });
  assert.equal(inexistente.status, 400, JSON.stringify(inexistente.json));
  // Se o ROLLBACK não tivesse acontecido, o client voltaria "sujo" e as próximas
  // requisições (que podem reusar essa conexão) travariam ou veriam lixo.
  for (let i = 0; i < 6; i++) {
    const seguinte = await api("/sales-orders");
    assert.equal(seguinte.status, 200, "o pool não pode ficar preso após o erro dentro da transação");
  }
});

test("duas confirmações simultâneas do mesmo sinal não duplicam o pagamento (FOR UPDATE)", async () => {
  // Solicitação pública gera a intenção de pagamento do sinal.
  const dia = nextDateForWeekday(1, 8);
  const slots = await api(`/booking/slots?service_id=${ctx.serviceId}&professional_id=${ctx.professionalId}&date=${dia}`);
  assert.equal(slots.status, 200, JSON.stringify(slots.json));
  assert.ok(slots.json.slots.length, "a clínica de teste precisa ter horários livres");

  const solicitacao = await req(`/booking/requests?t=${ctx.slug}`, {
    method: "POST",
    body: {
      service_id: ctx.serviceId, professional_id: ctx.professionalId, appointment_date: dia,
      appointment_time: slots.json.slots[0].time, full_name: "Cliente Webhook TX", whatsapp: "11900005555",
      idempotency_key: `tx-webhook-${ctx.slug}`,
    },
  });
  assert.equal(solicitacao.status, 201, JSON.stringify(solicitacao.json));
  const intentId = solicitacao.json.payment_intent?.id;
  assert.ok(intentId, "a solicitação deve criar a intenção de pagamento do sinal");

  // Mesma entrega de webhook chegando duas vezes ao mesmo tempo: o FOR UPDATE
  // dentro da transação serializa as duas e a segunda cai na idempotência.
  const corpo = { status: "confirmed", event_id: `evt-duplicado-${intentId}` };
  const [a, b] = await Promise.all([
    api(`/payment-intents/${intentId}/status`, { method: "PATCH", body: corpo }),
    api(`/payment-intents/${intentId}/status`, { method: "PATCH", body: corpo }),
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(b.status, 200, JSON.stringify(b.json));
  assert.equal([a, b].filter((resposta) => resposta.json.idempotent === true).length, 1, "exatamente uma deve ser idempotente");
  assert.equal([a, b].filter((resposta) => resposta.json.status === "confirmed").length, 2);

  // Estado final coerente: agendamento confirmado e sinal pago uma única vez.
  const agenda = await api(`/appointments?client_id=${solicitacao.json.client_id}`);
  const agendamento = agenda.json.find((item) => Number(item.id) === Number(solicitacao.json.id));
  assert.equal(agendamento.status, "confirmado");
});
