// Rotas administrativas sensíveis (reset de dados de demonstração).
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { isProduction } from "../config/index.js";

const router = Router();

router.post("/api/admin/reset-demo-data", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  // Endpoint destrutivo (TRUNCATE geral). Em produção fica bloqueado por padrão,
  // a menos que o operador libere explicitamente via ALLOW_DEMO_RESET=true.
  if (isProduction && process.env.ALLOW_DEMO_RESET !== "true") {
    return res.status(403).json({
      error: "Reset de dados de demonstração está desabilitado em produção. Defina ALLOW_DEMO_RESET=true no ambiente para liberar."
    });
  }
  if (req.body?.confirmation !== "RESETAR") {
    return res.status(400).json({ error: "Digite RESETAR para confirmar a limpeza dos dados." });
  }

  const tables = [
    "post_care_followups",
    "digital_terms",
    "client_medical_records",
    "loyalty_points",
    "loyalty_redemptions",
    "sales_order_items",
    "sales_orders",
    "payments",
    "appointments",
    "schedule_blocks",
    "stock_movements",
    "catalog_featured_products",
    "catalog_promotions",
    "expenses",
    "jewelry_variants",
    "jewelry_inventory",
    "clients"
  ];

  const removed = {};
  for (const table of tables) {
    const count = await db.get(`SELECT COUNT(*) AS count FROM ${table}`);
    removed[table] = Number(count?.count || 0);
  }
  // `tables` é uma allowlist fixa e interna (não vem do usuário).
  await db.run(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);

  res.json({
    ok: true,
    message: "Dados de demonstração removidos. Usuários, categorias e configurações foram preservados.",
    removed
  });
}));

export default router;
