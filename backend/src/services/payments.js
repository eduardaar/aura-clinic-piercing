import crypto from "crypto";
import { confirmAppointmentReservations, releaseAppointmentReservations } from "./reservations.js";

export async function createPaymentIntent(db, { appointmentId, clientId, amount, provider = "manual", idempotencyKey, expiresMinutes = 30 }) {
  const key = String(idempotencyKey || crypto.randomUUID());
  const existing = await db.get("SELECT * FROM payment_intents WHERE idempotency_key=?", [key]);
  if (existing) return { ...existing, idempotent: true };
  const result = await db.run(
    `INSERT INTO payment_intents
      (appointment_id, client_id, provider, idempotency_key, amount, status, expires_at, metadata)
     VALUES (?, ?, ?, ?, ?, 'awaiting_payment', CURRENT_TIMESTAMP + (? * INTERVAL '1 minute'), ?)`,
    [appointmentId, clientId, provider, key, Math.max(Number(amount || 0), 0), expiresMinutes, JSON.stringify({ integration: provider === "manual" ? "manual_proof" : "credentials_required" })]
  );
  return db.get("SELECT * FROM payment_intents WHERE id=?", [result.lastID]);
}

export async function transitionPaymentIntent(db, { intentId, status, providerEventId = null, payload = {}, paidAt = null }) {
  const allowed = ["pending", "awaiting_payment", "under_review", "confirmed", "failed", "cancelled", "refunded", "expired"];
  if (!allowed.includes(status)) throw new Error("Status de pagamento inválido.");
  const intent = await db.get("SELECT * FROM payment_intents WHERE id=? FOR UPDATE", [intentId]);
  if (!intent) throw new Error("Intenção de pagamento não encontrada.");
  if (providerEventId) {
    const duplicate = await db.get("SELECT id FROM payment_events WHERE payment_intent_id=? AND provider_event_id=?", [intentId, providerEventId]);
    if (duplicate) return { ...intent, idempotent: true };
  }
  await db.run("UPDATE payment_intents SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [status, intentId]);
  await db.run("INSERT INTO payment_events (payment_intent_id, provider_event_id, event_type, payload) VALUES (?, ?, ?, ?)", [intentId, providerEventId, status, JSON.stringify(payload)]);
  if (status === "confirmed") {
    await confirmAppointmentReservations(db, intent.appointment_id);
    await db.run("UPDATE appointments SET status='confirmado' WHERE id=?", [intent.appointment_id]);
    await db.run("UPDATE payments SET status='pago', paid_at=? WHERE appointment_id=? AND payment_type='sinal'", [paidAt || new Date().toISOString(), intent.appointment_id]);
  }
  if (["cancelled", "failed", "expired", "refunded"].includes(status)) await releaseAppointmentReservations(db, intent.appointment_id, status === "expired" ? "expired" : "released");
  return db.get("SELECT * FROM payment_intents WHERE id=?", [intentId]);
}
