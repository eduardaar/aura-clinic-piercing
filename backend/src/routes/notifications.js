import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { whatsappLink } from "../services/notifications.js";

const router = Router();

router.get("/api/notifications", withDb(async (req, res, db) => {
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

export default router;
