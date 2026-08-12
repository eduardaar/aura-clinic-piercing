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
import { AsaasError, onlyDigits } from "./asaas/client.js";
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

export const BILLING_TYPES = ["UNDEFINED", "CREDIT_CARD"];

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
  if (tenant.asaas_customer_id) return tenant.asaas_customer_id;

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

// O formulário manda snake_case (e às vezes camelCase); o cliente do Asaas quer
// camelCase. Normalizar aqui evita que um `expiry_month` ignorado em silêncio
// vire "cartão inválido" no gateway.
function normalizeCard(card) {
  if (!card) return null;
  const rawYear = String(card.expiryYear ?? card.expiry_year ?? "").trim();
  return {
    holderName: card.holderName ?? card.holder_name ?? null,
    number: onlyDigits(card.number ?? card.card_number),
    expiryMonth: String(card.expiryMonth ?? card.expiry_month ?? "").trim().padStart(2, "0"),
    // O Asaas exige 4 dígitos ("2030") e o formulário coleta MM/AA. Assumir o
    // século 20xx é seguro: não existe cartão válido emitido para 19xx.
    expiryYear: rawYear.length === 2 ? `20${rawYear}` : rawYear,
    ccv: onlyDigits(card.ccv ?? card.cvv ?? card.security_code)
  };
}

function normalizeHolderInfo(info) {
  if (!info) return null;
  return {
    name: info.name ?? info.holder_name ?? null,
    email: info.email ?? null,
    taxId: onlyDigits(info.taxId ?? info.tax_id ?? info.cpf_cnpj),
    postalCode: onlyDigits(info.postalCode ?? info.postal_code ?? info.cep),
    addressNumber: info.addressNumber ?? info.address_number ?? info.numero ?? null,
    phone: onlyDigits(info.phone ?? info.mobile_phone)
  };
}

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
 * @param {{ planCode: string, billingType?: string, creditCard?: object,
 *           creditCardHolderInfo?: object, remoteIp?: string }} options
 */
export async function startSubscriptionCheckout(
  tenantId,
  { planCode, billingType = "UNDEFINED", creditCard, creditCardHolderInfo, remoteIp } = {}
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

  const type = String(billingType || "UNDEFINED").toUpperCase();
  if (!BILLING_TYPES.includes(type)) {
    throw new PlatformBillingError(
      "Forma de pagamento inválida. Use UNDEFINED (link com PIX/boleto/cartão) ou CREDIT_CARD.",
      400,
      "billing_type_invalido"
    );
  }

  const card = type === "CREDIT_CARD" ? normalizeCard(creditCard) : null;
  const holder = type === "CREDIT_CARD" ? normalizeHolderInfo(creditCardHolderInfo) : null;
  if (type === "CREDIT_CARD") {
    if (!card?.number || !card.expiryMonth || !card.expiryYear || !card.ccv || !card.holderName) {
      throw new PlatformBillingError(
        "Dados do cartão incompletos (nome do titular, número, validade e CVV são obrigatórios).",
        400,
        "cartao_incompleto"
      );
    }
    if (!holder?.taxId || !holder.postalCode || !holder.addressNumber) {
      throw new PlatformBillingError(
        "Dados do titular incompletos (CPF/CNPJ, CEP e número do endereço são obrigatórios).",
        400,
        "titular_incompleto"
      );
    }
    // Sem o IP real do portador o antifraude do Asaas recusa a transação — e a
    // recusa chega como erro genérico, difícil de diagnosticar depois.
    if (!remoteIp) {
      throw new PlatformBillingError(
        "Não foi possível identificar o IP do pagador; a cobrança no cartão exige esse dado.",
        400,
        "remote_ip_ausente"
      );
    }
  }

  const customerId = await ensureAsaasCustomer(tenantId);

  const currentResult = await query(
    "SELECT id, plan_code, status, asaas_subscription_id FROM platform.tenant_subscriptions WHERE tenant_id = $1",
    [tenantId]
  );
  const current = currentResult.rows[0] || null;

  // Troca de plano: a assinatura velha precisa morrer, senão a clínica passa a
  // ter DUAS recorrências ativas e é cobrada duas vezes no mês seguinte.
  // Best-effort de propósito — se o cancelamento falhar, seguimos criando a
  // nova: uma cobrança duplicada é resolvível pelo suporte; perder o checkout
  // de quem acabou de digitar o cartão não é.
  if (current?.asaas_subscription_id) {
    try {
      await platformClient().cancelSubscription(current.asaas_subscription_id);
    } catch (error) {
      logGatewayError(
        `falha ao cancelar a assinatura anterior ${current.asaas_subscription_id} do tenant ${tenantId}`,
        error
      );
    }
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
      externalReference: `tenant:${tenantId}`,
      creditCard: card || undefined,
      creditCardHolderInfo: holder || undefined,
      remoteIp
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

async function applyCreated({ payment, charge }) {
  const existing = await query(
    "SELECT id FROM platform.tenant_invoices WHERE asaas_payment_id = $1",
    [payment.id]
  );
  if (existing.rows[0]) return { applied: false, detail: "fatura-ja-registrada" };

  await upsertInvoice(pool, {
    tenantId: charge.tenantId,
    subscriptionId: charge.subscriptionId,
    planCode: charge.planCode,
    payment,
    status: "pendente"
  });
  return { applied: true, detail: `fatura-criada:${payment.id}` };
}

async function applyPaid({ payment, charge }) {
  const outcome = await withTransaction(async (client) => {
    const invoice = await lockInvoice(client, payment.id);
    // Reprocesso é o caminho NORMAL aqui (dois eventos por cobrança), não a
    // exceção: sair cedo evita empurrar o vencimento um mês a cada entrega.
    if (invoice?.status === "paga") return { applied: false, detail: "ja-paga" };

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
              updated_at = now()
        WHERE tenant_id = $1`,
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

    await upsertInvoice(client, {
      tenantId: charge.tenantId,
      subscriptionId: charge.subscriptionId ?? invoice?.subscription_id ?? null,
      planCode: charge.planCode ?? invoice?.plan_code ?? null,
      payment,
      status: "atrasada"
    });

    // Só rebaixa quem estava em dia. 'canceled'/'suspended' são decisões
    // manuais da plataforma e não podem ser revertidas por um webhook;
    // 'trial_expired' já está bloqueado e não ganha nada virando 'overdue'.
    await client.query(
      `UPDATE platform.tenant_subscriptions
          SET status = 'overdue', updated_at = now()
        WHERE tenant_id = $1 AND status IN ('active', 'trial_active')`,
      [charge.tenantId]
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
