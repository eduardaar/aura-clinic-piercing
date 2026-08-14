// Rotas de pós-atendimento (acompanhamentos de cicatrização).
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { P } from "../config/permissions.js";
import { parseUpload, privateUpload, registerPrivateFiles } from "../middleware/upload.js";
import {
  listPostCareFollowups,
  countPostCareFollowups,
  getPostCareFollowup
} from "../services/postcare.js";
import { parsePaging, pageResponse } from "../services/pagination.js";
import { recordPrivacyAudit } from "../services/privacy.js";

const router = Router();

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const POST_CARE_SORTABLE = {
  due_date: "f.due_date",
  status: "f.status",
  healing_status: "f.healing_status",
  reminder_day: "f.reminder_day",
  client: "c.full_name",
  professional: "p.name",
  appointment_date: "a.appointment_date",
  created_at: "f.created_at"
};

// Leitura pura: os acompanhamentos já são criados quando o agendamento vira
// "atendido" (routes/appointments.js), então não há mais varredura de escrita
// aqui — ela custava 1 SELECT + 3 INSERT por atendimento concluído A CADA GET.
router.get("/api/post-care", withFeature("automatic_followup", async (req, res, db) => {
  // Cicatrização, intercorrências, notas e fotos são informação clínica.
  // Somente quem presta o cuidado ou administra a clínica pode consultá-las.
  if (!authorizePermission(req, res, P.CLINICAL_FILES_VIEW)) return;
  const clauses = [];
  const params = [];
  if (req.query.status) {
    clauses.push("f.status = ?");
    params.push(req.query.status);
  }
  if (req.query.healing_status) {
    clauses.push("f.healing_status = ?");
    params.push(req.query.healing_status);
  }
  if (req.query.client_id) {
    clauses.push("f.client_id = ?");
    params.push(req.query.client_id);
  }
  if (req.query.professional_id) {
    clauses.push("a.professional_id = ?");
    params.push(req.query.professional_id);
  }
  // Período pelo vencimento do acompanhamento (é o que a tela usa para triagem).
  if (req.query.from) {
    clauses.push("f.due_date >= ?");
    params.push(req.query.from);
  }
  if (req.query.to) {
    clauses.push("f.due_date <= ?");
    params.push(req.query.to);
  }
  if (req.query.search) {
    clauses.push("(c.full_name ILIKE ? OR c.whatsapp ILIKE ? OR a.procedure ILIKE ? OR a.piercing_region ILIKE ?)");
    params.push(...Array(4).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: POST_CARE_SORTABLE,
    tieBreak: "f.id",
    defaultOrderBy: "ORDER BY f.due_date ASC, f.reminder_day ASC"
  });
  const items = await listPostCareFollowups(db, { where, params, paging });
  const total = paging.paginated ? await countPostCareFollowups(db, { where, params }) : items.length;
  await recordPrivacyAudit(db, {
    req, action: "post_care_read", resourceType: "post_care_list",
    clientId: req.query.client_id || null,
    detail: { result_count: items.length, filtered_by_client: Boolean(req.query.client_id) }
  });
  res.json(pageResponse(items, total, paging));
}));

router.patch("/api/post-care/:id", withFeature("automatic_followup", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CLINICAL_FILES_EDIT)) return;
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
