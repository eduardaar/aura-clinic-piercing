// Central de pendências: somente itens acionáveis. Informações como
// aniversários e clientes frequentes pertencem ao dashboard, pois não deixam
// de existir só porque alguém abriu o sino.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { listCriticalStockItems } from "../services/inventory.js";
import { listAppointments } from "../services/appointments.js";
import { listTenantInvoices } from "../services/platformBilling.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { P } from "../config/permissions.js";

const router = Router();

router.get("/api/alerts", withDb(async (_req, res, db) => {
  if (!authorizePermission(_req, res, P.DASHBOARD_VIEW)) return;
  const today = new Date().toISOString().slice(0, 10);
  const jewelry = await listCriticalStockItems(db, { limit: 12 });
  const upcomingAppointments = await listAppointments(
    db,
    "WHERE a.appointment_date >= ? AND a.status IN ('pendente', 'awaiting_deposit_proof', 'confirmado', 'remarcado')",
    [today]
  );
  // Faturas são da clínica, portanto só entram para o administrador. Isso
  // evita expor situação de cobrança a funções operacionais.
  const openInvoices = _req.user?.role === "admin"
    ? (await listTenantInvoices(_req.tenant.id, { limit: 10 })).items
      .filter((invoice) => ["pendente", "atrasada"].includes(invoice.status))
    : [];

  const alerts = [
    ...jewelry.map((item) => ({
      id: `stock-${item.id}`,
      title: item.alert_level === "Esgotado" ? "Joia esgotada" : "Joia acabando",
      category: "Estoque",
      subject: item.name,
      description: `${item.name} possui ${Number(item.quantity || 0)} unidade(s) disponível(is).`,
      priority: item.priority,
      related_date: today,
      action_label: "Ver estoque",
      action_page: "inventory",
      created_at: today
    })),
    ...upcomingAppointments.flatMap((item) => {
      const date = new Date(`${item.appointment_date}T${item.appointment_time || "00:00"}:00`);
      const diffMinutes = Number.isNaN(date.getTime()) ? null : Math.round((date.getTime() - Date.now()) / 60000);
      const result = [];
      if (item.source === "public_booking" && ["pendente", "awaiting_deposit_proof"].includes(item.status)) {
        result.push({
          id: `appointment-public-${item.id}`,
          title: "Solicitação pública aguardando sinal",
          category: "Agenda",
          subject: item.full_name,
          description: `${item.full_name} solicitou ${item.service_name || item.procedure} para ${item.appointment_date} às ${item.appointment_time}.`,
          priority: "high",
          related_date: item.appointment_date,
          action_label: "Ver solicitações",
          action_page: "agenda",
          created_at: today
        });
      }
      if (diffMinutes !== null && diffMinutes >= 0 && diffMinutes <= 120) {
        result.push({
          id: `appointment-2h-${item.id}`,
          title: "Agendamento em até 2 horas",
          category: "Agenda",
          subject: item.full_name,
          description: `${item.full_name} tem atendimento às ${item.appointment_time}.`,
          priority: "high",
          related_date: item.appointment_date,
          action_label: "Ver agenda",
          action_page: "agenda",
          created_at: today
        });
      }
      return result;
    }),
    ...openInvoices.map((invoice) => ({
      id: `invoice-${invoice.id}`,
      title: invoice.status === "atrasada" ? "Fatura da assinatura em atraso" : "Fatura da assinatura pendente",
      category: "Cobrança",
      subject: `Plano ${invoice.plan_code || "atual"}`,
      description: invoice.due_date
        ? `Vencimento em ${invoice.due_date}. Acesse Meu plano para pagar ou consultar a fatura.`
        : "Acesse Meu plano para pagar ou consultar a fatura.",
      priority: invoice.status === "atrasada" ? "high" : "medium",
      related_date: invoice.due_date,
      action_label: "Ver faturas",
      action_page: "meu-plano",
      created_at: invoice.created_at || today
    }))
  ].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - ({ high: 0, medium: 1, low: 2 }[b.priority])));

  res.json({ count: alerts.length, items: alerts });
}));

export default router;
