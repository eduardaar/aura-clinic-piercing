import crypto from "crypto";
import { confirmAppointmentReservations, releaseAppointmentReservations } from "./reservations.js";

// Um link de pagamento é uma credencial de baixa entropia operacional: basta
// encaminhá-lo para outra pessoa para ela acompanhar aquela cobrança. Por isso
// ele tem vida independente do vencimento financeiro da fatura. Sete dias dá
// tempo de o cliente voltar ao comprovante, sem transformar o link em acesso
// público permanente. A rotação é sempre possível pela rota administrativa.
export const PUBLIC_PAYMENT_TOKEN_DAYS = 7;

function newPublicToken() {
  return crypto.randomUUID();
}

// Resposta mínima que pode sair por agendamento/checkout público. O id serial,
// client_id, metadados e ids internos continuam disponíveis somente nas rotas
// administrativas autenticadas.
export function publicPaymentIntent(intent) {
  if (!intent) return null;
  return {
    token: intent.public_token,
    status: intent.status,
    // `expires_at` é o prazo de pagamento/reserva; `token_expires_at` é o
    // prazo de acesso público. Os dois não devem ser confundidos pelo cliente.
    expires_at: intent.expires_at || null,
    token_expires_at: intent.public_token_expires_at || null
  };
}

/** Revoga o link anterior e cria outro UUID para a mesma cobrança. */
export async function rotatePublicPaymentToken(db, intentId) {
  const token = newPublicToken();
  const result = await db.run(
    `UPDATE payment_intents
        SET public_token=?,
            public_token_expires_at=CURRENT_TIMESTAMP + (? * INTERVAL '1 day'),
            public_token_rotated_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP
      WHERE id=?
      RETURNING id`,
    [token, PUBLIC_PAYMENT_TOKEN_DAYS, intentId]
  );
  if (!result.returnedId) throw new Error("Intenção de pagamento não encontrada.");
  return db.get("SELECT * FROM payment_intents WHERE id=?", [intentId]);
}

/** Invalida imediatamente o link quando não há mais ação pública útil. */
export async function expirePublicPaymentToken(db, intentId) {
  await db.run(
    `UPDATE payment_intents
        SET public_token_expires_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`,
    [intentId]
  );
}

export async function createPaymentIntent(db, { appointmentId, clientId, amount, provider = "manual", idempotencyKey, expiresMinutes = 30 }) {
  const key = String(idempotencyKey || crypto.randomUUID());
  const existing = await db.get("SELECT * FROM payment_intents WHERE idempotency_key=?", [key]);
  if (existing) {
    // Reenvio legítimo do checkout depois de uma semana: devolve um link novo,
    // mas NUNCA cria uma segunda cobrança no gateway.
    const tokenExpired = !existing.public_token_expires_at || new Date(existing.public_token_expires_at).getTime() <= Date.now();
    const current = tokenExpired ? await rotatePublicPaymentToken(db, existing.id) : existing;
    return { ...current, idempotent: true };
  }
  const publicToken = newPublicToken();
  const result = await db.run(
    `INSERT INTO payment_intents
      (public_token, public_token_expires_at, appointment_id, client_id, provider, idempotency_key, amount, status, expires_at, metadata)
     VALUES (?, CURRENT_TIMESTAMP + (? * INTERVAL '1 day'), ?, ?, ?, ?, ?, 'awaiting_payment', CURRENT_TIMESTAMP + (? * INTERVAL '1 minute'), ?) RETURNING id`,
    [publicToken, PUBLIC_PAYMENT_TOKEN_DAYS, appointmentId, clientId, provider, key, Math.max(Number(amount || 0), 0), expiresMinutes, JSON.stringify({ integration: provider === "manual" ? "manual_proof" : "credentials_required" })]
  );
  return db.get("SELECT * FROM payment_intents WHERE id=?", [result.returnedId]);
}

// Transição de estado da intenção de pagamento. TUDO numa transação só: o
// `FOR UPDATE` abaixo só segura o lock até o fim dela — em autocommit ele era
// liberado na mesma hora e dois webhooks do mesmo intent passavam juntos. E as
// cinco escritas (intent, evento, reservas, agendamento, pagamento) precisam
// cair juntas: não pode existir reserva confirmada com o sinal pendente.
export async function transitionPaymentIntent(db, { intentId, status, providerEventId = null, payload = {}, paidAt = null }) {
  const allowed = ["pending", "awaiting_payment", "under_review", "confirmed", "failed", "cancelled", "refunded", "chargeback", "expired"];
  if (!allowed.includes(status)) throw new Error("Status de pagamento inválido.");
  return db.transaction(async (tx) => {
    // Serializa transições concorrentes do MESMO intent: a segunda espera aqui
    // e só então enxerga o estado final da primeira (inclusive o evento já
    // gravado, que faz a checagem de duplicidade abaixo funcionar de verdade).
    const intent = await tx.get("SELECT * FROM payment_intents WHERE id=? FOR UPDATE", [intentId]);
    if (!intent) throw new Error("Intenção de pagamento não encontrada.");
    if (providerEventId) {
      const duplicate = await tx.get("SELECT id FROM payment_events WHERE payment_intent_id=? AND provider_event_id=?", [intentId, providerEventId]);
      if (duplicate) return { ...intent, idempotent: true };
    }
    // Não deixe uma edição administrativa transformar pagamento confirmado em
    // cancelado, por exemplo. Exceções explícitas cobrem pagamento tardio após
    // expiração/cancelamento e o estorno/chargeback que chega do gateway.
    const transitions = {
      pending: ["awaiting_payment", "confirmed", "failed", "cancelled", "expired"],
      awaiting_payment: ["under_review", "confirmed", "failed", "cancelled", "expired"],
      under_review: ["confirmed", "failed", "cancelled", "expired"],
      confirmed: ["refunded", "chargeback"],
      failed: [],
      cancelled: ["confirmed"],
      expired: ["confirmed"],
      refunded: ["chargeback"],
      chargeback: []
    };
    if (intent.status !== status && !transitions[intent.status]?.includes(status)) {
      throw new Error(`Transição de pagamento inválida: ${intent.status} → ${status}.`);
    }
    await tx.run("UPDATE payment_intents SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [status, intentId]);
    await tx.run("INSERT INTO payment_events (payment_intent_id, provider_event_id, event_type, payload) VALUES (?, ?, ?, ?)", [intentId, providerEventId, status, JSON.stringify(payload)]);
    if (status === "confirmed") {
      await confirmAppointmentReservations(tx, intent.appointment_id);
      await tx.run("UPDATE appointments SET status='confirmado' WHERE id=?", [intent.appointment_id]);
      await tx.run("UPDATE payments SET status='pago', paid_at=? WHERE appointment_id=? AND payment_type='sinal'", [paidAt || new Date().toISOString(), intent.appointment_id]);
    }
    if (["cancelled", "failed", "expired", "refunded", "chargeback"].includes(status)) {
      await releaseAppointmentReservations(tx, intent.appointment_id, status === "expired" ? "expired" : "released");
      await expirePublicPaymentToken(tx, intentId);
    }
    return tx.get("SELECT * FROM payment_intents WHERE id=?", [intentId]);
  });
}
