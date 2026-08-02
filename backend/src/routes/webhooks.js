// Webhooks do Asaas.
//
// Duas rotas, uma por escopo — porque são duas CONTAS diferentes no Asaas, com
// tokens diferentes:
//
//   POST /api/webhooks/asaas            conta da Monitence (assinatura das clínicas)
//   POST /api/webhooks/asaas/:slug      conta da própria clínica (cliente final)
//
// A clínica é identificada pelo SLUG NA URL, e não por header: o Asaas posta
// sem sessão, sem X-Tenant e sem noção do que é multi-tenant. Cada clínica
// cadastra a própria URL no painel dela, o que também significa que o slug
// sozinho não autoriza nada — a autenticidade vem do token.
//
// ---------------------------------------------------------------------------
// Contrato de status HTTP (o mais importante deste arquivo)
// ---------------------------------------------------------------------------
// O Asaas REENTREGA em qualquer resposta fora da faixa 2xx e, depois de falhas
// consecutivas, PAUSA a fila de webhooks da conta inteira — o que congela todas
// as cobranças daquele cliente até alguém reativar no painel. Então:
//
//   200  processado, ignorado, duplicado, evento desconhecido, cobrança que não
//        é nossa. Tudo que não adianta repetir responde 200.
//   401  token ausente/inválido. Reentrega é desejável aqui: ou é requisição
//        forjada (e não queremos dar 200 a ela), ou é configuração quebrada que
//        precisa aparecer na fila do painel.
//   500  falha nossa (banco fora). Reentrega é exatamente o que queremos, e o
//        evento foi liberado para ser reprocessado.
import { Router } from "express";
import { withTenantSchema } from "../db/tenantSession.js";
import { tenantBySlug } from "../middleware/tenant.js";
import { timingSafeEqual } from "../services/asaas/vault.js";
import {
  platformWebhookToken,
  isPlatformEnabled,
  tenantWebhookToken
} from "../services/asaas/credentials.js";
import {
  registerEvent,
  finishEvent,
  releaseEvent,
  recordRejectedEvent,
  resolveAction
} from "../services/asaas/events.js";
import { applyPlatformPaymentEvent } from "../services/platformBilling.js";
import { applyTenantPaymentEvent } from "../services/tenantCharges.js";

const router = Router();

// O Asaas ecoa, em todo webhook, o token que você cadastrou no painel dele.
// Não é assinatura HMAC do corpo — é um segredo compartilhado simples.
const TOKEN_HEADER = "asaas-access-token";

function incomingToken(req) {
  return String(req.headers[TOKEN_HEADER] || "").trim();
}

// Validação fail-closed: sem token configurado do NOSSO lado, o webhook fica
// desligado, e não aberto. Um endpoint público que aceita qualquer POST é o
// mesmo que dar a qualquer pessoa na internet o poder de marcar cobrança como
// paga e liberar plano.
function checkToken(expected, provided) {
  if (!expected) return { ok: false, reason: "webhook-token-nao-configurado" };
  if (!provided) return { ok: false, reason: "token-ausente" };
  // Comparação em tempo constante: um `===` vazaria o token caractere a
  // caractere pelo tempo de resposta.
  if (!timingSafeEqual(expected, provided)) return { ok: false, reason: "token-invalido" };
  return { ok: true };
}

// Campos que interessam do corpo. Extração defensiva: um `dueDate` malformado
// não pode derrubar a requisição e gerar reentrega infinita.
function parsePayload(body) {
  const payment = body?.payment || {};
  return {
    eventId: body?.id ? String(body.id) : null,
    eventType: body?.event ? String(body.event) : null,
    payment: {
      id: payment.id ? String(payment.id) : null,
      status: payment.status ? String(payment.status) : null,
      subscription: payment.subscription ? String(payment.subscription) : null,
      customer: payment.customer ? String(payment.customer) : null,
      externalReference: payment.externalReference ? String(payment.externalReference) : null,
      value: Number.isFinite(Number(payment.value)) ? Number(payment.value) : null,
      netValue: Number.isFinite(Number(payment.netValue)) ? Number(payment.netValue) : null,
      dueDate: payment.dueDate || null,
      paymentDate: payment.paymentDate || payment.clientPaymentDate || null,
      billingType: payment.billingType || null,
      invoiceUrl: payment.invoiceUrl || null,
      description: payment.description || null
    }
  };
}

// Esqueleto comum às duas rotas: valida, reivindica o evento, despacha e
// fecha o registro. O que muda entre plataforma e clínica é só de onde vem o
// token esperado e qual função aplica o efeito.
async function handleWebhook({ req, res, scope, tenantId, expectedToken, apply }) {
  const body = req.body || {};

  const check = checkToken(expectedToken, incomingToken(req));
  if (!check.ok) {
    if (check.reason === "webhook-token-nao-configurado") {
      console.error(
        `[Asaas] webhook ${scope} recebido sem token configurado do nosso lado — rejeitado. ` +
          "Configure o token e cadastre o MESMO valor no painel do Asaas."
      );
    }
    await recordRejectedEvent({ scope, tenantId, reason: check.reason, payload: body });
    return res.status(401).json({ error: "Webhook não autorizado." });
  }

  const { eventId, eventType, payment } = parsePayload(body);

  // Sem id de cobrança não há o que conciliar. 200 porque repetir não ajuda.
  if (!payment.id) {
    await recordRejectedEvent({ scope, tenantId, reason: "sem-payment-id", payload: body });
    return res.status(200).json({ ok: true, ignored: "sem-payment-id" });
  }

  // Reivindica o evento ANTES de processar. É o índice único que serializa
  // duas entregas simultâneas do mesmo evento — não o SELECT.
  let claim;
  try {
    claim = await registerEvent({
      scope,
      tenantId,
      eventId,
      eventType,
      paymentId: payment.id,
      payload: body
    });
  } catch (error) {
    console.error(`[Asaas] falha ao registrar webhook ${scope}:`, error.message);
    return res.status(500).json({ error: "Falha ao registrar evento." });
  }

  if (claim.duplicate) {
    // Caminho NORMAL, não excepcional: PAYMENT_CONFIRMED e PAYMENT_RECEIVED
    // chegam para a mesma cobrança, e reentregas acontecem.
    return res.status(200).json({ ok: true, duplicate: true });
  }

  const action = resolveAction(eventType);
  if (action === "ignored") {
    await finishEvent(claim.id, "ignored", `evento não tratado: ${eventType}`);
    return res.status(200).json({ ok: true, ignored: eventType });
  }

  try {
    const result = await apply({ action, payment, eventType });
    await finishEvent(claim.id, result?.applied ? "processed" : "ignored", result?.detail || null);
    return res.status(200).json({ ok: true, action, applied: Boolean(result?.applied) });
  } catch (error) {
    console.error(`[Asaas] erro ao processar webhook ${scope} (${eventType}):`, error);
    // Devolve o evento à fila: sem isto, a reentrega bateria no índice único,
    // seria vista como duplicata e o pagamento nunca baixaria.
    await releaseEvent(claim.id, eventId, error.message);
    return res.status(500).json({ error: "Falha ao processar evento." });
  }
}

// ---------------------------------------------------------------------------
// Plataforma: assinatura das clínicas, conta Asaas da Monitence.
// ---------------------------------------------------------------------------
router.post("/api/webhooks/asaas", async (req, res) => {
  if (!isPlatformEnabled()) {
    console.error("[Asaas] webhook da plataforma recebido com a integração desligada.");
    return res.status(401).json({ error: "Integração não configurada." });
  }
  return handleWebhook({
    req,
    res,
    scope: "platform",
    tenantId: null,
    expectedToken: platformWebhookToken(),
    apply: ({ action, payment }) => applyPlatformPaymentEvent({ action, payment })
  });
});

// ---------------------------------------------------------------------------
// Clínica: cobrança do cliente final, conta Asaas da própria clínica.
// ---------------------------------------------------------------------------
router.post("/api/webhooks/asaas/:slug", async (req, res) => {
  const tenant = await tenantBySlug(req.params.slug);
  if (!tenant) {
    // 200 de propósito: um slug inexistente nunca vai passar a existir por
    // reentrega, e devolver erro só faria o Asaas insistir e pausar a fila.
    // O rastro fica na tabela de eventos.
    await recordRejectedEvent({
      scope: "tenant",
      reason: `clinica-inexistente:${String(req.params.slug).slice(0, 40)}`,
      payload: req.body
    });
    return res.status(200).json({ ok: true, ignored: "clinica-desconhecida" });
  }

  // O token vive no cofre da clínica, então precisa do schema dela para ser
  // lido. Esta é a única leitura feita ANTES de autenticar — e é justamente a
  // leitura do segredo com que vamos autenticar.
  let expectedToken = null;
  try {
    expectedToken = await withTenantSchema(tenant.id, (db) => tenantWebhookToken(db));
  } catch (error) {
    console.error(`[Asaas] falha ao ler o cofre da clínica ${tenant.slug}:`, error.message);
    return res.status(500).json({ error: "Falha ao validar webhook." });
  }

  return handleWebhook({
    req,
    res,
    scope: "tenant",
    tenantId: tenant.id,
    expectedToken,
    apply: ({ action, payment, eventType }) =>
      withTenantSchema(tenant.id, (db) =>
        applyTenantPaymentEvent(db, { action, payment, eventType, tenant })
      )
  });
});

// Diagnóstico: confirma que a URL está no ar e responde ANTES de a clínica
// cadastrá-la no painel do Asaas. Não revela token nem se ele está configurado.
router.get("/api/webhooks/asaas", (_req, res) => {
  res.json({ ok: true, provider: "asaas", scope: "platform" });
});
router.get("/api/webhooks/asaas/:slug", (_req, res) => {
  res.json({ ok: true, provider: "asaas", scope: "tenant" });
});

export default router;
