// Rotas de profissionais.
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { boolNumber } from "../services/utils.js";
import { normalizeWhatsappNumber } from "../services/notifications.js";
import { parsePaging, fetchPage, pageResponse } from "../services/pagination.js";

const router = Router();

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const PROFESSIONAL_SORTABLE = {
  name: "name",
  specialty: "specialty",
  active: "active"
};

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

// Anexa service_ids apenas aos profissionais da página: antes a rota lia a
// tabela professional_services inteira para depois filtrar em memória.
async function attachServiceIds(db, professionals) {
  if (!professionals.length) return professionals;
  const placeholders = professionals.map(() => "?").join(",");
  const rows = await db.all(
    `SELECT professional_id, service_id FROM professional_services WHERE professional_id IN (${placeholders})`,
    professionals.map((professional) => professional.id)
  );
  return professionals.map((professional) => ({
    ...professional,
    service_ids: rows.filter((row) => row.professional_id === professional.id).map((row) => row.service_id)
  }));
}

// Busca direta por id: "listar tudo e procurar" devolveria undefined em
// silêncio assim que a listagem passasse a ser paginada.
async function getProfessional(db, id) {
  const professional = await db.get("SELECT * FROM professionals WHERE id = ?", [id]);
  if (!professional) return null;
  const rows = await db.all("SELECT service_id FROM professional_services WHERE professional_id = ?", [professional.id]);
  return { ...professional, service_ids: rows.map((row) => row.service_id) };
}

router.get("/api/professionals", withFeature("procedures", async (req, res, db) => {
  const clauses = [];
  const params = [];
  // `status` aqui é "active"/"inactive" (a coluna é o booleano active).
  if (req.query.status) {
    clauses.push("active = ?");
    params.push(req.query.status === "active" ? 1 : 0);
  }
  if (req.query.search) {
    clauses.push("(name ILIKE ? OR specialty ILIKE ? OR email ILIKE ? OR whatsapp ILIKE ?)");
    params.push(...Array(4).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: PROFESSIONAL_SORTABLE,
    tieBreak: "id",
    defaultOrderBy: "ORDER BY active DESC, name, id"
  });
  const { rows, total } = await fetchPage(db, {
    select: "*",
    from: "professionals",
    where,
    params,
    orderBy: paging.orderBy,
    paging
  });
  res.json(pageResponse(await attachServiceIds(db, rows), total, paging));
}));

router.post("/api/professionals", withFeature("procedures", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const { name, specialty, phone, email, calendar_color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome do profissional e obrigatorio." });
  const whatsapp = normalizeWhatsappNumber(req.body.whatsapp || phone);
  const result = await db.run(
    "INSERT INTO professionals (name, specialty, phone, email, whatsapp, notification_opt_in, calendar_color, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    [name.trim(), specialty || "", phone || "", email || "", whatsapp, boolNumber(req.body.notification_opt_in ?? true), calendar_color || "#C8A96A", req.body.active === false ? 0 : 1]
  );
  await replaceProfessionalServices(db, result.returnedId, req.body.service_ids || []);
  res.status(201).json(await getProfessional(db, result.returnedId));
}));

router.patch("/api/professionals/:id", withFeature("procedures", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const professional = await db.get("SELECT * FROM professionals WHERE id = ?", [req.params.id]);
  if (!professional) return res.status(404).json({ error: "Profissional nao encontrado." });
  await db.run(
    "UPDATE professionals SET name = ?, specialty = ?, phone = ?, email = ?, whatsapp = ?, notification_opt_in = ?, calendar_color = ?, active = ? WHERE id = ?",
    [
      req.body.name?.trim() || professional.name,
      req.body.specialty ?? professional.specialty,
      req.body.phone ?? professional.phone ?? "",
      req.body.email ?? professional.email ?? "",
      normalizeWhatsappNumber(req.body.whatsapp ?? req.body.phone ?? professional.whatsapp ?? professional.phone ?? ""),
      req.body.notification_opt_in === undefined ? Number(professional.notification_opt_in ?? 1) : boolNumber(req.body.notification_opt_in),
      req.body.calendar_color ?? professional.calendar_color ?? "#C8A96A",
      req.body.active === undefined ? professional.active : (req.body.active ? 1 : 0),
      req.params.id
    ]
  );
  if (req.body.service_ids) await replaceProfessionalServices(db, req.params.id, req.body.service_ids);
  res.json(await getProfessional(db, req.params.id));
}));

router.delete("/api/professionals/:id", withFeature("procedures", async (req, res, db) => {
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
