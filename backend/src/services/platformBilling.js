// Cobrança da PLATAFORMA: a Monitence cobrando a assinatura das clínicas.
//
// Este arquivo é o outro lado da moeda de `tenantCharges.js`: aqui o dinheiro
// vai para a conta Asaas da Monitence (credencial só do ambiente, ver
// asaas/credentials.js) e o "pagador" é a própria clínica. Nada aqui usa a
// camada `db`/withDb: todo o estado mora no schema `platform`, que é global e
// não pertence a nenhum search_path de tenant — por isso as consultas usam
// `query()`/`pool` com placeholders $1 e prefixo `platform.` explícito.
//
// Três invariantes guiam o arquivo inteiro:
//
//  1. VALOR EM REAIS. Os planos guardam centavos (`price_cents`), o Asaas
//     trabalha em decimal ("value": 149.90). Um esquecimento de dividir por 100
//     cobra cem vezes o preço do plano.
//  2. WEBHOOK NUNCA EXPLODE POR COBRANÇA DESCONHECIDA. Exceção aqui vira HTTP
//     500 lá em routes/webhooks.js, o Asaas reentrega e, depois de algumas
//     falhas, PAUSA a fila da conta inteira — congelando a cobrança de todas as
//     clínicas. Só falha real e transitória (banco fora) pode lançar.
//  3. FATURA E ASSINATURA MUDAM JUNTAS. Toda escrita que toca as duas roda em
//     uma transação, senão existiria fatura paga com assinatura inativa (ou o
//     contrário) na janela entre os dois UPDATEs.
import { pool, query } from "../database/connection.js";
import { PUBLIC_APP_URL } from "../config/index.js";
import { AsaasError, minimumDueDate, onlyDigits } from "./asaas/client.js";
import { isPlatformEnabled, platformClient } from "./asaas/credentials.js";
import { isCanceledStatus, isPaidStatus } from "./asaas/events.js";
import { SUBSCRIPTION_PLANS, normalizePlanCode, planByCode } from "./plans.js";
import { invalidateSubscriptionCache } from "./subscriptions.js";

// Erro de regra de negócio desta camada, com o status HTTP já decidido aqui.
// Existe para a rota não ter de adivinhar se "CPF ausente" é 400 ou 500 — e
// para separá-lo do AsaasError, que é falha do gateway e não nossa.
export class PlatformBillingError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.name = "PlatformBillingError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

// A Aura usa somente checkout/fatura hospedada. Aceitar cartão bruto aqui
// colocaria toda a API no escopo PCI DSS e criaria risco de PAN/CVV em logs.
export const BILLING_TYPES = ["CREDIT_CARD", "PIX"];

// ---------------------------------------------------------------------------
// Infraestrutura
// ---------------------------------------------------------------------------

// Transação no schema `platform`. Não dá para reusar o `db.transaction` da
// camada de tenant: aquele client vem do withDb com search_path da clínica.
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
      // ROLLBACK que falha significa conexão morta: devolvê-la ao pool
      // "suja" (com transação aberta) contaminaria a próxima requisição.
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

function ensureGatewayEnabled() {
  if (!isPlatformEnabled()) {
    throw new PlatformBillingError(
      "Pagamento online não configurado. Fale com a Monitence para ativar a cobrança automática.",
      503,
      "gateway_indisponivel"
    );
  }
}

// Log de erro do gateway SEM o objeto inteiro: no fluxo de cartão o payload que
// gerou o erro carrega número e CVV, e um `console.error(error)` de um erro que
// embrulhe a requisição imprimiria o PAN no log do servidor para sempre.
function logGatewayError(context, error) {
  const status = error?.status ?? "-";
  const code = error?.code ?? "-";
  console.error(`[Asaas/platform] ${context} (status=${status} code=${code}): ${error?.message}`);
}

// Status da nossa fatura a partir do status da cobrança no Asaas.
function invoiceStatusFromPayment(status) {
  const name = String(status || "").toUpperCase();
  if (isPaidStatus(name)) return "paga";
  if (isRefundStatus(name)) return "estornada";
  if (isCanceledStatus(name)) return "cancelada";
  if (name === "OVERDUE") return "atrasada";
  return "pendente";
}

// Estorno/chargeback x exclusão simples. A distinção importa porque só o
// estorno pode reverter uma fatura JÁ PAGA (ver `applyCanceled`), e o webhook
// entrega os dois como a mesma ação "canceled".
function isRefundStatus(status) {
  return /REFUND|CHARGEBACK/i.test(String(status || ""));
}

// ---------------------------------------------------------------------------
// Cliente (pagador) da clínica na conta da Monitence
// ---------------------------------------------------------------------------

/**
 * Garante que a clínica exista como `customer` na conta Asaas da Monitence e
 * devolve o id dele. Idempotente: se já houver id gravado, reusa.
 */
export async function ensureAsaasCustomer(tenantId) {
  const found = await query(
    "SELECT id, name, tax_id, email, phone, asaas_customer_id FROM platform.tenants WHERE id = $1",
    [tenantId]
  );
  const tenant = found.rows[0];
  if (!tenant) throw new PlatformBillingError("Clínica não encontrada.", 404);
  // Falha cedo e com nome: o Asaas recusa criar cliente sem CPF/CNPJ, e o erro
  // dele ("invalid_cpfCnpj") não diz à clínica ONDE preencher o dado.
  const taxId = onlyDigits(tenant.tax_id);
  if (!taxId) {
    throw new PlatformBillingError(
      "Cadastre o CPF ou CNPJ do responsável pela clínica antes de assinar um plano.",
      400,
      "tax_id_ausente"
    );
  }

  if (tenant.asaas_customer_id) {
    await platformClient().updateCustomer(tenant.asaas_customer_id, {
      name: tenant.name,
      taxId,
      email: tenant.email,
      phone: tenant.phone,
      externalReference: `tenant:${tenant.id}`
    });
    return tenant.asaas_customer_id;
  }

  const customer = await platformClient().createCustomer({
    name: tenant.name,
    taxId,
    email: tenant.email,
    phone: tenant.phone,
    // Ancoragem inversa: pelo painel do Asaas dá para chegar na clínica sem
    // consultar nosso banco (e o webhook usa isso como último recurso).
    externalReference: `tenant:${tenant.id}`
  });
  const customerId = customer?.id;
  if (!customerId) {
    throw new AsaasError("O gateway não devolveu o identificador do cliente.", { status: 502 });
  }

  // `AND asaas_customer_id IS NULL` resolve a corrida entre dois checkouts
  // simultâneos: quem perde não sobrescreve o vencedor (o índice único
  // ux_tenants_asaas_customer rejeitaria de qualquer forma) e passa a usar o id
  // que ficou gravado. O customer perdedor vira um cadastro órfão no Asaas —
  // inofensivo, porque cliente sem cobrança não gera nada.
  const saved = await query(
    `UPDATE platform.tenants SET asaas_customer_id = $1
      WHERE id = $2 AND asaas_customer_id IS NULL
      RETURNING asaas_customer_id`,
    [customerId, tenant.id]
  );
  if (saved.rows[0]) return saved.rows[0].asaas_customer_id;

  const current = await query("SELECT asaas_customer_id FROM platform.tenants WHERE id = $1", [
    tenant.id
  ]);
  return current.rows[0]?.asaas_customer_id || customerId;
}

// ---------------------------------------------------------------------------
// Checkout da assinatura
// ---------------------------------------------------------------------------

// Grava/atualiza a fatura a partir de uma cobrança do Asaas.
//
// O ON CONFLICT no índice parcial ux_tenant_invoices_asaas_payment é a
// idempotência de verdade: webhook "created" e a leitura da 1ª fatura no
// checkout descrevem a MESMA cobrança e correm em paralelo. Quem chegar depois
// atualiza a linha em vez de criar uma segunda.
async function upsertInvoice(runner, { tenantId, subscriptionId, planCode, payment, status }) {
  const result = await runner.query(
    `INSERT INTO platform.tenant_invoices
       (tenant_id, subscription_id, asaas_payment_id, asaas_subscription_id, plan_code,
        amount, status, billing_type, due_date, paid_at, invoice_url, competencia)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10,
             $11, date_trunc('month', COALESCE($9::date, now()))::date)
     ON CONFLICT (asaas_payment_id) WHERE asaas_payment_id IS NOT NULL
     DO UPDATE SET
       subscription_id = COALESCE(platform.tenant_invoices.subscription_id, excluded.subscription_id),
       plan_code = COALESCE(platform.tenant_invoices.plan_code, excluded.plan_code),
       amount = excluded.amount,
       status = excluded.status,
       billing_type = COALESCE(excluded.billing_type, platform.tenant_invoices.billing_type),
       due_date = COALESCE(excluded.due_date, platform.tenant_invoices.due_date),
       paid_at = COALESCE(excluded.paid_at, platform.tenant_invoices.paid_at),
       -- A URL da fatura só some quando o Asaas para de servi-la; preservar a
       -- antiga é melhor que zerar o único link que a clínica tem para pagar.
       invoice_url = COALESCE(excluded.invoice_url, platform.tenant_invoices.invoice_url),
       updated_at = now()
     RETURNING *`,
    [
      tenantId,
      subscriptionId ?? null,
      payment.id,
      payment.subscription ?? null,
      planCode ?? null,
      Number(payment.value ?? 0),
      status,
      payment.billingType ?? null,
      payment.dueDate ?? null,
      status === "paga" ? payment.paymentDate || new Date().toISOString() : null,
      payment.invoiceUrl ?? null
    ]
  );
  return result.rows[0];
}

/**
 * Cria (ou troca) a assinatura recorrente da clínica na conta da Monitence.
 *
 * @param {number} tenantId
 * @param {{ planCode: string, billingType?: string }} options
 */
export async function startSubscriptionCheckout(
  tenantId,
  { planCode, billingType = "CREDIT_CARD" } = {}
) {
  ensureGatewayEnabled();

  // planByCode() cai no plano padrão quando o código é desconhecido — ótimo
  // para leitura, péssimo para checkout: a clínica escolheria "inexistente" e
  // seria cobrada como "profissional". Aqui a validação é estrita.
  const code = normalizePlanCode(planCode, "");
  if (!code) {
    throw new PlatformBillingError(
      `Plano inválido. Use um destes: ${SUBSCRIPTION_PLANS.map((plan) => plan.code).join(", ")}.`,
      400,
      "plano_invalido"
    );
  }
  const plan = planByCode(code);

  const type = String(billingType || "CREDIT_CARD").toUpperCase();
  if (!BILLING_TYPES.includes(type)) {
    throw new PlatformBillingError(
      "Forma de pagamento inválida. Escolha cartão de crédito ou PIX.",
      400,
      "billing_type_invalido"
    );
  }

  const customerId = await ensureAsaasCustomer(tenantId);

  const currentResult = await query(
    `SELECT id, plan_code, status, billing_type, asaas_subscription_id, asaas_checkout_id,
            checkout_url, checkout_expires_at
       FROM platform.tenant_subscriptions WHERE tenant_id = $1`,
    [tenantId]
  );
  const current = currentResult.rows[0] || null;

  if (current?.asaas_subscription_id && current.status !== "canceled") {
    throw new PlatformBillingError(
      "Já existe uma assinatura no gateway. A troca de plano deve passar pelo suporte até que o fluxo de prorrata esteja disponível.",
      409,
      "plan_change_requires_support"
    );
  }

  // Reabrir um checkout de cartão ainda válido é mais seguro do que criar
  // vários links para o mesmo plano em duplo-clique/reentrada posterior.
  if (
    type === "CREDIT_CARD" &&
    current?.plan_code === code &&
    current?.billing_type === type &&
    current?.asaas_checkout_id &&
    current?.checkout_url &&
    new Date(current.checkout_expires_at).getTime() > Date.now()
  ) {
    return {
      subscription_id: current.id,
      asaas_subscription_id: null,
      billing_type: type,
      checkout_url: current.checkout_url,
      status: current.status
    };
  }

  if (current?.asaas_checkout_id) {
    try {
      await platformClient().cancelCheckout(current.asaas_checkout_id);
    } catch (error) {
      // 404 significa que o link já não existe. Qualquer outra falha deixa o
      // estado incerto; criar outro checkout nessa situação poderia duplicar
      // a recorrência, então interrompemos.
      if (error?.status !== 404) throw error;
    }
  }

  if (type === "CREDIT_CARD") {
    let checkout;
    try {
      checkout = await platformClient().createCheckout({
        billingTypes: ["CREDIT_CARD"],
        customer: customerId,
        externalReference: `tenant:${tenantId}`,
        items: [{
          name: `Plano ${plan.name}`,
          description: "Assinatura mensal Aura Clinic",
          quantity: 1,
          value: plan.price_cents / 100
        }],
        subscription: { cycle: "MONTHLY", nextDueDate: `${minimumDueDate()} 12:00:00` },
        callback: {
          successUrl: `${PUBLIC_APP_URL}/app/meu-plano?checkout=sucesso`,
          cancelUrl: `${PUBLIC_APP_URL}/app/meu-plano?checkout=cancelado`,
          expiredUrl: `${PUBLIC_APP_URL}/app/meu-plano?checkout=expirado`
        }
      });
    } catch (error) {
      logGatewayError(`falha ao criar checkout de cartão do tenant ${tenantId}`, error);
      throw error;
    }
    const checkoutId = checkout?.id;
    const checkoutUrl = checkout?.link || (checkoutId ? `https://asaas.com/checkoutSession/show?id=${checkoutId}` : null);
    if (!checkoutId || !checkoutUrl) {
      throw new AsaasError("O gateway não devolveu o link do checkout.", { status: 502 });
    }
    const savedCheckout = await withTransaction(async (client) => {
      const row = await client.query(
        `INSERT INTO platform.tenant_subscriptions
           (tenant_id, plan_code, status, billing_type, asaas_checkout_id, checkout_url,
            checkout_expires_at, updated_at)
         VALUES ($1, $2, 'trial_active', $3, $4, $5, now() + INTERVAL '24 hours', now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           plan_code = excluded.plan_code,
           billing_type = excluded.billing_type,
           asaas_subscription_id = NULL,
           asaas_checkout_id = excluded.asaas_checkout_id,
           checkout_url = excluded.checkout_url,
           checkout_expires_at = excluded.checkout_expires_at,
           canceled_at = NULL,
           updated_at = now()
         RETURNING id, status`,
        [tenantId, code, type, checkoutId, checkoutUrl]
      );
      await client.query("UPDATE platform.tenants SET plan = $1 WHERE id = $2", [code, tenantId]);
      return row.rows[0];
    });
    invalidateSubscriptionCache(tenantId);
    return {
      subscription_id: savedCheckout.id,
      asaas_subscription_id: null,
      billing_type: type,
      checkout_url: checkoutUrl,
      status: savedCheckout.status
    };
  }

  let subscription;
  try {
    subscription = await platformClient().createSubscription({
      customer: customerId,
      // price_cents -> reais. É a divisão que não pode faltar.
      value: plan.price_cents / 100,
      cycle: "MONTHLY",
      billingType: type,
      description: `Assinatura Monitence — ${plan.name}`,
      externalReference: `tenant:${tenantId}`
      // `nextDueDate` fica a cargo do cliente do Asaas: o piso é amanhã
      // (minimumDueDate), porque o gateway rejeita vencimento no passado.
    });
  } catch (error) {
    logGatewayError(`falha ao criar assinatura do tenant ${tenantId} (plano ${code})`, error);
    throw error;
  }

  const asaasSubscriptionId = subscription?.id;
  if (!asaasSubscriptionId) {
    throw new AsaasError("O gateway não devolveu o identificador da assinatura.", { status: 502 });
  }

  // O status NÃO vira 'active' aqui: quem confirma pagamento é o webhook. Mas o
  // plano é atualizado agora, porque a recorrência no gateway já foi criada com
  // este valor — deixar as duas pontas divergentes faria a clínica ver um plano
  // e ser cobrada por outro. O acesso continua governado por `status`.
  const saved = await withTransaction(async (client) => {
    const row = await client.query(
      `INSERT INTO platform.tenant_subscriptions
         (tenant_id, plan_code, status, asaas_subscription_id, billing_type, updated_at)
       VALUES ($1, $2, 'trial_active', $3, $4, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         plan_code = excluded.plan_code,
         asaas_subscription_id = excluded.asaas_subscription_id,
         billing_type = excluded.billing_type,
         asaas_checkout_id = NULL,
         checkout_url = NULL,
         checkout_expires_at = NULL,
         canceled_at = NULL,
         updated_at = now()
       RETURNING id, status, plan_code, billing_type, asaas_subscription_id`,
      [tenantId, code, asaasSubscriptionId, type]
    );
    // `platform.tenants.plan` alimenta o diretório público (/api/clinics) e o
    // painel; as duas colunas precisam contar a mesma história.
    await client.query("UPDATE platform.tenants SET plan = $1 WHERE id = $2", [code, tenantId]);
    return row.rows[0];
  });
  invalidateSubscriptionCache(tenantId);

  // Primeira fatura: BEST-EFFORT, e isso é essencial. Neste ponto a assinatura
  // já existe no gateway e, no cartão, a primeira parcela JÁ FOI COBRADA.
  // Deixar uma falha de leitura derrubar o checkout faria o usuário tentar de
  // novo e ser cobrado duas vezes. Se falhar, o webhook PAYMENT_CREATED
  // materializa a fatura depois — e syncInvoice é a rede de segurança.
  let invoiceUrl = null;
  try {
    const payments = await platformClient().getSubscriptionPayments(asaasSubscriptionId);
    const first = [...payments].sort((a, b) =>
      String(a?.dueDate || "").localeCompare(String(b?.dueDate || ""))
    )[0];
    if (first?.id) {
      const invoice = await upsertInvoice(pool, {
        tenantId,
        subscriptionId: saved.id,
        planCode: code,
        payment: {
          id: String(first.id),
          subscription: asaasSubscriptionId,
          value: Number(first.value ?? plan.price_cents / 100),
          billingType: first.billingType || type,
          dueDate: first.dueDate || null,
          paymentDate: first.paymentDate || first.clientPaymentDate || null,
          invoiceUrl: first.invoiceUrl || null
        },
        status: invoiceStatusFromPayment(first.status)
      });
      invoiceUrl = invoice?.invoice_url || null;
    }
  } catch (error) {
    logGatewayError(`falha ao ler a primeira fatura da assinatura ${asaasSubscriptionId}`, error);
  }

  return {
    subscription_id: saved.id,
    asaas_subscription_id: asaasSubscriptionId,
    billing_type: type,
    invoice_url: invoiceUrl,
    status: saved.status
  };
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

// Descobre de quem é a cobrança. Três caminhos, do mais forte para o mais
// fraco, porque nem todo evento traz os mesmos campos:
//   1. fatura já registrada com este payment.id (casamento exato);
//   2. assinatura recorrente (payment.subscription);
//   3. externalReference "tenant:<id>", gravado por nós na criação.
// Nenhum deles resolvendo, a cobrança simplesmente não é nossa.
async function locateCharge(payment) {
  if (payment?.id) {
    const byInvoice = await query(
      `SELECT i.id AS invoice_id, i.tenant_id, i.subscription_id, i.plan_code
         FROM platform.tenant_invoices i
        WHERE i.asaas_payment_id = $1`,
      [payment.id]
    );
    const row = byInvoice.rows[0];
    if (row) {
      return {
        tenantId: row.tenant_id,
        subscriptionId: row.subscription_id,
        planCode: row.plan_code,
        invoiceId: row.invoice_id
      };
    }
  }

  if (payment?.subscription) {
    const bySubscription = await query(
      `SELECT id, tenant_id, plan_code FROM platform.tenant_subscriptions
        WHERE asaas_subscription_id = $1`,
      [payment.subscription]
    );
    const row = bySubscription.rows[0];
    if (row) {
      return {
        tenantId: row.tenant_id,
        subscriptionId: row.id,
        planCode: row.plan_code,
        invoiceId: null
      };
    }
  }

  const reference = String(payment?.externalReference || "");
  const match = reference.match(/^tenant:(\d+)$/);
  if (match) {
    const byTenant = await query(
      `SELECT s.id, s.tenant_id, s.plan_code
         FROM platform.tenant_subscriptions s
        WHERE s.tenant_id = $1`,
      [Number(match[1])]
    );
    const row = byTenant.rows[0];
    if (row) {
      return {
        tenantId: row.tenant_id,
        subscriptionId: row.id,
        planCode: row.plan_code,
        invoiceId: null
      };
    }
  }

  return null;
}

// Trava a fatura para esta transação. O FOR UPDATE é o que serializa duas
// entregas do mesmo pagamento (PAYMENT_CONFIRMED e PAYMENT_RECEIVED chegam
// juntos): sem ele, as duas leriam "pendente" e as duas aplicariam o efeito.
async function lockInvoice(client, paymentId) {
  const result = await client.query(
    "SELECT * FROM platform.tenant_invoices WHERE asaas_payment_id = $1 FOR UPDATE",
    [paymentId]
  );
  return result.rows[0] || null;
}

async function attachRemoteSubscription(client, charge, payment) {
  if (!payment?.subscription) return;
  await client.query(
    `UPDATE platform.tenant_subscriptions
        SET asaas_subscription_id = COALESCE(asaas_subscription_id, $1),
            billing_type = COALESCE($2, billing_type),
            asaas_checkout_id = NULL,
            checkout_url = NULL,
            checkout_expires_at = NULL,
            updated_at = now()
      WHERE id = $3`,
    [payment.subscription, payment.billingType || null, charge.subscriptionId]
  );
}

async function applyCreated({ payment, charge }) {
  const existing = await query(
    "SELECT id FROM platform.tenant_invoices WHERE asaas_payment_id = $1",
    [payment.id]
  );
  if (existing.rows[0]) return { applied: false, detail: "fatura-ja-registrada" };

  await withTransaction(async (client) => {
    await attachRemoteSubscription(client, charge, payment);
    await upsertInvoice(client, {
      tenantId: charge.tenantId,
      subscriptionId: charge.subscriptionId,
      planCode: charge.planCode,
      payment,
      status: "pendente"
    });
  });
  invalidateSubscriptionCache(charge.tenantId);
  return { applied: true, detail: `fatura-criada:${payment.id}` };
}

async function applyPaid({ payment, charge }) {
  const outcome = await withTransaction(async (client) => {
    const invoice = await lockInvoice(client, payment.id);
    // Reprocesso é o caminho NORMAL aqui (dois eventos por cobrança), não a
    // exceção: sair cedo evita empurrar o vencimento um mês a cada entrega.
    if (invoice?.status === "paga") return { applied: false, detail: "ja-paga" };

    await attachRemoteSubscription(client, charge, payment);
    await upsertInvoice(client, {
      tenantId: charge.tenantId,
      subscriptionId: charge.subscriptionId ?? invoice?.subscription_id ?? null,
      planCode: charge.planCode ?? invoice?.plan_code ?? null,
      payment,
      status: "paga"
    });

    // GREATEST(...) evita duas armadilhas: renovar antes do vencimento não
    // encurta o período pago, e uma assinatura vencida há meses não ganha
    // crédito retroativo — o mês novo conta a partir de hoje.
    await client.query(
      `UPDATE platform.tenant_subscriptions
          SET status = 'active',
              current_period_ends_at =
                GREATEST(COALESCE(current_period_ends_at, now()), now()) + INTERVAL '1 month',
              canceled_at = NULL,
              grace_ends_at = NULL,
              billing_suspended_at = NULL,
              updated_at = now()
        WHERE tenant_id = $1
          AND (status <> 'canceled')
          AND (status <> 'suspended' OR billing_suspended_at IS NOT NULL)`,
      [charge.tenantId]
    );
    return { applied: true, detail: `fatura-paga:${payment.id}` };
  });

  if (outcome.applied) invalidateSubscriptionCache(charge.tenantId);
  return outcome;
}

async function applyOverdue({ payment, charge }) {
  const outcome = await withTransaction(async (client) => {
    const invoice = await lockInvoice(client, payment.id);
    // Fatura paga que recebe OVERDUE é ruído de ordenação de eventos; ignorar é
    // mais seguro que rebaixar quem já pagou.
    if (invoice && invoice.status !== "pendente") {
      return { applied: false, detail: `fatura-${invoice.status}` };
    }

    await attachRemoteSubscription(client, charge, payment);
    await upsertInvoice(client, {
      tenantId: charge.tenantId,
      subscriptionId: charge.subscriptionId ?? invoice?.subscription_id ?? null,
      planCode: charge.planCode ?? invoice?.plan_code ?? null,
      payment,
      status: "atrasada"
    });

    // O atraso abre cinco dias completos de carência. `overdue` continua com
    // acesso enquanto grace_ends_at não passou; o worker de ciclo financeiro
    // converte em `suspended` somente depois desse prazo.
    await client.query(
      `UPDATE platform.tenant_subscriptions
          SET status = 'overdue',
              grace_ends_at = COALESCE($2::date, CURRENT_DATE) + INTERVAL '6 days',
              billing_suspended_at = NULL,
              updated_at = now()
        WHERE tenant_id = $1 AND status IN ('active', 'trial_active')`,
      [charge.tenantId, payment.dueDate || null]
    );
    return { applied: true, detail: `fatura-atrasada:${payment.id}` };
  });

  if (outcome.applied) invalidateSubscriptionCache(charge.tenantId);
  return outcome;
}

async function applyCanceled({ payment, charge }) {
  // O webhook entrega exclusão, estorno e chargeback como a mesma ação
  // ("canceled"); só o `payment.status` separa os casos.
  const refund = isRefundStatus(payment.status);

  const outcome = await withTransaction(async (client) => {
    const invoice = await lockInvoice(client, payment.id);
    if (!invoice) return { applied: false, detail: "fatura-inexistente" };
    if (invoice.status === "cancelada" || invoice.status === "estornada") {
      return { applied: false, detail: `ja-${invoice.status}` };
    }

    // Cancelamento comum NÃO desfaz fatura paga: o Asaas emite PAYMENT_DELETED
    // ao limpar cobranças antigas, e aceitar isso apagaria o pagamento de quem
    // pagou. Estorno e chargeback são o oposto: o dinheiro voltou para a
    // clínica, então a fatura tem de ser revertida mesmo estando paga — e a
    // assinatura volta a 'overdue' até haver um novo pagamento.
    if (invoice.status === "paga" && !refund) {
      return { applied: false, detail: "fatura-paga-nao-cancelada" };
    }

    const revertingPaid = invoice.status === "paga" && refund;
    await client.query(
      `UPDATE platform.tenant_invoices
          SET status = $1, paid_at = CASE WHEN $2 THEN NULL ELSE paid_at END, updated_at = now()
        WHERE id = $3`,
      [refund ? "estornada" : "cancelada", refund, invoice.id]
    );

    if (revertingPaid) {
      await client.query(
        `UPDATE platform.tenant_subscriptions
            SET status = 'overdue', updated_at = now()
          WHERE tenant_id = $1 AND status IN ('active', 'trial_active')`,
        [charge.tenantId]
      );
    }
    return {
      applied: true,
      detail: `${refund ? "fatura-estornada" : "fatura-cancelada"}:${payment.id}`,
      touchedSubscription: revertingPaid
    };
  });

  if (outcome.touchedSubscription) invalidateSubscriptionCache(charge.tenantId);
  return { applied: outcome.applied, detail: outcome.detail };
}

/**
 * Handler chamado por routes/webhooks.js para eventos da conta da Monitence.
 *
 * @param {{ action: "paid"|"overdue"|"canceled"|"created", payment: object }} event
 * @returns {Promise<{ applied: boolean, detail: string }>}
 *   `applied:false` significa "não é minha cobrança / nada a fazer" — o webhook
 *   responde 200 e o Asaas não reentrega. Lançar aqui só se a falha for real e
 *   transitória (banco fora), para a reentrega valer a pena.
 */
export async function applyPlatformPaymentEvent({ action, payment }) {
  if (!payment?.id) return { applied: false, detail: "sem-payment-id" };

  const charge = await locateCharge(payment);
  // Cobrança que não casa com nenhuma clínica NÃO é erro: a conta da Monitence
  // pode ter cobranças criadas à mão no painel, e devolver 500 aqui faria o
  // Asaas reentregar para sempre e acabar pausando a fila da conta.
  if (!charge) return { applied: false, detail: "cobranca-desconhecida" };

  switch (action) {
    case "created":
      return applyCreated({ payment, charge });
    case "paid":
      return applyPaid({ payment, charge });
    case "overdue":
      return applyOverdue({ payment, charge });
    case "canceled":
      return applyCanceled({ payment, charge });
    default:
      return { applied: false, detail: `acao-nao-tratada:${action}` };
  }
}

// ---------------------------------------------------------------------------
// Conciliação e leitura
// ---------------------------------------------------------------------------

/**
 * Rede de segurança para o webhook que se perdeu: relê a cobrança no gateway e
 * aplica o mesmo efeito do evento correspondente. Pode ser chamada à vontade —
 * os handlers são idempotentes.
 */
export async function syncInvoice(invoiceId) {
  ensureGatewayEnabled();

  const found = await query("SELECT * FROM platform.tenant_invoices WHERE id = $1", [invoiceId]);
  const invoice = found.rows[0];
  if (!invoice) throw new PlatformBillingError("Fatura não encontrada.", 404);
  if (!invoice.asaas_payment_id) {
    return { applied: false, detail: "fatura-sem-cobranca-no-gateway" };
  }

  const remote = await platformClient().getPayment(invoice.asaas_payment_id);
  const payment = {
    id: String(remote?.id || invoice.asaas_payment_id),
    status: remote?.status || null,
    subscription: remote?.subscription || invoice.asaas_subscription_id || null,
    customer: remote?.customer || null,
    externalReference: remote?.externalReference || null,
    value: Number.isFinite(Number(remote?.value)) ? Number(remote.value) : Number(invoice.amount),
    netValue: Number.isFinite(Number(remote?.netValue)) ? Number(remote.netValue) : null,
    dueDate: remote?.dueDate || invoice.due_date || null,
    paymentDate: remote?.paymentDate || remote?.clientPaymentDate || null,
    billingType: remote?.billingType || invoice.billing_type || null,
    invoiceUrl: remote?.invoiceUrl || invoice.invoice_url || null,
    description: remote?.description || null
  };

  // GET /payments devolve o STATUS do recurso ("RECEIVED"), não o nome do
  // evento ("PAYMENT_RECEIVED"); isPaidStatus/isCanceledStatus aceitam ambos
  // justamente porque confundir as duas nomenclaturas é o bug clássico aqui.
  const status = String(payment.status || "").toUpperCase();
  let action = null;
  if (isPaidStatus(status)) action = "paid";
  else if (isCanceledStatus(status)) action = "canceled";
  else if (status === "OVERDUE") action = "overdue";
  else if (status === "PENDING" || status === "AWAITING_RISK_ANALYSIS") action = "created";

  if (!action) return { applied: false, detail: `status-sem-acao:${status || "desconhecido"}` };
  return applyPlatformPaymentEvent({ action, payment });
}

// ---------------------------------------------------------------------------
// Reajuste da recorrência (a assinatura Monitence -> clínica)
// ---------------------------------------------------------------------------

// Estados possíveis da propagação. Ficam listados aqui porque a tela e a
// auditoria leem este campo, e um estado inventado no meio do caminho viraria
// "status desconhecido" para quem precisa decidir o que fazer.
export const SUBSCRIPTION_SYNC_STATUSES = [
  "atualizado", // o gateway passou a cobrar o valor do plano vigente
  "ja_sincronizado", // já cobrava esse valor; nada foi escrito
  "sem_assinatura", // clínica sem recorrência no Asaas — não há o que reajustar
  "assinatura_cancelada", // cancelada aqui; reajustar reviveria uma cobrança encerrada
  "plano_sem_preco", // plano gratuito: o Asaas recusa assinatura de valor zero
  "gateway_indisponivel", // sem credencial da plataforma neste ambiente
  "falhou" // o Asaas respondeu erro (ou não respondeu)
];

function reais(centavos) {
  return `R$ ${(Number(centavos || 0) / 100).toFixed(2).replace(".", ",")}`;
}

/**
 * Faz a assinatura recorrente no Asaas concordar com o plano vigente da clínica.
 *
 * É a peça que faltava na troca de plano: mudar `plan_code` libera recursos na
 * hora, mas a recorrência no gateway continua emitindo o valor antigo — uma
 * clínica promovida seguiria pagando o plano barato até alguém reparar na
 * fatura.
 *
 * Três decisões guiam a função:
 *
 *  1. NUNCA LANÇA. Quem chama já mudou o plano no banco (o acesso da clínica
 *     JÁ mudou) e não pode desfazer isso porque o gateway está fora do ar.
 *     Toda saída é um relatório com `status` — inclusive a de erro.
 *  2. É IDEMPOTENTE POR CONSTRUÇÃO. Só faz `POST /subscriptions/{id}` sobre uma
 *     assinatura que já existe, com o valor ABSOLUTO do plano; não cria
 *     assinatura nem cobrança, então repetir não duplica nada. A leitura antes
 *     da escrita é o mesmo tipo de guarda de estado que os handlers de webhook
 *     usam (`if (invoice.status === "paga") return`): se o gateway já cobra o
 *     valor certo, a chamada de escrita nem acontece. Por isso não passa por
 *     `services/idempotency.js`, que existe para o caso oposto — requisições
 *     que CRIAM cobrança e cujo replay cobraria duas vezes.
 *  3. CREDENCIAL DA PLATAFORMA, sempre. Quem cobra a assinatura é a Monitence;
 *     a chave da clínica cobra o cliente final dela e não tem nada a ver com
 *     esta recorrência.
 *
 * @param {number} tenantId
 * @param {{ gateway?: object }} [options] `gateway` é ponto de injeção para os
 *   testes exercitarem o caminho de SUCESSO sem credencial real. Nenhuma rota
 *   passa esse parâmetro: o cliente do Asaas nunca pode vir de fora.
 */
export async function syncSubscriptionPrice(tenantId, { gateway = null } = {}) {
  const found = await query(
    `SELECT id, tenant_id, plan_code, status, asaas_subscription_id
       FROM platform.tenant_subscriptions
      WHERE tenant_id = $1`,
    [tenantId]
  );
  const row = found.rows[0] || null;
  const plan = planByCode(row?.plan_code);

  const base = {
    tenant_id: Number(tenantId),
    plan_code: row?.plan_code ?? null,
    plan_name: plan.name,
    price_cents: plan.price_cents,
    asaas_subscription_id: row?.asaas_subscription_id ?? null,
    valor_esperado: plan.price_cents / 100,
    valor_no_gateway: null,
    erro: null
  };

  if (!row || !row.asaas_subscription_id) {
    return {
      ...base,
      status: "sem_assinatura",
      detalhe: "Esta clínica não tem assinatura recorrente no Asaas; não há cobrança a reajustar."
    };
  }
  if (row.status === "canceled") {
    return {
      ...base,
      status: "assinatura_cancelada",
      detalhe:
        `A assinatura ${row.asaas_subscription_id} está cancelada aqui e não foi reajustada: ` +
        "mexer no valor de uma recorrência encerrada só faria sentido se a intenção fosse recobrar."
    };
  }
  // O Asaas recusa assinatura de valor zero (e `toAsaasValue` barra antes
  // disso). Plano gratuito não é erro de configuração — é um caso em que a
  // recorrência precisa ser CANCELADA, não reajustada.
  if (!(plan.price_cents > 0)) {
    return {
      ...base,
      status: "plano_sem_preco",
      detalhe:
        `O plano "${plan.name}" não tem preço, e o gateway não aceita assinatura de valor zero. ` +
        `A recorrência ${row.asaas_subscription_id} continua com o valor anterior.`
    };
  }
  // A guarda é sobre a CREDENCIAL, não sobre o ambiente: quem injeta um cliente
  // (os testes) já trouxe o próprio meio de falar com o gateway, e `platformClient()`
  // sem chave só produziria um erro tardio de "credencial não configurada".
  if (!gateway && !isPlatformEnabled()) {
    return {
      ...base,
      status: "gateway_indisponivel",
      detalhe:
        "O gateway da plataforma não está configurado neste ambiente; " +
        `a assinatura ${row.asaas_subscription_id} continua com o valor anterior.`
    };
  }

  const asaas = gateway || platformClient();

  // Leitura antes da escrita: além de tornar o reprocesso um no-op de verdade,
  // é ela que dá ao operador o "de X para Y" no relatório. Falhar aqui NÃO
  // aborta a operação — o que importa é a escrita, e uma leitura perdida não
  // pode ser motivo para deixar a clínica sendo cobrada errado.
  let valorAtual = null;
  try {
    const remoto = await asaas.getSubscription(row.asaas_subscription_id);
    const valor = Number(remoto?.value);
    if (Number.isFinite(valor)) valorAtual = valor;
  } catch (error) {
    logGatewayError(
      `falha ao ler a assinatura ${row.asaas_subscription_id} do tenant ${tenantId} antes do reajuste`,
      error
    );
  }

  if (valorAtual !== null && Math.round(valorAtual * 100) === plan.price_cents) {
    return {
      ...base,
      status: "ja_sincronizado",
      valor_no_gateway: valorAtual,
      detalhe:
        `A assinatura ${row.asaas_subscription_id} já cobra ${reais(plan.price_cents)} ` +
        `(plano "${plan.name}"). Nada foi enviado ao gateway.`
    };
  }

  try {
    const atualizada = await asaas.updateSubscription(row.asaas_subscription_id, {
      // price_cents -> reais. A divisão que, esquecida, cobra cem vezes o plano.
      value: plan.price_cents / 100,
      // As cobranças já emitidas e ainda não pagas precisam acompanhar, senão a
      // clínica recebe no mês que vem uma fatura com o preço velho.
      updatePendingPayments: true
    });
    const valorDepois = Number(atualizada?.value);
    return {
      ...base,
      status: "atualizado",
      valor_anterior: valorAtual,
      valor_no_gateway: Number.isFinite(valorDepois) ? valorDepois : plan.price_cents / 100,
      detalhe:
        `Assinatura ${row.asaas_subscription_id} reajustada para ${reais(plan.price_cents)} ` +
        `(plano "${plan.name}"), inclusive nas cobranças pendentes.`
    };
  } catch (error) {
    const mensagem = error instanceof AsaasError ? error.message : String(error?.message || error);
    logGatewayError(
      `falha ao reajustar a assinatura ${row.asaas_subscription_id} do tenant ${tenantId} ` +
        `para o plano ${plan.code}`,
      error
    );
    return {
      ...base,
      status: "falhou",
      erro: mensagem,
      valor_no_gateway: valorAtual,
      detalhe:
        `O gateway recusou o reajuste da assinatura ${row.asaas_subscription_id}: ${mensagem}. ` +
        "A cobrança recorrente continua com o valor anterior."
    };
  }
}

/**
 * O aviso que o operador precisa LER E AGIR, ou `null`.
 *
 * Só vira aviso o que deixa dinheiro pendurado. Sucesso, "já estava certo" e
 * "esta clínica não tem recorrência" são estados normais e viajam em
 * `gateway.detalhe`, que a tela mostra junto da mensagem de sucesso — um alerta
 * vermelho para cada troca de plano em ambiente sem gateway treinaria o
 * super-admin a fechar o aviso sem ler, justamente o que ele não pode fazer no
 * dia em que a propagação falhar de verdade.
 */
export function subscriptionSyncWarning(outcome) {
  if (!outcome) return null;
  const id = outcome.asaas_subscription_id;
  switch (outcome.status) {
    case "falhou":
      return (
        `Não foi possível reajustar a assinatura ${id} no Asaas: ${outcome.erro}. ` +
        `O plano novo já vale para a clínica, mas a cobrança recorrente continua no valor anterior — ` +
        `use "Reenviar ajuste ao Asaas" para tentar de novo.`
      );
    case "gateway_indisponivel":
      return (
        `O gateway não está configurado neste ambiente: a assinatura ${id} continua cobrando o valor ` +
        `anterior, não ${reais(outcome.price_cents)}. Reenvie o ajuste num ambiente com a chave da ` +
        "plataforma, ou corrija o valor no painel do Asaas."
      );
    case "assinatura_cancelada":
      return (
        `A assinatura ${id} está cancelada aqui e não foi tocada no gateway. Se a recorrência ainda ` +
        "estiver viva no Asaas, ela continua cobrando o valor antigo — cancele-a no painel."
      );
    case "plano_sem_preco":
      return (
        `O plano "${outcome.plan_name}" é gratuito e o Asaas não aceita assinatura de valor zero: a ` +
        `recorrência ${id} continua cobrando o valor anterior. Cancele-a no painel do gateway se a ` +
        "clínica não deve mais ser cobrada."
      );
    default:
      return null;
  }
}

/** Faturas da clínica, da mais recente para a mais antiga. */
export async function listTenantInvoices(tenantId, { limit = 20, offset = 0 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = Math.max(Number(offset) || 0, 0);

  const rows = await query(
    `SELECT id, tenant_id, subscription_id, asaas_payment_id, plan_code, amount, status,
            billing_type, due_date, paid_at, invoice_url, competencia, created_at, updated_at
       FROM platform.tenant_invoices
      WHERE tenant_id = $1
      ORDER BY COALESCE(due_date, created_at::date) DESC, id DESC
      LIMIT $2 OFFSET $3`,
    [tenantId, size, skip]
  );
  const counted = await query(
    "SELECT COUNT(*)::int AS total FROM platform.tenant_invoices WHERE tenant_id = $1",
    [tenantId]
  );

  return { items: rows.rows, total: counted.rows[0]?.total || 0, limit: size, offset: skip };
}

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function addUtcMonths(date, amount) {
  const source = new Date(`${isoDate(date)}T12:00:00Z`);
  const day = source.getUTCDate();
  source.setUTCDate(1);
  source.setUTCMonth(source.getUTCMonth() + amount);
  const lastDay = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0)).getUTCDate();
  source.setUTCDate(Math.min(day, lastDay));
  return isoDate(source);
}

/** Doze competências futuras, mesclando fatos do Asaas com projeções visuais. */
export async function billingSchedule(tenantId, months = 12) {
  const size = Math.min(Math.max(Number(months) || 12, 1), 12);
  const subscriptionResult = await query(
    `SELECT s.*, p.name AS plan_name, p.price_cents
       FROM platform.tenant_subscriptions s
       LEFT JOIN platform.subscription_plans p ON p.code = s.plan_code
      WHERE s.tenant_id = $1`,
    [tenantId]
  );
  const subscription = subscriptionResult.rows[0];
  if (!subscription) return { items: [], months: size };

  const actualResult = await query(
    `SELECT id, asaas_payment_id, amount, status, billing_type, due_date, paid_at, invoice_url
       FROM platform.tenant_invoices
      WHERE tenant_id = $1
        AND due_date >= date_trunc('month', CURRENT_DATE)::date
        AND due_date < (date_trunc('month', CURRENT_DATE) + INTERVAL '12 months')::date
      ORDER BY due_date, id`,
    [tenantId]
  );
  const byMonth = new Map(actualResult.rows.map((invoice) => [String(invoice.due_date).slice(0, 7), invoice]));
  const latestDue = actualResult.rows.at(-1)?.due_date;
  const anchor = latestDue || minimumDueDate();
  const anchorDay = Number(String(anchor).slice(8, 10)) || 1;
  const start = new Date();
  start.setUTCHours(12, 0, 0, 0);
  start.setUTCDate(Math.min(anchorDay, new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()));

  const items = [];
  for (let index = 0; index < size; index += 1) {
    const dueDate = addUtcMonths(start, index);
    const actual = byMonth.get(dueDate.slice(0, 7));
    items.push(actual ? { ...actual, kind: "actual" } : {
      id: null,
      asaas_payment_id: null,
      amount: Number(subscription.price_cents || 0) / 100,
      status: "projetada",
      billing_type: subscription.billing_type,
      due_date: dueDate,
      paid_at: null,
      invoice_url: null,
      kind: "projection"
    });
  }
  return { items, months: size, projected: true };
}

export async function getTenantPixPayment(tenantId, invoiceId) {
  ensureGatewayEnabled();
  const found = await query(
    `SELECT id, asaas_payment_id, status, billing_type, due_date, amount, invoice_url
       FROM platform.tenant_invoices WHERE id = $1 AND tenant_id = $2`,
    [invoiceId, tenantId]
  );
  const invoice = found.rows[0];
  if (!invoice) throw new PlatformBillingError("Fatura não encontrada.", 404);
  if (String(invoice.billing_type).toUpperCase() !== "PIX") {
    throw new PlatformBillingError("Esta fatura não é PIX.", 400, "fatura_nao_pix");
  }
  if (["paga", "cancelada", "estornada"].includes(invoice.status)) {
    throw new PlatformBillingError("Esta fatura não está disponível para pagamento.", 409, "fatura_encerrada");
  }
  if (!invoice.asaas_payment_id) {
    throw new PlatformBillingError("A cobrança ainda não foi emitida pelo Asaas.", 409, "cobranca_nao_emitida");
  }
  const pix = await platformClient().getPixQrCode(invoice.asaas_payment_id);
  return {
    invoice,
    encoded_image: pix?.encodedImage || null,
    payload: pix?.payload || null,
    expiration_date: pix?.expirationDate || null
  };
}

export async function cancelTenantSubscription(tenantId) {
  ensureGatewayEnabled();
  const found = await query(
    `SELECT id, status, asaas_subscription_id, asaas_checkout_id
       FROM platform.tenant_subscriptions WHERE tenant_id = $1`,
    [tenantId]
  );
  const current = found.rows[0];
  if (!current) throw new PlatformBillingError("Assinatura não encontrada.", 404);
  if (current.status === "canceled") return { canceled: true, idempotent: true };

  if (current.asaas_subscription_id) {
    await platformClient().cancelSubscription(current.asaas_subscription_id);
  } else if (current.asaas_checkout_id) {
    await platformClient().cancelCheckout(current.asaas_checkout_id);
  }
  await query(
    `UPDATE platform.tenant_subscriptions
        SET status = 'canceled', canceled_at = now(), grace_ends_at = NULL,
            billing_suspended_at = NULL, asaas_checkout_id = NULL,
            asaas_subscription_id = NULL,
            checkout_url = NULL, checkout_expires_at = NULL,
            updated_at = now()
      WHERE tenant_id = $1`,
    [tenantId]
  );
  invalidateSubscriptionCache(tenantId);
  return { canceled: true, idempotent: false };
}

// Concilia checkouts de cartão que já foram concluídos. O webhook de PAYMENT é
// o caminho principal; esta função cobre a janela em que o Checkout terminou,
// mas a assinatura/pagamento ainda não foram materializados localmente.
export async function syncPendingCheckouts(limit = 20) {
  ensureGatewayEnabled();
  const pending = await query(
    `SELECT id, tenant_id, plan_code, asaas_checkout_id
       FROM platform.tenant_subscriptions
      WHERE asaas_subscription_id IS NULL
        AND asaas_checkout_id IS NOT NULL
        AND status <> 'canceled'
      ORDER BY updated_at
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 20, 1), 100)]
  );
  let synced = 0;
  for (const local of pending.rows) {
    try {
      const checkout = await platformClient().getCheckout(local.asaas_checkout_id);
      const checkoutStatus = String(checkout?.status || "").toUpperCase();
      if (["CANCELED", "EXPIRED"].includes(checkoutStatus)) {
        await query(
          `UPDATE platform.tenant_subscriptions
              SET checkout_expires_at = now(), checkout_url = NULL, updated_at = now()
            WHERE id = $1`,
          [local.id]
        );
        continue;
      }
      if (checkoutStatus !== "PAID") continue;
      const subscriptions = await platformClient().listSubscriptions({ externalReference: `tenant:${local.tenant_id}` });
      const remote = subscriptions.find((item) => item?.id && !item?.deleted) || subscriptions[0];
      if (!remote?.id) continue;
      await query(
        `UPDATE platform.tenant_subscriptions
            SET asaas_subscription_id = $1, billing_type = 'CREDIT_CARD',
                asaas_checkout_id = NULL, checkout_url = NULL, checkout_expires_at = NULL,
                updated_at = now()
          WHERE id = $2 AND asaas_subscription_id IS NULL`,
        [remote.id, local.id]
      );
      const payments = await platformClient().getSubscriptionPayments(remote.id);
      for (const payment of payments) {
        const normalized = {
          id: String(payment.id),
          status: payment.status,
          subscription: remote.id,
          customer: payment.customer || remote.customer || null,
          externalReference: payment.externalReference || `tenant:${local.tenant_id}`,
          value: payment.value,
          dueDate: payment.dueDate,
          paymentDate: payment.paymentDate || payment.clientPaymentDate || null,
          billingType: payment.billingType || "CREDIT_CARD",
          invoiceUrl: payment.invoiceUrl || null
        };
        const status = String(payment.status || "").toUpperCase();
        const action = isPaidStatus(status) ? "paid" : status === "OVERDUE" ? "overdue" : "created";
        await applyPlatformPaymentEvent({ action, payment: normalized });
      }
      invalidateSubscriptionCache(local.tenant_id);
      synced += 1;
    } catch (error) {
      logGatewayError(`falha ao conciliar checkout ${local.asaas_checkout_id}`, error);
    }
  }
  return synced;
}
