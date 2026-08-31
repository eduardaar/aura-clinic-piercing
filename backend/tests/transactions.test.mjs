// Testes das transações do `db` (backend/src/db/postgres.js).
//
// Parte 1: unitários do helper `db.transaction` sobre um client de mentira —
//          conferem os comandos SQL emitidos (BEGIN/COMMIT/ROLLBACK/SAVEPOINT).
// Parte 2: endpoint — provam que um erro NO MEIO de um fluxo multi-escrita não
//          deixa nenhuma escrita para trás (clínica de teste própria).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/db/postgres.js";
import { req, createTenant, loginTenant } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { deprovisionTenant } from "../src/services/tenants.js";

// ---------------------------------------------------------------- parte 1 ---

// Client de mentira: registra o SQL executado e explode quando o comando
// contém "EXPLODE" (para simular falha no meio da transação).
function fakeClient() {
  const executed = [];
  return {
    executed,
    async query(text) {
      // Queries com parâmetro chegam como { text, values, types } (é o formato
      // que carrega o conversor de NUMERIC); BEGIN/COMMIT/SAVEPOINT vêm crus.
      const sql = String(typeof text === "string" ? text : text.text).trim();
      executed.push(sql);
      if (sql.includes("EXPLODE")) throw new Error("falha simulada no banco");
      return { rows: [{ id: 7 }], rowCount: 1 };
    },
  };
}

test("transação de sucesso emite BEGIN ... COMMIT e devolve o valor do callback", async () => {
  const client = fakeClient();
  const db = createDb(client);
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
  const db = createDb(client);
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
  const db = createDb(client);
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
  const db = createDb(client);
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
  const db = createDb(client);
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
  const db = createDb(client);
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
  const db = createDb(client);
  await db.run("BEGIN");
  assert.equal(db.inTransaction(), true);
  await db.run("INSERT INTO clients (full_name) VALUES (?)", ["Ana"]);
  await db.run("COMMIT");
  assert.equal(db.inTransaction(), false);
  assert.deepEqual(client.executed.filter((sql) => ["BEGIN", "COMMIT"].includes(sql)), ["BEGIN", "COMMIT"]);
});

test("abortOpenTransaction desfaz transação deixada aberta (rede de segurança do withDb)", async () => {
  const client = fakeClient();
  const db = createDb(client);
  await db.run("BEGIN");
  await db.run("INSERT INTO clients (full_name) VALUES (?)", ["Ana"]);
  assert.equal(await db.abortOpenTransaction(), true);
  assert.equal(db.inTransaction(), false);
  assert.equal(client.executed.at(-1), "ROLLBACK");
  assert.equal(await db.abortOpenTransaction(), false, "sem transação aberta, não faz nada");
});

// ---------------------------------------------------------------- parte 2 ---

const ctx = { slug: null, token: null, tenant: null, serviceId: null, professionalId: null, jewelryId: null, variantId: null };
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

  // `postcare_enabled` nasce false (migration 0032): as cinco escritas do
  // atendimento concluído incluem os lembretes de pós-atendimento, então o
  // serviço precisa declarar que os gera.
  const service = await api("/services", { method: "POST", body: { name: "Servico TX", duration_minutes: 30, price: 120, deposit_value: 40, postcare_enabled: true, postcare_days: [7, 15, 30] } });
  ctx.serviceId = service.json.id;
  const professional = await api("/professionals", { method: "POST", body: { name: "Prof TX", specialty: "Piercing", phone: "11977776666" } });
  ctx.professionalId = professional.json.id;
  const jewelry = await api("/jewelry", {
    method: "POST",
    body: { name: "Joia TX", category: "Labret", material: "Titânio", color: "Prata", quantity: 10, cost_value: 15, sale_value: 60, virtual_store_active: true, is_catalog_active: true, is_published: true },
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
  if (ctx.tenant?.id) await deprovisionTenant(ctx.tenant.id);
});

async function estoqueDaJoia() {
  const list = await api("/jewelry");
  return Number(list.json.find((item) => Number(item.id) === Number(ctx.jewelryId))?.quantity ?? -1);
}

test("venda que falha no meio não deixa cliente, pedido, item, pagamento nem baixa de estoque", async () => {
  const pedidosAntes = (await api("/sales-orders")).json.length;
  const clientesAntes = (await api("/clients")).json.length;
  const estoqueAntes = await estoqueDaJoia();

  // Serviço em venda avulsa é recusado antes de criar cliente, pedido ou baixa.
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
  assert.equal(falha.status, 400, JSON.stringify(falha.json));

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

test("venda pending concluída baixa estoque e cria parcelas exatas uma única vez", async () => {
  const estoqueAntes = await estoqueDaJoia();
  const venda = await api("/sales-orders", {
    method: "POST",
    body: {
      full_name: "Cliente Parcelado TX", whatsapp: "11900008887", status: "aberta",
      receivable_mode: "pending", installment_count: 3, first_due_date: "2026-01-31",
      payment_method: "Cartão de crédito",
      items: [{ item_name: "Joia TX", product_id: ctx.jewelryId, product_variant_id: ctx.variantId, quantity: 1, unit_price: 100 }]
    }
  });
  assert.equal(venda.status, 201, JSON.stringify(venda.json));
  assert.equal(await estoqueDaJoia(), estoqueAntes, "venda explicitamente aberta ainda não baixa estoque");
  const titlesBeforeClose = await withTenantSchema(ctx.tenant.id, (db) => db.all(
    "SELECT id FROM financial_entries WHERE source_type='sales_order' AND source_id=? AND entry_type='receivable' AND status!='canceled'",
    [venda.json.id]
  ));
  assert.equal(titlesBeforeClose.length, 0, "venda aberta ainda não constitui conta a receber");

  const [first, repeated] = await Promise.all([
    api(`/sales-orders/${venda.json.id}`, { method: "PATCH", body: { status: "concluida" } }),
    api(`/sales-orders/${venda.json.id}`, { method: "PATCH", body: { status: "concluida" } })
  ]);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(repeated.status, 200, JSON.stringify(repeated.json));
  assert.equal(await estoqueDaJoia(), estoqueAntes - 1, "confirmações concorrentes baixam uma unidade");

  const state = await withTenantSchema(ctx.tenant.id, async (db) => ({
    payments: await db.all("SELECT id FROM payments WHERE sales_order_id=?", [venda.json.id]),
    movements: await db.all("SELECT id FROM stock_movements WHERE sales_order_id=?", [venda.json.id]),
    receivables: await db.all(
      "SELECT amount,due_date,source_key FROM financial_entries WHERE source_type='sales_order' AND source_id=? AND entry_type='receivable' AND status!='canceled' ORDER BY installment_number",
      [venda.json.id]
    )
  }));
  assert.equal(state.payments.length, 0, "pending não é dinheiro recebido");
  assert.equal(state.movements.length, 1, "movimento de saída é estruturalmente idempotente");
  assert.deepEqual(state.receivables.map((item) => Number(item.amount)), [33.34, 33.33, 33.33]);
  assert.deepEqual(state.receivables.map((item) => item.due_date), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.equal(new Set(state.receivables.map((item) => item.source_key)).size, 3);

  const cancel = await api(`/sales-orders/${venda.json.id}`, { method: "PATCH", body: { status: "cancelado" } });
  assert.equal(cancel.status, 409, "venda com estoque baixado exige fluxo explícito de devolução/estorno");
});

test("checkout público não pode se autodeclarar pago nem baixar estoque", async () => {
  const estoqueAntes = await estoqueDaJoia();
  const pedido = await req("/sales-orders/public", {
    method: "POST",
    tenant: ctx.slug,
    body: {
      full_name: "Cliente Checkout TX",
      whatsapp: "11900006666",
      status: "concluida",
      accepted_policies: true,
      idempotency_key: `checkout-test-${ctx.slug}`,
      payment_method: "Pix",
      items: [{ item_name: "Joia TX", product_id: ctx.jewelryId, product_variant_id: ctx.variantId, quantity: 1, unit_price: 0.01 }],
    },
  });
  assert.equal(pedido.status, 201, JSON.stringify(pedido.json));
  assert.equal(pedido.json.status, "pendente");
  assert.equal(await estoqueDaJoia(), estoqueAntes, "pedido pendente não faz baixa definitiva");
  const repeated = await req("/sales-orders/public", {
    method: "POST", tenant: ctx.slug,
    body: { full_name: "Cliente Checkout TX", whatsapp: "11900006666", accepted_policies: true, idempotency_key: `checkout-test-${ctx.slug}`, items: [{ item_name: "ignorado", product_id: ctx.jewelryId, product_variant_id: ctx.variantId, quantity: 1, unit_price: 0.01 }] }
  });
  assert.equal(repeated.status, 201);
  assert.equal(repeated.json.id, pedido.json.id, "repetição idempotente devolve o mesmo pedido");
  assert.equal(Number(pedido.json.items[0].unit_price), 60, "backend ignora preço manipulado pelo navegador");
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
  const execucoesAntes = (await api("/service-executions")).json.length;

  // A data inválida é recusada antes de qualquer escrita operacional.
  const falha = await api(`/appointments/${appointmentId}`, { method: "PATCH", body: { status: "atendido", appointment_date: "data-invalida" } });
  assert.equal(falha.status, 400, JSON.stringify(falha.json));

  const depois = await api(`/appointments?client_id=${criado.json.client_id}`);
  const agendamento = depois.json.find((item) => Number(item.id) === Number(appointmentId));
  assert.equal(agendamento.status, "confirmado", "o status não pode ter mudado");
  assert.equal(agendamento.appointment_date, HOJE, "a data inválida não pode ter sido gravada");
  assert.equal(Number(agendamento.stock_deducted || 0), 0, "a baixa de estoque tem de ter sido desfeita");
  assert.equal(await estoqueDaJoia(), estoqueAntes, "o estoque não pode ter caído");
  assert.equal((await api("/service-executions")).json.length, execucoesAntes, "nenhuma execução pode ser criada");
  const postCare = await api("/post-care");
  assert.equal(postCare.json.filter((item) => Number(item.appointment_id) === Number(appointmentId)).length, 0);

  // Mesma chamada sem o erro: agora as cinco escritas acontecem.
  const sucesso = await api(`/appointments/${appointmentId}`, { method: "PATCH", body: { status: "atendido" } });
  assert.equal(sucesso.status, 200, JSON.stringify(sucesso.json));
  assert.equal(sucesso.json.status, "atendido");
  assert.equal(await estoqueDaJoia(), estoqueAntes - 1, "agora sim o estoque cai");
  assert.equal((await api("/service-executions")).json.length, execucoesAntes + 1, "execução de serviço gerada");
  const postCareDepois = await api("/post-care");
  assert.equal(postCareDepois.json.filter((item) => Number(item.appointment_id) === Number(appointmentId)).length, 3);
});

test("refechamento da agenda preserva execução/pagamento e recalcula apenas o saldo a receber", async () => {
  const criado = await api("/appointments", {
    method: "POST",
    body: {
      full_name: "Cliente Refechamento TX", whatsapp: "11900007776", professional_id: ctx.professionalId,
      service_id: ctx.serviceId, procedure: "Servico TX", piercing_region: "Orelha",
      appointment_date: HOJE, appointment_time: "16:00", total_value: 120, deposit_value: 0,
      remaining_payment_method: "Cartão de crédito", status: "confirmado"
    }
  });
  assert.equal(criado.status, 201, JSON.stringify(criado.json));

  const first = await api(`/appointments/${criado.json.id}/complete`, {
    method: "POST",
    body: {
      payments: [{ amount: 40, method: "Pix", status: "pago" }],
      clinical_notes: "Cicatrização adequada",
      occurrences: "",
      aftercare_notes: "Higienizar conforme orientação",
      installment_count: 3, first_due_date: "2026-01-31", payment_method: "Cartão de crédito"
    }
  });
  assert.equal(first.status, 200, JSON.stringify(first.json));

  const before = await withTenantSchema(ctx.tenant.id, async (db) => ({
    executions: await db.all("SELECT id,clinical_notes,occurrences,aftercare_notes FROM service_executions WHERE appointment_id=?", [criado.json.id]),
    payments: await db.all("SELECT id,service_execution_id,amount FROM payments WHERE appointment_id=? AND payment_type='restante' ORDER BY id", [criado.json.id]),
    receivables: await db.all("SELECT amount FROM financial_entries WHERE source_type='service_execution' AND entry_type='receivable' AND source_id=(SELECT id FROM service_executions WHERE appointment_id=?) AND status!='canceled' ORDER BY installment_number", [criado.json.id])
  }));
  assert.equal(before.executions.length, 1);
  assert.equal(before.executions[0].clinical_notes, "Cicatrização adequada");
  assert.equal(before.executions[0].occurrences, null, "campo clínico opcional vazio vira NULL");
  assert.equal(before.executions[0].aftercare_notes, "Higienizar conforme orientação");
  assert.equal(before.payments.length, 1);
  assert.equal(Number(before.payments[0].service_execution_id), Number(before.executions[0].id));
  assert.equal(before.receivables.reduce((sum, item) => sum + Number(item.amount), 0), 80);

  const second = await api(`/appointments/${criado.json.id}/complete`, {
    method: "POST",
    body: {
      reason: "Correção do fechamento QA",
      payments: [{ amount: 60, method: "Pix", status: "pago" }],
      installment_count: 2, first_due_date: "2026-02-01", payment_method: "Cartão de crédito"
    }
  });
  assert.equal(second.status, 200, JSON.stringify(second.json));

  const afterState = await withTenantSchema(ctx.tenant.id, async (db) => ({
    executions: await db.all("SELECT id,clinical_notes FROM service_executions WHERE appointment_id=?", [criado.json.id]),
    payments: await db.all("SELECT id,service_execution_id,amount FROM payments WHERE appointment_id=? AND payment_type='restante' ORDER BY id", [criado.json.id]),
    receivables: await db.all("SELECT amount FROM financial_entries WHERE source_type='service_execution' AND entry_type='receivable' AND source_id=(SELECT id FROM service_executions WHERE appointment_id=?) AND status!='canceled' ORDER BY installment_number", [criado.json.id])
  }));
  assert.equal(afterState.executions.length, 1, "índice e upsert mantêm uma execução de serviço");
  assert.equal(afterState.executions[0].clinical_notes, "Cicatrização adequada", "refechamento sem campo clínico preserva o registro");
  assert.equal(afterState.payments.length, 1, "refechamento atualiza a baixa em vez de recriá-la");
  assert.equal(afterState.payments[0].id, before.payments[0].id);
  assert.equal(Number(afterState.payments[0].service_execution_id), Number(afterState.executions[0].id));
  assert.equal(afterState.receivables.length, 2);
  assert.equal(afterState.receivables.reduce((sum, item) => sum + Number(item.amount), 0), 60);

  const reopened = await api(`/appointments/${criado.json.id}`, {
    method: "PATCH",
    body: { status: "confirmado", reason: "Reabertura QA" }
  });
  assert.equal(reopened.status, 200, JSON.stringify(reopened.json));
  const reopenedState = await withTenantSchema(ctx.tenant.id, async (db) => ({
    execution: await db.get("SELECT status FROM service_executions WHERE appointment_id=?", [criado.json.id]),
    activeReceivables: await db.all("SELECT id FROM financial_entries WHERE source_type='service_execution' AND source_id=? AND entry_type='receivable' AND status NOT IN ('canceled','refunded')", [afterState.executions[0].id])
  }));
  assert.equal(reopenedState.execution.status, "cancelled");
  assert.equal(reopenedState.activeReceivables.length, 0, "reabrir atendimento cancela os títulos da conclusão anterior");
});

test("reabrir atendimento estorna estoque com e sem variação uma única vez", async () => {
  const productOnly = await withTenantSchema(ctx.tenant.id, async (db) => {
    const result = await db.run(
      `INSERT INTO jewelry_inventory
        (name, category, material, color, quantity, cost_value, sale_value, status)
       VALUES (?, 'Labret', 'Titânio', 'Prata', 2, 10, 50, 'disponível') RETURNING id`,
      ["Joia Agenda Sem Variação"]
    );
    return result.returnedId;
  });
  const cases = [
    { label: "com variação", jewelryId: ctx.jewelryId, variantId: ctx.variantId, time: "17:00" },
    { label: "sem variação", jewelryId: productOnly, variantId: null, time: "17:50" }
  ];

  for (const item of cases) {
    const stock = () => withTenantSchema(ctx.tenant.id, async (db) => {
      if (item.variantId) {
        return Number((await db.get("SELECT quantity FROM jewelry_variants WHERE id=?", [item.variantId])).quantity);
      }
      return Number((await db.get("SELECT quantity FROM jewelry_inventory WHERE id=?", [item.jewelryId])).quantity);
    });
    const before = await stock();
    const created = await api("/appointments", {
      method: "POST",
      body: {
        full_name: `Cliente Estorno ${item.label}`, whatsapp: item.variantId ? "11900005551" : "11900005552",
        professional_id: ctx.professionalId, service_id: ctx.serviceId, procedure: "Servico TX",
        piercing_region: "Orelha", appointment_date: HOJE, appointment_time: item.time,
        jewelry_id: item.jewelryId, jewelry_variant_id: item.variantId,
        total_value: 170, deposit_value: 0, status: "confirmado"
      }
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));

    const completed = await api(`/appointments/${created.json.id}/complete`, { method: "POST", body: { payments: [] } });
    assert.equal(completed.status, 200, JSON.stringify(completed.json));
    assert.equal(await stock(), before - 1, `${item.label}: conclusão baixa uma unidade`);

    const reopened = await api(`/appointments/${created.json.id}`, {
      method: "PATCH",
      body: { status: "confirmado", reason: `Reabertura ${item.label}` }
    });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.json));
    assert.equal(await stock(), before, `${item.label}: reabertura devolve a unidade`);

    const reopenedState = await withTenantSchema(ctx.tenant.id, async (db) => ({
      appointment: await db.get("SELECT stock_deducted FROM appointments WHERE id=?", [created.json.id]),
      execution: await db.get("SELECT status FROM service_executions WHERE appointment_id=?", [created.json.id]),
      reversals: await db.all(
        "SELECT id FROM stock_movements WHERE jewelry_id=? AND movement_type='Entrada' AND notes LIKE ?",
        [item.jewelryId, `%#${created.json.id}`]
      )
    }));
    assert.equal(Number(reopenedState.appointment.stock_deducted), 0, `${item.label}: agenda permite nova baixa`);
    assert.equal(reopenedState.execution.status, "cancelled");
    assert.equal(reopenedState.reversals.length, 1, `${item.label}: existe um único movimento de estorno`);

    const repeated = await api(`/appointments/${created.json.id}`, {
      method: "PATCH",
      body: { status: "confirmado" }
    });
    assert.equal(repeated.status, 200, JSON.stringify(repeated.json));
    assert.equal(await stock(), before, `${item.label}: repetir o estado não duplica o estorno`);
  }
});

// --------------------------------------------------- estoque x quantidade ---
//
// Pendência #1: a venda aceitava quantidade que não existe em estoque. A
// checagem antiga só rodava para linha COM variação informada; sem variação não
// havia checagem nenhuma e `Math.max(0, ...)` zerava o saldo em silêncio.

// Joia própria por teste: os casos abaixo mexem no saldo até o limite e não
// podem depender da ordem em que a suíte rodou os outros testes.
async function criaJoia(nome, quantidade) {
  const criada = await api("/jewelry", {
    method: "POST",
    body: { name: nome, category: "Labret", material: "Titânio", color: "Prata", quantity: quantidade, cost_value: 10, sale_value: 50 },
  });
  assert.equal(criada.status, 201, JSON.stringify(criada.json));
  return { id: criada.json.id, variantId: criada.json.variants[0].id };
}

async function estoqueDe(jewelryId) {
  const list = await api("/jewelry");
  return Number(list.json.find((item) => Number(item.id) === Number(jewelryId))?.quantity ?? -1);
}

test("venda com variação acima do estoque é recusada com 400 e não grava nada", async () => {
  const joia = await criaJoia("Joia Estoque Variacao", 3);
  const pedidosAntes = (await api("/sales-orders")).json.length;
  const clientesAntes = (await api("/clients")).json.length;

  const venda = await api("/sales-orders", {
    method: "POST",
    body: {
      full_name: "Cliente Estoque A", whatsapp: "11900001111", payment_method: "Pix",
      items: [{ item_name: "Joia Estoque Variacao", product_id: joia.id, product_variant_id: joia.variantId, quantity: 50, unit_price: 50 }],
    },
  });
  assert.equal(venda.status, 400, JSON.stringify(venda.json));
  assert.match(venda.json.error, /Estoque insuficiente/i);
  assert.match(venda.json.error, /3 un\./, "a mensagem precisa dizer o saldo disponível");

  assert.equal(await estoqueDe(joia.id), 3, "o estoque não pode ter sido tocado");
  assert.equal((await api("/sales-orders")).json.length, pedidosAntes, "nenhum pedido pode ter sobrado");
  assert.equal((await api("/clients")).json.length, clientesAntes, "nenhum cliente pode ter sobrado");
});

test("venda SEM variação informada acima do estoque também é recusada", async () => {
  const joia = await criaJoia("Joia Estoque Sem Variacao", 3);
  const pedidosAntes = (await api("/sales-orders")).json.length;

  const venda = await api("/sales-orders", {
    method: "POST",
    body: {
      full_name: "Cliente Estoque B", whatsapp: "11900002222", payment_method: "Pix",
      items: [{ item_name: "Joia Estoque Sem Variacao", product_id: joia.id, quantity: 50, unit_price: 50 }],
    },
  });
  assert.equal(venda.status, 400, JSON.stringify(venda.json));
  assert.match(venda.json.error, /Estoque insuficiente/i);
  assert.equal(await estoqueDe(joia.id), 3, "o saldo não pode ir a zero");
  assert.equal((await api("/sales-orders")).json.length, pedidosAntes);
});

test("duas linhas do mesmo produto somam contra o mesmo saldo", async () => {
  const joia = await criaJoia("Joia Estoque Duas Linhas", 3);
  const venda = await api("/sales-orders", {
    method: "POST",
    body: {
      full_name: "Cliente Estoque C", whatsapp: "11900003333", payment_method: "Pix",
      items: [
        { item_name: "Joia Estoque Duas Linhas", product_id: joia.id, product_variant_id: joia.variantId, quantity: 2, unit_price: 50 },
        { item_name: "Joia Estoque Duas Linhas", product_id: joia.id, product_variant_id: joia.variantId, quantity: 2, unit_price: 50 },
      ],
    },
  });
  assert.equal(venda.status, 400, JSON.stringify(venda.json));
  assert.equal(await estoqueDe(joia.id), 3, "2 + 2 sobre saldo 3 não pode passar");
});

test("venda da quantidade exata do estoque continua passando e zera o saldo", async () => {
  const joia = await criaJoia("Joia Estoque Exato", 3);
  const venda = await api("/sales-orders", {
    method: "POST",
    body: {
      full_name: "Cliente Estoque D", whatsapp: "11900004444", payment_method: "Pix",
      items: [{ item_name: "Joia Estoque Exato", product_id: joia.id, product_variant_id: joia.variantId, quantity: 3, unit_price: 50 }],
    },
  });
  assert.equal(venda.status, 201, JSON.stringify(venda.json));
  assert.equal(await estoqueDe(joia.id), 0, "o limite exato é venda válida");

  // E a próxima unidade, aí sim, não existe mais.
  const excedente = await api("/sales-orders", {
    method: "POST",
    body: {
      full_name: "Cliente Estoque D", whatsapp: "11900004444", payment_method: "Pix",
      items: [{ item_name: "Joia Estoque Exato", product_id: joia.id, product_variant_id: joia.variantId, quantity: 1, unit_price: 50 }],
    },
  });
  assert.equal(excedente.status, 400, JSON.stringify(excedente.json));
  assert.equal(await estoqueDe(joia.id), 0, "estoque não pode ficar negativo");
});

test("erro dentro da transação não devolve o client ao pool com transação aberta", async () => {
  // Intenção inexistente: o throw acontece com a transação já aberta.
  const inexistente = await api("/payment-intents/999999/status", { method: "PATCH", body: { status: "confirmed" } });
  assert.equal(inexistente.status, 404, JSON.stringify(inexistente.json));
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
  assert.equal(solicitacao.json.payment_intent?.id, undefined, "id serial não pode sair na resposta pública");
  assert.match(solicitacao.json.payment_intent?.token || "", /^[0-9a-f-]{36}$/i);
  const intents = await api("/payment-intents");
  assert.equal(intents.status, 200, JSON.stringify(intents.json));
  const intentId = intents.json.find((item) => Number(item.appointment_id) === Number(solicitacao.json.id))?.id;
  assert.ok(intentId, "a intenção deve continuar visível na rota administrativa");

  // Link público é uma credencial curta: admin/finance pode rotacioná-lo sem
  // criar outra cobrança; o token anterior não pode mais consultar nada.
  const rotacionado = await api(`/payment-intents/${intentId}/public-token`, { method: "POST" });
  assert.equal(rotacionado.status, 200, JSON.stringify(rotacionado.json));
  assert.notEqual(rotacionado.json.payment_intent.token, solicitacao.json.payment_intent.token);
  assert.ok(rotacionado.json.payment_intent.token_expires_at);
  const tokenAntigo = await req(`/payment-intents/${solicitacao.json.payment_intent.token}/sync`, {
    tenant: ctx.slug,
    method: "POST"
  });
  assert.equal(tokenAntigo.status, 404);

  const enumerated = await req(`/payment-intents/${intentId}/pix`, { tenant: ctx.slug });
  assert.equal(enumerated.status, 401, "id serial não pode autenticar consulta pública");
  const publicStatus = await req(`/payment-intents/${rotacionado.json.payment_intent.token}/sync`, {
    tenant: ctx.slug,
    method: "POST"
  });
  assert.equal(publicStatus.status, 200, JSON.stringify(publicStatus.json));
  assert.equal(publicStatus.json.status, "awaiting_payment");
  assert.equal(publicStatus.json.id, undefined);

  // Operação financeira sem chave idempotente é recusada antes de tocar o
  // estado. A chave impede que dois cliques cancelem a mesma cobrança.
  const semChave = await api(`/payment-intents/${intentId}/cancel`, { method: "POST" });
  assert.equal(semChave.status, 400, JSON.stringify(semChave.json));
  const cancelado = await api(`/payment-intents/${intentId}/cancel`, {
    method: "POST",
    headers: { "Idempotency-Key": `cancel-${intentId}-uma-vez` },
    body: { reason: "Teste de cancelamento" }
  });
  assert.equal(cancelado.status, 200, JSON.stringify(cancelado.json));
  assert.equal(cancelado.json.payment_status, "cancelled");
  const publicoCancelado = await req(`/payment-intents/${rotacionado.json.payment_intent.token}/sync`, {
    tenant: ctx.slug,
    method: "POST"
  });
  assert.equal(publicoCancelado.status, 410, JSON.stringify(publicoCancelado.json));

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
