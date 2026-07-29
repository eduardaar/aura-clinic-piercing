// Agregações consolidadas do estúdio: contagens, funil de CRM e mapa corporal.
// Tudo aqui vem do banco do tenant — o painel "Aura ERP" que consumia esta rota
// foi removido do frontend justamente porque exibia conteúdo fictício embutido
// no código (módulos, cupons, influenciadores, consultorias, cursos e calendário
// editorial). Esses blocos saíram; o que sobrou é medição real.
// O funil de CRM e o mapa corporal (regiões mais perfuradas) não existem em
// nenhuma outra rota — é por isso que este endpoint continua de pé.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();

router.get("/api/erp", withDb(async (_req, res, db) => {
  if (!requireRole(_req, res, ["admin"])) return;
  const clientsCount = await db.get("SELECT COUNT(*) AS count FROM clients");
  const appointmentsCount = await db.get("SELECT COUNT(*) AS count FROM appointments");
  const jewelryCount = await db.get("SELECT COUNT(*) AS count FROM jewelry_inventory");
  const paid = await db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'pago'");
  const catalogItems = await db.all(`
    SELECT id, name, photo_url, category, material, color, size, quantity, sale_value
    FROM jewelry_inventory
    WHERE quantity > 0
    ORDER BY name
    LIMIT 6
  `);
  const crm = await db.all(`
    SELECT stage, COUNT(*) AS total
    FROM (
      SELECT
        c.id,
        CASE
          WHEN COUNT(a.id) >= 4 THEN 'Cliente VIP'
          WHEN COUNT(a.id) >= 2 THEN 'Cliente recorrente'
          WHEN COUNT(a.id) = 1 THEN 'Cliente'
          ELSE 'Lead'
        END AS stage
      FROM clients c
      LEFT JOIN appointments a ON a.client_id = c.id
      GROUP BY c.id
    ) AS crm_stages
    GROUP BY stage
    ORDER BY total DESC
  `);
  const bodyMap = await db.all(`
    SELECT piercing_region AS region, COUNT(*) AS total
    FROM appointments
    WHERE piercing_region IS NOT NULL AND piercing_region != ''
    GROUP BY piercing_region
    ORDER BY total DESC
    LIMIT 8
  `);

  res.json({
    metrics: {
      clients: clientsCount.count || 0,
      appointments: appointmentsCount.count || 0,
      jewelry: jewelryCount.count || 0,
      revenue: paid.total || 0
    },
    crm,
    catalogItems,
    bodyMap
  });
}));

export default router;
