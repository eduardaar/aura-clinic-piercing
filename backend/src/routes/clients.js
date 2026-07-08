// Rotas de clientes, prontuarios medicos e resgates de fidelidade.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { listMedicalRecords } from "../services/appointments.js";
import { getClientLoyalty } from "../services/loyalty.js";
import { listClientsWithDetails } from "../services/clients.js";
import { validateBody } from "../middleware/validate.js";
import { clientCreateSchema, clientUpdateSchema } from "../schemas/index.js";

const router = Router();

function normalizeClientBody(body = {}, current = {}) {
  const name = body.full_name ?? body.name ?? current.full_name ?? "";
  return {
    full_name: String(name || "").trim(),
    phone: body.phone ?? current.phone ?? "",
    whatsapp: body.whatsapp ?? body.phone ?? current.whatsapp ?? "",
    instagram: body.instagram ?? current.instagram ?? "",
    email: body.email ?? current.email ?? "",
    birth_date: body.birth_date ?? body.birthday ?? body.birthDate ?? current.birth_date ?? "",
    cpf: body.cpf ?? current.cpf ?? "",
    notes: body.notes ?? current.notes ?? ""
  };
}

function clientResponse(client) {
  return client ? { ...client, name: client.full_name } : client;
}

router.post("/api/clients", withDb(async (req, res, db) => {
  const b = normalizeClientBody(req.body);
  req.body = { ...req.body, full_name: b.full_name, whatsapp: b.whatsapp };
  if (!validateBody(clientCreateSchema, req, res)) return;
  const result = await db.run(
    "INSERT INTO clients (full_name, phone, whatsapp, instagram, email, birth_date, cpf, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [b.full_name, b.phone, b.whatsapp, b.instagram, b.email, b.birth_date, b.cpf, b.notes]
  );
  res.status(201).json(clientResponse(await db.get("SELECT * FROM clients WHERE id = ?", [result.lastID])));
}));

async function updateClient(req, res, db) {
  const current = await db.get("SELECT * FROM clients WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Cliente nao encontrado." });
  const b = normalizeClientBody(req.body, current);
  req.body = { ...req.body, full_name: b.full_name, whatsapp: b.whatsapp };
  if (!validateBody(clientUpdateSchema, req, res)) return;
  await db.run(
    "UPDATE clients SET full_name = ?, phone = ?, whatsapp = ?, instagram = ?, email = ?, birth_date = ?, cpf = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [b.full_name, b.phone, b.whatsapp, b.instagram, b.email, b.birth_date, b.cpf, b.notes, req.params.id]
  );
  res.json(clientResponse(await db.get("SELECT * FROM clients WHERE id = ?", [req.params.id])));
}

router.put("/api/clients/:id", withDb(updateClient));
router.patch("/api/clients/:id", withDb(updateClient));

router.delete("/api/clients/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const id = req.params.id;
  const linked = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM appointments WHERE client_id = ?) +
      (SELECT COUNT(*) FROM payments WHERE client_id = ?) +
      (SELECT COUNT(*) FROM sales_orders WHERE client_id = ?) +
      (SELECT COUNT(*) FROM client_medical_records WHERE client_id = ?) +
      (SELECT COUNT(*) FROM digital_terms WHERE client_id = ?) +
      (SELECT COUNT(*) FROM loyalty_points WHERE client_id = ?) +
      (SELECT COUNT(*) FROM loyalty_redemptions WHERE client_id = ?) +
      (SELECT COUNT(*) FROM post_care_followups WHERE client_id = ?) AS total
  `, [id, id, id, id, id, id, id, id]);
  if (Number(linked?.total || 0) > 0) {
    return res.status(409).json({
      error: "Este cliente possui historico e nao pode ser excluido."
    });
  }
  await db.run("DELETE FROM clients WHERE id = ?", [id]);
  res.json({ ok: true });
}));

router.get("/api/clients", withDb(async (_req, res, db) => {
  const clients = await listClientsWithDetails(db);
  res.json(clients.map(clientResponse));
}));

router.post("/api/clients/:id/loyalty-redemptions", withDb(async (req, res, db) => {
  const client = await db.get("SELECT id FROM clients WHERE id = ?", [req.params.id]);
  if (!client) return res.status(404).json({ error: "Cliente nao encontrado." });
  const points = Number(req.body.points_used || 0);
  const discount = Number(req.body.discount_value || 0);
  const loyalty = await getClientLoyalty(db, req.params.id);
  if (points <= 0 || points > loyalty.availablePoints) {
    return res.status(400).json({ error: "Pontos insuficientes para resgate." });
  }
  await db.run(
    "INSERT INTO loyalty_redemptions (client_id, points_used, discount_value, notes) VALUES (?, ?, ?, ?)",
    [req.params.id, points, discount, req.body.notes || ""]
  );
  res.status(201).json(await getClientLoyalty(db, req.params.id));
}));

router.post("/api/clients/:id/medical-records", upload.fields([{ name: "before_photo", maxCount: 1 }, { name: "after_photo", maxCount: 1 }]), withDb(async (req, res, db) => {
  const client = await db.get("SELECT id FROM clients WHERE id = ?", [req.params.id]);
  if (!client) return res.status(404).json({ error: "Cliente nao encontrado." });
  const body = req.body;
  const beforePhoto = req.files?.before_photo?.[0] ? `/uploads/${req.files.before_photo[0].filename}` : "";
  const afterPhoto = req.files?.after_photo?.[0] ? `/uploads/${req.files.after_photo[0].filename}` : "";
  const result = await db.run(
    `INSERT INTO client_medical_records
    (client_id, appointment_id, record_date, piercing_history, jewelry_used, before_photo_url, after_photo_url, occurrences, guidance, allergies_notes, healing_evolution, returns_done)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.params.id,
      body.appointment_id || null,
      body.record_date || new Date().toISOString().slice(0, 10),
      body.piercing_history || "",
      body.jewelry_used || "",
      beforePhoto,
      afterPhoto,
      body.occurrences || "",
      body.guidance || "",
      body.allergies_notes || "",
      body.healing_evolution || "",
      body.returns_done || ""
    ]
  );
  res.status(201).json((await listMedicalRecords(db, req.params.id)).find((record) => record.id === result.lastID));
}));

router.delete("/api/clients/:clientId/medical-records/:recordId", withDb(async (req, res, db) => {
  await db.run("DELETE FROM client_medical_records WHERE id = ? AND client_id = ?", [req.params.recordId, req.params.clientId]);
  res.json({ ok: true });
}));

export default router;
