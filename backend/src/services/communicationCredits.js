// Carteira de créditos de comunicação.
//
// O saldo é separado por canal para impedir que uma carga barata de e-mail seja
// usada para custear WhatsApp ou IA. A carteira mensal expira por competência
// (YYYY-MM); toda mutação usa uma transação e atualiza a projeção de saldo e o
// ledger imutável na mesma confirmação.
import { tenantSubscription } from "./subscriptions.js";

export const COMMUNICATION_CHANNELS = ["whatsapp", "email", "ai"];

export const PLAN_MONTHLY_COMMUNICATION_CREDITS = {
  start: { whatsapp: 0, email: 100, ai: 20 },
  profissional: { whatsapp: 100, email: 300, ai: 100 },
  studio: { whatsapp: 500, email: 1000, ai: 400 }
};

// Preços de catálogo. A compra ainda não aciona gateway: ela cria apenas uma
// intenção pendente, para a plataforma poder conectar Asaas/checkout depois.
export const COMMUNICATION_CREDIT_PRODUCTS = [
  { key: "whatsapp_100", channel: "whatsapp", credits: 100, price_cents: 2490, name: "100 mensagens WhatsApp" },
  { key: "whatsapp_500", channel: "whatsapp", credits: 500, price_cents: 10990, name: "500 mensagens WhatsApp" },
  { key: "email_1000", channel: "email", credits: 1000, price_cents: 990, name: "1.000 e-mails" },
  { key: "ai_100", channel: "ai", credits: 100, price_cents: 1490, name: "100 créditos de IA" },
  { key: "ai_500", channel: "ai", credits: 500, price_cents: 6490, name: "500 créditos de IA" }
];

export class CommunicationCreditError extends Error {
  constructor(message, code = "communication_credit_error", statusCode = 422) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function communicationPeriod(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) throw new CommunicationCreditError("Competência de crédito inválida.", "invalid_period", 400);
  return value.toISOString().slice(0, 7);
}

function normalizePeriod(periodKey) {
  if (periodKey == null || periodKey === "") return communicationPeriod();
  const normalized = String(periodKey);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(normalized)) {
    throw new CommunicationCreditError("Competência deve estar no formato AAAA-MM.", "invalid_period", 400);
  }
  return normalized;
}

function assertChannel(channel) {
  const normalized = String(channel || "").trim().toLowerCase();
  if (!COMMUNICATION_CHANNELS.includes(normalized)) {
    throw new CommunicationCreditError("Canal de comunicação inválido.", "invalid_channel", 400);
  }
  return normalized;
}

function assertCredits(credits) {
  const amount = Number(credits);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1000000) {
    throw new CommunicationCreditError("Quantidade de créditos inválida.", "invalid_credits", 400);
  }
  return amount;
}

function monthlyAllowance(planCode) {
  return PLAN_MONTHLY_COMMUNICATION_CREDITS[planCode] || PLAN_MONTHLY_COMMUNICATION_CREDITS.start;
}

async function planCodeForTenant(tenantId) {
  const subscription = await tenantSubscription(tenantId);
  return subscription?.plan_code || "start";
}

async function ensureWallet(tx, channel, periodKey) {
  await tx.run(
    `INSERT INTO communication_credit_wallets (channel, period_key)
     VALUES (?, ?) ON CONFLICT (channel, period_key) DO NOTHING`,
    [channel, periodKey]
  );
}

// Concede a franquia uma única vez por plano/canal/competência. O identificador
// no ledger torna a operação idempotente mesmo quando duas requisições chegam
// juntas no primeiro acesso do mês.
export async function ensureMonthlyCommunicationCredits(db, tenantId, { periodKey = communicationPeriod() } = {}) {
  periodKey = normalizePeriod(periodKey);
  const planCode = await planCodeForTenant(tenantId);
  const allowance = monthlyAllowance(planCode);
  return db.transaction(async (tx) => {
    for (const channel of COMMUNICATION_CHANNELS) {
      const credits = Number(allowance[channel] || 0);
      await ensureWallet(tx, channel, periodKey);
      if (!credits) continue;
      const referenceKey = `monthly:${periodKey}:${planCode}:${channel}`;
      const inserted = await tx.run(
        `INSERT INTO communication_credit_ledger
          (channel, period_key, entry_type, credits, reference_key, metadata)
         VALUES (?, ?, 'monthly_grant', ?, ?, ?)
         ON CONFLICT (reference_key) WHERE reference_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [channel, periodKey, credits, referenceKey, JSON.stringify({ plan_code: planCode })]
      );
      if (inserted.changes) {
        await tx.run(
          `UPDATE communication_credit_wallets
              SET available_credits=available_credits + ?, updated_at=CURRENT_TIMESTAMP
            WHERE channel=? AND period_key=?`,
          [credits, channel, periodKey]
        );
      }
    }
    return { plan_code: planCode, period_key: periodKey, allowance };
  });
}

export async function communicationCreditBalance(db, tenantId, { periodKey = communicationPeriod() } = {}) {
  periodKey = normalizePeriod(periodKey);
  const monthly = await ensureMonthlyCommunicationCredits(db, tenantId, { periodKey });
  const rows = await db.all(
    `SELECT channel, available_credits FROM communication_credit_wallets
      WHERE period_key=? ORDER BY channel`,
    [periodKey]
  );
  const available = Object.fromEntries(COMMUNICATION_CHANNELS.map((channel) => [channel, 0]));
  for (const row of rows) available[row.channel] = Number(row.available_credits || 0);
  return { period_key: periodKey, plan_code: monthly.plan_code, monthly_allowance: monthly.allowance, available };
}

export async function communicationCreditHistory(db, tenantId, { periodKey = communicationPeriod(), limit = 100 } = {}) {
  periodKey = normalizePeriod(periodKey);
  await ensureMonthlyCommunicationCredits(db, tenantId, { periodKey });
  const size = Math.min(Math.max(Number(limit) || 100, 1), 200);
  return db.all(
    `SELECT id, channel, period_key, entry_type, credits, reference_key, metadata, created_at
       FROM communication_credit_ledger
      WHERE period_key=?
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    [periodKey, size]
  );
}

export async function reserveCommunicationCredits(db, tenantId, { channel, credits = 1, referenceKey, metadata = {}, periodKey = communicationPeriod() } = {}) {
  periodKey = normalizePeriod(periodKey);
  const safeChannel = assertChannel(channel);
  const amount = assertCredits(credits);
  const reference = String(referenceKey || "").trim();
  if (!reference || reference.length > 180) throw new CommunicationCreditError("Referência da reserva inválida.", "invalid_reference", 400);
  await ensureMonthlyCommunicationCredits(db, tenantId, { periodKey });
  return db.transaction(async (tx) => {
    const existing = await tx.get("SELECT * FROM communication_credit_reservations WHERE reference_key=? FOR UPDATE", [reference]);
    if (existing) return existing;
    const changed = await tx.run(
      `UPDATE communication_credit_wallets
          SET available_credits=available_credits - ?, updated_at=CURRENT_TIMESTAMP
        WHERE channel=? AND period_key=? AND available_credits >= ?`,
      [amount, safeChannel, periodKey, amount]
    );
    if (!changed.changes) {
      throw new CommunicationCreditError("Saldo insuficiente para esta comunicação.", "insufficient_credits", 402);
    }
    const reservation = await tx.run(
      `INSERT INTO communication_credit_reservations (channel, period_key, credits, reference_key, metadata)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
      [safeChannel, periodKey, amount, reference, JSON.stringify(metadata || {})]
    );
    await tx.run(
      `INSERT INTO communication_credit_ledger
        (channel, period_key, entry_type, credits, reference_key, metadata)
       VALUES (?, ?, 'reservation', ?, ?, ?)`,
      [safeChannel, periodKey, -amount, `reservation:${reference}`, JSON.stringify({ reservation_id: reservation.rows[0].id, ...(metadata || {}) })]
    );
    return reservation.rows[0];
  });
}

export async function consumeCommunicationCredit(db, { reservationId, metadata = {} } = {}) {
  const id = Number(reservationId);
  if (!Number.isInteger(id) || id <= 0) throw new CommunicationCreditError("Reserva de crédito inválida.", "invalid_reservation", 400);
  return db.transaction(async (tx) => {
    const reservation = await tx.get("SELECT * FROM communication_credit_reservations WHERE id=? FOR UPDATE", [id]);
    if (!reservation) throw new CommunicationCreditError("Reserva de crédito não encontrada.", "reservation_not_found", 404);
    if (reservation.status === "consumed") return reservation;
    if (reservation.status !== "active") throw new CommunicationCreditError("Esta reserva não pode mais ser consumida.", "reservation_inactive", 409);
    await tx.run("UPDATE communication_credit_reservations SET status='consumed', consumed_at=CURRENT_TIMESTAMP WHERE id=?", [id]);
    await tx.run(
      `INSERT INTO communication_credit_ledger (channel, period_key, entry_type, credits, reference_key, metadata)
       VALUES (?, ?, 'consumption', 0, ?, ?) ON CONFLICT (reference_key) WHERE reference_key IS NOT NULL DO NOTHING`,
      [reservation.channel, reservation.period_key, `consumption:${id}`, JSON.stringify({ reservation_id: id, ...(metadata || {}) })]
    );
    return { ...reservation, status: "consumed" };
  });
}

export async function releaseCommunicationCredit(db, { reservationId, metadata = {} } = {}) {
  const id = Number(reservationId);
  if (!Number.isInteger(id) || id <= 0) throw new CommunicationCreditError("Reserva de crédito inválida.", "invalid_reservation", 400);
  return db.transaction(async (tx) => {
    const reservation = await tx.get("SELECT * FROM communication_credit_reservations WHERE id=? FOR UPDATE", [id]);
    if (!reservation) throw new CommunicationCreditError("Reserva de crédito não encontrada.", "reservation_not_found", 404);
    if (reservation.status === "released") return reservation;
    if (reservation.status !== "active") throw new CommunicationCreditError("Esta reserva não pode mais ser liberada.", "reservation_inactive", 409);
    await tx.run("UPDATE communication_credit_reservations SET status='released', released_at=CURRENT_TIMESTAMP WHERE id=?", [id]);
    await tx.run(
      `UPDATE communication_credit_wallets SET available_credits=available_credits + ?, updated_at=CURRENT_TIMESTAMP
        WHERE channel=? AND period_key=?`,
      [reservation.credits, reservation.channel, reservation.period_key]
    );
    await tx.run(
      `INSERT INTO communication_credit_ledger (channel, period_key, entry_type, credits, reference_key, metadata)
       VALUES (?, ?, 'release', ?, ?, ?) ON CONFLICT (reference_key) WHERE reference_key IS NOT NULL DO NOTHING`,
      [reservation.channel, reservation.period_key, reservation.credits, `release:${id}`, JSON.stringify({ reservation_id: id, ...(metadata || {}) })]
    );
    return { ...reservation, status: "released" };
  });
}

// Uso exclusivo de webhook/backoffice após uma cobrança confirmada. Não há rota
// pública para esta função enquanto o checkout de créditos estiver pendente.
export async function grantCommunicationTopup(db, { channel, credits, referenceKey, metadata = {}, periodKey = communicationPeriod() } = {}) {
  periodKey = normalizePeriod(periodKey);
  const safeChannel = assertChannel(channel);
  const amount = assertCredits(credits);
  const reference = String(referenceKey || "").trim();
  if (!reference) throw new CommunicationCreditError("Referência da recarga inválida.", "invalid_reference", 400);
  return db.transaction(async (tx) => {
    await ensureWallet(tx, safeChannel, periodKey);
    const inserted = await tx.run(
      `INSERT INTO communication_credit_ledger (channel, period_key, entry_type, credits, reference_key, metadata)
       VALUES (?, ?, 'topup', ?, ?, ?) ON CONFLICT (reference_key) WHERE reference_key IS NOT NULL DO NOTHING RETURNING id`,
      [safeChannel, periodKey, amount, reference, JSON.stringify(metadata || {})]
    );
    if (inserted.changes) {
      await tx.run("UPDATE communication_credit_wallets SET available_credits=available_credits + ?, updated_at=CURRENT_TIMESTAMP WHERE channel=? AND period_key=?", [amount, safeChannel, periodKey]);
    }
    return { applied: Boolean(inserted.changes), channel: safeChannel, credits: amount, period_key: periodKey };
  });
}

export function communicationCreditProduct(productKey) {
  return COMMUNICATION_CREDIT_PRODUCTS.find((product) => product.key === String(productKey || "")) || null;
}
