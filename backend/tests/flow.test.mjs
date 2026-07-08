// Teste de ENDPOINT do fluxo completo de uma clínica (happy path do começo ao fim).
// Cria uma clínica própria (createTenant), executa o fluxo de negócio inteiro
// e limpa tudo no final (deleteTenant). Bate contra o servidor de produção
// subido pelo run-suite.mjs (auth real por token + header X-Tenant).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { req, createTenant, loginTenant, platformLogin, deleteTenant } from "./helpers.mjs";

// Estado compartilhado entre os passos do fluxo (montado no before).
const ctx = {
  slug: null,
  token: null,
  tenant: null,
  platformToken: null,
  clientId: null,
  serviceId: null,
  procedureId: null,
  professionalId: null,
  jewelryId: null,
  appointmentId: null,
};

// Datas: usa amanhã para o agendamento (evita conflito com "hoje" em rankings).
const HOJE = new Date().toISOString().slice(0, 10);
const AMANHA = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

// Wrapper que injeta token + tenant automaticamente nas chamadas autenticadas.
function api(path, opts = {}) {
  return req(path, { token: ctx.token, tenant: ctx.slug, ...opts });
}

before(async () => {
  const created = await createTenant("qaflow");
  ctx.slug = created.slug;
  ctx.tenant = created.tenant;
  const login = await loginTenant(created.slug, created.adminEmail, created.adminPassword);
  ctx.token = login.token;
  ctx.platformToken = await platformLogin();
});

after(async () => {
  if (ctx.platformToken && ctx.tenant?.id) {
    await deleteTenant(ctx.platformToken, ctx.tenant.id, ctx.slug);
  }
});

// 1) Login já foi feito no before; confirmamos que temos token e role admin.
test("1. login do admin retorna token e role admin", async () => {
  assert.ok(ctx.token, "token deve existir após login");
  const login = await loginTenant(ctx.slug, `admin@${ctx.slug}.test`, "SenhaForte123");
  assert.equal(login.user.role, "admin");
  assert.equal(login.tenant.slug, ctx.slug);
});

// 2) Cliente: cadastra e confere na listagem.
test("2. cadastra cliente e ele aparece na listagem", async () => {
  const create = await api("/clients", {
    method: "POST",
    body: { full_name: "Maria Teste", whatsapp: "11999990001", instagram: "@maria", birth_date: "1995-03-10" },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.ok(create.json.id, "cliente criado deve ter id");
  assert.equal(create.json.full_name, "Maria Teste");
  ctx.clientId = create.json.id;

  const list = await api("/clients");
  assert.equal(list.status, 200);
  const found = list.json.find((c) => c.id === ctx.clientId);
  assert.ok(found, "cliente deve aparecer na listagem");
  assert.equal(found.full_name, "Maria Teste");
  assert.equal(found.whatsapp, "11999990001");
});

// 3a) Serviço.
test("3a. cadastra serviço e confere na listagem", async () => {
  const create = await api("/services", {
    method: "POST",
    body: { name: "Perfuração de orelha", duration_minutes: 30, price: 120, deposit_value: 40 },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.equal(create.json.name, "Perfuração de orelha");
  assert.equal(Number(create.json.price), 120);
  ctx.serviceId = create.json.id;

  const list = await api("/services");
  assert.equal(list.status, 200);
  assert.ok(list.json.some((s) => s.id === ctx.serviceId), "serviço deve aparecer");
});

// 3b) Procedimento vinculado ao serviço.
test("3b. cadastra procedimento vinculado ao serviço", async () => {
  const create = await api("/procedures", {
    method: "POST",
    body: { name: "Lóbulo simples", service_id: ctx.serviceId, body_area: "Orelha", price: 100, duration_minutes: 20 },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.equal(create.json.name, "Lóbulo simples");
  assert.equal(Number(create.json.service_id), Number(ctx.serviceId));
  ctx.procedureId = create.json.id;

  const list = await api("/procedures");
  assert.equal(list.status, 200);
  const found = list.json.find((p) => p.id === ctx.procedureId);
  assert.ok(found, "procedimento deve aparecer");
  assert.equal(found.service_name, "Perfuração de orelha", "join com service_name deve resolver");
});

// 3c) Profissional.
test("3c. cadastra profissional", async () => {
  const create = await api("/professionals", {
    method: "POST",
    body: { name: "Ana Piercer", specialty: "Body piercing" },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.equal(create.json.name, "Ana Piercer");
  assert.equal(create.json.active, 1);
  ctx.professionalId = create.json.id;
});

// 3d) Disponibilidade: o provisionamento não semeia availability, então a
// listagem vem vazia e um PATCH em id inexistente deve dar 404.
test("3d. disponibilidade lista vazia e PATCH inexistente dá 404", async () => {
  const list = await api("/availability");
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json), "availability deve ser array");
  assert.equal(list.json.length, 0, "sem seed de disponibilidade, lista deve vir vazia");

  const patch = await api("/availability/999999", {
    method: "PATCH",
    body: { start_time: "08:00", end_time: "17:00" },
  });
  assert.equal(patch.status, 404, "PATCH em disponibilidade inexistente deve dar 404");
});

test("3e. readiness exige vinculo e agenda semanal; depois fica pronto", async () => {
  const initial = await api("/booking/readiness");
  assert.equal(initial.status, 200);
  assert.equal(initial.json.ready, false);
  assert.ok(initial.json.missing.includes("Agenda semanal configurada"));
  assert.ok(initial.json.missing.includes("Profissionais vinculados aos serviços"));

  const linkProfessional = await api(`/professionals/${ctx.professionalId}`, {
    method: "PATCH",
    body: { service_ids: [ctx.serviceId], active: true },
  });
  assert.equal(linkProfessional.status, 200, JSON.stringify(linkProfessional.json));
  assert.deepEqual(linkProfessional.json.service_ids, [ctx.serviceId]);

  const deactivate = await api(`/professionals/${ctx.professionalId}`, {
    method: "PATCH",
    body: { active: false },
  });
  assert.equal(deactivate.status, 200, JSON.stringify(deactivate.json));
  assert.equal(deactivate.json.active, 0);

  const reactivate = await api(`/professionals/${ctx.professionalId}`, {
    method: "PATCH",
    body: { active: true },
  });
  assert.equal(reactivate.status, 200, JSON.stringify(reactivate.json));
  assert.equal(reactivate.json.active, 1);

  const generated = await api("/availability/generate-weekly", {
    method: "POST",
    body: {
      professional_id: ctx.professionalId,
      weekdays: [1, 2, 3, 4, 5],
      start_time: "09:00",
      end_time: "18:00",
      lunch_start: "12:00",
      lunch_end: "13:00",
      duration_minutes: 40,
      buffer_minutes: 10,
    },
  });
  assert.equal(generated.status, 201, JSON.stringify(generated.json));
  assert.equal(generated.json.length, 5);

  const ready = await api("/booking/readiness");
  assert.equal(ready.status, 200);
  assert.equal(ready.json.ready, true, JSON.stringify(ready.json));

  const config = await api("/booking/config");
  assert.equal(config.status, 200, JSON.stringify(config.json));
  const linkedProfessional = config.json.professionals.find((item) => Number(item.id) === Number(ctx.professionalId));
  assert.ok(linkedProfessional, "profissional vinculado deve aparecer no agendamento publico");
  assert.ok(linkedProfessional.service_ids.map(Number).includes(Number(ctx.serviceId)), "config publico deve informar service_ids do profissional");
});

// 4a) Joia: cadastra com quantidade inicial (POST /jewelry → 201).
test("4a. cadastra joia com estoque inicial", async () => {
  const create = await api("/jewelry", {
    method: "POST",
    body: {
      name: "Labret Titânio Zircônia",
      category: "Labret",
      material: "Titânio",
      color: "Prata",
      quantity: 10,
      cost_value: 15,
      sale_value: 60,
      low_stock_threshold: 3,
      critical_stock_threshold: 1,
    },
  });

  assert.equal(create.status, 201, `POST /jewelry deveria criar a joia. Resposta: ${JSON.stringify(create.json)}`);
  ctx.jewelryId = create.json.id;
  assert.ok(create.json.id, "joia deve ter id");
  // A quantidade agregada vem das variações (variantFromLegacy criou 1 variação).
  assert.equal(Number(create.json.quantity), 10, "quantidade agregada da joia deve ser 10");
  const list = await api("/jewelry");
  assert.equal(list.status, 200);
  assert.ok(list.json.some((j) => j.id === ctx.jewelryId), "joia deve aparecer na listagem");

  const duplicateAuto = await api("/jewelry", {
    method: "POST",
    body: {
      name: "Labret Titânio Zircônia Reserva",
      category: "Labret",
      material: "Titânio",
      color: "Prata",
      variants: [{
        sku: create.json.variants[0].sku,
        material: "Titânio",
        color: "Prata",
        thickness: "1.2mm",
        length: "8mm",
        quantity: 1,
        sale_value: 65,
      }],
    },
  });
  assert.equal(duplicateAuto.status, 201, `SKU automatico duplicado deve ser regenerado. Resposta: ${JSON.stringify(duplicateAuto.json)}`);
  assert.notEqual(duplicateAuto.json.sku, create.json.sku, "SKU principal automatico deve ser unico");
  assert.notEqual(duplicateAuto.json.variants[0].sku, create.json.variants[0].sku, "SKU da variacao automatica deve ser unico");
  ctx.extraJewelryId = duplicateAuto.json.id;
});

// 4b) Movimento de estoque no nível de produto (POST /jewelry/:id/movements).
test("4b. registra movimento de estoque (Entrada) e confere quantidade", async () => {
  const mov = await api(`/jewelry/${ctx.jewelryId}/movements`, {
    method: "POST",
    body: { movement_type: "Entrada", quantity: 5, notes: "Reposição QA" },
  });
  assert.equal(mov.status, 200, JSON.stringify(mov.json));
  assert.ok(mov.json.ok, "resposta do movimento deve ter ok=true");
  assert.equal(Number(mov.json.jewelry.quantity), 15, "quantidade do produto deve ir de 10 para 15");

  const movements = await api(`/jewelry/${ctx.jewelryId}/movements`);
  assert.equal(movements.status, 200);
  assert.ok(movements.json.some((m) => m.movement_type === "Entrada" && Number(m.quantity) === 5), "movimento deve ser listado");
});

// 5) Agendamento: liga cliente + profissional + serviço, com data/hora/valores.
test("5a. cria agendamento (com sinal) e ele aparece na listagem", async () => {
  // jewelry_id só é enviado se a joia foi realmente criada (bug de 4a).
  const body = {
    client_id: ctx.clientId,
    full_name: "Maria Teste",
    whatsapp: "11999990001",
    professional_id: ctx.professionalId,
    service_id: ctx.serviceId,
    procedure: "Lóbulo simples",
    piercing_region: "Orelha",
    appointment_date: AMANHA,
    appointment_time: "14:00",
    total_value: 120,
    deposit_value: 40,
    remaining_value: 80,
    deposit_payment_method: "Pix",
    remaining_payment_method: "Cartão",
    status: "confirmado",
  };
  if (ctx.jewelryId) body.jewelry_id = ctx.jewelryId;
  const create = await api("/appointments", { method: "POST", body });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.ok(create.json.id, "agendamento deve ter id");
  assert.equal(Number(create.json.professional_id), Number(ctx.professionalId));
  assert.equal(Number(create.json.deposit_value), 40);
  assert.equal(Number(create.json.remaining_value), 80);
  ctx.appointmentId = create.json.id;

  const list = await api("/appointments");
  assert.equal(list.status, 200);
  const found = list.json.find((a) => a.id === ctx.appointmentId);
  assert.ok(found, "agendamento deve aparecer na listagem");
  assert.equal(found.professional_name, "Ana Piercer");
  assert.equal(found.service_name, "Perfuração de orelha");
});

test("5b. horário duplicado para o mesmo profissional dá 409", async () => {
  const dup = await api("/appointments", {
    method: "POST",
    body: {
      full_name: "Cliente Conflito",
      whatsapp: "11999990002",
      professional_id: ctx.professionalId,
      procedure: "Lóbulo simples",
      piercing_region: "Orelha",
      appointment_date: AMANHA,
      appointment_time: "14:00",
    },
  });
  assert.equal(dup.status, 409, JSON.stringify(dup.json));
});

test("5c. muda status do agendamento até 'atendido'", async () => {
  const patch = await api(`/appointments/${ctx.appointmentId}`, {
    method: "PATCH",
    body: { status: "atendido" },
  });
  assert.equal(patch.status, 200, JSON.stringify(patch.json));
  assert.equal(patch.json.status, "atendido");
});

// 6) Financeiro: o sinal + o restante (registrado ao atender) devem aparecer.
test("6a. finance reflete sinal e restante do atendimento", async () => {
  const finance = await api("/finance");
  assert.equal(finance.status, 200, JSON.stringify(finance.json));
  // Sinal de 40 recebido neste mês.
  assert.equal(Number(finance.json.deposits.monthTotal), 40, "sinal de 40 deve constar em deposits.monthTotal");
  // Ao atender, registra o pagamento restante (80). Total do mês = 40 + 80 = 120.
  assert.equal(Number(finance.json.totals.month_total), 120, "month_total deve somar sinal + restante = 120");
});

test("6b. cria despesa e ela reflete no finance", async () => {
  const create = await api("/expenses", {
    method: "POST",
    body: { description: "Aluguel QA", expense_type: "fixa", category: "Estrutura", amount: 500, due_date: HOJE, status: "paga", payment_method: "Boleto" },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.equal(create.json.description, "Aluguel QA");

  const finance = await api("/finance");
  assert.equal(Number(finance.json.expensesSummary.fixed_total), 500, "despesa fixa de 500 deve constar");
  assert.equal(
    Number(finance.json.profit.estimated),
    120 - 500,
    "lucro estimado = receita do mês (120) - despesas (500)"
  );
});

// 7) Venda: cria pedido com itens e confere na listagem.
test("7. cria venda com itens e confere em sales-orders", async () => {
  const create = await api("/sales-orders", {
    method: "POST",
    body: {
      full_name: "Maria Teste",
      whatsapp: "11999990001",
      client_id: ctx.clientId,
      order_type: "produto",
      payment_method: "Pix",
      status: "concluida",
      items: [
        { item_name: "Labret Titânio", quantity: 2, unit_price: 60, product_id: ctx.jewelryId },
      ],
    },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.equal(Number(create.json.total_value), 120, "total da venda = 2 x 60");
  assert.equal(create.json.items.length, 1);

  const list = await api("/sales-orders");
  assert.equal(list.status, 200);
  assert.ok(list.json.some((o) => o.id === create.json.id), "venda deve aparecer na listagem");
});

// 8a) Prontuário médico.
test("8a. cria prontuário do cliente", async () => {
  const create = await api(`/clients/${ctx.clientId}/medical-records`, {
    method: "POST",
    body: {
      appointment_id: ctx.appointmentId,
      record_date: HOJE,
      piercing_history: "Primeiro furo",
      jewelry_used: "Labret Titânio",
      guidance: "Higienizar 2x ao dia",
    },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.ok(create.json.id, "prontuário deve ter id");

  // O prontuário deve vir no enriquecimento do cliente na listagem.
  const list = await api("/clients");
  const client = list.json.find((c) => c.id === ctx.clientId);
  assert.ok(Array.isArray(client.medicalRecords), "cliente deve trazer medicalRecords");
  assert.ok(client.medicalRecords.length >= 1, "prontuário deve constar no cliente");
});

// 8b) Termo digital.
test("8b. cria termo digital vinculado ao agendamento", async () => {
  const create = await api("/digital-terms", {
    method: "POST",
    body: {
      appointment_id: ctx.appointmentId,
      client_id: ctx.clientId,
      full_name: "Maria Teste",
      document_number: "123456789",
      whatsapp: "11999990001",
      orientations_confirmed: true,
      health_declaration: "Sem alergias",
      // PNG 2x2 RGB válido (o backend renderiza a assinatura no PDF do termo).
      signature_data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGPgEpHjEpFjgFAABk4A8Z5vd+AAAAAASUVORK5CYII=",
      form_data: { epilepsia: false, diabetes: false },
    },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  assert.ok(create.json.id, "termo deve ter id");

  const list = await api("/digital-terms");
  assert.equal(list.status, 200);
  assert.ok(list.json.some((t) => t.id === create.json.id), "termo deve aparecer na listagem");
});

// 8c) Pós-atendimento: ao atender, followups (7/15/30 dias) foram gerados.
test("8c. pós-atendimento gera followups do atendimento", async () => {
  const postCare = await api("/post-care");
  assert.equal(postCare.status, 200, JSON.stringify(postCare.json));
  const meus = postCare.json.filter((f) => f.appointment_id === ctx.appointmentId);
  assert.equal(meus.length, 3, "devem existir 3 followups (7/15/30 dias)");
  assert.deepEqual(
    meus.map((f) => f.reminder_day).sort((a, b) => a - b),
    [7, 15, 30],
    "os dias de lembrete devem ser 7, 15 e 30"
  );
});

// 8d) Fidelidade: atender concedeu 10 (procedimento) + 5 (joia, se houver).
// Sem joia (bug de 4a) o esperado é 10; com joia, 15. Resgatamos parte deles.
test("8d. fidelidade acumulou pontos e permite resgate válido", async () => {
  const esperadoTotal = ctx.jewelryId ? 15 : 10;
  const redeem = await api(`/clients/${ctx.clientId}/loyalty-redemptions`, {
    method: "POST",
    body: { points_used: 5, discount_value: 5, notes: "Resgate QA" },
  });
  assert.equal(redeem.status, 201, JSON.stringify(redeem.json));
  assert.equal(Number(redeem.json.totalEarned), esperadoTotal, `total ganho deve ser ${esperadoTotal} (10 procedimento${ctx.jewelryId ? " + 5 joia" : ""})`);
  assert.equal(Number(redeem.json.redeemedPoints), 5);
  assert.equal(Number(redeem.json.availablePoints), esperadoTotal - 5, `após resgatar 5, sobram ${esperadoTotal - 5}`);
});

test("8e. resgate acima do saldo disponível dá 400", async () => {
  const redeem = await api(`/clients/${ctx.clientId}/loyalty-redemptions`, {
    method: "POST",
    body: { points_used: 999, discount_value: 10 },
  });
  assert.equal(redeem.status, 400, JSON.stringify(redeem.json));
});

// 9) Dashboard e ERP respondem 200 com números coerentes.
test("9a. dashboard responde 200 com estrutura esperada", async () => {
  const dash = await api("/dashboard");
  assert.equal(dash.status, 200, JSON.stringify(dash.json));
  assert.ok(dash.json.stats, "deve haver bloco stats");
  assert.ok(Array.isArray(dash.json.todaysAppointments), "todaysAppointments deve ser array");
  assert.ok(dash.json.adminDashboard, "deve haver adminDashboard");
  assert.ok(Array.isArray(dash.json.adminDashboard.monthlyRevenue), "monthlyRevenue deve ser array");
});

test("9b. erp responde 200 com métricas coerentes", async () => {
  const erp = await api("/erp");
  assert.equal(erp.status, 200, JSON.stringify(erp.json));
  assert.equal(Number(erp.json.metrics.clients), 1, "deve haver 1 cliente");
  assert.equal(Number(erp.json.metrics.appointments), 1, "deve haver 1 agendamento");
  const expectedJewelryCount = [ctx.jewelryId, ctx.extraJewelryId].filter(Boolean).length;
  assert.equal(Number(erp.json.metrics.jewelry), expectedJewelryCount, "quantidade de joias coerente com o que foi criado");
  // Receita paga (payments status='pago') = sinal 40 + restante 80 (atendimento)
  // + 120 (a venda concluída também grava um pagamento 'pago') = 240.
  assert.equal(Number(erp.json.metrics.revenue), 240, "receita paga deve ser 240 (40 + 80 + 120 da venda)");
});
