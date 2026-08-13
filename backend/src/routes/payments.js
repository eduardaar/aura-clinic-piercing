import { Router } from "express";
import { withDb, withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { transitionPaymentIntent } from "../services/payments.js";
import { getPixDataByPublicToken, syncIntentByPublicToken } from "../services/tenantCharges.js";

const router = Router();

router.get("/api/payment-intents", withFeature("deposits", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance", "reception"])) return;
  res.json(await db.all(`
    SELECT pi.*, a.appointment_date, a.appointment_time, c.full_name AS client_name
    FROM payment_intents pi
    LEFT JOIN appointments a ON a.id=pi.appointment_id
    LEFT JOIN clients c ON c.id=pi.client_id
    ORDER BY pi.created_at DESC LIMIT 200
  `));
}));

router.patch("/api/payment-intents/:id/status", withFeature("deposits", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "finance"])) return;
  try {
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

// ---------------------------------------------------------------------------
// Cobrança online (Asaas)
// ---------------------------------------------------------------------------

// QR code + copia-e-cola do PIX de uma cobrança já criada.
//
// PÚBLICA de propósito: quem chama é o cliente final sem sessão. O token UUID
// é aleatório e específico da cobrança; o id serial nunca funciona aqui.
router.get("/api/payment-intents/:token/pix", withDb(async (req, res, db) => {
  const pix = await getPixDataByPublicToken(db, req.params.token);
  if (!pix) {
    return res.status(404).json({ error: "PIX indisponível para esta cobrança." });
  }
  res.json(pix);
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
    if (!intent) return res.status(404).json({ error: "Cobrança não encontrada." });
    res.json({
      status: intent.status,
      paid_at: intent.paid_at || null,
      invoice_url: intent.invoice_url || null
    });
  } catch (error) {
    // Gateway fora não é erro do cliente: ele tenta de novo em instantes.
    res.status(502).json({ error: error.userMessage || "Não foi possível consultar o pagamento agora." });
  }
}));

export default router;
