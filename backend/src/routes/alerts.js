// Rota de alertas: estoque, aniversarios e clientes frequentes.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { nextBirthdays } from "../services/utils.js";
import { listCriticalStockItems } from "../services/inventory.js";

const router = Router();

router.get("/api/alerts", withDb(async (_req, res, db) => {
  const today = new Date().toISOString().slice(0, 10);
  const jewelry = await listCriticalStockItems(db, { limit: 12 });
  const clients = await db.all("SELECT id, full_name, whatsapp, instagram, birth_date FROM clients WHERE birth_date IS NOT NULL");
  const birthdays = nextBirthdays(clients, 30).slice(0, 10);
  const topClients = await db.all(`
    SELECT c.id, c.full_name, c.whatsapp, c.instagram,
      COUNT(a.id) AS appointment_count,
      SUM(CASE WHEN LOWER(COALESCE(a.procedure, '')) LIKE '%retorno%' OR LOWER(COALESCE(a.description, '')) LIKE '%retorno%' THEN 1 ELSE 0 END) AS return_count,
      MAX(a.appointment_date) AS last_visit
    FROM clients c
    JOIN appointments a ON a.client_id = c.id
    GROUP BY c.id
    HAVING COUNT(a.id) >= 2
    ORDER BY appointment_count DESC, return_count DESC, last_visit DESC
    LIMIT 8
  `);

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
      action_page: "catalog",
      created_at: today
    })),
    ...birthdays.map((item) => ({
      id: `birthday-${item.id}`,
      title: item.days_until === 0 ? "Aniversário hoje" : "Aniversário próximo",
      category: "Clientes",
      subject: item.full_name,
      description: item.days_until === 0 ? `${item.full_name} faz aniversário hoje.` : `${item.full_name} faz aniversário em ${item.days_until} dia(s).`,
      priority: item.days_until <= 7 ? "medium" : "low",
      related_date: item.next_birthday,
      action_label: "Ver cliente",
      action_page: "client-center",
      created_at: today
    })),
    ...topClients.map((item) => ({
      id: `client-${item.id}`,
      title: "Cliente frequente",
      category: "Relacionamento",
      subject: item.full_name,
      description: `${item.full_name} possui ${Number(item.appointment_count || 0)} atendimento(s) e ${Number(item.return_count || 0)} retorno(s).`,
      priority: "low",
      related_date: item.last_visit,
      action_label: "Ver clientes",
      action_page: "client-center",
      created_at: today
    }))
  ];

  res.json({ count: alerts.length, items: alerts });
}));

export default router;
