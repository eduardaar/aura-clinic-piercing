// Rotas de profissionais.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();

async function replaceProfessionalServices(db, professionalId, serviceIds = []) {
  const ids = Array.isArray(serviceIds) ? serviceIds : String(serviceIds || "").split(",");
  await db.run("DELETE FROM professional_services WHERE professional_id = ?", [professionalId]);
  for (const id of ids.filter(Boolean)) {
    await db.run(
      "INSERT INTO professional_services (professional_id, service_id) VALUES (?, ?) ON CONFLICT (professional_id, service_id) DO NOTHING",
      [Number(professionalId), Number(id)]
    );
  }
}

async function listProfessionals(db) {
  const professionals = await db.all("SELECT * FROM professionals ORDER BY active DESC, name");
  const rows = await db.all("SELECT professional_id, service_id FROM professional_services");
  return professionals.map((professional) => ({
    ...professional,
    service_ids: rows.filter((row) => row.professional_id === professional.id).map((row) => row.service_id)
  }));
}

router.get("/api/professionals", withDb(async (_req, res, db) => {
  res.json(await listProfessionals(db));
}));

router.post("/api/professionals", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const { name, specialty, phone, email, calendar_color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome do profissional e obrigatorio." });
  const result = await db.run(
    "INSERT INTO professionals (name, specialty, phone, email, calendar_color, active) VALUES (?, ?, ?, ?, ?, ?)",
    [name.trim(), specialty || "", phone || "", email || "", calendar_color || "#C8A96A", req.body.active === false ? 0 : 1]
  );
  await replaceProfessionalServices(db, result.lastID, req.body.service_ids || []);
  res.status(201).json((await listProfessionals(db)).find((item) => item.id === result.lastID));
}));

router.patch("/api/professionals/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const professional = await db.get("SELECT * FROM professionals WHERE id = ?", [req.params.id]);
  if (!professional) return res.status(404).json({ error: "Profissional nao encontrado." });
  await db.run(
    "UPDATE professionals SET name = ?, specialty = ?, phone = ?, email = ?, calendar_color = ?, active = ? WHERE id = ?",
    [
      req.body.name?.trim() || professional.name,
      req.body.specialty ?? professional.specialty,
      req.body.phone ?? professional.phone ?? "",
      req.body.email ?? professional.email ?? "",
      req.body.calendar_color ?? professional.calendar_color ?? "#C8A96A",
      req.body.active === undefined ? professional.active : (req.body.active ? 1 : 0),
      req.params.id
    ]
  );
  if (req.body.service_ids) await replaceProfessionalServices(db, req.params.id, req.body.service_ids);
  res.json((await listProfessionals(db)).find((item) => item.id === Number(req.params.id)));
}));

router.delete("/api/professionals/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const linked = await db.get("SELECT COUNT(*) AS count FROM appointments WHERE professional_id = ?", [req.params.id]);
  if (linked.count > 0) {
    await db.run("UPDATE professionals SET active = 0 WHERE id = ?", [req.params.id]);
    return res.json({ ok: true, archived: true });
  }
  await db.run("DELETE FROM professional_availability WHERE professional_id = ?", [req.params.id]);
  await db.run("DELETE FROM professional_services WHERE professional_id = ?", [req.params.id]);
  await db.run("DELETE FROM professionals WHERE id = ?", [req.params.id]);
  res.json({ ok: true, archived: false });
}));

export default router;
