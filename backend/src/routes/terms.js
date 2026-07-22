// Rotas de termos digitais (anamnese): criacao, listagem e PDF.
import { Router } from "express";
import { withDb, withFeature } from "../middleware/withDb.js";
import { listAppointments, upsertClient } from "../services/appointments.js";
import { listDigitalTerms, createTermPdf } from "../services/terms.js";

const router = Router();

router.get("/api/digital-terms", withFeature("digital_terms", async (_req, res, db) => {
  res.json(await listDigitalTerms(db));
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  const term = await db.get("SELECT * FROM digital_terms WHERE id = ?", [result.lastID]);
  const pdfUrl = await createTermPdf(term, appointment || {});
  await db.run("UPDATE digital_terms SET pdf_url = ? WHERE id = ?", [pdfUrl, result.lastID]);
  res.status(201).json((await listDigitalTerms(db)).find((item) => item.id === result.lastID));
}));

export default router;
