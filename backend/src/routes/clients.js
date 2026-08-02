// Rotas de clientes, prontuarios medicos e resgates de fidelidade.
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { parseUpload, privateUpload, registerPrivateFiles } from "../middleware/upload.js";
import { getMedicalRecord } from "../services/appointments.js";
import { getClientLoyalty } from "../services/loyalty.js";
import { getClientWithDetails } from "../services/clients.js";
import { parsePaging, fetchPage, pageResponse } from "../services/pagination.js";
import { validateBody } from "../middleware/validate.js";
import { clientCreateSchema, clientUpdateSchema } from "../schemas/index.js";

const router = Router();

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const CLIENT_SORTABLE = {
  name: "full_name",
  created_at: "created_at",
  updated_at: "updated_at",
  birth_date: "birth_date"
};

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
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const b = normalizeClientBody(req.body);
  req.body = { ...req.body, full_name: b.full_name, whatsapp: b.whatsapp };
  if (!validateBody(clientCreateSchema, req, res)) return;
  const result = await db.run(
    "INSERT INTO clients (full_name, phone, whatsapp, instagram, email, birth_date, cpf, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    [b.full_name, b.phone, b.whatsapp, b.instagram, b.email, b.birth_date, b.cpf, b.notes]
  );
  res.status(201).json(clientResponse(await db.get("SELECT * FROM clients WHERE id = ?", [result.returnedId])));
}));

async function updateClient(req, res, db) {
  if (!requireRole(req, res, ["admin", "reception"])) return;
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
  if (!requireRole(req, res, ["admin"])) return;
  const id = req.params.id;
  if (req.body?.confirmation !== "EXCLUIR CLIENTE") return res.status(400).json({ error: "Digite EXCLUIR CLIENTE para confirmar." });
  const reason = String(req.body?.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "Informe o motivo da exclusão." });
  const client = await db.get("SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL", [id]);
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });
  const linked = await clientDeletionImpact(db, id);
  const total = Object.values(linked).reduce((sum, value) => sum + Number(value || 0), 0);
  const action = total > 0 ? "anonymize" : "hard_delete";
  await db.transaction(async (tx) => {
    if (action === "anonymize") {
      await tx.run(`UPDATE clients SET full_name = ?, whatsapp = ?, phone = '', instagram = '', email = '', birth_date = '', cpf = '', notes = '', deleted_at = ?, anonymized_at = ?, updated_at = ? WHERE id = ?`, [`Cliente anonimizado #${id}`, `anonimizado-${id}`, new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), id]);
    } else {
      await tx.run("DELETE FROM clients WHERE id = ?", [id]);
    }
    await tx.run("INSERT INTO administrative_audit_logs (entity_type, entity_id, action, reason, user_id, snapshot) VALUES ('client', ?, ?, ?, ?, ?)", [id, action, reason, req.user?.id || null, JSON.stringify({ client, impact: linked })]);
  });
  res.json({ ok: true, action, impact: linked });
}));

async function clientDeletionImpact(db, id) {
  const row = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM appointments WHERE client_id = ?) AS appointments,
      (SELECT COUNT(*) FROM payments WHERE client_id = ?) AS payments,
      (SELECT COUNT(*) FROM sales_orders WHERE client_id = ?) AS sales,
      (SELECT COUNT(*) FROM client_medical_records WHERE client_id = ?) AS medical_records,
      (SELECT COUNT(*) FROM digital_terms WHERE client_id = ?) AS terms,
      (SELECT COUNT(*) FROM post_care_followups WHERE client_id = ?) AS followups,
      (SELECT COUNT(*) FROM loyalty_points WHERE client_id = ?) AS loyalty_points,
      (SELECT COUNT(*) FROM loyalty_redemptions WHERE client_id = ?) AS loyalty_redemptions,
      (SELECT COUNT(*) FROM coupon_usages WHERE client_id = ?) AS coupon_usages,
      (SELECT COUNT(*) FROM promotion_usages WHERE client_id = ?) AS promotion_usages,
      (SELECT COUNT(*) FROM payment_intents WHERE client_id = ?) AS payment_intents
  `, [id, id, id, id, id, id, id, id, id, id, id]);
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, Number(value || 0)]));
}

router.get("/api/clients/:id/deletion-impact", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const client = await db.get("SELECT id FROM clients WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });
  const impact = await clientDeletionImpact(db, req.params.id);
  res.json({ impact, action: Object.values(impact).some(Number) ? "anonymize" : "hard_delete" });
}));

// Listagem ENXUTA: só as colunas da própria tabela `clients`, que é o que a
// tela de listagem/busca exibe. O enriquecimento (timeline, prontuários,
// fidelidade...) saiu daqui e virou GET /api/clients/:id — antes esta rota
// carregava onze tabelas inteiras em memória para montar a timeline de todos.
router.get("/api/clients", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception", "piercer"])) return;
  const clauses = [];
  const params = [];
  if (req.query.search) {
    clauses.push("(full_name ILIKE ? OR whatsapp ILIKE ? OR phone ILIKE ? OR email ILIKE ? OR instagram ILIKE ? OR cpf ILIKE ?)");
    params.push(...Array(6).fill(`%${req.query.search}%`));
  }
  clauses.unshift("deleted_at IS NULL");
  const where = `WHERE ${clauses.join(" AND ")}`;
  const paging = parsePaging(req.query, {
    sortable: CLIENT_SORTABLE,
    tieBreak: "id",
    defaultOrderBy: "ORDER BY full_name"
  });
  const { rows, total } = await fetchPage(db, {
    select: "*",
    from: "clients",
    where,
    params,
    orderBy: paging.orderBy,
    paging
  });
  res.json(pageResponse(rows.map(clientResponse), total, paging));
}));

router.get("/api/clients/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception", "piercer"])) return;
  const client = await getClientWithDetails(db, req.params.id);
  if (client?.deleted_at) return res.status(404).json({ error: "Cliente nao encontrado." });
  if (!client) return res.status(404).json({ error: "Cliente nao encontrado." });
  // Recepção não enxerga prontuário nem termo (mesma regra da listagem antiga).
  const visible = req.user?.role === "reception"
    ? { ...client, medicalRecords: [], terms: [] }
    : client;
  res.json(clientResponse(visible));
}));

router.post("/api/clients/:id/loyalty-redemptions", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
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

router.post("/api/clients/:id/medical-records", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "piercer"])) return;
  await parseUpload(privateUpload.fields([{ name: "before_photo", maxCount: 1 }, { name: "after_photo", maxCount: 1 }]), req, res);
  await registerPrivateFiles(db, Object.values(req.files || {}).flat(), "medical_record", req.user?.id);
  const client = await db.get("SELECT id FROM clients WHERE id = ?", [req.params.id]);
  if (!client) return res.status(404).json({ error: "Cliente nao encontrado." });
  const body = req.body;
  const beforePhoto = req.files?.before_photo?.[0] ? `/api/private-files/${req.files.before_photo[0].filename}` : "";
  const afterPhoto = req.files?.after_photo?.[0] ? `/api/private-files/${req.files.after_photo[0].filename}` : "";
  const result = await db.run(
    `INSERT INTO client_medical_records
    (client_id, appointment_id, record_date, piercing_history, jewelry_used, before_photo_url, after_photo_url, occurrences, guidance, allergies_notes, healing_evolution, returns_done)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
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
  res.status(201).json(await getMedicalRecord(db, result.returnedId));
}));

router.delete("/api/clients/:clientId/medical-records/:recordId", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "piercer"])) return;
  await db.run("DELETE FROM client_medical_records WHERE id = ? AND client_id = ?", [req.params.recordId, req.params.clientId]);
  res.json({ ok: true });
}));

export default router;
