// Rotas de pós-atendimento (acompanhamentos de cicatrização).
import { Router } from "express";
import { withDb, withFeature } from "../middleware/withDb.js";
import { upload } from "../middleware/upload.js";
import {
  ensureFollowupsForCompletedAppointments,
  listPostCareFollowups
} from "../services/postcare.js";

const router = Router();

router.get("/api/post-care", withFeature("automatic_followup", async (_req, res, db) => {
  await ensureFollowupsForCompletedAppointments(db);
  res.json(await listPostCareFollowups(db));
}));

router.patch("/api/post-care/:id", upload.single("client_photo"), withFeature("automatic_followup", async (req, res, db) => {
  const existing = await db.get("SELECT * FROM post_care_followups WHERE id = ?", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Acompanhamento não encontrado." });
  const photoUrl = req.file ? `/uploads/${req.file.filename}` : existing.client_photo_url;
  await db.run(
    `UPDATE post_care_followups
     SET care_message = ?, healing_status = ?, client_notes = ?, status = ?, client_photo_url = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      req.body.care_message || existing.care_message,
      req.body.healing_status || existing.healing_status,
      req.body.client_notes || existing.client_notes,
      req.body.status || existing.status,
      photoUrl,
      req.params.id
    ]
  );
  res.json((await listPostCareFollowups(db)).find((item) => item.id === Number(req.params.id)));
}));

export default router;
