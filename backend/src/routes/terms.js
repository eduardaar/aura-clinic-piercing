// Rotas de termos digitais (anamnese): criacao, listagem e PDF.
import { Router } from "express";
import { withDb, withFeature } from "../middleware/withDb.js";
import { listAppointments, upsertClient } from "../services/appointments.js";
import { listDigitalTerms, countDigitalTerms, getDigitalTerm, createTermPdf } from "../services/terms.js";
import { parsePaging, pageResponse } from "../services/pagination.js";

const router = Router();

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const TERM_SORTABLE = {
  signed_at: "t.signed_at",
  name: "t.full_name",
  procedure: "t.procedure",
  client: "c.full_name",
  appointment_date: "a.appointment_date"
};

router.get("/api/digital-terms", withFeature("digital_terms", async (req, res, db) => {
  const clauses = [];
  const params = [];
  if (req.query.client_id) {
    clauses.push("t.client_id = ?");
    params.push(req.query.client_id);
  }
  if (req.query.appointment_id) {
    clauses.push("t.appointment_id = ?");
    params.push(req.query.appointment_id);
  }
  // Período pela data da assinatura (signed_at guarda "YYYY-MM-DD HH:MM:SS").
  if (req.query.from) {
    clauses.push("t.signed_at >= ?");
    params.push(req.query.from);
  }
  if (req.query.to) {
    clauses.push("t.signed_at <= ?");
    params.push(`${req.query.to} 23:59:59`);
  }
  if (req.query.search) {
    clauses.push("(t.full_name ILIKE ? OR t.whatsapp ILIKE ? OR t.document_number ILIKE ? OR t.procedure ILIKE ?)");
    params.push(...Array(4).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: TERM_SORTABLE,
    tieBreak: "t.id",
    defaultOrderBy: "ORDER BY t.signed_at DESC, t.id DESC"
  });
  const items = await listDigitalTerms(db, { where, params, paging });
  const total = paging.paginated ? await countDigitalTerms(db, { where, params }) : items.length;
  res.json(pageResponse(items, total, paging));
}));

router.post("/api/digital-terms", withFeature("digital_terms", async (req, res, db) => {
  const body = req.body || {};
  if (!body.full_name?.trim() || !body.signature_data_url) {
    return res.status(400).json({ error: "Dados obrigatorios do termo nao foram preenchidos." });
  }
  if (!body.orientations_confirmed) {
    return res.status(400).json({ error: "O cliente precisa confirmar que recebeu as orientacoes." });
  }

  const appointment = body.appointment_id
    ? await listAppointments(db, "WHERE a.id = ?", [body.appointment_id]).then((rows) => rows[0])
    : null;
  if (body.appointment_id && !appointment) {
    return res.status(404).json({ error: "Agendamento nao encontrado." });
  }

  const client = body.client_id
    ? await db.get("SELECT * FROM clients WHERE id = ?", [body.client_id])
    : await upsertClient(db, {
      full_name: body.full_name,
      whatsapp: body.whatsapp || "",
      instagram: body.instagram || "",
      birth_date: body.birth_date || "",
      client_notes: "Cliente criado pelo termo digital."
    });
  if (!client?.id) {
    return res.status(400).json({ error: "Nao foi possivel vincular o cliente ao termo." });
  }

  const result = await db.run(
    `INSERT INTO digital_terms
    (appointment_id, client_id, full_name, social_name, document_number, birth_date, whatsapp, instagram, address, procedure, piercing_region, orientations_confirmed, health_declaration, form_data, signature_data_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      body.appointment_id || null,
      client.id,
      body.full_name,
      body.social_name || "",
      body.document_number || "",
      body.birth_date || "",
      body.whatsapp || appointment?.whatsapp || "",
      body.instagram || appointment?.instagram || "",
      body.address || "",
      body.procedure || appointment?.procedure || "",
      body.piercing_region || appointment?.piercing_region || "",
      body.orientations_confirmed ? 1 : 0,
      body.health_declaration || "",
      JSON.stringify(body.form_data || {}),
      body.signature_data_url
    ]
  );

  const term = await db.get("SELECT * FROM digital_terms WHERE id = ?", [result.returnedId]);
  const pdfUrl = await createTermPdf(db, term, appointment || {}, req.user?.id || null);
  await db.run("UPDATE digital_terms SET pdf_url = ? WHERE id = ?", [pdfUrl, result.returnedId]);
  res.status(201).json(await getDigitalTerm(db, result.returnedId));
}));

export default router;
