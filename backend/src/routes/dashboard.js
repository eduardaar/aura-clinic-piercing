// Rota do dashboard (indicadores, agenda do dia, rankings e alertas).
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { nextBirthdays } from "../services/utils.js";
import { listAppointments } from "../services/appointments.js";
import { buildFinanceReport } from "../services/finance.js";

const router = Router();

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
  const lowStock = await db.get("SELECT COUNT(*) AS count FROM jewelry_inventory WHERE quantity > 0 AND quantity <= COALESCE(critical_stock_threshold, 3)");
  const todaysAppointments = await listAppointments(db, "WHERE a.appointment_date = ?", [today]);
  const lowStockJewelry = await db.all(`
    SELECT id, name, category, color, size, thickness, quantity, status, sku
    FROM jewelry_inventory
    WHERE quantity > 0 AND quantity <= COALESCE(critical_stock_threshold, 3)
    ORDER BY quantity ASC, name
    LIMIT 8
  `);
  const clients = await db.all("SELECT id, full_name, whatsapp, instagram, birth_date FROM clients WHERE birth_date IS NOT NULL");
  const birthdays = nextBirthdays(clients, 30).slice(0, 8);
  const topClients = await db.all(`
    SELECT
      c.id,
      c.full_name,
      c.whatsapp,
      c.instagram,
      COUNT(a.id) AS appointment_count,
      SUM(CASE WHEN LOWER(a.procedure) LIKE '%retorno%' OR LOWER(a.description) LIKE '%retorno%' THEN 1 ELSE 0 END) AS return_count,
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
  const upcomingAppointments = await listAppointments(db, "WHERE a.appointment_date >= ? AND a.status IN ('pendente', 'confirmado', 'remarcado')", [today]).then((rows) => rows.slice(0, 8));
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
      todayCount: stats?.today_count || stats?.todayCount || 0,
      pendingCount: stats?.pending_count || stats?.pendingCount || 0,
      confirmedCount: stats?.confirmed_count || stats?.confirmedCount || 0,
      criticalStock: lowStock?.count || 0,
      lowStockCount: lowStock?.count || 0,
      depositReceived: deposit?.total || 0,
      monthForecast: stats?.month_forecast || stats?.monthForecast || 0
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
      upcomingAppointments,
      returnClients
    }
  });
}));

export default router;
