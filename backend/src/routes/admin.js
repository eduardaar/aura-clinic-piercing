// Rotas administrativas sensíveis (reset seguro de dados).
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();
const RESET_CONFIRMATION = "RESETAR DADOS";

const OPERATIONAL_TABLES = [
  "post_care_followups",
  "digital_terms",
  "client_medical_records",
  "loyalty_points",
  "loyalty_redemptions",
  "sales_order_items",
  "sales_orders",
  "payments",
  "appointments",
  "stock_movements",
  "expenses"
];

const COMPLETE_TABLES = [
  ...OPERATIONAL_TABLES,
  "schedule_blocks",
  "professional_availability",
  "professional_services",
  "procedures",
  "services",
  "professionals",
  "catalog_featured_products",
  "catalog_featured_categories",
  "catalog_banners",
  "catalog_promotions",
  "catalog_settings",
  "catalog_theme",
  "inventory_options",
  "jewelry_variants",
  "jewelry_inventory",
  "clients"
];

async function countTables(db, tables) {
  const removed = {};
  for (const table of tables) {
    const count = await db.get(`SELECT COUNT(*) AS count FROM ${table}`);
    removed[table] = Number(count?.count || 0);
  }
  return removed;
}

async function insertAudit(db, req, { resetType, result, removed = {}, error = "" }) {
  await db.run(
    `INSERT INTO admin_audit_logs (user_id, user_email, tenant_slug, action, reset_type, result, removed_counts, error_message)
     VALUES (?, ?, ?, 'clinic_reset', ?, ?, ?, ?)`,
    [
      req.user?.id || null,
      req.user?.email || "",
      req.tenant?.slug || "",
      resetType || "",
      result,
      JSON.stringify(removed || {}),
      error || ""
    ]
  );
}

async function runClinicReset(req, res, db, fallbackType = "operational") {
  if (!requireRole(req, res, ["admin"])) return;
  const resetType = String(req.body?.reset_type || req.body?.type || fallbackType);
  if (!["operational", "complete"].includes(resetType)) {
    return res.status(400).json({ error: "Tipo de reset inválido." });
  }
  if (req.body?.confirmation !== RESET_CONFIRMATION) {
    return res.status(400).json({ error: "Digite RESETAR DADOS para confirmar o reset." });
  }

  const tables = resetType === "complete" ? COMPLETE_TABLES : OPERATIONAL_TABLES;
  const admins = await db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
  if (Number(admins?.count || 0) < 1) {
    return res.status(409).json({ error: "A clínica precisa manter ao menos uma administradora geral." });
  }

  let removed = {};
  try {
    await db.run("BEGIN");
    removed = await countTables(db, tables);
    await db.run(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
    if (resetType === "complete") {
      await db.run("INSERT INTO catalog_theme (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
    }
    await insertAudit(db, req, { resetType, result: "success", removed });
    await db.run("COMMIT");
  } catch (error) {
    try { await db.run("ROLLBACK"); } catch { /* rollback best-effort */ }
    console.error("[admin-reset] Falha ao resetar dados:", error);
    try {
      await insertAudit(db, req, { resetType, result: "error", removed, error: error.message });
    } catch { /* não mascara erro principal */ }
    return res.status(500).json({ error: "Não foi possível concluir o reset. Nenhum dado foi apagado parcialmente." });
  }

  res.json({
    ok: true,
    type: resetType,
    message: resetType === "complete"
      ? "Reset completo concluído. A conta administradora e a clínica foram preservadas."
      : "Reset operacional concluído. Cadastros estruturais e configurações foram preservados.",
    removed
  });
}

router.post("/api/admin/reset-demo-data", withDb(async (req, res, db) => {
  req.body = { ...(req.body || {}), confirmation: req.body?.confirmation === "RESETAR" ? RESET_CONFIRMATION : req.body?.confirmation, reset_type: "operational" };
  return runClinicReset(req, res, db, "operational");
}));

router.post("/api/admin/reset-clinic-data", withDb(runClinicReset));

export default router;
