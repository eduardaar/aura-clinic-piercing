import { Router } from "express";
import { withDb, withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { whatsappLink } from "../services/notifications.js";
import { processDueCommunications, TEMPLATE_VARIABLES } from "../services/communications.js";

const router = Router();

router.get("/api/notifications", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const params = [];
  const where = req.query.status ? "WHERE nq.status = ?" : "";
  if (req.query.status) params.push(req.query.status);
  const rows = await db.all(`
    SELECT nq.*, p.name AS professional_name, a.appointment_date, a.appointment_time
    FROM notification_queue nq
    LEFT JOIN professionals p ON p.id = nq.professional_id
    LEFT JOIN appointments a ON a.id = nq.appointment_id
    ${where}
    ORDER BY nq.created_at DESC, nq.id DESC
    LIMIT 100
  `, params);
  res.json(rows.map((row) => ({
    ...row,
    whatsapp_link: row.destination ? whatsappLink(row.destination, row.message) : ""
  })));
}));

router.get("/api/communication-templates", withFeature("message_templates", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  res.json({ variables: TEMPLATE_VARIABLES, templates: await db.all("SELECT * FROM communication_templates ORDER BY name") });
}));

router.patch("/api/communication-templates/:id", withFeature("message_templates", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const current = await db.get("SELECT * FROM communication_templates WHERE id=?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Template não encontrado." });
  const body = String(req.body?.body || "").trim();
  if (!body || body.length > 4000) return res.status(400).json({ error: "O texto deve possuir entre 1 e 4000 caracteres." });
  await db.run("UPDATE communication_templates SET name=?, channel=?, subject=?, body=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [
    String(req.body?.name || current.name).trim(), req.body?.channel || current.channel, req.body?.subject || "",
    body, Number(req.body?.is_active ?? current.is_active), req.params.id
  ]);
  res.json(await db.get("SELECT * FROM communication_templates WHERE id=?", [req.params.id]));
}));

router.get("/api/automation-rules", withFeature("message_templates", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  res.json(await db.all(`
    SELECT ar.*, ct.name AS template_name,
      (SELECT COUNT(*) FROM automation_runs r WHERE r.rule_id=ar.id) AS run_count
    FROM automation_rules ar LEFT JOIN communication_templates ct ON ct.template_key=ar.template_key
    ORDER BY ar.name
  `));
}));

router.patch("/api/automation-rules/:id", withFeature("message_templates", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const current = await db.get("SELECT * FROM automation_rules WHERE id=?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Automação não encontrada." });
  const currentSettings = typeof current.settings === "string"
    ? JSON.parse(current.settings || "{}")
    : (current.settings || {});
  await db.run("UPDATE automation_rules SET name=?, template_key=?, channel=?, offset_minutes=?, is_active=?, settings=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [
    req.body?.name || current.name, req.body?.template_key || current.template_key, req.body?.channel || current.channel,
    Number(req.body?.offset_minutes ?? current.offset_minutes), Number(req.body?.is_active ?? current.is_active),
    JSON.stringify(req.body?.settings || currentSettings), req.params.id
  ]);
  res.json(await db.get("SELECT * FROM automation_rules WHERE id=?", [req.params.id]));
}));

router.post("/api/automations/process", withFeature("message_templates", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  res.json({ ok: true, ready: await processDueCommunications(db, req.body?.limit) });
}));

router.get("/api/automation-runs", withFeature("message_templates", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  res.json(await db.all("SELECT * FROM automation_runs ORDER BY executed_at DESC, id DESC LIMIT 200"));
}));

export default router;
