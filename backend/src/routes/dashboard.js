// Rota do dashboard: indicadores, agenda do dia, rankings e alertas.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { localDate, nextBirthdays } from "../services/utils.js";
import { listAppointments } from "../services/appointments.js";
import { buildFinanceReport } from "../services/finance.js";
import { syncFinanceSources } from "../services/financeLedger.js";
import { listCriticalStockItems } from "../services/inventory.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { hasPermission } from "../services/permissionService.js";
import { P } from "../config/permissions.js";

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
    if (item.source === "public_booking" && ["pendente", "awaiting_deposit_proof"].includes(item.status)) add("public-pending", "Solicitação pública aguardando sinal", "high");
    if (Number(item.deposit_value || 0) > 0 && Number(item.remaining_value || 0) >= Number(item.total_value || 0)) add("deposit-pending", "Sinal pendente", "medium");
    if (diffMinutes < 0 && !["cancelado", "recusado", "atendido"].includes(item.status)) add("late", "Agendamento atrasado", "high");
    if (diffMinutes >= 0 && diffMinutes <= 120 && !["cancelado", "recusado", "atendido"].includes(item.status)) add("next-2h", "Agendamento em ate 2 horas", "high");
    else if (diffMinutes > 120 && diffMinutes <= 1440 && !["cancelado", "recusado", "atendido"].includes(item.status)) add("next-24h", "Agendamento em ate 24 horas", "medium");
  }
  return alerts;
}

router.get("/api/dashboard", withDb(async (_req, res, db) => {
  if (!authorizePermission(_req, res, P.DASHBOARD_VIEW)) return;
  const canViewFinancial = hasPermission(_req.user, P.DASHBOARD_FINANCIAL);
  const today = localDate();
  const month = today.slice(0, 7);
  const periodDays = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 }[_req.query.period] || 30;
  const periodStart = localDate(new Date(Date.now() - (periodDays - 1) * 86_400_000));
  const stats = await db.get(`
    SELECT
      SUM(CASE WHEN appointment_date = ? AND status NOT IN ('cancelado', 'recusado', 'remarcado', 'nao_compareceu') THEN 1 ELSE 0 END) AS today_count,
      SUM(CASE WHEN status IN ('pendente', 'awaiting_deposit_proof') THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN status = 'confirmado' THEN 1 ELSE 0 END) AS confirmed_count,
      SUM(CASE WHEN appointment_date LIKE ? AND status NOT IN ('cancelado', 'recusado', 'remarcado', 'nao_compareceu') THEN total_value ELSE 0 END) AS month_forecast,
      -- Saldo ainda a receber da agenda do mês: o restante dos agendamentos
      -- que não foram finalizados nem cancelados. Atendimento finalizado vira
      -- título em "A receber" e não entra aqui (seria contado duas vezes).
      SUM(CASE WHEN appointment_date LIKE ? AND status IN ('pendente', 'awaiting_deposit_proof', 'confirmado', 'chegou', 'em_atendimento') THEN remaining_value ELSE 0 END) AS month_pending
    FROM appointments
  `, [today, `${month}%`, `${month}%`]);
  // Faturamento do dia: todos os tipos de pagamento RECEBIDOS (pago ou
  // confirmado) na data local de hoje. Pendente, crédito aplicado (não é caixa
  // novo), cancelado e estornado não são faturamento.
  const revenueToday = await db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status IN ('pago', 'confirmado') AND SUBSTRING(paid_at, 1, 10) = ?", [today]);
  const newClients = await db.get("SELECT COUNT(*) AS total FROM clients WHERE created_at LIKE ?", [`${month}%`]);
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
  // Rankings do PERÍODO selecionado (7/30/90/365 dias), como a tela diz.
  const procedureRanking = await db.all(`
    SELECT procedure AS label, COUNT(*) AS total
    FROM appointments
    WHERE status = 'atendido' AND appointment_date BETWEEN ? AND ?
    GROUP BY procedure
    ORDER BY total DESC
    LIMIT 6
  `, [periodStart, today]);
  // Produtos/joias que saíram no período: todas as joias dos itens de
  // atendimentos finalizados (não só a joia principal) + vendas avulsas não
  // canceladas. O espelho legado do atendimento (source='agenda') fica fora
  // para não contar a mesma joia duas vezes.
  const soldProducts = `
    SELECT ai.jewelry_id AS product_id, ai.quantity
    FROM appointment_items ai JOIN appointments a ON a.id = ai.appointment_id
    WHERE a.status = 'atendido' AND ai.jewelry_id IS NOT NULL AND a.appointment_date BETWEEN ? AND ?
    UNION ALL
    SELECT soi.product_id, soi.quantity
    FROM sales_order_items soi JOIN sales_orders so ON so.id = soi.sales_order_id
    WHERE soi.product_id IS NOT NULL AND so.source <> 'agenda' AND so.status NOT IN ('cancelado', 'cancelada', 'devolvida')
      AND SUBSTRING(so.created_at, 1, 10) BETWEEN ? AND ?`;
  const jewelryRanking = await db.all(`
    SELECT j.name AS label, SUM(sold.quantity) AS total
    FROM (${soldProducts}) sold
    JOIN jewelry_inventory j ON j.id = sold.product_id
    GROUP BY j.id, j.name
    ORDER BY total DESC, j.name
    LIMIT 6
  `, [periodStart, today, periodStart, today]);
  const categoryRanking = await db.all(`
    SELECT COALESCE(NULLIF(j.category, ''), 'Sem categoria') AS label, SUM(sold.quantity) AS total
    FROM (${soldProducts}) sold
    JOIN jewelry_inventory j ON j.id = sold.product_id
    GROUP BY COALESCE(NULLIF(j.category, ''), 'Sem categoria')
    ORDER BY total DESC, label
    LIMIT 6
  `, [periodStart, today, periodStart, today]);
  const birthdaysMonth = await db.all(`
    SELECT id, full_name, whatsapp, instagram, birth_date
    FROM clients
    WHERE birth_date IS NOT NULL AND SUBSTR(birth_date, 6, 2) = ?
    ORDER BY SUBSTR(birth_date, 9, 2)
    LIMIT 8
  `, [today.slice(5, 7)]);
  const upcomingAppointments = await listAppointments(
    db,
    "WHERE a.appointment_date >= ? AND a.status IN ('pendente', 'awaiting_deposit_proof', 'confirmado', 'remarcado')",
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
  const appointmentKpis = await db.get(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status='atendido' THEN 1 ELSE 0 END) AS attended,
        SUM(CASE WHEN status IN ('cancelado','recusado') THEN 1 ELSE 0 END) AS canceled,
        COALESCE(AVG(CASE WHEN status='atendido' THEN total_value END),0) AS average_ticket
      FROM appointments WHERE appointment_date BETWEEN ? AND ?
    `, [periodStart, today]);
  const paymentKpis = await db.get("SELECT COALESCE(SUM(amount),0) AS received, COALESCE(SUM(CASE WHEN payment_type='sinal' THEN amount ELSE 0 END),0) AS deposits FROM payments WHERE status IN ('pago','confirmado') AND SUBSTRING(paid_at,1,10) BETWEEN ? AND ?", [periodStart, today]);
  const promotionKpis = await db.get("SELECT COUNT(*) AS uses,COALESCE(SUM(discount_amount),0) AS discount FROM promotion_usages WHERE SUBSTRING(CAST(created_at AS TEXT),1,10) BETWEEN ? AND ?", [periodStart, today]);
  const couponKpis = await db.get("SELECT COUNT(*) AS uses,COALESCE(SUM(discount_amount),0) AS discount FROM coupon_usages WHERE SUBSTRING(CAST(created_at AS TEXT),1,10) BETWEEN ? AND ?", [periodStart, today]);
  const catalogKpis = await db.all("SELECT event_type,COUNT(*) AS total,COUNT(DISTINCT session_key) AS sessions FROM catalog_events WHERE SUBSTRING(occurred_at,1,10) BETWEEN ? AND ? GROUP BY event_type", [periodStart, today]);
  const topViewed = await db.all(`
      SELECT j.id,j.name,COUNT(*) AS views FROM catalog_events e JOIN jewelry_inventory j ON j.id=e.product_id
      WHERE e.event_type='product_view' AND SUBSTRING(e.occurred_at,1,10) BETWEEN ? AND ?
      GROUP BY j.id ORDER BY views DESC LIMIT 6
    `, [periodStart, today]);
  const professionalRanking = await db.all(`
      SELECT p.id,p.name AS label,COUNT(a.id) AS appointments,COALESCE(SUM(a.total_value),0) AS revenue
      FROM professionals p LEFT JOIN appointments a ON a.professional_id=p.id AND a.appointment_date BETWEEN ? AND ? AND a.status='atendido'
      GROUP BY p.id ORDER BY revenue DESC LIMIT 6
    `, [periodStart, today]);
  // "A receber"/"A pagar" com o MESMO critério do razão (ledgerReport):
  // espelhos sincronizados antes de somar, só lançamentos ativos (fora teste e
  // cancelamento administrativo) e só o saldo em aberto de cada um.
  if (canViewFinancial) await syncFinanceSources(db);
  const financialPending = canViewFinancial ? await db.get(`
      SELECT
        COALESCE(SUM(GREATEST(amount-paid_amount,0)) FILTER (WHERE entry_type IN ('payable','expense')),0) AS payable,
        COALESCE(SUM(GREATEST(amount-paid_amount,0)) FILTER (WHERE entry_type IN ('receivable','income')),0) AS receivable
      FROM financial_entries
      WHERE status IN ('pending','overdue','partially_paid') AND COALESCE(lifecycle_status,'active')='active'
    `) : {};
  const catalogMetrics = Object.fromEntries(catalogKpis.map((item) => [item.event_type, Number(item.total || 0)]));
  const catalogViews = Number(catalogMetrics.catalog_view || 0);
  const catalogSelections = Number(catalogMetrics.product_selected || 0);
  const visibleProfessionalRanking = canViewFinancial
    ? professionalRanking
    : professionalRanking.map(({ revenue: _revenue, ...item }) => item);

  res.json({
    stats: {
      todayCount: stats?.today_count || 0,
      pendingCount: stats?.pending_count || 0,
      confirmedCount: stats?.confirmed_count || 0,
      criticalStock: lowStockJewelry.length,
      lowStockCount: lowStockJewelry.length,
      ...(canViewFinancial ? {
        // Sinais do mês corrente (o painel que consome este valor é mensal).
        depositReceived: Number(finance.deposits?.monthTotal || 0),
        monthForecast: stats?.month_forecast || 0,
        monthPending: Number(stats?.month_pending || 0),
        revenueToday: Number(revenueToday?.total || 0),
        revenueMonth: Number(finance.totals?.month_total || 0),
        expensesMonth: Number(finance.expensesSummary?.total || 0),
        profitEstimated: Number(finance.profit?.estimated || 0)
      } : {}),
      newClientsMonth: Number(newClients?.total || 0)
    },
    todaysAppointments,
    alerts: { lowStockJewelry, birthdays, topClients },
    adminDashboard: {
      ...(canViewFinancial ? {
        monthlyRevenue: finance.monthlyRevenue,
        weeklyRevenue: finance.weeklyRevenue,
        dailyRevenue: finance.dailyRevenue
      } : {}),
      procedureRanking,
      jewelryRanking,
      categoryRanking,
      criticalStock: lowStockJewelry,
      birthdaysMonth,
      upcomingAppointments: upcomingAppointments.slice(0, 8),
      nextAppointment,
      appointmentAlerts,
      returnClients
      ,
      executive: {
        period_days: periodDays,
        period_start: periodStart,
        appointments: Number(appointmentKpis.total || 0),
        cancellations: Number(appointmentKpis.canceled || 0),
        attendance_rate: Number(appointmentKpis.total || 0) ? Number(((Number(appointmentKpis.attended || 0) / Number(appointmentKpis.total)) * 100).toFixed(1)) : 0,
        cancellation_rate: Number(appointmentKpis.total || 0) ? Number(((Number(appointmentKpis.canceled || 0) / Number(appointmentKpis.total)) * 100).toFixed(1)) : 0,
        ...(canViewFinancial ? {
          // Ticket médio = líquido médio dos atendimentos finalizados no
          // período. Antes dividia TODOS os pagamentos (vendas e sinais de
          // atendimentos futuros) pelo número de atendidos.
          average_ticket: Number(Number(appointmentKpis.average_ticket || 0).toFixed(2)),
          received: Number(paymentKpis.received || 0),
          deposits: Number(paymentKpis.deposits || 0),
          payable: Number(financialPending.payable || 0),
          receivable: Number(financialPending.receivable || 0)
        } : {}),
        promotion_uses: Number(promotionKpis.uses || 0),
        coupon_uses: Number(couponKpis.uses || 0),
        catalog_conversion_rate: catalogViews ? Number(((catalogSelections / catalogViews) * 100).toFixed(1)) : 0,
        catalog_views: catalogViews,
        product_selections: catalogSelections
      },
      topViewed,
      professionalRanking: visibleProfessionalRanking
    }
  });
}));

export default router;
