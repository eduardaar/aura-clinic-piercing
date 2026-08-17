// Painel financeiro da plataforma.
//
// Duas coisas doem se derem errado aqui, e são elas que o arquivo persegue:
//
//   1. CENTAVO ERRADO. Todo valor conferido tem casa decimal de propósito
//      (149.90 + 39.90 = 189.80). Somados em ponto flutuante, os mesmos valores
//      derrapam — 149.90 + 39.90 + 59.90 dá 249.70000000000002 — e o painel
//      precisa devolver o NUMERIC exato.
//   2. FRONTEIRA DE MÊS. "Este mês" e "vencido" dependem de um fuso. A suíte
//      inteira roda com `data_base` FIXA (2026-03-15) e com faturas pagas de
//      propósito em cima da virada (22h de 31/03 em São Paulo = 01/04 em UTC),
//      então nada aqui depende do dia em que o teste roda — nem quebra na
//      virada do mês, como acontece com a parte antiga da suíte.
//
// Os números são conferidos por DELTA (antes x depois da inserção das
// fixtures), porque o banco de desenvolvimento já tem clínicas e faturas de
// outros testes: comparar totais absolutos daria um teste que passa na máquina
// de quem escreveu e falha na do vizinho. Delta em CENTAVOS INTEIROS é subtração
// exata, sem ponto flutuante.
import test from "node:test";
import assert from "node:assert/strict";
import { req, platformLogin, createTenant, deleteTenant } from "./helpers.mjs";
import { query } from "../src/database/connection.js";

// Data base de todas as consultas. Fixa e no passado: o painel é reproduzível.
const DATA_BASE = "2026-03-15";
const MARCO = "2026-03";
const FEVEREIRO = "2026-02";

// Preço de tabela dos planos-semente, em centavos (platformSchema.sql).
const PRECO = { start: 3990, profissional: 6990, studio: 11990 };

// Sufixo único por execução: dois runs simultâneos não podem colidir no índice
// único de asaas_payment_id nem no de asaas_subscription_id.
const MARCA = `fin${Math.floor(performance.now() * 1000) % 1000000}`;

let sequencia = 0;

// Coloca a assinatura da clínica no estado desejado. O signup sempre cria
// 'trial_active' sem recorrência no gateway; o painel financeiro precisa dos
// outros estados.
async function ajustarAssinatura(tenantId, { status, planCode, gateway = true, canceladaEm = null }) {
  await query(
    `UPDATE platform.tenant_subscriptions
        SET status = $1, plan_code = $2, asaas_subscription_id = $3, canceled_at = $4, updated_at = now()
      WHERE tenant_id = $5`,
    [status, planCode, gateway ? `sub_${MARCA}_${tenantId}` : null, canceladaEm, tenantId]
  );
}

// Fatura direto no banco: criar pelo caminho real exigiria o gateway Asaas de
// verdade (checkout + webhook), e o que está sob teste é a LEITURA. `amount` vai
// como string para o valor não passar por float nem aqui no teste.
async function criarFatura(tenantId, { valor, status, vencimento, pagoEm = null, planCode }) {
  sequencia += 1;
  await query(
    `INSERT INTO platform.tenant_invoices
       (tenant_id, asaas_payment_id, plan_code, amount, status, due_date, paid_at, competencia, invoice_url)
     VALUES ($1, $2, $3, $4::numeric, $5, $6::date, $7::timestamptz,
             date_trunc('month', $6::date)::date, $8)`,
    [
      tenantId,
      `pay_${MARCA}_${sequencia}`,
      planCode,
      valor,
      status,
      vencimento,
      pagoEm,
      `https://exemplo.test/fatura/${MARCA}/${sequencia}`
    ]
  );
}

test("Financeiro da plataforma: resumo, inadimplência, vencimentos, série e planos", async (t) => {
  const platformToken = await platformLogin();
  const plt = { token: platformToken, platform: true };

  const url = (rota, extra = "") => `/platform/finance/${rota}?data_base=${DATA_BASE}${extra}`;

  // -------------------------------------------------------------------------
  // Autorização (antes de criar qualquer coisa)
  // -------------------------------------------------------------------------

  await t.test("todas as rotas exigem token de plataforma", async () => {
    for (const rota of ["summary", "overdue", "upcoming", "monthly", "by-plan"]) {
      const { status } = await req(`/platform/finance/${rota}`);
      assert.equal(status, 401, `rota ${rota} sem sessão deveria ser 401`);
    }
  });

  // -------------------------------------------------------------------------
  // Fotografia ANTES das fixtures
  // -------------------------------------------------------------------------

  const antes = {
    resumo: (await req(url("summary"), plt)).json,
    serie: (await req(url("monthly", "&meses=3"), plt)).json,
    planos: (await req(url("by-plan"), plt)).json
  };
  assert.ok(antes.resumo?.data_base, "o resumo precisa responder antes das fixtures");

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------

  const criadas = [];
  t.after(async () => {
    // A fatura tem FK com ON DELETE CASCADE para o tenant, então remover a
    // clínica limpa tudo. O DELETE por marca é o cinto de segurança para o caso
    // de o deprovisionamento falhar no meio.
    for (const clinica of criadas) {
      await deleteTenant(platformToken, clinica.tenant.id, clinica.slug);
    }
    await query("DELETE FROM platform.tenant_invoices WHERE asaas_payment_id LIKE $1", [`pay_${MARCA}_%`]);
  });

  async function novaClinica(prefixo, assinatura) {
    const clinica = await createTenant(prefixo);
    criadas.push(clinica);
    await ajustarAssinatura(clinica.tenant.id, assinatura);
    return clinica.tenant.id;
  }

  // A) Inadimplente: duas faturas vencidas (149.90 + 39.90 = 189.80) e uma paga
  //    em FEVEREIRO — que não pode aparecer no caixa de março.
  const inadimplente = await novaClinica("fininad", { status: "active", planCode: "profissional" });
  await criarFatura(inadimplente, {
    valor: "149.90",
    // 'pendente' de propósito, e não 'atrasada': o status só muda quando o
    // webhook OVERDUE do Asaas chega. Vencida é quem passou da data.
    status: "pendente",
    vencimento: "2026-02-20",
    planCode: "profissional"
  });
  await criarFatura(inadimplente, {
    valor: "39.90",
    status: "atrasada",
    vencimento: "2026-03-05",
    planCode: "profissional"
  });
  await criarFatura(inadimplente, {
    valor: "500.00",
    status: "paga",
    vencimento: "2026-02-10",
    pagoEm: "2026-02-10T15:00:00Z",
    planCode: "profissional"
  });

  // B) Primeira fatura paga da história caindo em março: é uma assinatura nova.
  const novaPagante = await novaClinica("finnova", { status: "active", planCode: "studio" });
  await criarFatura(novaPagante, {
    valor: "99.90",
    status: "paga",
    vencimento: "2026-03-10",
    pagoEm: "2026-03-10T15:00:00Z",
    planCode: "studio"
  });

  // C) As duas faturas da VIRADA DE MÊS, que provam o fuso do painel.
  const aVencer = await novaClinica("finvenc", { status: "active", planCode: "start" });
  await criarFatura(aVencer, {
    valor: "59.90",
    status: "pendente",
    vencimento: "2026-03-18",
    planCode: "start"
  });
  await criarFatura(aVencer, {
    valor: "70.00",
    status: "pendente",
    vencimento: "2026-04-20",
    planCode: "start"
  });
  await criarFatura(aVencer, {
    valor: "10.00",
    status: "paga",
    vencimento: "2026-03-31",
    // 01/04 01h UTC = 31/03 22h em São Paulo: é receita de MARÇO.
    pagoEm: "2026-04-01T01:00:00Z",
    planCode: "start"
  });
  await criarFatura(aVencer, {
    valor: "20.00",
    status: "paga",
    vencimento: "2026-02-28",
    // 01/03 02h UTC = 28/02 23h em São Paulo: é receita de FEVEREIRO.
    pagoEm: "2026-03-01T02:00:00Z",
    planCode: "start"
  });

  // D) Trial que nunca passou pelo checkout: sem recorrência no gateway.
  await novaClinica("fintrial", { status: "trial_active", planCode: "profissional", gateway: false });

  // E) Cancelada dentro do mês. Compartilha o plano Profissional com outra
  // fixture ativa para provar que status, e não só código do plano, decide MRR.
  await novaClinica("fincanc", {
    status: "canceled",
    planCode: "profissional",
    canceladaEm: "2026-03-12T12:00:00Z"
  });

  const depois = {
    resumo: (await req(url("summary"), plt)).json,
    serie: (await req(url("monthly", "&meses=3"), plt)).json,
    planos: (await req(url("by-plan"), plt)).json
  };

  // Delta em centavos: subtração de inteiros, exata por construção.
  const delta = (campo) => depois.resumo[campo] - antes.resumo[campo];
  const deltaClinicas = (campo) => depois.resumo.clinicas[campo] - antes.resumo.clinicas[campo];

  // -------------------------------------------------------------------------
  // Resumo
  // -------------------------------------------------------------------------

  await t.test("a data base pedida é a que o painel usou", async () => {
    assert.equal(depois.resumo.data_base, DATA_BASE);
    assert.equal(depois.resumo.competencia, MARCO);
    assert.equal(depois.resumo.fuso, "America/Sao_Paulo");
  });

  await t.test("MRR estimado soma só assinatura ativa COM cobrança no gateway", async () => {
    // profissional + studio + start. A clínica em trial (sem
    // asaas_subscription_id) e a cancelada não entram: trial não é receita
    // recorrente, e cancelada deixou de ser.
    const esperado = PRECO.profissional + PRECO.studio + PRECO.start;
    assert.equal(delta("mrr_estimado_centavos"), esperado);
    assert.match(depois.resumo.mrr_estimado, /^\d+\.\d{2}$/, "dinheiro sai como string decimal");
  });

  await t.test("recebido no mês é caixa, no fuso do painel", async () => {
    // 99.90 (pago em 10/03) + 10.00 (pago às 22h de 31/03 em São Paulo).
    // Os 500.00 e os 20.00 caíram em fevereiro e não podem entrar.
    assert.equal(delta("recebido_mes_centavos"), 9990 + 1000);
    assert.equal(delta("recebido_mes_faturas"), 2);
  });

  await t.test("a receber no mês é só o que ainda vai vencer", async () => {
    assert.equal(delta("a_receber_mes_centavos"), 5990, "59.90 com vencimento em 18/03");
    assert.equal(delta("a_receber_mes_faturas"), 1);
  });

  await t.test("vencido considera a DATA, não o status da fatura", async () => {
    // A fatura de 149.90 continua 'pendente' (webhook OVERDUE não chegou) e
    // mesmo assim precisa entrar: vencida é quem passou da data.
    assert.equal(delta("vencido_centavos"), 18980);
    assert.equal(delta("vencido_faturas"), 2);
    assert.equal(delta("vencido_clinicas"), 1);
  });

  await t.test("clínicas por status de assinatura", async () => {
    assert.equal(deltaClinicas("ativa"), 3);
    assert.equal(deltaClinicas("trial"), 1);
    assert.equal(deltaClinicas("cancelada"), 1);
    assert.equal(deltaClinicas("sem_cobranca_no_gateway"), 1);
  });

  await t.test("assinaturas novas e cancelamentos do mês", async () => {
    // Nova = primeira fatura paga da história caiu no mês. A clínica C também
    // pagou em março, mas a primeira paga dela foi em 28/02 (fuso de SP).
    assert.equal(delta("assinaturas_novas_mes"), 1);
    assert.equal(delta("cancelamentos_mes"), 1);
  });

  await t.test("churn não é inventado: vem null, com a explicação junto", async () => {
    assert.equal(depois.resumo.churn_mes, null);
    assert.equal(typeof depois.resumo.notas.churn_mes, "string");
    assert.ok(depois.resumo.notas.churn_mes.length > 40, "o motivo precisa estar escrito");
    // MRR é projeção e recebido é caixa: os dois campos existem separados e cada
    // um diz o que é.
    assert.ok(depois.resumo.notas.mrr_estimado.includes("PROJEÇÃO"));
    assert.ok(depois.resumo.notas.recebido_mes.includes("CAIXA"));
  });

  // -------------------------------------------------------------------------
  // Inadimplência
  // -------------------------------------------------------------------------

  await t.test("a soma com centavos bate exatamente (149.90 + 39.90 = 189.80)", async () => {
    // A prova de que o risco é real com ESTES valores: somar em ponto flutuante
    // os três em aberto da fixture dá 249.70000000000002. Por isso a soma
    // acontece no NUMERIC do Postgres, e nunca em JavaScript.
    assert.notEqual(149.9 + 39.9 + 59.9, 249.7);

    const { status, json } = await req(url("overdue", "&limit=200"), plt);
    assert.equal(status, 200, JSON.stringify(json));
    const linha = json.items.find((item) => item.tenant_id === inadimplente);
    assert.ok(linha, "a clínica com fatura vencida precisa estar na lista");
    assert.equal(linha.valor_devido, "189.80");
    assert.equal(linha.valor_devido_centavos, 18980);
    assert.equal(linha.faturas_vencidas, 2);
  });

  await t.test("ordena por dias de atraso e traz o contato de quem cobrar", async () => {
    const { json } = await req(url("overdue", "&limit=200"), plt);
    const linha = json.items.find((item) => item.tenant_id === inadimplente);
    // 20/02 -> 15/03 = 23 dias, contados da fatura MAIS ANTIGA em aberto.
    assert.equal(linha.dias_atraso, 23);
    assert.equal(linha.vencimento_mais_antigo, "2026-02-20");
    assert.ok(linha.clinica && linha.slug, "sem nome da clínica não dá para cobrar");
    assert.equal(linha.telefone, "11999990000");
    assert.ok(linha.link_fatura_mais_antiga.includes(MARCA));

    const dias = json.items.map((item) => item.dias_atraso);
    assert.deepEqual(dias, [...dias].sort((a, b) => b - a), "a lista abre pelo mais atrasado");
  });

  await t.test("clínica em trial, sem cobrança no gateway, não é inadimplente", async () => {
    const { json } = await req(url("overdue", "&limit=200"), plt);
    const trial = criadas.find((c) => c.slug.startsWith("fintrial"));
    assert.ok(!json.items.some((item) => item.tenant_id === trial.tenant.id));
  });

  await t.test("respeita o envelope de paginação da casa", async () => {
    const { json } = await req(url("overdue", "&limit=1&offset=0"), plt);
    assert.equal(json.items.length, 1);
    assert.equal(json.limit, 1);
    assert.equal(json.offset, 0);
    assert.ok(json.total >= 1);

    // Sem limit/offset o contrato é array puro (retrocompatibilidade).
    const puro = await req(url("overdue"), plt);
    assert.ok(Array.isArray(puro.json));
  });

  // -------------------------------------------------------------------------
  // Vencimentos próximos
  // -------------------------------------------------------------------------

  await t.test("mostra só o que vence na janela pedida", async () => {
    const meus = new Set(criadas.map((c) => c.tenant.id));

    const sete = await req(url("upcoming", "&dias=7&limit=200"), plt);
    assert.equal(sete.status, 200, JSON.stringify(sete.json));
    assert.equal(sete.json.dias, 7);
    const naJanela = sete.json.items.filter((item) => meus.has(item.tenant_id));
    assert.equal(naJanela.length, 1);
    assert.equal(naJanela[0].valor, "59.90");
    assert.equal(naJanela[0].valor_centavos, 5990);
    assert.equal(naJanela[0].vencimento, "2026-03-18");
    assert.equal(naJanela[0].dias_para_vencer, 3);

    // Janela maior alcança a fatura de 20/04.
    const quarentaCinco = await req(url("upcoming", "&dias=45&limit=200"), plt);
    const maior = quarentaCinco.json.items.filter((item) => meus.has(item.tenant_id));
    assert.equal(maior.length, 2);
  });

  await t.test("fatura já vencida não aparece nos vencimentos próximos", async () => {
    // Ela é assunto da lista de inadimplência; nas duas, seria dívida contada
    // em dobro.
    const { json } = await req(url("upcoming", "&dias=90&limit=200"), plt);
    assert.ok(!json.items.some((item) => item.tenant_id === inadimplente));
  });

  await t.test("a janela de dias é limitada", async () => {
    assert.equal((await req(url("upcoming", "&dias=999"), plt)).json.dias, 90);
    assert.equal((await req(url("upcoming", "&dias=0"), plt)).json.dias, 1);
    assert.equal((await req(url("upcoming", "&dias=abc"), plt)).json.dias, 7);
  });

  // -------------------------------------------------------------------------
  // Série temporal
  // -------------------------------------------------------------------------

  await t.test("a série tem um ponto por mês, inclusive mês vazio", async () => {
    assert.equal(depois.serie.items.length, 3);
    assert.deepEqual(
      depois.serie.items.map((ponto) => ponto.mes),
      ["2026-01", FEVEREIRO, MARCO]
    );
  });

  await t.test("cada pagamento cai no mês do fuso do painel", async () => {
    const ponto = (fonte, mes) => fonte.items.find((item) => item.mes === mes);
    const deltaMes = (mes, campo) => ponto(depois.serie, mes)[campo] - ponto(antes.serie, mes)[campo];

    // 99.90 + 10.00 (pago às 22h de 31/03 em SP, já 01/04 em UTC).
    assert.equal(deltaMes(MARCO, "recebido_centavos"), 10990);
    // 500.00 + 20.00 (pago às 23h de 28/02 em SP, já 01/03 em UTC).
    assert.equal(deltaMes(FEVEREIRO, "recebido_centavos"), 52000);
    assert.equal(deltaMes("2026-01", "recebido_centavos"), 0);

    // Emitido é por competência (mês do vencimento), não por pagamento.
    assert.equal(deltaMes(MARCO, "emitido_centavos"), 3990 + 9990 + 5990 + 1000);
    assert.equal(deltaMes(MARCO, "faturas_pagas"), 2);
  });

  // -------------------------------------------------------------------------
  // Receita por plano
  // -------------------------------------------------------------------------

  await t.test("cada plano mostra assinantes, MRR e caixa do mês", async () => {
    const plano = (fonte, codigo) => fonte.items.find((item) => item.plan_code === codigo);
    const deltaPlano = (codigo, campo) => plano(depois.planos, codigo)[campo] - plano(antes.planos, codigo)[campo];

    assert.equal(deltaPlano("profissional", "assinantes_ativos"), 1);
    assert.equal(deltaPlano("profissional", "mrr_estimado_centavos"), PRECO.profissional);
    assert.equal(deltaPlano("studio", "assinantes_ativos"), 1);
    assert.equal(deltaPlano("studio", "mrr_estimado_centavos"), PRECO.studio);
    assert.equal(deltaPlano("start", "mrr_estimado_centavos"), PRECO.start);
    // A cancelada compartilha o Profissional com uma ativa e, por isso,
    // não adiciona assinante ativo nem MRR além do valor já conferido acima.

    // Caixa do mês, por plano.
    assert.equal(deltaPlano("studio", "recebido_mes_centavos"), 9990);
    assert.equal(deltaPlano("start", "recebido_mes_centavos"), 1000);
    assert.equal(deltaPlano("profissional", "recebido_mes_centavos"), 0);
  });

  await t.test("plano sem assinante nenhum continua na lista, zerado", async () => {
    // É o dado que responde "este plano vende?" — some se a consulta partir das
    // assinaturas em vez dos planos.
    const codigos = depois.planos.items.map((item) => item.plan_code);
    for (const codigo of ["start", "profissional", "studio"]) {
      assert.ok(codigos.includes(codigo), `o plano ${codigo} precisa aparecer`);
    }
    const start = depois.planos.items.find((item) => item.plan_code === "start");
    assert.match(start.mrr_estimado, /^\d+\.\d{2}$/);
  });

  // -------------------------------------------------------------------------
  // Entradas inválidas e o caminho sem data base
  // -------------------------------------------------------------------------

  await t.test("recusa data base malformada ou inexistente no calendário", async () => {
    const malformada = await req("/platform/finance/summary?data_base=15/03/2026", plt);
    assert.equal(malformada.status, 400, JSON.stringify(malformada.json));
    assert.match(malformada.json.error, /AAAA-MM-DD/);

    // Casa com a regex e não existe: sem esta checagem viraria erro 500 do
    // Postgres, sem explicação nenhuma para quem está na tela.
    const inexistente = await req("/platform/finance/summary?data_base=2026-02-31", plt);
    assert.equal(inexistente.status, 400);
  });

  await t.test("sem data base, o painel responde pelo dia de hoje no fuso fixo", async () => {
    const { status, json } = await req("/platform/finance/summary", plt);
    assert.equal(status, 200, JSON.stringify(json));
    assert.match(json.data_base, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(json.competencia, json.data_base.slice(0, 7));
    assert.equal(json.fuso, "America/Sao_Paulo");
    // O MRR não depende de data: continua contando as três assinaturas ativas.
    assert.equal(json.mrr_estimado_centavos, depois.resumo.mrr_estimado_centavos);
  });
});
