// Testes de ENDPOINT do GET /api/dashboard — trava o CONTRATO do objeto `stats`.
//
// Rode (de backend/):
//   node tests/run-suite.mjs tests/dashboard.test.mjs
//
// O runner sobe o servidor em NODE_ENV=production → auth REAL (token + X-Tenant).
// Cada teste cria a PRÓPRIA clínica, monta os próprios dados e derruba tudo no
// final: nenhum teste depende de ordem de execução nem de sobras de outro.
//
// Contrato coberto aqui (stats de GET /api/dashboard):
//   revenueToday    → payments pagos com paid_at na data de HOJE (local, UTC−3),
//                     somando TODOS os tipos de pagamento (não só o sinal);
//   revenueMonth    → recebido no mês corrente;
//   expensesMonth   → despesas do mês corrente;
//   profitEstimated → revenueMonth − expensesMonth;
//   depositReceived → sinais recebidos NO MÊS CORRENTE (não all-time);
//   newClientsMonth → clientes criados no mês corrente;
//   todayCount      → agendamentos de hoje EXCLUINDO 'cancelado' e 'recusado'.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { req, createTenant, loginTenant, platformLogin, deleteTenant } from "./helpers.mjs";

const ctx = { platformToken: null, criadas: [] };

// ---------------------------------------------------------------------------
// Datas — sempre no fuso da clínica (America/Sao_Paulo), como manda o contrato.
// ---------------------------------------------------------------------------
const FUSO = "America/Sao_Paulo";

// "YYYY-MM-DD" do dia local deslocado em `offsetDias` (sv-SE já formata ISO).
function dataLocal(offsetDias = 0) {
  return new Date(Date.now() + offsetDias * 86_400_000).toLocaleDateString("sv-SE", { timeZone: FUSO });
}

// Dia 15 de um mês anterior — evita virada de mês/DST na conta.
function diaDeMesAnterior(mesesAtras) {
  const [ano, mes] = dataLocal().split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1 - mesesAtras, 15)).toISOString().slice(0, 10);
}

const HOJE = dataLocal(0);
const ONTEM = dataLocal(-1);
const MES_PASSADO = diaDeMesAnterior(1);
const DOIS_MESES_ATRAS = diaDeMesAnterior(2);

// ---------------------------------------------------------------------------
// Clínicas de teste (nunca a `bella`: aquela é o ambiente de demonstração).
// ---------------------------------------------------------------------------
before(async () => {
  ctx.platformToken = await platformLogin();
});

after(async () => {
  // Rede de segurança: se um teste estourou antes do finally, limpa aqui.
  for (const clinica of ctx.criadas) {
    await deleteTenant(ctx.platformToken, clinica.tenantId, clinica.slug);
  }
  ctx.criadas = [];
});

// Cria uma clínica isolada e já devolve o wrapper autenticado (token + X-Tenant).
async function novaClinica(prefixo) {
  const criada = await createTenant(prefixo);
  const login = await loginTenant(criada.slug, criada.adminEmail, criada.adminPassword);
  const clinica = {
    slug: criada.slug,
    tenantId: criada.tenant.id,
    token: login.token,
    api: (path, opts = {}) => req(path, { tenant: criada.slug, token: login.token, ...opts })
  };
  ctx.criadas.push(clinica);
  return clinica;
}

async function derrubar(...clinicas) {
  for (const clinica of clinicas) {
    if (!clinica) continue;
    await deleteTenant(ctx.platformToken, clinica.tenantId, clinica.slug);
    ctx.criadas = ctx.criadas.filter((item) => item.tenantId !== clinica.tenantId);
  }
}

// ---------------------------------------------------------------------------
// Leitura do dashboard — campo ausente é FALHA, nunca 0 silencioso.
// ---------------------------------------------------------------------------
const CAMPOS_DO_CONTRATO = [
  "revenueToday",
  "revenueMonth",
  "expensesMonth",
  "profitEstimated",
  "depositReceived",
  "newClientsMonth",
  "todayCount"
];

async function lerStats(clinica) {
  const res = await clinica.api("/dashboard");
  assert.equal(res.status, 200, `GET /api/dashboard falhou: ${JSON.stringify(res.json)}`);
  assert.ok(res.json?.stats, `resposta do dashboard sem objeto 'stats': ${JSON.stringify(res.json)}`);
  return res.json.stats;
}

// Lê um indicador exigindo que ele EXISTA de verdade. O bug do "R$ 0,00
// permanente" se escondia exatamente aqui: campo ausente virava 0 com `?? 0`.
function indicador(stats, campo) {
  const presentes = Object.keys(stats).join(", ") || "(nenhum)";
  assert.ok(
    Object.prototype.hasOwnProperty.call(stats, campo),
    `stats.${campo} não existe no payload de GET /api/dashboard — campos presentes: ${presentes}`
  );
  assert.ok(
    stats[campo] !== undefined && stats[campo] !== null,
    `stats.${campo} veio ${String(stats[campo])} (o contrato exige um número, nunca undefined/null)`
  );
  const numero = Number(stats[campo]);
  assert.ok(
    Number.isFinite(numero),
    `stats.${campo} deveria ser numérico e veio ${JSON.stringify(stats[campo])}`
  );
  return numero;
}

// ---------------------------------------------------------------------------
// Montagem de dados (só via API pública do backend, sem SQL direto).
// ---------------------------------------------------------------------------
let sequencia = 0;
function whatsappUnico() {
  sequencia += 1;
  return `1198${String(Date.now() % 100000).padStart(5, "0")}${String(sequencia).padStart(2, "0")}`.slice(0, 13);
}

async function criarProfissional(clinica, nome = "Profissional QA") {
  const res = await clinica.api("/professionals", { method: "POST", body: { name: nome } });
  assert.equal(res.status, 201, `falha ao criar profissional: ${JSON.stringify(res.json)}`);
  return res.json.id;
}

async function criarCliente(clinica, nome) {
  const res = await clinica.api("/clients", { method: "POST", body: { full_name: nome, whatsapp: whatsappUnico() } });
  assert.equal(res.status, 201, `falha ao criar cliente: ${JSON.stringify(res.json)}`);
  return res.json.id;
}

// Cria um agendamento. Com `sinal` > 0 o backend grava um pagamento 'sinal'
// PAGO com paid_at = data/hora do agendamento — é assim que a suíte consegue
// pagamentos em datas controladas (hoje, ontem, meses anteriores).
async function criarAgendamento(clinica, {
  profissionalId,
  data,
  hora,
  status = "confirmado",
  total = 0,
  sinal = 0,
  clienteId = null,
  nome = "Cliente QA Dashboard"
}) {
  const body = {
    professional_id: profissionalId,
    appointment_date: data,
    appointment_time: hora,
    procedure: "Lóbulo QA",
    piercing_region: "Orelha",
    full_name: nome,
    whatsapp: whatsappUnico(),
    total_value: total,
    deposit_value: sinal,
    deposit_status: sinal > 0 ? "pago" : "nao_aplicavel",
    deposit_paid_at: sinal > 0 ? `${data}T${hora}:00` : null,
    deposit_payment_method: "Pix",
    remaining_payment_method: "Pix",
    status
  };
  if (clienteId) body.client_id = clienteId;
  const res = await clinica.api("/appointments", { method: "POST", body });
  assert.equal(res.status, 201, `falha ao criar agendamento (${data} ${hora}): ${JSON.stringify(res.json)}`);
  return res.json.id;
}

async function criarDespesa(clinica, { descricao, valor, vencimento, status = "paga" }) {
  const res = await clinica.api("/expenses", {
    method: "POST",
    body: { description: descricao, expense_type: "variavel", category: "QA", amount: valor, due_date: vencimento, status, payment_method: "Pix" }
  });
  assert.equal(res.status, 201, `falha ao criar despesa: ${JSON.stringify(res.json)}`);
  return res.json.id;
}

// ---------------------------------------------------------------------------
// 1. Clínica zerada
// ---------------------------------------------------------------------------

test("clínica zerada devolve todos os indicadores em 0 — e nenhum campo undefined", async () => {
  const clinica = await novaClinica("dash-zero");
  try {
    const stats = await lerStats(clinica);
    for (const campo of CAMPOS_DO_CONTRATO) {
      assert.equal(indicador(stats, campo), 0, `clínica recém-criada deveria ter stats.${campo} = 0`);
    }
  } finally {
    await derrubar(clinica);
  }
});

// ---------------------------------------------------------------------------
// 2. revenueToday só conta HOJE
// ---------------------------------------------------------------------------

test("revenueToday soma só os pagamentos de hoje (ignora ontem e o mês passado)", async () => {
  const clinica = await novaClinica("dash-hoje");
  try {
    const profissionalId = await criarProfissional(clinica);
    await criarAgendamento(clinica, { profissionalId, data: HOJE, hora: "10:00", total: 100, sinal: 100 });
    await criarAgendamento(clinica, { profissionalId, data: ONTEM, hora: "11:00", total: 55, sinal: 55 });
    await criarAgendamento(clinica, { profissionalId, data: MES_PASSADO, hora: "12:00", total: 33, sinal: 33 });

    const stats = await lerStats(clinica);
    assert.equal(
      indicador(stats, "revenueToday"),
      100,
      `revenueToday deve somar apenas o pagamento de ${HOJE} (100) — ontem (55) e mês passado (33) não entram`
    );
  } finally {
    await derrubar(clinica);
  }
});

// ---------------------------------------------------------------------------
// 3. revenueToday não é só sinal
// ---------------------------------------------------------------------------

test("revenueToday soma todos os tipos de pagamento do dia, não só o sinal", async () => {
  const clinica = await novaClinica("dash-tipos");
  try {
    const profissionalId = await criarProfissional(clinica);
    // Sinal de 100 pago hoje + restante de 150 registrado ao marcar 'atendido'.
    const agendamentoId = await criarAgendamento(clinica, { profissionalId, data: HOJE, hora: "09:00", total: 250, sinal: 100 });
    const atendido = await clinica.api(`/appointments/${agendamentoId}/complete`, {
      method: "POST",
      body: { payments: [{ amount: 150, method: "Pix", status: "pago" }] }
    });
    assert.equal(atendido.status, 200, JSON.stringify(atendido.json));
    assert.equal(atendido.json.status, "atendido");

    const stats = await lerStats(clinica);
    assert.equal(
      indicador(stats, "revenueToday"),
      250,
      "revenueToday deve somar sinal (100) + restante (150) = 250; se veio 100, está filtrando payment_type='sinal'"
    );
  } finally {
    await derrubar(clinica);
  }
});

// ---------------------------------------------------------------------------
// 4. depositReceived é do MÊS, não all-time
// ---------------------------------------------------------------------------

test("depositReceived considera só os sinais do mês corrente (não é all-time)", async () => {
  const clinica = await novaClinica("dash-sinal");
  try {
    const profissionalId = await criarProfissional(clinica);
    await criarAgendamento(clinica, { profissionalId, data: HOJE, hora: "13:00", total: 120, sinal: 120 });
    await criarAgendamento(clinica, { profissionalId, data: MES_PASSADO, hora: "14:00", total: 200, sinal: 200 });
    await criarAgendamento(clinica, { profissionalId, data: DOIS_MESES_ATRAS, hora: "15:00", total: 300, sinal: 300 });

    const stats = await lerStats(clinica);
    assert.equal(
      indicador(stats, "depositReceived"),
      120,
      "depositReceived deve trazer só o sinal do mês corrente (120); 620 significa que está somando todo o histórico"
    );
  } finally {
    await derrubar(clinica);
  }
});

// ---------------------------------------------------------------------------
// 5. todayCount ignora cancelado/recusado
// ---------------------------------------------------------------------------

test("todayCount conta os agendamentos de hoje ignorando 'cancelado' e 'recusado'", async () => {
  const clinica = await novaClinica("dash-agenda");
  try {
    const profissionalId = await criarProfissional(clinica);
    const contam = ["pendente", "awaiting_deposit_proof", "confirmado", "atendido"];
    const naoContam = ["cancelado", "recusado"];
    let hora = 8;
    for (const status of [...contam, ...naoContam]) {
      await criarAgendamento(clinica, { profissionalId, data: HOJE, hora: `${String(hora).padStart(2, "0")}:00`, status, total: 80 });
      hora += 1;
    }
    // Um de amanhã para provar que o filtro é por data também.
    await criarAgendamento(clinica, { profissionalId, data: dataLocal(1), hora: "08:00", status: "confirmado", total: 80 });

    const stats = await lerStats(clinica);
    assert.equal(
      indicador(stats, "todayCount"),
      contam.length,
      `todayCount deve valer ${contam.length} (${contam.join(", ")}); cancelado/recusado e o agendamento de amanhã ficam de fora`
    );
  } finally {
    await derrubar(clinica);
  }
});

// ---------------------------------------------------------------------------
// 6. newClientsMonth conta CLIENTES, não agendamentos
// ---------------------------------------------------------------------------

test("newClientsMonth conta clientes criados no mês, não agendamentos", async () => {
  const clinica = await novaClinica("dash-clientes");
  try {
    const profissionalId = await criarProfissional(clinica);
    const clientes = [];
    for (const nome of ["Cliente Um", "Cliente Dois", "Cliente Tres"]) {
      clientes.push(await criarCliente(clinica, `${nome} QA`));
    }
    // 5 agendamentos — todos reaproveitando o MESMO cliente (client_id), para
    // que a contagem de clientes não possa ser confundida com a de agenda.
    for (let i = 0; i < 5; i += 1) {
      await criarAgendamento(clinica, {
        profissionalId,
        data: HOJE,
        hora: `${String(9 + i).padStart(2, "0")}:30`,
        clienteId: clientes[0],
        total: 60
      });
    }

    const stats = await lerStats(clinica);
    assert.equal(
      indicador(stats, "newClientsMonth"),
      clientes.length,
      `newClientsMonth deve ser ${clientes.length} (clientes criados no mês); 5 significa que está contando agendamentos`
    );
  } finally {
    await derrubar(clinica);
  }
});

// ---------------------------------------------------------------------------
// 7. profitEstimated = revenueMonth − expensesMonth
// ---------------------------------------------------------------------------

test("profitEstimated bate exatamente com revenueMonth - expensesMonth", async () => {
  const clinica = await novaClinica("dash-lucro");
  try {
    const profissionalId = await criarProfissional(clinica);
    await criarAgendamento(clinica, { profissionalId, data: HOJE, hora: "16:00", total: 400, sinal: 400 });
    await criarDespesa(clinica, { descricao: "Insumos QA", valor: 150, vencimento: HOJE, status: "paga" });
    // Despesa de mês anterior e ainda em aberto: não pode entrar em nenhum critério.
    await criarDespesa(clinica, { descricao: "Despesa antiga QA", valor: 999, vencimento: MES_PASSADO, status: "pendente" });

    const stats = await lerStats(clinica);
    const receita = indicador(stats, "revenueMonth");
    const despesas = indicador(stats, "expensesMonth");
    const lucro = indicador(stats, "profitEstimated");

    assert.equal(receita, 400, "revenueMonth deve somar o recebido do mês (400)");
    assert.equal(despesas, 150, "expensesMonth deve trazer só a despesa do mês corrente (150)");
    assert.equal(lucro, receita - despesas, "profitEstimated deve ser exatamente revenueMonth - expensesMonth");
    assert.equal(lucro, 250, "com 400 recebidos e 150 de despesa, o lucro estimado é 250");
  } finally {
    await derrubar(clinica);
  }
});

// ---------------------------------------------------------------------------
// 8. ISOLAMENTO ENTRE CLÍNICAS — o teste mais importante do projeto.
// ---------------------------------------------------------------------------

test("indicadores da clínica A não vazam para a clínica B (isolamento)", async () => {
  let clinicaA = null;
  let clinicaB = null;
  try {
    clinicaA = await novaClinica("dash-iso-a");
    clinicaB = await novaClinica("dash-iso-b");

    const profissionalId = await criarProfissional(clinicaA);
    const clienteA = await criarCliente(clinicaA, "Cliente Isolamento A1");
    await criarCliente(clinicaA, "Cliente Isolamento A2");
    await criarAgendamento(clinicaA, { profissionalId, data: HOJE, hora: "17:00", total: 300, sinal: 300, clienteId: clienteA });
    await criarDespesa(clinicaA, { descricao: "Despesa isolamento", valor: 100, vencimento: HOJE, status: "paga" });

    // A enxerga os próprios números.
    const statsA = await lerStats(clinicaA);
    assert.equal(indicador(statsA, "revenueToday"), 300, "A deveria ver o próprio recebimento de hoje");
    assert.equal(indicador(statsA, "revenueMonth"), 300, "A deveria ver o próprio recebimento do mês");
    assert.equal(indicador(statsA, "depositReceived"), 300, "A deveria ver o próprio sinal do mês");
    assert.equal(indicador(statsA, "expensesMonth"), 100, "A deveria ver a própria despesa do mês");
    assert.equal(indicador(statsA, "profitEstimated"), 200, "lucro de A = 300 - 100");
    assert.equal(indicador(statsA, "newClientsMonth"), 2, "A criou 2 clientes no mês");
    assert.equal(indicador(statsA, "todayCount"), 1, "A tem 1 agendamento hoje");

    // B, que não criou nada, continua zerada em TODOS os indicadores.
    const statsB = await lerStats(clinicaB);
    for (const campo of CAMPOS_DO_CONTRATO) {
      assert.equal(
        indicador(statsB, campo),
        0,
        `ISOLAMENTO QUEBRADO: stats.${campo} da clínica B (${clinicaB.slug}) foi contaminado por dados da clínica A (${clinicaA.slug})`
      );
    }
  } finally {
    await derrubar(clinicaA, clinicaB);
  }
});
