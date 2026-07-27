import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { transitionPaymentIntent } from "../services/payments.js";

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

export default router;
