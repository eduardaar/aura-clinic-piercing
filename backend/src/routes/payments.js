import { Router } from "express";
import { withDb, withFeature } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { P } from "../config/permissions.js";
import { publicPaymentIntent, rotatePublicPaymentToken, transitionPaymentIntent } from "../services/payments.js";
import {
  cancelTenantCharge,
  getPixDataByPublicToken,
  refundTenantCharge,
  syncIntentByPublicToken
} from "../services/tenantCharges.js";

const router = Router();

router.get("/api/payment-intents", withFeature("deposits", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CASH_VIEW)) return;
  res.json(await db.all(`
    SELECT pi.*, a.appointment_date, a.appointment_time, c.full_name AS client_name
    FROM payment_intents pi
    LEFT JOIN appointments a ON a.id=pi.appointment_id
    LEFT JOIN clients c ON c.id=pi.client_id
    ORDER BY pi.created_at DESC LIMIT 200
  `));
}));

router.patch("/api/payment-intents/:id/status", withFeature("deposits", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_EDIT)) return;
  try {
    const current = await db.get("SELECT provider FROM payment_intents WHERE id=?", [Number(req.params.id)]);
    if (!current) return res.status(404).json({ error: "Intenção de pagamento não encontrada." });
    if (["refunded", "chargeback"].includes(req.body?.status)) {
      return res.status(422).json({ error: "Estorno e chargeback são atualizados pelo gateway; use o fluxo de estorno ou aguarde o webhook." });
    }
    if (current.provider === "asaas" && req.body?.status === "cancelled") {
      return res.status(422).json({ error: "Cancele cobranças Asaas pela rota de cancelamento, com Idempotency-Key." });
    }
    res.json(await transitionPaymentIntent(db, {
      intentId: Number(req.params.id),
      status: req.body?.status,
      providerEventId: req.body?.event_id || `manual:${req.params.id}:${req.body?.status}`,
      payload: { source: "manual", user_id: req.user?.id, notes: req.body?.notes || "" },
      paidAt: req.body?.paid_at
    }));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}));

// Revoga um link vazado/antigo sem emitir outra cobrança. O URL da fatura no
// Asaas continua o mesmo, mas nossa tela pública passa a exigir o UUID novo.
router.post("/api/payment-intents/:id/public-token", withFeature("deposits", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_EDIT)) return;
  try {
    const intent = await rotatePublicPaymentToken(db, Number(req.params.id));
    res.json({ payment_intent: publicPaymentIntent(intent), payment_url: intent.invoice_url || null });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
}));

// Cancelamento só serve para cobrança que ainda não foi liquidada. Para não
// executar duas vezes por duplo clique, Idempotency-Key é obrigatório.
router.post("/api/payment-intents/:id/cancel", withFeature("deposits", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_CANCEL)) return;
  try {
    const result = await cancelTenantCharge(db, {
      intentId: Number(req.params.id),
      idempotencyKey: req.get("Idempotency-Key"),
      userId: req.user.id,
      reason: String(req.body?.reason || "").trim().slice(0, 500) || null
    });
    res.status(result.operation_status === "pending" ? 202 : 200).json(result);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.userMessage || error.message, code: error.code || undefined });
  }
}));

// Estorno total do cliente final. O retorno 200 significa que o Asaas aceitou
// a solicitação; o status `refunded` só chega por webhook/reconciliação.
router.post("/api/payment-intents/:id/refund", withFeature("deposits", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_REFUND)) return;
  try {
    const result = await refundTenantCharge(db, {
      intentId: Number(req.params.id),
      idempotencyKey: req.get("Idempotency-Key"),
      userId: req.user.id,
      amount: req.body?.amount,
      reason: String(req.body?.reason || "").trim().slice(0, 500) || null
    });
    res.status(result.operation_status === "pending" ? 202 : 200).json(result);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.userMessage || error.message, code: error.code || undefined });
  }
}));

// ---------------------------------------------------------------------------
// Cobrança online (Asaas)
// ---------------------------------------------------------------------------

// QR code + copia-e-cola do PIX de uma cobrança já criada.
//
// PÚBLICA de propósito: quem chama é o cliente final sem sessão. O token UUID
// é aleatório e específico da cobrança; o id serial nunca funciona aqui.
router.get("/api/payment-intents/:token/pix", withDb(async (req, res, db) => {
  const pix = await getPixDataByPublicToken(db, req.params.token);
  if (pix.kind === "expired") {
    return res.status(410).json({ error: "Este link de pagamento expirou. Solicite um novo à clínica." });
  }
  if (pix.kind !== "ok" || !pix.data) {
    return res.status(404).json({ error: "PIX indisponível para esta cobrança." });
  }
  res.json(pix.data);
}));

// Conciliação sob demanda de UMA cobrança.
//
// É a resposta ao "paguei e não confirmou": em vez de esperar o worker, a tela
// pergunta ao gateway agora. Também serve de fallback se o webhook se perdeu.
//
// Pública pelo mesmo motivo do PIX (a tela de status do cliente final usa), mas
// devolve só o status — nunca o intent inteiro, que carrega valor, cliente e
// metadados da integração.
router.post("/api/payment-intents/:token/sync", withDb(async (req, res, db) => {
  try {
    const intent = await syncIntentByPublicToken(db, req.params.token);
    if (intent.kind === "expired") {
      return res.status(410).json({ error: "Este link de pagamento expirou. Solicite um novo à clínica." });
    }
    if (intent.kind !== "ok" || !intent.intent) return res.status(404).json({ error: "Cobrança não encontrada." });
    res.json({
      status: intent.intent.status,
      paid_at: intent.intent.paid_at || null,
      invoice_url: intent.intent.invoice_url || null
    });
  } catch (error) {
    // Gateway fora não é erro do cliente: ele tenta de novo em instantes.
    res.status(502).json({ error: error.userMessage || "Não foi possível consultar o pagamento agora." });
  }
}));

export default router;
