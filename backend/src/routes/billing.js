// Rotas da assinatura SaaS: a clínica pagando a Monitence.
//
// Duas audiências no mesmo arquivo, de propósito — são as duas pontas do mesmo
// fluxo e separá-las esconderia a simetria:
//
//   /api/billing/*            admin da CLÍNICA (token de clínica, withDb)
//   /api/platform/invoices/*  super-admin da PLATAFORMA (token de plataforma)
//
// As rotas da clínica passam por withDb apenas para resolver o tenant e
// autenticar: os dados de cobrança vivem no schema `platform`, que é global, e
// por isso são lidos com `query()` (via services/platformBilling.js) e não pelo
// `db` da requisição.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole, requirePlatformAuth as requirePlatform } from "../middleware/auth.js";
import { invalidateTenantCache } from "../middleware/tenant.js";
import { query } from "../database/connection.js";
import { isProduction } from "../config/index.js";
import { parseTaxId, maskTaxId } from "../services/taxId.js";
import { AsaasError } from "../services/asaas/client.js";
import { isPlatformEnabled } from "../services/asaas/credentials.js";
import { planByCode } from "../services/plans.js";
import { IdempotencyError, runIdempotent } from "../services/idempotency.js";
import { tenantSubscription } from "../services/subscriptions.js";
import { pageResponse, parsePaging } from "../services/pagination.js";
import {
  PlatformBillingError,
  billingSchedule,
  cancelTenantSubscription,
  getTenantPixPayment,
  listTenantInvoices,
  startSubscriptionCheckout,
  syncInvoice
} from "../services/platformBilling.js";

const router = Router();

// Auth do painel de plataforma. Cópia local do helper de routes/platform.js (e
// não um import): são arquivos de domínios diferentes e um não deve depender do
// outro só por causa de sete linhas. SEM bypass de dev, como lá.
// Tradução de erro -> HTTP.
//
// Diferente da regra das telas públicas: aqui quem lê é o ADMIN da clínica (ou
// o super-admin), e a mensagem técnica do gateway (por exemplo, CPF/CNPJ
// inválido) é exatamente o que resolve o problema dele.
// O `userMessage` genérico do AsaasError é para o cliente final, no catálogo.
function handleBillingError(res, error) {
  // 409 de idempotência: chave reusada para outro corpo, ou checkout ainda em
  // voo. Não é falha do gateway nem erro nosso — é a recusa a cobrar duas vezes.
  if (error instanceof IdempotencyError) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code });
  }
  if (error instanceof PlatformBillingError) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code });
  }
  if (error instanceof AsaasError) {
    // 5xx do gateway vira 502 (não é culpa do payload da clínica); 4xx vira 400,
    // porque repetir o mesmo corpo daria o mesmo erro.
    const status = error.status >= 500 || error.status === 0 ? 502 : 400;
    return res.status(status).json({ error: error.message, code: error.code || "gateway_error" });
  }
  // Só mensagem e stack, NUNCA o objeto de erro inteiro.
  //
  // `console.error(error)` imprime também propriedades próprias enumeráveis e
  // é comum um erro inesperado carregar a requisição que o originou. A rota
  // recusa cartão, mas mantemos o log mínimo como defesa em profundidade.
  console.error(`[billing] ${error?.message || error}`, error?.stack || "");
  return res.status(500).json({
    error: isProduction ? "Erro interno no servidor." : `Erro interno: ${error.message}`
  });
}

// ---------------------------------------------------------------------------
// Idempotência do checkout
// ---------------------------------------------------------------------------
//
// Exigir o header sem USÁ-LO não protegeria nada: o dano de um duplo-clique (ou
// de um timeout de rede em que o navegador reenvia) é uma SEGUNDA assinatura
// recorrente e uma segunda cobrança no cartão.
//
// A dedupe vive em platform.idempotency_keys (services/idempotency.js) e não
// num mapa de processo: com duas instâncias atrás do balanceador, as duas
// metades do duplo-clique caem em processos diferentes e o mapa não vê nada.
const CHECKOUT_ENDPOINT = "billing.checkout";

// ---------------------------------------------------------------------------
// Clínica
// ---------------------------------------------------------------------------

// Dados fiscais da clínica como PAGADORA. Ficam em platform.tenants, mas o
// cadastro de clínica nunca os coletou — sem eles o Asaas recusa criar o
// cliente e o checkout inteiro morre no primeiro passo. A tela precisa saber
// disso ANTES de oferecer o botão de assinar.
async function billingProfile(tenantId) {
  const found = await query(
    "SELECT name, tax_id, email, phone FROM platform.tenants WHERE id = $1",
    [tenantId]
  );
  const tenant = found.rows[0] || {};
  return {
    name: tenant.name || null,
    // Máscara, não o documento: a tela só precisa confirmar QUAL está salvo.
    tax_id_hint: maskTaxId(tenant.tax_id),
    email: tenant.email || null,
    phone: tenant.phone || null,
    complete: Boolean(tenant.tax_id && tenant.email)
  };
}

// Assinatura atual + plano + últimas faturas. É a tela "Meu plano".
router.get(
  "/api/billing/subscription",
  withDb(async (req, res) => {
    if (!requireRole(req, res, ["admin"])) return;
    try {
      const tenantId = req.tenant.id;
      const subscription = await tenantSubscription(tenantId);
      const invoices = await listTenantInvoices(tenantId, { limit: 6 });
      res.json({
        // Sem o gateway configurado a tela precisa esconder o botão de assinar
        // em vez de deixar o usuário bater num 503.
        gateway_enabled: isPlatformEnabled(),
        subscription,
        plan: planByCode(subscription?.plan_code),
        // `complete: false` é o sinal para a tela pedir o CPF/CNPJ antes de
        // deixar assinar, em vez de deixar o erro estourar no checkout.
        billing_profile: await billingProfile(tenantId),
        invoices: invoices.items
      });
    } catch (error) {
      handleBillingError(res, error);
    }
  })
);

// Preenche/atualiza os dados fiscais da própria clínica.
//
// Fica aqui, e não no painel de plataforma, porque quem tem o dado é o admin da
// clínica — obrigá-lo a abrir chamado para a Monitence preencher um CPF
// transformaria a assinatura num processo manual.
router.put(
  "/api/billing/profile",
  withDb(async (req, res) => {
    if (!requireRole(req, res, ["admin"])) return;
    try {
      const body = req.body || {};

      // Validação local antes de gastar uma ida ao gateway: o Asaas responde
      // "invalid_cpfCnpj", que não diz se faltou um dígito ou se o campo é outro.
      const parsed = parseTaxId(body.tax_id);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: "tax_id_invalido" });

      const email = String(body.email || "").trim() || null;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Informe um e-mail válido para receber as faturas." });
      }
      const phone = String(body.phone || "").replace(/\D/g, "") || null;

      // COALESCE preserva o que já existe quando a tela manda o campo vazio —
      // mesma regra do cofre: um PUT parcial não apaga dado bom.
      await query(
        `UPDATE platform.tenants
            SET tax_id = $1,
                email = COALESCE($2, email),
                phone = COALESCE($3, phone)
          WHERE id = $4`,
        [parsed.value, email, phone, req.tenant.id]
      );
      invalidateTenantCache(req.tenant.slug);

      res.json(await billingProfile(req.tenant.id));
    } catch (error) {
      handleBillingError(res, error);
    }
  })
);

// Contrata (ou troca) o plano usando somente a página hospedada pelo Asaas.
//
// Dados brutos de cartão nunca devem atravessar a API da Aura: isso amplia o
// escopo PCI DSS para toda a aplicação e transforma logs, APM, proxies e
// tratamento de erros em superfícies que poderiam capturar PAN/CVV.
router.post(
  "/api/billing/checkout",
  withDb(async (req, res) => {
    if (!requireRole(req, res, ["admin"])) return;
    try {
      const body = req.body || {};
      const billingType = String(body.billing_type || "CREDIT_CARD").toUpperCase();

      // Recusa antes até de consultar a configuração do gateway: assim o
      // contrato "a Aura nunca recebe cartão" é verificável em qualquer
      // ambiente e não muda conforme um secret esteja presente ou ausente.
      if (body.credit_card || body.credit_card_holder_info) {
        return res.status(400).json({
          error: "Dados de cartão não são aceitos pela Aura. Use a página segura de pagamento do Asaas.",
          code: "checkout_hospedado_obrigatorio"
        });
      }
      if (!["CREDIT_CARD", "PIX"].includes(billingType)) {
        return res.status(400).json({
          error: "Forma de pagamento inválida. Escolha cartão de crédito ou PIX.",
          code: "billing_type_invalido"
        });
      }

      if (!isPlatformEnabled()) {
        return res.status(503).json({
          error:
            "Pagamento online não configurado. Fale com a Monitence para ativar a cobrança automática.",
          code: "gateway_indisponivel"
        });
      }

      const tenantId = req.tenant.id;

      const checkout = () =>
        startSubscriptionCheckout(tenantId, {
          planCode: body.plan_code,
          billingType
        });

      // Mesmo no checkout hospedado, timeout/reenvio não pode criar duas
      // assinaturas. A chave é obrigatória para qualquer método.
      const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
      if (!idempotencyKey) {
        return res.status(400).json({
          error: "Header Idempotency-Key obrigatório no checkout.",
          code: "idempotency_key_ausente"
        });
      }
      const safeBody = { plan_code: body.plan_code, billing_type: billingType };
      const { result } = await runIdempotent(
        { tenantId, endpoint: CHECKOUT_ENDPOINT, key: idempotencyKey, body: safeBody },
        checkout
      );
      res.status(201).json(result);
    } catch (error) {
      handleBillingError(res, error);
    }
  })
);

// Agenda financeira dos próximos 12 meses. Linhas sem payment_id são apenas
// projeções; as cobranças reais continuam sendo emitidas pelo Asaas.
router.get(
  "/api/billing/schedule",
  withDb(async (req, res) => {
    if (!requireRole(req, res, ["admin"])) return;
    try {
      res.json(await billingSchedule(req.tenant.id, 12));
    } catch (error) {
      handleBillingError(res, error);
    }
  })
);

router.get(
  "/api/billing/invoices/:id/pix",
  withDb(async (req, res) => {
    if (!requireRole(req, res, ["admin"])) return;
    try {
      const invoiceId = Number(req.params.id);
      if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
        return res.status(400).json({ error: "Identificador de fatura inválido." });
      }
      res.json(await getTenantPixPayment(req.tenant.id, invoiceId));
    } catch (error) {
      handleBillingError(res, error);
    }
  })
);

router.post(
  "/api/billing/subscription/cancel",
  withDb(async (req, res) => {
    if (!requireRole(req, res, ["admin"])) return;
    try {
      res.json(await cancelTenantSubscription(req.tenant.id));
    } catch (error) {
      handleBillingError(res, error);
    }
  })
);

// Faturas da própria clínica. Envelope de paginação padrão da casa (array puro
// quando o cliente não manda limit/offset).
router.get(
  "/api/billing/invoices",
  withDb(async (req, res) => {
    if (!requireRole(req, res, ["admin"])) return;
    try {
      const paging = parsePaging(req.query, { defaultLimit: 20, maxLimit: 100 });
      const page = await listTenantInvoices(req.tenant.id, {
        limit: paging.limit,
        offset: paging.offset
      });
      res.json(pageResponse(page.items, page.total, paging));
    } catch (error) {
      handleBillingError(res, error);
    }
  })
);

// ---------------------------------------------------------------------------
// Plataforma (super-admin)
// ---------------------------------------------------------------------------

const INVOICE_STATUSES = ["pendente", "paga", "atrasada", "cancelada", "estornada"];

// Todas as faturas de todas as clínicas, com filtro por status e por clínica.
router.get("/api/platform/invoices", requirePlatform, async (req, res) => {
  try {
    const paging = parsePaging(req.query, { defaultLimit: 50, maxLimit: 200 });

    // Filtros por posição ($1/$2): o status passa por whitelist e o tenant_id
    // por Number() — nada vindo da query string é interpolado na SQL.
    const status = INVOICE_STATUSES.includes(String(req.query.status)) ? req.query.status : null;
    const tenantId = Number(req.query.tenant_id);
    const filters = [];
    const params = [];
    if (status) {
      params.push(status);
      filters.push(`i.status = $${params.length}`);
    }
    if (Number.isInteger(tenantId) && tenantId > 0) {
      params.push(tenantId);
      filters.push(`i.tenant_id = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const rows = await query(
      `SELECT i.id, i.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
              i.asaas_payment_id, i.plan_code, i.amount, i.status, i.billing_type,
              i.due_date, i.paid_at, i.invoice_url, i.competencia, i.created_at
         FROM platform.tenant_invoices i
         LEFT JOIN platform.tenants t ON t.id = i.tenant_id
         ${where}
        ORDER BY COALESCE(i.due_date, i.created_at::date) DESC, i.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, paging.limit, paging.offset]
    );
    const counted = await query(
      `SELECT COUNT(*)::int AS total FROM platform.tenant_invoices i ${where}`,
      params
    );

    res.json(pageResponse(rows.rows, counted.rows[0]?.total || 0, paging));
  } catch (error) {
    handleBillingError(res, error);
  }
});

// Conciliação manual: relê a cobrança no Asaas e reaplica o efeito. É a saída
// para o webhook que se perdeu ("paguei e continua atrasada").
router.post("/api/platform/invoices/:id/sync", requirePlatform, async (req, res) => {
  try {
    const invoiceId = Number(req.params.id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      return res.status(400).json({ error: "Identificador de fatura inválido." });
    }
    res.json(await syncInvoice(invoiceId));
  } catch (error) {
    handleBillingError(res, error);
  }
});

export default router;
