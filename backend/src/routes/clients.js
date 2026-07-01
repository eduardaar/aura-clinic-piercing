// Rotas de clientes, prontuários médicos e resgates de fidelidade.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { listAppointments, listMedicalRecords } from "../services/appointments.js";
import { getClientLoyalty } from "../services/loyalty.js";

const router = Router();

router.post("/api/clients", withDb(async (req, res, db) => {
  const b = req.body || {};
  if (!b.full_name?.trim() || !b.whatsapp?.trim()) {
    return res.status(400).json({ error: "Informe nome e WhatsApp do cliente." });
  }
  const result = await db.run(
    "INSERT INTO clients (full_name, whatsapp, instagram, birth_date, notes) VALUES (?, ?, ?, ?, ?)",
    [b.full_name.trim(), b.whatsapp.trim(), b.instagram || "", b.birth_date || "", b.notes || ""]
  );
  res.status(201).json(await db.get("SELECT * FROM clients WHERE id = ?", [result.lastID]));
}));

router.put("/api/clients/:id", withDb(async (req, res, db) => {
  const client = await db.get("SELECT * FROM clients WHERE id = ?", [req.params.id]);
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });
  const b = req.body || {};
  await db.run(
    "UPDATE clients SET full_name = ?, whatsapp = ?, instagram = ?, birth_date = ?, notes = ? WHERE id = ?",
    [b.full_name || client.full_name, b.whatsapp || client.whatsapp, b.instagram ?? client.instagram, b.birth_date ?? client.birth_date, b.notes ?? client.notes, req.params.id]
  );
  res.json(await db.get("SELECT * FROM clients WHERE id = ?", [req.params.id]));
}));

router.delete("/api/clients/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  await db.run("DELETE FROM clients WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

router.get("/api/clients", withDb(async (_req, res, db) => {
  const clients = await db.all("SELECT * FROM clients ORDER BY full_name");
  for (const client of clients) {
    client.history = await listAppointments(db, "WHERE a.client_id = ?", [client.id]);
    client.payments = await db.all("SELECT * FROM payments WHERE client_id = ? ORDER BY paid_at DESC", [client.id]);
    client.medicalRecords = await listMedicalRecords(db, client.id);
    client.loyalty = await getClientLoyalty(db, client.id);
  }
  res.json(clients);
}));

router.patch("/api/clients/:id", withDb(async (req, res, db) => {
  const client = await db.get("SELECT * FROM clients WHERE id = ?", [req.params.id]);
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });
  await db.run(
    "UPDATE clients SET full_name = ?, whatsapp = ?, instagram = ?, birth_date = ?, notes = ? WHERE id = ?",
    [
      req.body.full_name || client.full_name,
      req.body.whatsapp || client.whatsapp,
      req.body.instagram || client.instagram,
      req.body.birth_date || client.birth_date,
      req.body.notes || client.notes,
      req.params.id
    ]
  );
  res.json(await db.get("SELECT * FROM clients WHERE id = ?", [req.params.id]));
}));

router.post("/api/clients/:id/loyalty-redemptions", withDb(async (req, res, db) => {
  const client = await db.get("SELECT id FROM clients WHERE id = ?", [req.params.id]);
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });
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
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });
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
