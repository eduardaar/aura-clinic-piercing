// Rotas de pós-atendimento (acompanhamentos de cicatrização).
import { Router } from "express";
import { withDb, withFeature } from "../middleware/withDb.js";
import { parseUpload, privateUpload, registerPrivateFiles } from "../middleware/upload.js";
import {
  listPostCareFollowups,
  getPostCareFollowup
} from "../services/postcare.js";

const router = Router();

// Leitura pura: os acompanhamentos já são criados quando o agendamento vira
// "atendido" (routes/appointments.js), então não há mais varredura de escrita
// aqui — ela custava 1 SELECT + 3 INSERT por atendimento concluído A CADA GET.
router.get("/api/post-care", withFeature("automatic_followup", async (_req, res, db) => {
  res.json(await listPostCareFollowups(db));
}));

router.patch("/api/post-care/:id", withFeature("automatic_followup", async (req, res, db) => {
  await parseUpload(privateUpload.single("client_photo"), req, res);
  await registerPrivateFiles(db, req.file, "postcare_photo", req.user?.id);
  const existing = await db.get("SELECT * FROM post_care_followups WHERE id = ?", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Acompanhamento não encontrado." });
  const photoUrl = req.file ? `/api/private-files/${req.file.filename}` : existing.client_photo_url;
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
  res.json(await getPostCareFollowup(db, req.params.id));
}));

export default router;
