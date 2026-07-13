// Rota do dashboard: indicadores, agenda do dia, rankings e alertas.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { nextBirthdays } from "../services/utils.js";
import { listAppointments } from "../services/appointments.js";
import { buildFinanceReport } from "../services/finance.js";
import { listCriticalStockItems } from "../services/inventory.js";

const router = Router();

function appointmentDateTime(item) {
  const value = new Date(`${item.appointment_date}T${item.appointment_time || "00:00"}:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function appointmentCountdown(item, now = new Date()) {
  const date = appointmentDateTime(item);
  if (!date) return "";
  const diffMinutes = Math.round((date.getTime() - now.getTime()) / 60000);
  if (diffMinutes < 0) return `Atrasado ha ${Math.abs(diffMinutes)} min`;
  if (diffMinutes < 60) return `Em ${diffMinutes} min`;
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return `Em ${hours}h${String(minutes).padStart(2, "0")}`;
}

function buildAppointmentAlerts(appointments, now = new Date()) {
  const seen = new Set();
  const alerts = [];
  for (const item of appointments) {
    const date = appointmentDateTime(item);
    if (!date) continue;
    const diffMinutes = Math.round((date.getTime() - now.getTime()) / 60000);
    const base = {
      appointment_id: item.id,
      full_name: item.full_name,
      service_name: item.service_name || item.procedure,
      professional_name: item.professional_name,
      appointment_date: item.appointment_date,
      appointment_time: item.appointment_time,
      status: item.status
    };
    const add = (type, title, priority) => {
      const key = `${type}-${item.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      alerts.push({ ...base, id: key, type, title, priority, minutes_until: diffMinutes });
    };
    if (item.source === "public_booking" && item.status === "pendente") add("public-pending", "Solicitacao publica pendente", "high");
    if (Number(item.deposit_value || 0) > 0 && Number(item.remaining_value || 0) >= Number(item.total_value || 0)) add("deposit-pending", "Sinal pendente", "medium");
    if (diffMinutes < 0 && !["cancelado", "recusado", "atendido"].includes(item.status)) add("late", "Agendamento atrasado", "high");
    if (diffMinutes >= 0 && diffMinutes <= 120 && !["cancelado", "recusado", "atendido"].includes(item.status)) add("next-2h", "Agendamento em ate 2 horas", "high");
    else if (diffMinutes > 120 && diffMinutes <= 1440 && !["cancelado", "recusado", "atendido"].includes(item.status)) add("next-24h", "Agendamento em ate 24 horas", "medium");
  }
  return alerts;
}

router.get("/api/dashboard", withDb(async (_req, res, db) => {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const stats = await db.get(`
    SELECT
      SUM(CASE WHEN appointment_date = ? THEN 1 ELSE 0 END) AS today_count,
      SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN status = 'confirmado' THEN 1 ELSE 0 END) AS confirmed_count,
      SUM(CASE WHEN appointment_date LIKE ? THEN total_value ELSE 0 END) AS month_forecast
    FROM appointments
  `, [today, `${month}%`]);
  const deposit = await db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_type = 'sinal' AND status = 'pago'");
  const todaysAppointments = await listAppointments(db, "WHERE a.appointment_date = ?", [today]);
  const lowStockJewelry = await listCriticalStockItems(db, { limit: 8 });
  const clients = await db.all("SELECT id, full_name, whatsapp, instagram, birth_date FROM clients WHERE birth_date IS NOT NULL");
  const birthdays = nextBirthdays(clients, 30).slice(0, 8);
  const topClients = await db.all(`
    SELECT
      c.id,
      c.full_name,
      c.whatsapp,
      c.instagram,
      COUNT(a.id) AS appointment_count,
      SUM(CASE WHEN LOWER(COALESCE(a.procedure, '')) LIKE '%retorno%' OR LOWER(COALESCE(a.description, '')) LIKE '%retorno%' THEN 1 ELSE 0 END) AS return_count,
      MAX(a.appointment_date) AS last_visit
    FROM clients c
    JOIN appointments a ON a.client_id = c.id
    GROUP BY c.id
    ORDER BY appointment_count DESC, return_count DESC, last_visit DESC
    LIMIT 6
  `);
  const finance = await buildFinanceReport(db);
  const procedureRanking = await db.all(`
    SELECT procedure AS label, COUNT(*) AS total
    FROM appointments
    WHERE status = 'atendido'
    GROUP BY procedure
    ORDER BY total DESC
    LIMIT 6
  `);
  const jewelryRanking = await db.all(`
    SELECT j.name AS label, COUNT(*) AS total
    FROM appointments a
    JOIN jewelry_inventory j ON j.id = a.jewelry_id
    WHERE a.status = 'atendido'
    GROUP BY j.id
    ORDER BY total DESC
    LIMIT 6
  `);
  const categoryRanking = await db.all(`
    SELECT j.category AS label, COUNT(*) AS total
    FROM appointments a
    JOIN jewelry_inventory j ON j.id = a.jewelry_id
    WHERE a.status = 'atendido'
    GROUP BY j.category
    ORDER BY total DESC
    LIMIT 6
  `);
  const birthdaysMonth = await db.all(`
    SELECT id, full_name, whatsapp, instagram, birth_date
    FROM clients
    WHERE birth_date IS NOT NULL AND SUBSTR(birth_date, 6, 2) = ?
    ORDER BY SUBSTR(birth_date, 9, 2)
    LIMIT 8
  `, [today.slice(5, 7)]);
  const upcomingAppointments = await listAppointments(
    db,
    "WHERE a.appointment_date >= ? AND a.status IN ('pendente', 'confirmado', 'remarcado')",
    [today]
  );
  const nextAppointment = upcomingAppointments[0] ? {
    ...upcomingAppointments[0],
    countdown: appointmentCountdown(upcomingAppointments[0])
  } : null;
  const appointmentAlerts = buildAppointmentAlerts(upcomingAppointments);
  const returnClients = await db.all(`
    SELECT f.*, c.full_name, c.whatsapp, a.procedure
    FROM post_care_followups f
    JOIN clients c ON c.id = f.client_id
    JOIN appointments a ON a.id = f.appointment_id
    WHERE f.status != 'concluido'
    ORDER BY f.due_date ASC
    LIMIT 8
  `);

  res.json({
    stats: {
      todayCount: stats?.today_count || 0,
      pendingCount: stats?.pending_count || 0,
      confirmedCount: stats?.confirmed_count || 0,
      criticalStock: lowStockJewelry.length,
      lowStockCount: lowStockJewelry.length,
      depositReceived: deposit?.total || 0,
      monthForecast: stats?.month_forecast || 0
    },
    todaysAppointments,
    alerts: { lowStockJewelry, birthdays, topClients },
    adminDashboard: {
      monthlyRevenue: finance.monthlyRevenue,
      weeklyRevenue: finance.weeklyRevenue,
      dailyRevenue: finance.dailyRevenue,
      procedureRanking,
      jewelryRanking,
      categoryRanking,
      criticalStock: lowStockJewelry,
      birthdaysMonth,
      upcomingAppointments: upcomingAppointments.slice(0, 8),
      nextAppointment,
      appointmentAlerts,
      returnClients
    }
  });
}));

export default router;
