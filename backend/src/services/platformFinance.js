// Painel financeiro da PLATAFORMA: a saúde da receita da Monitence.
//
// Esta camada só LÊ. Quem escreve fatura é `platformBilling.js` (checkout,
// webhook, syncInvoice) e a listagem bruta já existe em
// `GET /api/platform/invoices`. Aqui mora a pergunta que aquela lista não
// responde: quanto entrou, quanto falta entrar, quem está devendo e há quanto
// tempo. Nada daqui altera uma linha sequer.
//
// Três decisões atravessam o arquivo inteiro:
//
// 1. DINHEIRO NÃO PASSA POR PONTO FLUTUANTE.
//    `tenant_invoices.amount` é NUMERIC(12,2) e toda soma acontece no Postgres
//    (SUM), nunca em JavaScript — `0.1 + 0.2` dá 0.30000000000000004, e num
//    painel de cobrança isso vira divergência de centavos com o extrato do
//    Asaas. Cada valor sai em DOIS formatos:
//      `<campo>`           string decimal em reais, ex. "189.80" (o NUMERIC
//                          convertido para texto pelo driver, sem arredondar);
//      `<campo>_centavos`  inteiro, para o frontend somar/comparar sem parsear
//                          vírgula (cabe folgado em Number: 2^53 centavos são
//                          ~90 trilhões de reais).
//    O projeto tem a dívida conhecida de dinheiro em DOUBLE PRECISION nos
//    schemas de clínica (pendência 13); nada aqui a amplia.
//
// 2. UM FUSO SÓ, EXPLÍCITO: America/Sao_Paulo.
//    "Hoje", "este mês" e "vencido" são recortes de CALENDÁRIO, e calendário
//    depende de onde se está. O servidor pode rodar em UTC, o Asaas trabalha com
//    datas brasileiras e `due_date` é DATE (sem fuso nenhum). Sem fixar a
//    convenção, às 21h de 31/03 em São Paulo o mês já teria virado em UTC e o
//    fechamento mudaria de resposta conforme a máquina. Toda fronteira de data é
//    calculada NO SQL a partir de `FUSO_FINANCEIRO`, jamais com o relógio do
//    Node — é isso que torna o número reproduzível em qualquer servidor.
//
// 3. FATO E ESTIMATIVA TÊM NOMES DIFERENTES.
//    `recebido_mes` é caixa: fatura com status 'paga'. `mrr_estimado` é
//    projeção: o preço do plano das assinaturas ativas, dinheiro que ainda NÃO
//    entrou. Um campo só com os dois é como se fecha um mês com número que não
//    bate com o banco.
import { query } from "../database/connection.js";

export class PlatformFinanceError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "PlatformFinanceError";
    this.statusCode = statusCode;
  }
}

// O fuso de TODO o painel. Trocar esta constante muda o significado de "hoje",
// "este mês" e "vencido" em todas as consultas de uma vez — que é exatamente o
// motivo de ela existir em vez de cada query escolher a sua.
export const FUSO_FINANCEIRO = "America/Sao_Paulo";

// Faturas que representam dinheiro vivo ou promessa de dinheiro.
// 'cancelada' e 'estornada' ficam de fora de qualquer soma: a primeira nunca
// virou receita e a segunda VOLTOU para a clínica — contá-la como recebida
// inflaria o caixa com dinheiro que não está mais na conta.
const STATUS_VALEM_DINHEIRO = ["pendente", "atrasada", "paga"];

// Janela de datas comum a todas as consultas.
//
// Fica em SQL, e não em JS, porque o Node não sabe (sem biblioteca) qual é a
// meia-noite de São Paulo — e é justamente a meia-noite que separa "vence hoje"
// de "vencido". `$1` é a data base opcional; `$2` é o fuso. Toda consulta deste
// arquivo que use a janela recebe esses dois parâmetros nessa ordem, e os
// próprios parâmetros começam em `$3`.
const JANELA = `
  base AS (
    SELECT COALESCE($1::date, (now() AT TIME ZONE $2::text)::date) AS hoje
  ),
  janela AS (
    SELECT
      b.hoje,
      date_trunc('month', b.hoje)::date AS mes_inicio,
      (date_trunc('month', b.hoje) + INTERVAL '1 month' - INTERVAL '1 day')::date AS mes_fim,
      -- Fronteiras do mês como TIMESTAMPTZ, para comparar com paid_at (que é
      -- timestamptz) sem converter a coluna linha a linha.
      (date_trunc('month', b.hoje)::timestamp AT TIME ZONE $2::text) AS mes_inicio_ts,
      ((date_trunc('month', b.hoje) + INTERVAL '1 month')::timestamp AT TIME ZONE $2::text) AS mes_fim_ts
    FROM base b
  )`;

// Data base opcional ("me mostre o painel como ele estava em 31/03").
//
// Sem ela o painel só sabe falar do instante presente, e QUALQUER teste ou
// conferência de fechamento passaria a depender do dia em que roda. Validada
// aqui, com round-trip, porque `2026-02-31` casa com a regex e faz o Postgres
// devolver um erro 22008 que viraria 500 sem explicação.
function resolveDataBase(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === "") return null;
  const texto = String(valor).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    throw new PlatformFinanceError("Data base inválida. Use o formato AAAA-MM-DD.");
  }
  const data = new Date(`${texto}T00:00:00Z`);
  if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== texto) {
    throw new PlatformFinanceError(`Data base inexistente no calendário: ${texto}.`);
  }
  return texto;
}

// Recorte numérico da tela (dias, meses). Clampa em vez de recusar: o painel
// manda o que o usuário digitou no seletor, e devolver 400 para "0 dias"
// deixaria a tela vazia sem dizer por quê. O valor efetivamente aplicado volta
// na resposta, então nada fica implícito.
function inteiroNaFaixa(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.min(Math.max(Math.trunc(numero), minimo), maximo);
}

// Centavos chegam do Postgres como string (o driver serializa BIGINT assim, para
// não perder precisão em 64 bits). Aqui a conversão é segura: é inteiro, e
// inteiro abaixo de 2^53 tem representação exata em Number.
function centavos(valor) {
  return Number(valor ?? 0);
}

function paginacao({ limit = 50, offset = 0 } = {}) {
  return {
    limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
    offset: Math.max(Number(offset) || 0, 0)
  };
}

// ---------------------------------------------------------------------------
// 1. Resumo
// ---------------------------------------------------------------------------

// Uma passada por `tenant_invoices` classificando cada fatura, e só então as
// somas. Classificar antes deixa o critério legível — e o critério é a parte
// que dá briga na reunião de fechamento.
const SQL_RESUMO_FATURAS = `
  WITH ${JANELA},
  classificadas AS (
    SELECT
      i.amount,
      i.tenant_id,
      -- CAIXA: entrou no mês. Recorte por paid_at, não por vencimento — é
      -- o dinheiro que bateu na conta dentro do mês de referência.
      (i.status = 'paga' AND i.paid_at >= j.mes_inicio_ts AND i.paid_at < j.mes_fim_ts) AS recebida_no_mes,
      -- AINDA VAI VENCER neste mês: de hoje (inclusive) até o último dia.
      (i.status IN ('pendente', 'atrasada') AND i.due_date >= j.hoje AND i.due_date <= j.mes_fim) AS a_receber_no_mes,
      -- VENCIDO por FATO (due_date < hoje), e não por status = 'atrasada'.
      --
      -- O status 'atrasada' só é gravado quando o webhook OVERDUE do Asaas
      -- chega; webhook atrasa e webhook se perde. Uma fatura 'pendente' com
      -- vencimento na semana passada está vencida no mundo real, e o painel de
      -- inadimplência é exatamente onde essa divergência precisa aparecer — não
      -- desaparecer.
      (i.status IN ('pendente', 'atrasada') AND i.due_date IS NOT NULL AND i.due_date < j.hoje) AS vencida
    FROM platform.tenant_invoices i
    CROSS JOIN janela j
    WHERE i.status = ANY($3::text[])
  )
  SELECT
    to_char((SELECT hoje FROM janela), 'YYYY-MM-DD') AS data_base,
    to_char((SELECT hoje FROM janela), 'YYYY-MM') AS competencia,
    COALESCE(SUM(amount) FILTER (WHERE recebida_no_mes), 0)::numeric(14,2) AS recebido_mes,
    (COALESCE(SUM(amount) FILTER (WHERE recebida_no_mes), 0) * 100)::bigint AS recebido_mes_centavos,
    COUNT(*) FILTER (WHERE recebida_no_mes)::int AS recebido_mes_faturas,
    COALESCE(SUM(amount) FILTER (WHERE a_receber_no_mes), 0)::numeric(14,2) AS a_receber_mes,
    (COALESCE(SUM(amount) FILTER (WHERE a_receber_no_mes), 0) * 100)::bigint AS a_receber_mes_centavos,
    COUNT(*) FILTER (WHERE a_receber_no_mes)::int AS a_receber_mes_faturas,
    COALESCE(SUM(amount) FILTER (WHERE vencida), 0)::numeric(14,2) AS vencido,
    (COALESCE(SUM(amount) FILTER (WHERE vencida), 0) * 100)::bigint AS vencido_centavos,
    COUNT(*) FILTER (WHERE vencida)::int AS vencido_faturas,
    COUNT(DISTINCT tenant_id) FILTER (WHERE vencida)::int AS vencido_clinicas
  FROM classificadas`;

// Assinaturas: contagem por status e o MRR.
//
// Sem janela de data de propósito — status de assinatura é sempre "agora", não
// existe histórico para reconstruir o passado (ver a nota de churn lá embaixo).
const SQL_RESUMO_ASSINATURAS = `
  WITH assinaturas AS (
    SELECT
      s.status,
      -- Assinatura sem asaas_subscription_id é clínica que NUNCA passou pelo
      -- checkout: está no trial e não existe recorrência no gateway. Ela não
      -- gera receita recorrente e por isso não pode entrar no MRR — contá-la
      -- transformaria trial em faturamento projetado.
      (s.asaas_subscription_id IS NOT NULL) AS cobranca_no_gateway,
      COALESCE(p.price_cents, 0) AS price_cents
    FROM platform.tenant_subscriptions s
    LEFT JOIN platform.subscription_plans p ON p.code = s.plan_code
  )
  SELECT
    COUNT(*) FILTER (WHERE status = 'trial_active')::int AS trial,
    COUNT(*) FILTER (WHERE status = 'trial_expired')::int AS trial_expirada,
    COUNT(*) FILTER (WHERE status = 'active')::int AS ativa,
    COUNT(*) FILTER (WHERE status = 'overdue')::int AS atrasada,
    COUNT(*) FILTER (WHERE status = 'canceled')::int AS cancelada,
    COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspensa,
    COUNT(*) FILTER (WHERE NOT cobranca_no_gateway)::int AS sem_cobranca_no_gateway,
    (SELECT COUNT(*)::int FROM platform.tenants t
      WHERE NOT EXISTS (SELECT 1 FROM platform.tenant_subscriptions s2 WHERE s2.tenant_id = t.id)
    ) AS sem_assinatura,
    COALESCE(SUM(price_cents) FILTER (WHERE status = 'active' AND cobranca_no_gateway), 0)::bigint
      AS mrr_estimado_centavos,
    (COALESCE(SUM(price_cents) FILTER (WHERE status = 'active' AND cobranca_no_gateway), 0)::numeric / 100)::numeric(14,2)
      AS mrr_estimado,
    -- Mesma conta, só que para quem está com pagamento em atraso: é o pedaço do
    -- MRR que some se a cobrança não for resolvida.
    COALESCE(SUM(price_cents) FILTER (WHERE status = 'overdue' AND cobranca_no_gateway), 0)::bigint
      AS mrr_em_risco_centavos,
    (COALESCE(SUM(price_cents) FILTER (WHERE status = 'overdue' AND cobranca_no_gateway), 0)::numeric / 100)::numeric(14,2)
      AS mrr_em_risco
  FROM assinaturas`;

// Movimento do mês: entradas e saídas de assinantes.
const SQL_RESUMO_MOVIMENTO = `
  WITH ${JANELA},
  primeira_paga AS (
    -- "Assinatura nova" medida pela PRIMEIRA fatura paga da clínica.
    --
    -- É o único marco que existe como fato: tenant_subscriptions.created_at é
    -- o começo do TRIAL (nasce no cadastro, sem cartão nenhum) e updated_at é
    -- tocado por qualquer webhook. Contar created_at chamaria de "assinatura
    -- nova" quem só abriu uma conta grátis.
    SELECT i.tenant_id, MIN(i.paid_at) AS em
      FROM platform.tenant_invoices i
     WHERE i.status = 'paga' AND i.paid_at IS NOT NULL
     GROUP BY i.tenant_id
  )
  SELECT
    (SELECT COUNT(*)::int FROM primeira_paga p, janela j
      WHERE p.em >= j.mes_inicio_ts AND p.em < j.mes_fim_ts) AS assinaturas_novas_mes,
    (SELECT COUNT(*)::int FROM platform.tenant_subscriptions s, janela j
      WHERE s.canceled_at >= j.mes_inicio_ts AND s.canceled_at < j.mes_fim_ts) AS cancelamentos_mes`;

// Por que `churn_mes` volta NULL, e não um número.
//
// Churn honesto é (cancelamentos do mês / base de assinantes no INÍCIO do mês).
// O divisor não existe: `tenant_subscriptions` guarda uma linha por clínica com
// o status ATUAL e nenhum histórico — não há tabela de eventos de assinatura.
// Reconstruir a base de 1º do mês só seria possível assumindo que todo mundo que
// hoje está ativo já estava lá, o que é falso justamente nos meses em que houve
// crescimento (o divisor sairia inflado e o churn, artificialmente baixo).
//
// Pior: o numerador também é frágil. Hoje NENHUM caminho do código grava
// `canceled_at` (o checkout só o zera), então `cancelamentos_mes` fica em zero
// enquanto o fluxo de cancelamento não passar a carimbá-lo — e um churn de 0,0%
// impresso num painel é mais perigoso que um "não sei calcular".
//
// Para virar número, falta uma destas duas coisas:
//   a) o cancelamento gravar `canceled_at` (e o status 'canceled'); e
//   b) um log de mudanças de status de assinatura (data, de, para), que permita
//      contar a base em qualquer data passada.
const NOTAS_RESUMO = {
  mrr_estimado:
    "PROJEÇÃO, não caixa: soma do preço de tabela do plano das assinaturas com status 'active' e recorrência criada no gateway. Clínica em trial (sem asaas_subscription_id) não entra. Desconto, cortesia ou preço legado não são refletidos — o plano é a única fonte de preço que existe hoje.",
  recebido_mes:
    "CAIXA: faturas com status 'paga' cujo pagamento (paid_at) caiu dentro do mês de referência, no fuso do painel. Fatura estornada não conta.",
  vencido:
    "Fatura em aberto ('pendente' ou 'atrasada') com vencimento ANTERIOR à data base. O critério é a data, não o status: o status só vira 'atrasada' quando o webhook OVERDUE chega, e webhook atrasa.",
  assinaturas_novas_mes:
    "Clínicas cuja PRIMEIRA fatura paga da história caiu neste mês. É a conversão de trial em pagante; não conta quem apenas criou conta grátis.",
  cancelamentos_mes:
    "Assinaturas com canceled_at dentro do mês. Atenção: hoje nenhum fluxo do sistema grava canceled_at, então este número fica em zero até o cancelamento passar a carimbá-lo.",
  churn_mes:
    "Não calculável com os dados de hoje. Falta o histórico de status das assinaturas (não existe log de mudanças), então a base de assinantes no início do mês não é reconstruível; e o numerador depende de canceled_at, que nenhum fluxo preenche. Um número aqui seria inventado."
};

/**
 * Os números que abrem a tela: MRR, caixa do mês, vencido e o retrato das
 * clínicas por status de assinatura.
 *
 * @param {{ dataBase?: string }} [opcoes]
 */
export async function resumoFinanceiro({ dataBase } = {}) {
  const base = resolveDataBase(dataBase);

  const [faturas, assinaturas, movimento] = await Promise.all([
    query(SQL_RESUMO_FATURAS, [base, FUSO_FINANCEIRO, STATUS_VALEM_DINHEIRO]),
    query(SQL_RESUMO_ASSINATURAS),
    query(SQL_RESUMO_MOVIMENTO, [base, FUSO_FINANCEIRO])
  ]);

  const f = faturas.rows[0];
  const a = assinaturas.rows[0];
  const m = movimento.rows[0];

  return {
    // A data base volta do BANCO (e como texto), não do relógio do Node: é ela
    // que explica todo o resto da resposta, e precisa ser a mesma que o SQL usou.
    data_base: f.data_base,
    competencia: f.competencia,
    fuso: FUSO_FINANCEIRO,

    mrr_estimado: a.mrr_estimado,
    mrr_estimado_centavos: centavos(a.mrr_estimado_centavos),
    mrr_em_risco: a.mrr_em_risco,
    mrr_em_risco_centavos: centavos(a.mrr_em_risco_centavos),

    recebido_mes: f.recebido_mes,
    recebido_mes_centavos: centavos(f.recebido_mes_centavos),
    recebido_mes_faturas: f.recebido_mes_faturas,

    a_receber_mes: f.a_receber_mes,
    a_receber_mes_centavos: centavos(f.a_receber_mes_centavos),
    a_receber_mes_faturas: f.a_receber_mes_faturas,

    vencido: f.vencido,
    vencido_centavos: centavos(f.vencido_centavos),
    vencido_faturas: f.vencido_faturas,
    vencido_clinicas: f.vencido_clinicas,

    clinicas: {
      trial: a.trial,
      trial_expirada: a.trial_expirada,
      ativa: a.ativa,
      atrasada: a.atrasada,
      cancelada: a.cancelada,
      suspensa: a.suspensa,
      // Clínica sem linha de assinatura nenhuma (cadastro anterior ao módulo de
      // planos). Aparece separada para não ser confundida com trial.
      sem_assinatura: a.sem_assinatura,
      sem_cobranca_no_gateway: a.sem_cobranca_no_gateway
    },

    assinaturas_novas_mes: m.assinaturas_novas_mes,
    cancelamentos_mes: m.cancelamentos_mes,
    // Ver o bloco de comentário acima de NOTAS_RESUMO: null é a resposta honesta.
    churn_mes: null,
    notas: NOTAS_RESUMO
  };
}

// ---------------------------------------------------------------------------
// 2. Inadimplência — a lista de quem cobrar
// ---------------------------------------------------------------------------

// Agrupada por CLÍNICA, não por fatura: quem vai cobrar liga uma vez para o
// estúdio, não uma vez por boleto.
//
// A lista nasce das FATURAS, e é assim que a regra "clínica em trial não é
// inadimplente" se cumpre sozinha: sem checkout não existe cobrança no gateway,
// sem cobrança não existe fatura, e sem fatura a clínica não tem como aparecer
// aqui. O status da assinatura vem junto (`assinatura_status`) para o operador
// ver o contexto, mas não é ele que define a dívida — a dívida é a fatura.
const SQL_INADIMPLENCIA = `
  WITH ${JANELA},
  abertas AS (
    SELECT
      i.tenant_id,
      SUM(i.amount) AS devido,
      COUNT(*) AS faturas,
      MIN(i.due_date) AS mais_antiga
    FROM platform.tenant_invoices i
    CROSS JOIN janela j
    WHERE i.status = ANY($3::text[])
      AND i.due_date IS NOT NULL
      AND i.due_date < j.hoje
    GROUP BY i.tenant_id
  )
  SELECT
    a.tenant_id,
    t.name AS clinica,
    t.slug,
    t.responsible_name AS responsavel,
    t.phone AS telefone,
    t.email,
    s.plan_code,
    s.status AS assinatura_status,
    (s.asaas_subscription_id IS NOT NULL) AS cobranca_no_gateway,
    a.devido::numeric(14,2) AS valor_devido,
    (a.devido * 100)::bigint AS valor_devido_centavos,
    a.faturas::int AS faturas_vencidas,
    -- Diferença entre DATEs: inteiro de dias, sem hora e sem fuso no meio.
    (j.hoje - a.mais_antiga)::int AS dias_atraso,
    to_char(a.mais_antiga, 'YYYY-MM-DD') AS vencimento_mais_antigo,
    (
      SELECT i2.invoice_url
        FROM platform.tenant_invoices i2
       WHERE i2.tenant_id = a.tenant_id
         AND i2.status = ANY($3::text[])
         AND i2.due_date < j.hoje
       ORDER BY i2.due_date, i2.id
       LIMIT 1
    ) AS link_fatura_mais_antiga
  FROM abertas a
  JOIN platform.tenants t ON t.id = a.tenant_id
  LEFT JOIN platform.tenant_subscriptions s ON s.tenant_id = a.tenant_id
  CROSS JOIN janela j
  ORDER BY dias_atraso DESC, valor_devido DESC, a.tenant_id
  LIMIT $4 OFFSET $5`;

const SQL_INADIMPLENCIA_TOTAL = `
  WITH ${JANELA}
  SELECT COUNT(DISTINCT i.tenant_id)::int AS total
    FROM platform.tenant_invoices i
    CROSS JOIN janela j
   WHERE i.status = ANY($3::text[])
     AND i.due_date IS NOT NULL
     AND i.due_date < j.hoje`;

// Só faturas em aberto contam como dívida.
const STATUS_EM_ABERTO = ["pendente", "atrasada"];

/**
 * Clínicas com fatura vencida, da mais atrasada para a menos.
 *
 * @param {{ dataBase?: string, limit?: number, offset?: number }} [opcoes]
 */
export async function listarInadimplencia({ dataBase, limit, offset } = {}) {
  const base = resolveDataBase(dataBase);
  const page = paginacao({ limit, offset });

  const [linhas, contagem] = await Promise.all([
    query(SQL_INADIMPLENCIA, [base, FUSO_FINANCEIRO, STATUS_EM_ABERTO, page.limit, page.offset]),
    query(SQL_INADIMPLENCIA_TOTAL, [base, FUSO_FINANCEIRO, STATUS_EM_ABERTO])
  ]);

  return {
    items: linhas.rows.map((row) => ({
      ...row,
      valor_devido_centavos: centavos(row.valor_devido_centavos)
    })),
    total: contagem.rows[0]?.total || 0,
    limit: page.limit,
    offset: page.offset
  };
}

// ---------------------------------------------------------------------------
// 3. Vencimentos próximos
// ---------------------------------------------------------------------------

// Por FATURA (e não por clínica): aqui o objetivo é conferir o que está para
// entrar, fatura a fatura. Só 'pendente' — o que já venceu é assunto da lista de
// inadimplência, e misturar as duas faria a mesma dívida ser contada duas vezes
// em telas diferentes.
const SQL_VENCIMENTOS = `
  WITH ${JANELA}
  SELECT
    i.id,
    i.tenant_id,
    t.name AS clinica,
    t.slug,
    t.phone AS telefone,
    t.email,
    i.plan_code,
    i.amount::numeric(14,2) AS valor,
    (i.amount * 100)::bigint AS valor_centavos,
    to_char(i.due_date, 'YYYY-MM-DD') AS vencimento,
    (i.due_date - j.hoje)::int AS dias_para_vencer,
    i.billing_type,
    i.invoice_url,
    i.asaas_payment_id
  FROM platform.tenant_invoices i
  JOIN platform.tenants t ON t.id = i.tenant_id
  CROSS JOIN janela j
  WHERE i.status = 'pendente'
    AND i.due_date IS NOT NULL
    AND i.due_date >= j.hoje
    AND i.due_date <= j.hoje + $3::int
  ORDER BY i.due_date, i.id
  LIMIT $4 OFFSET $5`;

const SQL_VENCIMENTOS_RESUMO = `
  WITH ${JANELA}
  SELECT
    COUNT(*)::int AS total,
    COALESCE(SUM(i.amount), 0)::numeric(14,2) AS valor_total,
    (COALESCE(SUM(i.amount), 0) * 100)::bigint AS valor_total_centavos
  FROM platform.tenant_invoices i
  CROSS JOIN janela j
  WHERE i.status = 'pendente'
    AND i.due_date IS NOT NULL
    AND i.due_date >= j.hoje
    AND i.due_date <= j.hoje + $3::int`;

/**
 * O que vence nos próximos N dias (inclusive hoje).
 *
 * @param {{ dataBase?: string, dias?: number, limit?: number, offset?: number }} [opcoes]
 */
export async function listarVencimentosProximos({ dataBase, dias, limit, offset } = {}) {
  const base = resolveDataBase(dataBase);
  // Teto de 90 dias: além disso a fatura nem existe ainda (o Asaas gera a
  // cobrança do ciclo seguinte perto do vencimento), então a lista daria a falsa
  // impressão de que o trimestre inteiro já está faturado.
  const janelaDias = inteiroNaFaixa(dias, 7, 1, 90);
  const page = paginacao({ limit, offset });

  const [linhas, resumo] = await Promise.all([
    query(SQL_VENCIMENTOS, [base, FUSO_FINANCEIRO, janelaDias, page.limit, page.offset]),
    query(SQL_VENCIMENTOS_RESUMO, [base, FUSO_FINANCEIRO, janelaDias])
  ]);

  const agregado = resumo.rows[0];
  return {
    items: linhas.rows.map((row) => ({ ...row, valor_centavos: centavos(row.valor_centavos) })),
    total: agregado?.total || 0,
    limit: page.limit,
    offset: page.offset,
    dias: janelaDias,
    valor_total: agregado?.valor_total ?? "0.00",
    valor_total_centavos: centavos(agregado?.valor_total_centavos)
  };
}

// ---------------------------------------------------------------------------
// 4. Série temporal (o gráfico)
// ---------------------------------------------------------------------------

// `generate_series` de meses é o que garante mês vazio no gráfico: sem ele, um
// mês sem nenhuma fatura simplesmente não viria, e a linha do gráfico saltaria
// de fevereiro para abril como se março não tivesse existido.
const SQL_SERIE = `
  WITH ${JANELA},
  meses AS (
    SELECT generate_series(
      date_trunc('month', j.hoje) - (($3::int - 1) * INTERVAL '1 month'),
      date_trunc('month', j.hoje),
      INTERVAL '1 month'
    )::date AS mes_inicio
    FROM janela j
  ),
  limite AS (
    SELECT
      MIN(mes_inicio) AS desde,
      (MIN(mes_inicio)::timestamp AT TIME ZONE $2::text) AS desde_ts
    FROM meses
  ),
  recebido AS (
    -- Agrupa pelo mês do PAGAMENTO convertido para o fuso do painel: uma fatura
    -- paga às 22h de 31/03 em São Paulo é 01/04 em UTC, e cairia no mês errado
    -- se a conversão não acontecesse aqui.
    SELECT
      date_trunc('month', (i.paid_at AT TIME ZONE $2::text))::date AS mes,
      SUM(i.amount) AS valor,
      COUNT(*) AS faturas
    FROM platform.tenant_invoices i, limite l
    WHERE i.status = 'paga' AND i.paid_at IS NOT NULL AND i.paid_at >= l.desde_ts
    GROUP BY 1
  ),
  emitido AS (
    -- Competência: o mês a que a cobrança se refere. competencia é gravada
    -- pelo upsert a partir do vencimento; o COALESCE cobre fatura antiga que
    -- tenha ficado sem ela.
    SELECT
      date_trunc('month', COALESCE(i.competencia, i.due_date))::date AS mes,
      SUM(i.amount) AS valor,
      COUNT(*) AS faturas
    FROM platform.tenant_invoices i, limite l
    WHERE i.status = ANY($4::text[])
      AND COALESCE(i.competencia, i.due_date) IS NOT NULL
      AND COALESCE(i.competencia, i.due_date) >= l.desde
    GROUP BY 1
  )
  SELECT
    to_char(m.mes_inicio, 'YYYY-MM') AS mes,
    COALESCE(r.valor, 0)::numeric(14,2) AS recebido,
    (COALESCE(r.valor, 0) * 100)::bigint AS recebido_centavos,
    COALESCE(r.faturas, 0)::int AS faturas_pagas,
    COALESCE(e.valor, 0)::numeric(14,2) AS emitido,
    (COALESCE(e.valor, 0) * 100)::bigint AS emitido_centavos,
    COALESCE(e.faturas, 0)::int AS faturas_emitidas
  FROM meses m
  LEFT JOIN recebido r ON r.mes = m.mes_inicio
  LEFT JOIN emitido e ON e.mes = m.mes_inicio
  ORDER BY m.mes_inicio`;

/**
 * Receita mês a mês nos últimos N meses (o mês da data base é o último).
 *
 * @param {{ dataBase?: string, meses?: number }} [opcoes]
 */
export async function serieMensal({ dataBase, meses } = {}) {
  const base = resolveDataBase(dataBase);
  const quantidade = inteiroNaFaixa(meses, 12, 1, 36);

  const result = await query(SQL_SERIE, [base, FUSO_FINANCEIRO, quantidade, STATUS_VALEM_DINHEIRO]);
  return {
    fuso: FUSO_FINANCEIRO,
    meses: quantidade,
    items: result.rows.map((row) => ({
      ...row,
      recebido_centavos: centavos(row.recebido_centavos),
      emitido_centavos: centavos(row.emitido_centavos)
    }))
  };
}

// ---------------------------------------------------------------------------
// 5. Receita por plano
// ---------------------------------------------------------------------------

// Parte de `subscription_plans` (e não das assinaturas) para que plano sem
// nenhum assinante apareça com zero: é o dado que responde "este plano vende?".
//
// `participacao_mrr` é percentual, não dinheiro — pode ser float sem risco. Ainda
// assim é calculado no SQL, sobre os centavos inteiros, para não haver duas
// aritméticas diferentes no mesmo endpoint.
const SQL_POR_PLANO = `
  WITH ${JANELA},
  assinantes AS (
    SELECT
      s.plan_code,
      COUNT(*) FILTER (WHERE s.status = 'active' AND s.asaas_subscription_id IS NOT NULL)::int AS ativos,
      COUNT(*) FILTER (WHERE s.status = 'overdue')::int AS atrasados,
      COUNT(*) FILTER (WHERE s.status IN ('trial_active', 'trial_expired'))::int AS em_trial,
      COALESCE(SUM(p.price_cents) FILTER (WHERE s.status = 'active' AND s.asaas_subscription_id IS NOT NULL), 0)::bigint
        AS mrr_centavos
    FROM platform.tenant_subscriptions s
    LEFT JOIN platform.subscription_plans p ON p.code = s.plan_code
    GROUP BY s.plan_code
  ),
  recebido AS (
    SELECT i.plan_code, SUM(i.amount) AS valor, COUNT(*) AS faturas
      FROM platform.tenant_invoices i
      CROSS JOIN janela j
     WHERE i.status = 'paga' AND i.paid_at >= j.mes_inicio_ts AND i.paid_at < j.mes_fim_ts
     GROUP BY i.plan_code
  )
  SELECT
    pl.code AS plan_code,
    pl.name AS plano,
    pl.is_active AS plano_ativo,
    pl.price_cents::int AS preco_centavos,
    (pl.price_cents::numeric / 100)::numeric(14,2) AS preco,
    COALESCE(a.ativos, 0) AS assinantes_ativos,
    COALESCE(a.atrasados, 0) AS assinantes_atrasados,
    COALESCE(a.em_trial, 0) AS assinantes_em_trial,
    COALESCE(a.mrr_centavos, 0)::bigint AS mrr_estimado_centavos,
    (COALESCE(a.mrr_centavos, 0)::numeric / 100)::numeric(14,2) AS mrr_estimado,
    ROUND(
      100 * COALESCE(a.mrr_centavos, 0)::numeric
        / NULLIF(SUM(COALESCE(a.mrr_centavos, 0)) OVER (), 0),
      1
    ) AS participacao_mrr,
    COALESCE(r.valor, 0)::numeric(14,2) AS recebido_mes,
    (COALESCE(r.valor, 0) * 100)::bigint AS recebido_mes_centavos,
    COALESCE(r.faturas, 0)::int AS recebido_mes_faturas
  FROM platform.subscription_plans pl
  LEFT JOIN assinantes a ON a.plan_code = pl.code
  LEFT JOIN recebido r ON r.plan_code = pl.code
  ORDER BY mrr_estimado_centavos DESC, pl.sort_order, pl.price_cents`;

/**
 * Quanto cada plano representa: assinantes, MRR estimado e caixa do mês.
 *
 * @param {{ dataBase?: string }} [opcoes]
 */
export async function receitaPorPlano({ dataBase } = {}) {
  const base = resolveDataBase(dataBase);
  const result = await query(SQL_POR_PLANO, [base, FUSO_FINANCEIRO]);

  return {
    fuso: FUSO_FINANCEIRO,
    items: result.rows.map((row) => ({
      ...row,
      mrr_estimado_centavos: centavos(row.mrr_estimado_centavos),
      recebido_mes_centavos: centavos(row.recebido_mes_centavos),
      // Percentual: número mesmo, para o gráfico não ter de parsear string.
      participacao_mrr: row.participacao_mrr === null ? null : Number(row.participacao_mrr)
    }))
  };
}
