// Poder do super-admin sobre a CONTA de uma clínica: trocar plano, suspender,
// reativar, mexer no trial, forçar o status da assinatura e cancelar a
// recorrência no gateway.
//
// Tudo aqui corta acesso ou mexe em dinheiro, e é isso que explica as três
// regras que o arquivo inteiro segue:
//
//  1. MUDANÇA E AUDITORIA COMMITAM JUNTAS. Cada ação roda numa transação que
//     grava a linha nova E o registro em `platform.admin_audit`. Se a auditoria
//     falhar, a mudança é desfeita. É deliberado: uma clínica suspensa sem
//     ninguém saber quem suspendeu, quando e por quê é um problema pior do que
//     a suspensão não ter acontecido.
//  2. `invalidateSubscriptionCache` DEPOIS DE TODA ESCRITA. O gating lê a
//     assinatura de um cache de 30s; sem invalidar, o super-admin troca o plano
//     e a clínica continua com o anterior por meia janela — tempo suficiente
//     para o suporte concluir que "não funcionou" e mexer de novo.
//  3. SUSPENDER ≠ CANCELAR. São duas decisões diferentes e ficam em duas
//     funções diferentes (ver o comentário de `setAccountStatus`).
//
// Nada aqui usa withDb/`db`: o estado de uma conta mora no schema `platform`,
// que é global. Por isso `query()`/`pool` com `$1` e prefixo `platform.`
// explícito. A única incursão no schema da clínica é a MEDIÇÃO de uso, que
// passa por planLimits.js.
import { pool, query } from "../database/connection.js";
import { AsaasError } from "./asaas/client.js";
import { isPlatformEnabled, platformClient } from "./asaas/credentials.js";
import { invalidateTenantCache } from "../middleware/tenant.js";
import { listTenantInvoices, subscriptionSyncWarning, syncSubscriptionPrice } from "./platformBilling.js";
import { tenantUsageReport } from "./planLimits.js";
import { SUBSCRIPTION_STATUSES, normalizePlanCode, planByCode } from "./plans.js";
import { invalidateSubscriptionCache, tenantSubscription } from "./subscriptions.js";
import { maskTaxId } from "./taxId.js";

// Erro de regra de negócio com o status HTTP já decidido aqui — a rota não
// precisa adivinhar se "motivo ausente" é 400 ou 500.
export class AccountAdminError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.name = "AccountAdminError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

// Status de assinatura que o super-admin pode FORÇAR. Os dois de trial ficam de
// fora de propósito: quem mexe em trial é `adjustTrial`, que também acerta as
// datas — forçar 'trial_active' sem data de fim criaria um trial eterno.
export const FORCEABLE_SUBSCRIPTION_STATUSES = ["active", "overdue", "canceled", "suspended"];

export const ACCOUNT_STATUSES = ["ativo", "suspenso"];

const MAX_TRIAL_DAYS = 365;

// ---------------------------------------------------------------------------
// Infraestrutura
// ---------------------------------------------------------------------------

// Transação no schema `platform`. Não dá para reusar `db.transaction`: aquele
// client vem do withDb, com o search_path de uma clínica.
async function withTransaction(run) {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ROLLBACK que falha é conexão morta: devolvê-la ao pool com transação
      // aberta contaminaria a próxima requisição.
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

// Grava a trilha de auditoria DENTRO da transação da mudança (regra 1).
async function auditWithin(client, { actor, action, tenantId, detail }) {
  await client.query(
    `INSERT INTO platform.admin_audit (actor_id, actor_email, action, target_type, target_id, detail)
     VALUES ($1, $2, $3, 'tenant', $4, $5::jsonb)`,
    [actor?.id ?? null, actor?.email ?? null, action, String(tenantId), JSON.stringify(detail ?? {})]
  );
}

/**
 * Identidade do super-admin para a auditoria. O token carrega só o `sub`; o
 * e-mail é lido aqui porque é ele que sobrevive à leitura humana do log meses
 * depois (um id vira ninguém quando a conta do admin é removida).
 */
export async function platformActor(platformUser) {
  const id = Number(platformUser?.sub);
  if (!Number.isInteger(id)) return { id: null, email: null };
  const result = await query("SELECT id, email FROM platform.platform_users WHERE id = $1", [id]);
  const row = result.rows[0];
  return { id: row?.id ?? id, email: row?.email ?? null };
}

// Motivo é obrigatório em TODA ação deste arquivo: sem ele a auditoria registra
// o que mudou mas não responde "por quê?", que é a pergunta que sempre aparece
// depois — em cobrança contestada, em cancelamento e em conta suspensa.
function requireReason(reason) {
  const text = String(reason ?? "").trim();
  if (text.length < 3) {
    throw new AccountAdminError(
      "Informe o motivo desta ação (ele fica registrado na auditoria).",
      400,
      "motivo_obrigatorio"
    );
  }
  return text.slice(0, 500);
}

async function loadTenant(tenantId) {
  const id = Number(tenantId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AccountAdminError("Clínica inválida.", 400, "tenant_invalido");
  }
  const result = await query(
    `SELECT id, name, slug, status, plan, store_short_name, responsible_name, phone, email,
            city, state, tax_id, asaas_customer_id, listed, created_at
       FROM platform.tenants
      WHERE id = $1`,
    [id]
  );
  const tenant = result.rows[0];
  if (!tenant) throw new AccountAdminError("Clínica não encontrada.", 404, "tenant_inexistente");
  return tenant;
}

// Linha crua da assinatura (sem o enriquecimento/cache de tenantSubscription):
// é o "antes" que vai para a auditoria, e ele tem de vir do banco.
async function loadSubscriptionRow(tenantId) {
  const result = await query(
    `SELECT id, tenant_id, plan_code, status, trial_started_at, trial_ends_at,
            current_period_ends_at, asaas_subscription_id, billing_type, canceled_at, updated_at
       FROM platform.tenant_subscriptions
      WHERE tenant_id = $1`,
    [tenantId]
  );
  return result.rows[0] || null;
}

function subscriptionSnapshot(row) {
  if (!row) return null;
  return {
    plan_code: row.plan_code,
    status: row.status,
    trial_ends_at: row.trial_ends_at,
    current_period_ends_at: row.current_period_ends_at,
    canceled_at: row.canceled_at
  };
}

/**
 * Auditoria de uma etapa que acontece FORA da transação da mudança.
 *
 * Aqui a regra 1 do topo do arquivo (mudança e auditoria commitam juntas) não
 * se aplica, e é deliberado: a conversa com o gateway só pode acontecer depois
 * do COMMIT (o acesso da clínica não pode depender do Asaas estar de pé), então
 * não existe transação para carregar este registro junto. Deixar uma falha de
 * INSERT derrubar a requisição faria o super-admin repetir a operação — e ele
 * repetiria o reajuste de cobrança, que é muito pior do que perder uma linha de
 * log. É a mesma escolha que `planAdmin.js` faz na propagação de preço.
 */
async function auditAfterCommit({ actor, action, tenantId, detail }) {
  try {
    await auditWithin(pool, { actor, action, tenantId, detail });
  } catch (error) {
    console.error(
      `[accountAdmin] falha ao registrar "${action}" da clínica ${tenantId} na auditoria: ${error.message}. ` +
        `Detalhe: ${JSON.stringify(detail)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Visão detalhada da conta
// ---------------------------------------------------------------------------

/**
 * Tudo que o super-admin precisa ver antes de decidir: cadastro da clínica,
 * assinatura, plano vigente, uso x cotas e as últimas faturas.
 *
 * Uso e faturas são BEST-EFFORT: uma clínica com schema quebrado ou o gateway
 * fora do ar não podem impedir a tela de abrir — é justamente nessa clínica que
 * o super-admin precisa entrar para consertar alguma coisa.
 */
export async function accountOverview(tenantId, { invoiceLimit = 5 } = {}) {
  const tenant = await loadTenant(tenantId);
  const subscriptionRow = await loadSubscriptionRow(tenant.id);

  let subscription = null;
  try {
    subscription = await tenantSubscription(tenant.id);
  } catch (error) {
    console.error(`[accountAdmin] falha ao ler a assinatura da clínica ${tenant.id}: ${error.message}`);
  }

  const plan = planByCode(subscriptionRow?.plan_code || tenant.plan);

  let usage = [];
  try {
    usage = await tenantUsageReport(tenant.id, plan.code);
  } catch (error) {
    console.error(`[accountAdmin] falha ao medir o uso da clínica ${tenant.id}: ${error.message}`);
  }

  let invoices = [];
  try {
    const page = await listTenantInvoices(tenant.id, { limit: invoiceLimit });
    invoices = page.items;
  } catch (error) {
    console.error(`[accountAdmin] falha ao listar faturas da clínica ${tenant.id}: ${error.message}`);
  }

  return {
    tenant: {
      ...tenant,
      // O documento inteiro não acrescenta nada a esta tela e é dado pessoal do
      // responsável: mostra-se o suficiente para ele reconhecer o próprio.
      tax_id: maskTaxId(tenant.tax_id),
      has_tax_id: Boolean(tenant.tax_id)
    },
    subscription: subscriptionRow
      ? {
          ...subscriptionRow,
          days_left: subscription?.days_left ?? null,
          plan_name: plan.name,
          price_cents: plan.price_cents
        }
      : null,
    plan: { code: plan.code, name: plan.name, price_cents: plan.price_cents, features: plan.features },
    usage,
    invoices
  };
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

/**
 * Troca o plano IMEDIATAMENTE, sem tocar no status da assinatura.
 *
 * Complementa (não substitui) o `PATCH /api/platform/tenants/:id/plan` antigo,
 * que também marcava 'active' com 30 dias. Separar é o ponto: uma clínica
 * inadimplente que muda de plano continua inadimplente, e "liberar acesso" é
 * uma decisão explícita — `forceSubscriptionStatus`.
 *
 * O VALOR NOVO VAI PARA O GATEWAY, e a ordem importa: primeiro o COMMIT daqui,
 * depois o Asaas. O contrário — gateway primeiro — cobraria o preço novo de uma
 * clínica cujo plano não chegou a mudar, se a transação falhasse na sequência.
 * A propagação é BEST-EFFORT pelo mesmo motivo de sempre: o acesso da clínica
 * já mudou, e uma indisponibilidade do gateway não pode desfazer nem travar
 * isso. O que ela produz é um relatório (`gateway`) e, quando sobra dinheiro
 * pendurado, um `warning` — reprocessável por `resyncAccountSubscription`.
 *
 * @param {number|string} tenantId
 * @param {{ planCode: string, reason: string, actor?: object, gateway?: object }} options
 *   `gateway` é ponto de injeção para teste; nenhuma rota o repassa.
 */
export async function changeAccountPlan(tenantId, { planCode, reason, actor, gateway } = {}) {
  const tenant = await loadTenant(tenantId);
  const motivo = requireReason(reason);

  // normalizePlanCode com fallback vazio: `planByCode` cairia no plano padrão
  // num código errado, e aqui isso significaria mover a clínica para um plano
  // que ninguém pediu.
  const code = normalizePlanCode(planCode, "");
  if (!code) throw new AccountAdminError("Plano inválido.", 400, "plano_invalido");

  const before = await loadSubscriptionRow(tenant.id);
  const fromPlan = before?.plan_code || tenant.plan;

  const saved = await withTransaction(async (client) => {
    // As duas colunas contam a mesma história: `tenants.plan` alimenta o
    // diretório público e o painel; `tenant_subscriptions.plan_code` governa o
    // gating. Divergentes, a clínica vê um plano e usa outro.
    await client.query("UPDATE platform.tenants SET plan = $1 WHERE id = $2", [code, tenant.id]);
    const updated = await client.query(
      `UPDATE platform.tenant_subscriptions
          SET plan_code = $1, updated_at = now()
        WHERE tenant_id = $2
        RETURNING id, plan_code, status, trial_ends_at, current_period_ends_at, canceled_at`,
      [code, tenant.id]
    );
    await auditWithin(client, {
      actor,
      action: "conta.plano_alterado",
      tenantId: tenant.id,
      detail: {
        motivo,
        antes: { plan_code: fromPlan, subscription: subscriptionSnapshot(before) },
        depois: { plan_code: code, subscription: subscriptionSnapshot(updated.rows[0]) }
      }
    });
    return updated.rows[0] || null;
  });

  invalidateSubscriptionCache(tenant.id);
  invalidateTenantCache(tenant.slug);

  // Reajuste da recorrência. Roda mesmo quando o plano "não mudou" (o operador
  // reaplicando o mesmo plano é, na prática, um pedido de conserto): a própria
  // sincronização compara o valor no gateway antes de escrever e devolve
  // `ja_sincronizado` sem tocar em nada quando já está certo.
  const gatewayResult = saved ? await syncSubscriptionPrice(tenant.id, { gateway }) : null;
  if (gatewayResult) {
    // Linha própria, separada de `conta.plano_alterado`: é ela que responde
    // "a clínica chegou a ser cobrada pelo plano novo?" — pergunta que aparece
    // meses depois, sozinha, quando alguém confere a fatura.
    await auditAfterCommit({
      actor,
      action: "conta.plano_propagado_no_gateway",
      tenantId: tenant.id,
      detail: {
        motivo,
        de: fromPlan,
        para: code,
        gateway: gatewayResult
      }
    });
  }

  return {
    ok: true,
    tenant_id: tenant.id,
    plan_code: code,
    plan_name: planByCode(code).name,
    subscription: saved,
    // Relatório completo da propagação: a tela usa `status`/`detalhe` para
    // contar o que aconteceu de fato, mesmo quando não há nada a avisar.
    gateway: gatewayResult,
    // Sem assinatura, a troca ficou só em `tenants.plan` — o gating continua
    // sem linha para consultar. Quem cria a assinatura é o provisionamento ou o
    // checkout; avisar é melhor que fingir que a troca foi completa.
    warning: saved
      ? subscriptionSyncWarning(gatewayResult)
      : "Esta clínica não tem linha de assinatura; o plano foi gravado apenas no cadastro."
  };
}

/**
 * Reenvia ao Asaas o valor do plano vigente. É o caminho de reprocesso do
 * `warning` da troca de plano ("falhou, tente novamente").
 *
 * Idempotente: `syncSubscriptionPrice` lê a assinatura antes de escrever e não
 * faz nada se o gateway já cobra o valor certo. Não cria assinatura nem
 * cobrança — só atualiza a recorrência que já existe —, então chamar dez vezes
 * tem o mesmo efeito de chamar uma.
 *
 * O motivo é OPCIONAL aqui, e é a única ação deste arquivo em que ele é. As
 * outras decidem acesso ou dinheiro e precisam responder "por quê?"; esta
 * apenas faz o gateway concordar com uma decisão que JÁ está registrada (com o
 * motivo dela) em `conta.plano_alterado`. Exigir um texto para clicar em
 * "tentar de novo" só reduziria a chance de alguém tentar.
 */
export async function resyncAccountSubscription(tenantId, { reason, actor, gateway } = {}) {
  const tenant = await loadTenant(tenantId);
  const motivo = String(reason ?? "").trim().slice(0, 500) || "Reenvio do ajuste de valor ao gateway.";

  const before = await loadSubscriptionRow(tenant.id);
  if (!before) {
    throw new AccountAdminError(
      "Esta clínica não tem assinatura para sincronizar.",
      409,
      "assinatura_inexistente"
    );
  }

  const gatewayResult = await syncSubscriptionPrice(tenant.id, { gateway });
  await auditAfterCommit({
    actor,
    action: "conta.assinatura_ressincronizada",
    tenantId: tenant.id,
    detail: { motivo, gateway: gatewayResult }
  });

  return {
    ok: true,
    tenant_id: tenant.id,
    plan_code: gatewayResult.plan_code,
    plan_name: gatewayResult.plan_name,
    gateway: gatewayResult,
    warning: subscriptionSyncWarning(gatewayResult)
  };
}

/**
 * Suspende ou reativa a conta. `platform.tenants.status = 'suspenso'` é o corte
 * de acesso mais duro que existe: `resolveTenant` devolve 403 para QUALQUER
 * requisição da clínica, inclusive login.
 *
 * NÃO cancela a assinatura no Asaas, de propósito. Suspender é uma medida
 * operacional e quase sempre temporária (abuso, chargeback em apuração, pedido
 * do próprio dono); cancelar a recorrência é uma decisão comercial definitiva e
 * irreversível do lado do gateway — para voltar, a clínica teria de digitar o
 * cartão de novo. Amarrar as duas faria toda suspensão de 24h custar um
 * checkout novo. Quem quer as duas coisas chama `cancelAccountSubscription`
 * explicitamente.
 */
export async function setAccountStatus(tenantId, { status, reason, actor } = {}) {
  const tenant = await loadTenant(tenantId);
  const motivo = requireReason(reason);
  const next = String(status || "").trim().toLowerCase();
  if (!ACCOUNT_STATUSES.includes(next)) {
    throw new AccountAdminError(
      `Status inválido. Use um destes: ${ACCOUNT_STATUSES.join(", ")}.`,
      400,
      "status_invalido"
    );
  }

  const saved = await withTransaction(async (client) => {
    const updated = await client.query(
      "UPDATE platform.tenants SET status = $1 WHERE id = $2 RETURNING id, name, slug, status, plan",
      [next, tenant.id]
    );
    await auditWithin(client, {
      actor,
      action: next === "suspenso" ? "conta.suspensa" : "conta.reativada",
      tenantId: tenant.id,
      detail: {
        motivo,
        antes: { status: tenant.status },
        depois: { status: next },
        // Deixa explícito no log o que esta ação NÃO fez, para ninguém concluir
        // meses depois que a cobrança no Asaas parou junto.
        assinatura_no_gateway: "inalterada"
      }
    });
    return updated.rows[0];
  });

  // O cache de tenant tem 60s. Sem invalidar, uma clínica suspensa continuaria
  // atendida por até um minuto — e uma reativada continuaria bloqueada.
  invalidateTenantCache(tenant.slug);
  invalidateSubscriptionCache(tenant.id);

  return { ok: true, tenant: saved, assinatura_no_gateway: "inalterada" };
}

/**
 * Estende ou reinicia o trial.
 *
 * - `extend`: soma dias ao fim do trial (a partir de hoje, se já tiver passado —
 *   somar sobre uma data vencida devolveria um prazo que já nasce no passado).
 * - `restart`: recomeça a contagem hoje.
 *
 * Nos dois casos, uma assinatura em `trial_expired` volta para `trial_active`:
 * estender o prazo sem destravar o status seria um prazo que não libera nada.
 *
 * Uma assinatura PAGA (`active`/`overdue`) nunca é rebaixada para trial — a
 * clínica perderia o acesso que já pagou.
 */
export async function adjustTrial(tenantId, { days, mode = "extend", reason, actor } = {}) {
  const tenant = await loadTenant(tenantId);
  const motivo = requireReason(reason);

  const amount = Number(days);
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_TRIAL_DAYS) {
    throw new AccountAdminError(
      `Informe um número inteiro de dias entre 1 e ${MAX_TRIAL_DAYS}.`,
      400,
      "dias_invalidos"
    );
  }
  const action = String(mode || "extend").toLowerCase();
  if (!["extend", "restart"].includes(action)) {
    throw new AccountAdminError("Modo inválido. Use 'extend' ou 'restart'.", 400, "modo_invalido");
  }

  const before = await loadSubscriptionRow(tenant.id);
  if (!before) {
    throw new AccountAdminError(
      "Esta clínica não tem assinatura para ajustar o trial.",
      409,
      "assinatura_inexistente"
    );
  }
  const isPaid = ["active", "overdue"].includes(before.status);

  const saved = await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE platform.tenant_subscriptions
          SET trial_started_at = CASE WHEN $2 = 'restart' THEN now() ELSE COALESCE(trial_started_at, now()) END,
              trial_ends_at = CASE
                WHEN $2 = 'restart' THEN now() + ($3 || ' days')::interval
                -- GREATEST(now(), ...) é o que impede que "mais 7 dias" sobre um
                -- trial vencido há um mês devolva uma data ainda no passado.
                ELSE GREATEST(COALESCE(trial_ends_at, now()), now()) + ($3 || ' days')::interval
              END,
              status = CASE WHEN $4 THEN status ELSE 'trial_active' END,
              updated_at = now()
        WHERE tenant_id = $1
        RETURNING id, plan_code, status, trial_started_at, trial_ends_at, current_period_ends_at, canceled_at`,
      [tenant.id, action, String(amount), isPaid]
    );
    await auditWithin(client, {
      actor,
      action: "conta.trial_ajustado",
      tenantId: tenant.id,
      detail: {
        motivo,
        modo: action,
        dias: amount,
        antes: subscriptionSnapshot(before),
        depois: subscriptionSnapshot(updated.rows[0]),
        // Registrado porque é a única explicação para o status NÃO ter mudado.
        status_preservado: isPaid ? "assinatura paga não vira trial" : null
      }
    });
    return updated.rows[0];
  });

  invalidateSubscriptionCache(tenant.id);
  return { ok: true, tenant_id: tenant.id, mode: action, days: amount, subscription: saved };
}

/**
 * Força o status da assinatura. É a válvula de escape para o que o webhook não
 * cobre: pagamento fora do gateway, acordo comercial, cortesia, fraude.
 *
 * Forçar 'active' com período vencido também empurra `current_period_ends_at`
 * por 30 dias: sem isso a clínica ficaria 'active' com "0 dias restantes" na
 * tela — tecnicamente liberada, visualmente expirada, e o suporte receberia a
 * ligação assim mesmo.
 */
export async function forceSubscriptionStatus(tenantId, { status, reason, actor } = {}) {
  const tenant = await loadTenant(tenantId);
  const motivo = requireReason(reason);
  const next = String(status || "").trim().toLowerCase();
  if (!FORCEABLE_SUBSCRIPTION_STATUSES.includes(next) || !SUBSCRIPTION_STATUSES.includes(next)) {
    throw new AccountAdminError(
      `Status inválido. Use um destes: ${FORCEABLE_SUBSCRIPTION_STATUSES.join(", ")}.`,
      400,
      "status_invalido"
    );
  }

  const before = await loadSubscriptionRow(tenant.id);
  if (!before) {
    throw new AccountAdminError(
      "Esta clínica não tem assinatura para alterar.",
      409,
      "assinatura_inexistente"
    );
  }

  const saved = await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE platform.tenant_subscriptions
          SET status = $2,
              current_period_ends_at = CASE
                WHEN $2 = 'active' AND (current_period_ends_at IS NULL OR current_period_ends_at < now())
                  THEN now() + INTERVAL '30 days'
                ELSE current_period_ends_at
              END,
              -- 'canceled' carimba a data; sair de 'canceled' limpa o carimbo,
              -- senão a conta reativada continuaria parecendo cancelada.
              canceled_at = CASE WHEN $2 = 'canceled' THEN COALESCE(canceled_at, now()) ELSE NULL END,
              updated_at = now()
        WHERE tenant_id = $1
        RETURNING id, plan_code, status, trial_ends_at, current_period_ends_at, canceled_at`,
      [tenant.id, next]
    );
    await auditWithin(client, {
      actor,
      action: "conta.status_assinatura_forcado",
      tenantId: tenant.id,
      detail: {
        motivo,
        antes: subscriptionSnapshot(before),
        depois: subscriptionSnapshot(updated.rows[0]),
        assinatura_no_gateway: "inalterada"
      }
    });
    return updated.rows[0];
  });

  invalidateSubscriptionCache(tenant.id);
  return { ok: true, tenant_id: tenant.id, subscription: saved, assinatura_no_gateway: "inalterada" };
}

/**
 * Cancela a assinatura: a recorrência no Asaas e a linha daqui.
 *
 * O gateway vem primeiro e é BEST-EFFORT. Primeiro porque é a parte que pode
 * falhar e o resultado dela precisa entrar na auditoria; best-effort porque uma
 * indisponibilidade do Asaas não pode impedir o cancelamento local — cancelar
 * só do lado deles deixaria uma cobrança mensal viva sem registro nosso, que é
 * o pior dos dois erros possíveis. Quando falha, o erro fica no log E na
 * auditoria com `gateway_cancelado: false`, para alguém cancelar na mão.
 *
 * O acesso NÃO é cortado aqui: `tenants.status` continua 'ativo'. Cancelar a
 * cobrança e derrubar a clínica no mesmo instante tiraria dela o período que já
 * foi pago. Quem corta acesso é `setAccountStatus`.
 */
export async function cancelAccountSubscription(tenantId, { reason, actor } = {}) {
  const tenant = await loadTenant(tenantId);
  const motivo = requireReason(reason);

  const before = await loadSubscriptionRow(tenant.id);
  if (!before) {
    throw new AccountAdminError(
      "Esta clínica não tem assinatura para cancelar.",
      409,
      "assinatura_inexistente"
    );
  }

  let gatewayCanceled = false;
  let gatewayError = null;
  if (before.asaas_subscription_id) {
    if (!isPlatformEnabled()) {
      gatewayError = "Gateway não configurado neste ambiente; cancele a recorrência no painel do Asaas.";
    } else {
      try {
        await platformClient().cancelSubscription(before.asaas_subscription_id);
        gatewayCanceled = true;
      } catch (error) {
        gatewayError = error instanceof AsaasError ? error.message : String(error?.message || error);
        // Log SEM o objeto de erro inteiro: um erro de gateway costuma carregar
        // a requisição que o gerou, e neste fluxo ela pode conter dado do
        // pagador. Mensagem e status bastam para o diagnóstico.
        console.error(
          `[accountAdmin] falha ao cancelar no Asaas a assinatura ${before.asaas_subscription_id} ` +
            `da clínica ${tenant.id}: ${gatewayError}. CANCELE MANUALMENTE no painel do gateway.`
        );
      }
    }
  }

  const saved = await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE platform.tenant_subscriptions
          SET status = 'canceled', canceled_at = COALESCE(canceled_at, now()), updated_at = now()
        WHERE tenant_id = $1
        RETURNING id, plan_code, status, trial_ends_at, current_period_ends_at,
                  asaas_subscription_id, canceled_at`,
      [tenant.id]
    );
    await auditWithin(client, {
      actor,
      action: "conta.assinatura_cancelada",
      tenantId: tenant.id,
      detail: {
        motivo,
        antes: subscriptionSnapshot(before),
        depois: subscriptionSnapshot(updated.rows[0]),
        asaas_subscription_id: before.asaas_subscription_id || null,
        gateway_cancelado: gatewayCanceled,
        gateway_erro: gatewayError,
        acesso: "mantido — cancelar cobrança não suspende a clínica"
      }
    });
    return updated.rows[0];
  });

  invalidateSubscriptionCache(tenant.id);

  return {
    ok: true,
    tenant_id: tenant.id,
    subscription: saved,
    gateway_canceled: gatewayCanceled,
    gateway_error: gatewayError,
    warning: gatewayError
      ? "A assinatura foi cancelada aqui, mas a recorrência no Asaas pode continuar ativa. Cancele-a no painel do gateway."
      : null
  };
}
