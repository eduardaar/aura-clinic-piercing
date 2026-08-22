// CRUD de planos do painel de plataforma (o super-admin editando a grade de
// preços, features e limites).
//
// Fica separado de `plans.js` de propósito: lá é o LADO DA LEITURA, síncrono e
// importado por meia dúzia de arquivos no caminho quente do gating; aqui é o
// lado da ESCRITA, que fala com o banco e com o Asaas. Misturar os dois faria
// todo módulo que só quer saber "esta clínica tem `online_booking`?" arrastar
// junto o cliente do gateway.
//
// Três coisas guiam o arquivo inteiro:
//
//  1. UM PLANO RUIM DERRUBA CLÍNICA PAGANTE. Feature inexistente não protege
//     rota nenhuma, limite digitado errado trava o expediente e código fora do
//     padrão quebra a FK de `tenant_subscriptions`. Por isso a validação é
//     estrita e recusa o desconhecido em vez de ignorá-lo em silêncio — o
//     super-admin precisa saber que a caixinha que ele marcou não existe.
//  2. PREÇO É DINHEIRO DE VERDADE. Mudar `price_cents` recobra todo mundo que
//     assina o plano, então a mudança exige confirmação explícita e a
//     propagação para o gateway é relatada clínica a clínica.
//  3. O REGISTRO EM MEMÓRIA PRECISA SER RECARREGADO. `planByCode()` responde a
//     partir do registro carregado no boot; sem `loadPlansFromDb()` ao fim de
//     cada escrita, o gating continuaria servindo o plano antigo até o próximo
//     restart — e a edição pareceria não ter funcionado.
import { pool, query } from "../database/connection.js";
import { isPlatformEnabled, platformClient } from "./asaas/credentials.js";
import {
  FEATURE_CATALOG,
  FEATURE_KEYS,
  LIMIT_CATALOG,
  LIMIT_KEYS,
  loadPlansFromDb,
  normalizeFeatureKey,
  normalizeFeatureList
} from "./plans.js";

// Erro de regra de negócio desta camada, com o status HTTP já decidido aqui —
// a rota não deveria ter de adivinhar se "plano com assinante" é 400 ou 409.
// `details` vai junto no corpo da resposta: no caso da confirmação de preço, a
// tela precisa dos números (quantas clínicas, preço de/para) para montar o
// diálogo de confirmação sem uma segunda requisição.
export class PlanAdminError extends Error {
  constructor(message, statusCode = 400, { code = null, details = null } = {}) {
    super(message);
    this.name = "PlanAdminError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

// Colunas devolvidas ao painel. Explícitas em vez de `SELECT *` para uma coluna
// nova no schema não vazar para a API sem alguém ter decidido isso.
const PLAN_COLUMNS = `code, name, price_cents, audience, description, trial_days,
                      features, limits, is_recommended, is_active, badge, sort_order,
                      created_at, updated_at`;

// Identidade do plano. Precisa ser estável e sem surpresa porque vira valor de
// `plan_code` em `tenant_subscriptions` (FK), chave de URL e nome em log.
const CODE_RE = /^[a-z][a-z0-9_-]{1,29}$/;

const MAX_TRIAL_DAYS = 90;

// ---------------------------------------------------------------------------
// Normalização e validação da entrada
// ---------------------------------------------------------------------------

function textoOpcional(valor, campo, max = 240) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== "string") throw new PlanAdminError(`O campo "${campo}" deve ser texto.`);
  const limpo = valor.trim();
  if (limpo.length > max) {
    throw new PlanAdminError(`O campo "${campo}" passa de ${max} caracteres.`);
  }
  return limpo;
}

function normalizarCodigo(valor) {
  const codigo = String(valor ?? "").trim().toLowerCase();
  if (!CODE_RE.test(codigo)) {
    throw new PlanAdminError(
      "Código inválido. Use de 2 a 30 caracteres, começando por letra minúscula, " +
        'apenas letras, números, "-" e "_" (ex.: "studio_plus").',
      400,
      { code: "codigo_invalido" }
    );
  }
  return codigo;
}

function normalizarNome(valor) {
  const nome = String(valor ?? "").trim();
  if (!nome) throw new PlanAdminError("Informe o nome do plano.");
  if (nome.length > 80) throw new PlanAdminError("O nome do plano passa de 80 caracteres.");
  return nome;
}

// Centavos, sempre inteiro. Aceitar "69.90" aqui seria o caminho mais curto
// para cobrar R$ 0,69 de todo mundo: o campo é centavos, e o arredondamento
// silencioso esconderia o erro de unidade em vez de apontá-lo.
function normalizarPreco(valor) {
  if (valor === "" || valor === null || valor === undefined) {
    throw new PlanAdminError("Informe o preço do plano em centavos (price_cents).");
  }
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0) {
    throw new PlanAdminError(
      "O preço deve ser um número inteiro de centavos maior ou igual a zero (ex.: 6990 = R$ 69,90).",
      400,
      { code: "preco_invalido" }
    );
  }
  return numero;
}

function normalizarTrialDays(valor) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0 || numero > MAX_TRIAL_DAYS) {
    throw new PlanAdminError(`O teste grátis deve ser um número inteiro de 0 a ${MAX_TRIAL_DAYS} dias.`);
  }
  return numero;
}

// Aceita lista (`["clients","agenda"]`) ou mapa de caixinhas
// (`{ clients: true, agenda: false }`), que é o formato natural de um
// formulário com checkbox.
function normalizarFeatures(valor) {
  let chavesBrutas;
  if (Array.isArray(valor)) {
    chavesBrutas = valor.map((item) => String(item ?? "").trim()).filter(Boolean);
  } else if (valor && typeof valor === "object") {
    chavesBrutas = Object.entries(valor)
      .filter(([, marcado]) => Boolean(marcado))
      .map(([chave]) => chave.trim());
  } else {
    throw new PlanAdminError('O campo "features" deve ser uma lista de chaves.');
  }
  const chaves = [...new Set(chavesBrutas.map(normalizeFeatureKey))];

  // Chave desconhecida é ERRO, não ruído a ser filtrado: nenhuma rota é
  // protegida por ela, então o super-admin sairia da tela convencido de ter
  // liberado um recurso que continua bloqueado (ou nem existe).
  const desconhecidas = [...new Set(chaves.filter((chave) => !FEATURE_KEYS.includes(chave)))];
  if (desconhecidas.length) {
    throw new PlanAdminError(
      `Feature desconhecida: ${desconhecidas.join(", ")}. ` +
        "Só valem as chaves do catálogo — cada uma corresponde a uma tela realmente protegida.",
      400,
      { code: "feature_desconhecida", details: { features_invalidas: desconhecidas } }
    );
  }

  // Ordem do catálogo: a lista guardada fica estável e o diff da auditoria não
  // acusa mudança só porque a tela mandou as caixinhas em outra sequência.
  return FEATURE_KEYS.filter((chave) => chaves.includes(chave));
}

// `null` = ILIMITADO, e é o padrão de tudo que não veio. Campo vazio no
// formulário chega como "" e também vira ilimitado — o contrário (virar zero)
// bloquearia a clínica em tudo naquela cota.
function normalizarLimites(valor) {
  if (valor === undefined || valor === null || valor === "") return {};
  if (typeof valor !== "object" || Array.isArray(valor)) {
    throw new PlanAdminError('O campo "limits" deve ser um objeto (chave -> número ou null).');
  }

  const desconhecidas = Object.keys(valor).filter((chave) => !LIMIT_KEYS.includes(chave));
  if (desconhecidas.length) {
    throw new PlanAdminError(
      `Limite desconhecido: ${desconhecidas.join(", ")}. Só valem as cotas do catálogo.`,
      400,
      { code: "limite_desconhecido", details: { limites_invalidos: desconhecidas } }
    );
  }

  const limites = {};
  for (const [chave, bruto] of Object.entries(valor)) {
    if (bruto === null || bruto === undefined || String(bruto).trim() === "") continue;
    const numero = Number(bruto);
    if (!Number.isInteger(numero) || numero < 0) {
      const rotulo = LIMIT_CATALOG.find((item) => item.key === chave)?.label || chave;
      throw new PlanAdminError(
        `O limite "${rotulo}" deve ser um número inteiro maior ou igual a zero, ` +
          "ou ficar vazio para ilimitado.",
        400,
        { code: "limite_invalido" }
      );
    }
    limites[chave] = numero;
  }
  return limites;
}

function normalizarBooleano(valor, campo) {
  if (typeof valor === "boolean") return valor;
  if (valor === "true" || valor === "false") return valor === "true";
  throw new PlanAdminError(`O campo "${campo}" deve ser verdadeiro ou falso.`);
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

function paraPainel(row) {
  return {
    code: row.code,
    name: row.name,
    price_cents: Number(row.price_cents || 0),
    audience: row.audience || "",
    description: row.description || "",
    trial_days: Number(row.trial_days ?? 7),
    features: normalizeFeatureList(row.features),
    limits: row.limits && typeof row.limits === "object" ? row.limits : {},
    is_recommended: Boolean(row.is_recommended),
    is_active: row.is_active !== false,
    badge: row.badge || "",
    sort_order: Number(row.sort_order || 0),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null
  };
}

async function lerPlano(codigo, runner = pool) {
  const result = await runner.query(
    `SELECT ${PLAN_COLUMNS} FROM platform.subscription_plans WHERE code = $1`,
    [codigo]
  );
  return result.rows[0] ? paraPainel(result.rows[0]) : null;
}

async function exigirPlano(codigo) {
  const plano = await lerPlano(codigo);
  if (!plano) throw new PlanAdminError(`Plano não encontrado: ${codigo}.`, 404, { code: "plano_inexistente" });
  return plano;
}

function formatarReais(centavos) {
  return `R$ ${(Number(centavos || 0) / 100).toFixed(2).replace(".", ",")}`;
}

/**
 * Todos os planos do banco (inclusive os desativados), já com quantas clínicas
 * usam cada um. A contagem vem junto porque a tela precisa dela para decidir se
 * o botão de excluir sequer aparece — buscá-la em N requisições faria a lista
 * piscar com o botão errado enquanto carrega.
 */
export async function listarPlanosDoPainel() {
  const result = await query(
    `SELECT p.code, p.name, p.price_cents, p.audience, p.description, p.trial_days,
            p.features, p.limits, p.is_recommended, p.is_active, p.badge, p.sort_order,
            p.created_at, p.updated_at,
            (SELECT COUNT(*)::int FROM platform.tenant_subscriptions s WHERE s.plan_code = p.code) AS assinantes,
            (SELECT COUNT(*)::int FROM platform.tenants t WHERE t.plan = p.code) AS clinicas_marcadas
       FROM platform.subscription_plans p
      ORDER BY p.sort_order, p.price_cents`
  );
  const planos = result.rows.map((row) => ({
    ...paraPainel(row),
    subscribers: Number(row.assinantes || 0),
    tenants_with_plan: Number(row.clinicas_marcadas || 0)
  }));
  return { planos, alertas: alertasDeCoerencia(planos) };
}

/**
 * Quem usa o plano. Conta as duas referências que existem hoje:
 *
 *   - `platform.tenant_subscriptions.plan_code` — a FK de verdade;
 *   - `platform.tenants.plan` — coluna espelho, sem FK, que alimenta o
 *     diretório público e o painel.
 *
 * A segunda importa tanto quanto a primeira na hora de excluir: um plano
 * apagado deixaria `tenants.plan` apontando para um código inexistente, e
 * `normalizePlanCode()` cairia no plano padrão — a clínica ganharia features
 * que ninguém liberou, em silêncio.
 */
export async function usoDoPlano(codigo) {
  const code = String(codigo || "").trim().toLowerCase();
  await exigirPlano(code);

  const result = await query(
    `SELECT t.id, t.name, t.slug, t.status AS tenant_status,
            s.status AS subscription_status, s.asaas_subscription_id
       FROM platform.tenants t
       LEFT JOIN platform.tenant_subscriptions s ON s.tenant_id = t.id
      WHERE s.plan_code = $1 OR t.plan = $1
      ORDER BY t.name`,
    [code]
  );

  const porStatus = {};
  for (const row of result.rows) {
    const status = row.subscription_status || "sem_assinatura";
    porStatus[status] = (porStatus[status] || 0) + 1;
  }

  const total = result.rows.length;
  return {
    code,
    total,
    // Assinaturas vivas no gateway são as que sentem uma mudança de preço.
    cobrando: result.rows.filter((row) => row.asaas_subscription_id && row.subscription_status !== "canceled").length,
    por_status: porStatus,
    pode_excluir: total === 0,
    // Amostra para a tela mostrar "quem seria afetado" sem despejar 400 nomes.
    clinicas: result.rows.slice(0, 50).map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      tenant_status: row.tenant_status,
      subscription_status: row.subscription_status || null
    }))
  };
}

// ---------------------------------------------------------------------------
// Alertas (avisam, nunca bloqueiam)
// ---------------------------------------------------------------------------

// Plano mais caro com MENOS features que um mais barato é quase sempre engano
// de marcação — mas pode ser proposital (um plano de nicho, caro e enxuto).
// Por isso avisa e deixa salvar: bloquear obrigaria o super-admin a inventar
// features para conseguir gravar um plano legítimo.
function alertasDeCoerencia(planos) {
  const ativos = planos.filter((plano) => plano.is_active).sort((a, b) => a.price_cents - b.price_cents);
  const alertas = [];
  for (let i = 0; i < ativos.length; i += 1) {
    for (let j = i + 1; j < ativos.length; j += 1) {
      const barato = ativos[i];
      const caro = ativos[j];
      if (caro.price_cents <= barato.price_cents) continue;
      if (caro.features.length >= barato.features.length) continue;
      alertas.push(
        `O plano "${caro.name}" (${formatarReais(caro.price_cents)}) tem ${caro.features.length} ` +
          `recurso(s), menos que "${barato.name}" (${formatarReais(barato.price_cents)}), que tem ` +
          `${barato.features.length}. Confira se é intencional.`
      );
    }
  }

  const recomendados = ativos.filter((plano) => plano.is_recommended).map((plano) => plano.name);
  if (recomendados.length > 1) {
    alertas.push(
      `Mais de um plano está marcado como recomendado (${recomendados.join(", ")}). ` +
        "A vitrine destaca todos, e o destaque perde o efeito."
    );
  }
  return alertas;
}

// Alertas relativos a UM plano que acabou de ser gravado.
async function alertasDoPlano(codigo) {
  const { planos } = await listarPlanosDoPainel();
  const alvo = planos.find((plano) => plano.code === codigo);
  if (!alvo || !alvo.is_active) return [];
  return alertasDeCoerencia(planos).filter((alerta) => alerta.includes(`"${alvo.name}"`));
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

async function emailDoAtor(actorId) {
  if (!actorId) return null;
  try {
    const result = await query("SELECT email FROM platform.platform_users WHERE id = $1", [actorId]);
    return result.rows[0]?.email || null;
  } catch {
    // Auditoria não pode derrubar a escrita; sem o e-mail ainda sobra o id.
    return null;
  }
}

/**
 * Registra a ação em `platform.admin_audit`.
 *
 * BEST-EFFORT de propósito: no caminho da mudança de preço o registro acontece
 * DEPOIS de o gateway já ter sido atualizado. Deixar uma falha de INSERT
 * derrubar a requisição faria o super-admin repetir a operação e recobrar todo
 * mundo de novo — muito pior que perder uma linha de log, que ainda assim vai
 * para o console.
 */
async function registrarAuditoria({ actorId, action, targetId, detail }, runner = pool) {
  try {
    await runner.query(
      `INSERT INTO platform.admin_audit (actor_id, actor_email, action, target_type, target_id, detail)
       VALUES ($1, $2, $3, 'plan', $4, $5::jsonb)`,
      [actorId ?? null, await emailDoAtor(actorId), action, targetId, JSON.stringify(detail ?? {})]
    );
  } catch (error) {
    console.error(`[planAdmin] falha ao registrar auditoria de "${action}" em ${targetId}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Propagação de preço para o Asaas
// ---------------------------------------------------------------------------

/**
 * Aplica o preço novo nas assinaturas que já existem no gateway.
 *
 * UMA POR UMA e com try/catch individual: uma clínica cuja assinatura foi
 * cancelada (ou apagada) do lado do Asaas devolve 404 e, num `Promise.all` ou
 * numa transação, levaria junto a atualização de todas as outras. O relatório
 * de falhas volta na resposta porque "37 de 40 atualizadas" é uma informação
 * que o super-admin precisa ver na hora — as 3 restantes continuam sendo
 * cobradas pelo valor antigo até alguém agir.
 */
async function propagarPrecoNoAsaas(codigo, priceCents) {
  const alvos = await query(
    `SELECT s.tenant_id, s.asaas_subscription_id, t.name
       FROM platform.tenant_subscriptions s
       JOIN platform.tenants t ON t.id = s.tenant_id
      WHERE s.plan_code = $1
        AND s.asaas_subscription_id IS NOT NULL
        AND s.status <> 'canceled'
      ORDER BY s.tenant_id`,
    [codigo]
  );

  const relatorio = { total: alvos.rows.length, atualizadas: 0, falhas: 0, ignoradas: 0, erros: [] };
  if (!relatorio.total) return relatorio;

  // Sem credencial da plataforma não há o que propagar — e isso não pode
  // impedir a edição do plano: em ambiente sem gateway (dev, homologação) o
  // painel precisa continuar funcionando.
  if (!isPlatformEnabled()) {
    relatorio.ignoradas = relatorio.total;
    relatorio.motivo = "gateway_indisponivel";
    console.warn(
      `[planAdmin] preço do plano ${codigo} mudou, mas o gateway não está configurado: ` +
        `${relatorio.total} assinatura(s) seguem com o valor antigo no Asaas.`
    );
    return relatorio;
  }

  const asaas = platformClient();
  for (const alvo of alvos.rows) {
    try {
      await asaas.updateSubscription(alvo.asaas_subscription_id, {
        // price_cents -> reais. A divisão que, esquecida, cobra cem vezes o
        // preço do plano.
        value: priceCents / 100,
        // As cobranças já geradas e ainda não pagas precisam acompanhar, senão
        // a clínica recebe no mês que vem um boleto com o preço velho.
        updatePendingPayments: true
      });
      relatorio.atualizadas += 1;
    } catch (error) {
      relatorio.falhas += 1;
      // Só nome e mensagem no log: o payload do gateway pode carregar dado de
      // cartão, e um `console.error(error)` o imprimiria por inteiro.
      console.error(
        `[planAdmin] falha ao atualizar a assinatura ${alvo.asaas_subscription_id} ` +
          `(clínica ${alvo.tenant_id} — ${alvo.name}): ${error?.message}`
      );
      if (relatorio.erros.length < 25) {
        relatorio.erros.push({
          tenant_id: alvo.tenant_id,
          tenant_name: alvo.name,
          asaas_subscription_id: alvo.asaas_subscription_id,
          erro: error?.message || "erro desconhecido"
        });
      }
    }
  }
  return relatorio;
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/** Cria um plano. */
export async function criarPlano(payload = {}, { actorId = null } = {}) {
  const code = normalizarCodigo(payload.code);

  const existente = await lerPlano(code);
  if (existente) {
    throw new PlanAdminError(
      `Já existe um plano com o código "${code}". O código é a identidade do plano e não se repete.`,
      409,
      { code: "codigo_duplicado" }
    );
  }

  const plano = {
    code,
    name: normalizarNome(payload.name),
    price_cents: normalizarPreco(payload.price_cents),
    audience: textoOpcional(payload.audience, "audience") ?? "",
    description: textoOpcional(payload.description, "description", 2000) ?? "",
    trial_days: normalizarTrialDays(payload.trial_days ?? 7),
    features: normalizarFeatures(payload.features ?? []),
    limits: normalizarLimites(payload.limits),
    is_recommended: payload.is_recommended === undefined && payload.highlight === undefined
      ? false
      : normalizarBooleano(payload.is_recommended ?? payload.highlight, "is_recommended"),
    is_active: payload.is_active === undefined ? true : normalizarBooleano(payload.is_active, "is_active"),
    badge: textoOpcional(payload.badge, "badge", 40) ?? ""
  };

  // Sem ordem informada, o plano novo entra no fim da vitrine. Passo de 10 para
  // caber uma inserção manual entre dois planos sem renumerar todos.
  let sortOrder = payload.sort_order === undefined || payload.sort_order === null || payload.sort_order === ""
    ? null
    : Number(payload.sort_order);
  if (sortOrder !== null && (!Number.isInteger(sortOrder) || sortOrder < 0)) {
    throw new PlanAdminError('O campo "sort_order" deve ser um número inteiro maior ou igual a zero.');
  }
  if (sortOrder === null) {
    const ultimo = await query("SELECT COALESCE(MAX(sort_order), 0) AS max FROM platform.subscription_plans");
    sortOrder = Number(ultimo.rows[0]?.max || 0) + 10;
  }

  let criado;
  try {
    const result = await query(
      `INSERT INTO platform.subscription_plans
         (code, name, price_cents, audience, description, trial_days, features, limits,
          is_recommended, is_active, badge, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12)
       RETURNING ${PLAN_COLUMNS}`,
      [
        plano.code,
        plano.name,
        plano.price_cents,
        plano.audience,
        plano.description,
        plano.trial_days,
        JSON.stringify(plano.features),
        JSON.stringify(plano.limits),
        plano.is_recommended,
        plano.is_active,
        plano.badge,
        sortOrder
      ]
    );
    criado = paraPainel(result.rows[0]);
  } catch (error) {
    // Corrida entre dois cadastros com o mesmo código: o pré-check acima passou
    // nos dois, só a PK decide.
    if (error?.code === "23505") {
      throw new PlanAdminError(`Já existe um plano com o código "${code}".`, 409, { code: "codigo_duplicado" });
    }
    throw error;
  }

  await loadPlansFromDb();
  await registrarAuditoria({
    actorId,
    action: "plano.criado",
    targetId: code,
    detail: {
      name: criado.name,
      price_cents: criado.price_cents,
      trial_days: criado.trial_days,
      features: criado.features,
      limits: criado.limits,
      is_active: criado.is_active
    }
  });

  return { plan: criado, alertas: await alertasDoPlano(code) };
}

/**
 * Edita um plano.
 *
 * Campos ausentes são PRESERVADOS: a tela pode salvar só o que mudou, e um PUT
 * parcial não deve zerar features nem limites.
 */
export async function atualizarPlano(codigo, payload = {}, { actorId = null } = {}) {
  const code = String(codigo || "").trim().toLowerCase();
  const atual = await exigirPlano(code);

  // O código é a identidade e vira FK em `tenant_subscriptions`; renomeá-lo
  // deixaria as clínicas apontando para um plano que não existe mais.
  if (payload.code !== undefined && String(payload.code).trim().toLowerCase() !== code) {
    throw new PlanAdminError(
      "O código do plano não pode ser alterado: as assinaturas das clínicas apontam para ele. " +
        "Crie um plano novo e migre as clínicas, se for esse o caso.",
      400,
      { code: "codigo_imutavel" }
    );
  }

  const novo = {
    name: payload.name === undefined ? atual.name : normalizarNome(payload.name),
    price_cents: payload.price_cents === undefined ? atual.price_cents : normalizarPreco(payload.price_cents),
    audience: payload.audience === undefined ? atual.audience : textoOpcional(payload.audience, "audience") ?? "",
    description:
      payload.description === undefined
        ? atual.description
        : textoOpcional(payload.description, "description", 2000) ?? "",
    trial_days: payload.trial_days === undefined ? atual.trial_days : normalizarTrialDays(payload.trial_days),
    features: payload.features === undefined ? atual.features : normalizarFeatures(payload.features),
    limits: payload.limits === undefined ? atual.limits : normalizarLimites(payload.limits),
    is_recommended:
      payload.is_recommended === undefined && payload.highlight === undefined
        ? atual.is_recommended
        : normalizarBooleano(payload.is_recommended ?? payload.highlight, "is_recommended"),
    is_active: payload.is_active === undefined ? atual.is_active : normalizarBooleano(payload.is_active, "is_active"),
    badge: payload.badge === undefined ? atual.badge : textoOpcional(payload.badge, "badge", 40) ?? ""
  };

  const uso = await usoDoPlano(code);
  const precoMudou = novo.price_cents !== atual.price_cents;

  // Trava de confirmação. Um zero a mais em `price_cents` recobraria todas as
  // clínicas do plano no ciclo seguinte, e o estrago só apareceria na fatura
  // delas. O corpo do erro leva os números para a tela montar o "confirma
  // reajustar de X para Y em N clínicas?" sem uma segunda requisição.
  if (precoMudou && uso.total > 0 && payload.confirm_price_change !== true) {
    throw new PlanAdminError(
      `Mudar o preço de ${formatarReais(atual.price_cents)} para ${formatarReais(novo.price_cents)} ` +
        `afeta ${uso.total} clínica(s) que assinam este plano. Confirme o reajuste para prosseguir.`,
      409,
      {
        code: "confirmacao_de_preco_necessaria",
        details: {
          subscribers: uso.total,
          cobrando: uso.cobrando,
          price_cents_atual: atual.price_cents,
          price_cents_novo: novo.price_cents
        }
      }
    );
  }

  // Desativar é a operação segura (o plano some da vitrine e continua valendo
  // para quem assina), mas ficar SEM nenhum plano ativo quebra o cadastro de
  // clínica nova — e a vitrine ficaria vazia para todo visitante.
  if (atual.is_active && !novo.is_active) await exigirOutroPlanoAtivo(code);

  const result = await query(
    `UPDATE platform.subscription_plans
        SET name = $1, price_cents = $2, audience = $3, description = $4, trial_days = $5,
            features = $6::jsonb, limits = $7::jsonb, is_recommended = $8, is_active = $9,
            badge = $10, updated_at = now()
      WHERE code = $11
      RETURNING ${PLAN_COLUMNS}`,
    [
      novo.name,
      novo.price_cents,
      novo.audience,
      novo.description,
      novo.trial_days,
      JSON.stringify(novo.features),
      JSON.stringify(novo.limits),
      novo.is_recommended,
      novo.is_active,
      novo.badge,
      code
    ]
  );
  const atualizado = paraPainel(result.rows[0]);

  // Antes da propagação: a partir daqui o banco é a fonte da verdade e o gating
  // precisa refletir a edição mesmo que o gateway esteja fora do ar.
  await loadPlansFromDb();

  const mudancas = diferencas(atual, atualizado);
  await registrarAuditoria({
    actorId,
    action: "plano.editado",
    targetId: code,
    detail: { mudancas, assinantes: uso.total }
  });

  let propagacao = null;
  if (precoMudou) {
    propagacao = await propagarPrecoNoAsaas(code, atualizado.price_cents);
    // Linha própria para a mudança de preço, separada da edição: é ela que
    // responde "por que o plano subiu?" e "quais clínicas não pegaram o valor
    // novo?" — perguntas que aparecem meses depois, uma de cada vez.
    await registrarAuditoria({
      actorId,
      action: "plano.preco_alterado",
      targetId: code,
      detail: {
        price_cents_antes: atual.price_cents,
        price_cents_depois: atualizado.price_cents,
        assinantes: uso.total,
        propagacao
      }
    });
  }

  return { plan: atualizado, propagacao, alertas: await alertasDoPlano(code) };
}

// Diff raso entre o antes e o depois, para a auditoria guardar o que mudou em
// vez de duas fotos inteiras do plano.
function diferencas(antes, depois) {
  const mudancas = {};
  for (const campo of [
    "name",
    "price_cents",
    "audience",
    "description",
    "trial_days",
    "features",
    "limits",
    "is_recommended",
    "is_active",
    "badge",
    "sort_order"
  ]) {
    const de = antes[campo];
    const para = depois[campo];
    if (JSON.stringify(de) !== JSON.stringify(para)) mudancas[campo] = { de, para };
  }
  return mudancas;
}

async function exigirOutroPlanoAtivo(code) {
  const result = await query(
    "SELECT COUNT(*)::int AS total FROM platform.subscription_plans WHERE is_active = true AND code <> $1",
    [code]
  );
  if (!Number(result.rows[0]?.total || 0)) {
    throw new PlanAdminError(
      "Este é o único plano ativo. Sem nenhum plano ativo a vitrine fica vazia e ninguém consegue " +
        "se cadastrar — ative outro antes de desativar este.",
      409,
      { code: "ultimo_plano_ativo" }
    );
  }
}

/** Liga/desliga o plano. Desligado: some da vitrine e do cadastro, mas quem já assina continua igual. */
export async function definirPlanoAtivo(codigo, ativo, { actorId = null } = {}) {
  const code = String(codigo || "").trim().toLowerCase();
  const atual = await exigirPlano(code);
  const valor = normalizarBooleano(ativo, "is_active");

  if (atual.is_active === valor) {
    const uso = await usoDoPlano(code);
    return { plan: atual, uso, inalterado: true };
  }
  if (!valor) await exigirOutroPlanoAtivo(code);

  const result = await query(
    `UPDATE platform.subscription_plans SET is_active = $1, updated_at = now()
      WHERE code = $2 RETURNING ${PLAN_COLUMNS}`,
    [valor, code]
  );
  const plano = paraPainel(result.rows[0]);

  await loadPlansFromDb();
  const uso = await usoDoPlano(code);
  await registrarAuditoria({
    actorId,
    action: valor ? "plano.ativado" : "plano.desativado",
    targetId: code,
    detail: { assinantes: uso.total }
  });

  return { plan: plano, uso, inalterado: false };
}

/**
 * Reordena a vitrine a partir da lista completa de códigos na ordem final.
 *
 * Em lote e numa transação só: "mova o plano X para a posição N", aplicado numa
 * requisição por plano, deixa a página de preços em ordem imprevisível se uma
 * das chamadas falhar no meio.
 */
export async function reordenarPlanos(codigos, { actorId = null } = {}) {
  if (!Array.isArray(codigos) || !codigos.length) {
    throw new PlanAdminError("Envie a lista de códigos de plano na ordem desejada.");
  }
  const lista = codigos.map((codigo) => String(codigo || "").trim().toLowerCase());
  if (new Set(lista).size !== lista.length) {
    throw new PlanAdminError("A lista tem planos repetidos.");
  }

  const existentes = await query("SELECT code FROM platform.subscription_plans");
  const conhecidos = existentes.rows.map((row) => row.code);
  const desconhecido = lista.find((codigo) => !conhecidos.includes(codigo));
  if (desconhecido) {
    throw new PlanAdminError(`Plano não encontrado: ${desconhecido}.`, 404, { code: "plano_inexistente" });
  }
  // Lista parcial deixaria os planos de fora com a ordem antiga, intercalados
  // com os novos — resultado que ninguém pediu e difícil de entender na tela.
  const faltando = conhecidos.filter((codigo) => !lista.includes(codigo));
  if (faltando.length) {
    throw new PlanAdminError(
      `Envie TODOS os planos na ordem desejada. Faltaram: ${faltando.join(", ")}.`,
      400,
      { code: "ordem_incompleta" }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [indice, codigo] of lista.entries()) {
      await client.query(
        "UPDATE platform.subscription_plans SET sort_order = $1, updated_at = now() WHERE code = $2",
        [(indice + 1) * 10, codigo]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  await loadPlansFromDb();
  await registrarAuditoria({ actorId, action: "plano.reordenado", targetId: lista.join(","), detail: { ordem: lista } });

  return listarPlanosDoPainel();
}

/**
 * Exclui um plano — só quando ninguém o usa.
 *
 * A FK de `tenant_subscriptions` já barraria a exclusão, mas com um erro cru de
 * banco ("violates foreign key constraint"), que não diz ao super-admin nem
 * quantas clínicas estão envolvidas nem o que fazer. A checagem explícita
 * existe para responder as duas coisas.
 */
export async function excluirPlano(codigo, { actorId = null } = {}) {
  const code = String(codigo || "").trim().toLowerCase();
  const plano = await exigirPlano(code);
  const uso = await usoDoPlano(code);

  if (uso.total > 0) {
    throw new PlanAdminError(
      `Não dá para excluir o plano "${plano.name}": ${uso.total} clínica(s) usam ele hoje. ` +
        "Desative o plano — ele some da vitrine e do cadastro de novas clínicas, e quem já assina " +
        "continua funcionando normalmente.",
      409,
      { code: "plano_com_assinantes", details: { subscribers: uso.total, clinicas: uso.clinicas } }
    );
  }

  // Excluir o último plano deixaria o registro em memória sem nada para
  // carregar — e `loadPlansFromDb()` cairia de volta nos planos-semente do
  // código, ressuscitando planos que não existem mais no banco.
  await exigirOutroPlanoAtivo(code);

  try {
    await query("DELETE FROM platform.subscription_plans WHERE code = $1", [code]);
  } catch (error) {
    // Rede de segurança para a corrida "clínica assina o plano enquanto o
    // super-admin o exclui": entre a contagem e o DELETE cabe uma assinatura.
    if (error?.code === "23503") {
      throw new PlanAdminError(
        `Não dá para excluir o plano "${plano.name}": uma clínica passou a usá-lo agora há pouco. ` +
          "Desative o plano em vez de excluir.",
        409,
        { code: "plano_com_assinantes" }
      );
    }
    throw error;
  }

  await loadPlansFromDb();
  await registrarAuditoria({
    actorId,
    action: "plano.excluido",
    targetId: code,
    // O plano inteiro no detalhe: depois da exclusão não há outro lugar de onde
    // reconstruir preço e features de quem foi cobrado por ele.
    detail: { plano }
  });

  return { code, deleted: true };
}

export const CATALOGOS = { feature_catalog: FEATURE_CATALOG, limit_catalog: LIMIT_CATALOG };
