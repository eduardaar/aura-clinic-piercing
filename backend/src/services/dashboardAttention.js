import { localDate, localTimestamp } from "./utils.js";
import { listCriticalStockItems } from "./inventory.js";

export function attentionPeriod(period = "today", now = new Date()) {
  const today = localDate(now);
  const date = new Date(`${today}T12:00:00Z`);
  let from = today;
  let to = today;
  if (period === "week") {
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    from = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 6);
    to = date.toISOString().slice(0, 10);
  } else if (period === "month") {
    from = `${today.slice(0, 7)}-01`;
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    to = date.toISOString().slice(0, 10);
  }
  return { from, to };
}

export async function dashboardAttention(db, { period = "today", now = new Date(), appointments = true, inventory = true, clients = true, followups = true } = {}) {
  const { from, to } = attentionPeriod(period, now);
  const [pending, stock, birthdays, returns] = await Promise.all([
    appointments ? db.get(`SELECT COUNT(*) AS total FROM appointments
      WHERE appointment_date BETWEEN ? AND ? AND (status IN ('pendente','awaiting_deposit_proof','chegou','em_atendimento')
        OR (status='confirmado' AND (appointment_date || ' ' || appointment_time) <= ?))`, [from, to, localTimestamp(now)]) : null,
    inventory ? listCriticalStockItems(db, { limit: Number.MAX_SAFE_INTEGER }) : null,
    clients ? db.all("SELECT birth_date FROM clients WHERE birth_date IS NOT NULL") : null,
    followups ? db.get(`SELECT COUNT(DISTINCT client_id) AS total FROM post_care_followups
      WHERE due_date BETWEEN ? AND ? AND status != 'concluido'`, [from, to]) : null
  ]);
  // Compara mês/dia, inclusive semanas que atravessam dezembro e janeiro.
  const days = new Set();
  const cursor = new Date(`${from}T12:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= to) {
    days.add(cursor.toISOString().slice(5, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return {
    period, from, to, updated_at: now.toISOString(),
    appointments: pending ? Number(pending.total) : null,
    sold_out: stock ? stock.filter((item) => item.track_stock && item.can_sell && Number(item.quantity) <= 0).length : null,
    birthdays: birthdays ? birthdays.filter((item) => days.has(String(item.birth_date).slice(5, 10))).length : null,
    returns: returns ? Number(returns.total) : null
  };
}
