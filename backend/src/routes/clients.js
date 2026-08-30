// Rotas de clientes, prontuarios medicos e resgates de fidelidade.
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { parseUpload, privateUpload, registerPrivateFiles } from "../middleware/upload.js";
import { getMedicalRecord } from "../services/appointments.js";
import { getClientLoyalty } from "../services/loyalty.js";
import { getClientWithDetails } from "../services/clients.js";
import { parsePaging, fetchPage, pageResponse } from "../services/pagination.js";
import { validateBody } from "../middleware/validate.js";
import { clientCreateSchema, clientUpdateSchema } from "../schemas/index.js";
import { invalidateUsageCache, requireWithinLimit } from "../services/planLimits.js";
import { recordPrivacyAudit } from "../services/privacy.js";
import { P } from "../config/permissions.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { hasPermission } from "../services/permissionService.js";
import { firstClientError, normalizeClientData } from "../services/clientData.js";
import { recordAudit } from "../services/audit.js";

const router = Router();

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const CLIENT_SORTABLE = {
  name: "full_name",
  created_at: "created_at",
  updated_at: "updated_at",
  birth_date: "birth_date",
};

function clientResponse(client) {
  return client ? { ...client, name: client.full_name } : client;
}

async function validateClientLinks(db, data, currentId = null) {
  for (const [field, id] of [["referred_by_client_id", data.referred_by_client_id], ["guardian_client_id", data.guardian_client_id]]) {
    if (!id) continue;
    if (currentId && Number(id) === Number(currentId)) return `${field === "guardian_client_id" ? "Responsável" : "Indicador"} não pode ser o próprio cliente.`;
    const linked = await db.get("SELECT id FROM clients WHERE id=? AND deleted_at IS NULL", [id]);
    if (!linked) return `${field === "guardian_client_id" ? "Responsável" : "Cliente indicador"} não encontrado.`;
  }
  return "";
}

async function findClientDuplicates(db, data, currentId = null) {
  const clauses = [];
  const params = [];
  for (const [field, value] of [["cpf", data.cpf], ["whatsapp", data.whatsapp], ["email", data.email]]) {
    if (!value) continue;
    clauses.push(field === "email" ? "lower(email)=lower(?)" : `${field}=?`);
    params.push(value);
  }
  if (!clauses.length) return [];
  if (currentId) {
    clauses.push("id<>?");
    params.push(currentId);
  }
  return db.all(
    `SELECT id, full_name, cpf, whatsapp, email FROM clients
      WHERE deleted_at IS NULL AND (${clauses.slice(0, currentId ? -1 : undefined).join(" OR ")})${currentId ? " AND id<>?" : ""}
      ORDER BY full_name LIMIT 10`,
    params
  );
}

function duplicateResponse(res, matches) {
  return res.status(409).json({
    error: `Possível cliente duplicado: ${matches.map((item) => item.full_name).join(", ")}. Abra o cadastro existente antes de continuar.`,
    code: "duplicate_client",
    matches
  });
}

router.post(
  "/api/clients",
  withFeature("clients", async (req, res, db) => {
    if (!authorizePermission(req, res, P.CLIENTS_CREATE)) return;
    const normalized = normalizeClientData(req.body);
    if (!normalized.valid)
      return res.status(400).json({ error: firstClientError(normalized.errors), field_errors: normalized.errors });
    const b = normalized.data;
    const linkError = await validateClientLinks(db, b);
    if (linkError) return res.status(400).json({ error: linkError });
    const duplicates = await findClientDuplicates(db, b);
    if (duplicates.length) return duplicateResponse(res, duplicates);
    req.body = { ...req.body, full_name: b.full_name, whatsapp: b.whatsapp };
    if (!validateBody(clientCreateSchema, req, res)) return;
    // Cota do plano — só na criação. Editar e listar cliente que já existe nunca
    // passa por aqui: cota não esconde nem trava o que a clínica já cadastrou.
    //
    // Este guard NÃO vale para o agendamento público (routes/booking.js): lá quem
    // receberia o 409 é o cliente final da clínica, que não tem como resolver.
    if (!(await requireWithinLimit(req, res, "clients", db))) return;
    const result = await db.run(
      `INSERT INTO clients (
      full_name, social_name, phone, whatsapp, instagram, email, birth_date, cpf, tax_id,
      preferred_contact, postal_code, address_line, address_number, address_complement,
      neighborhood, city, state, acquisition_source, referred_by_client_id, tags, lifecycle_status,
      blocked_reason, operational_consent, marketing_consent, emergency_contact_name,
      emergency_contact_phone, guardian_client_id, guardian_relationship, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        b.full_name,
        b.social_name,
        b.phone,
        b.whatsapp,
        b.instagram,
        b.email,
        b.birth_date,
        b.cpf,
        b.cpf,
        b.preferred_contact,
        b.postal_code,
        b.address_line,
        b.address_number,
        b.address_complement,
        b.neighborhood,
        b.city,
        b.state,
        b.acquisition_source,
        b.referred_by_client_id,
        JSON.stringify(b.tags),
        b.lifecycle_status,
        b.blocked_reason,
        b.operational_consent,
        b.marketing_consent,
        b.emergency_contact_name,
        b.emergency_contact_phone,
        b.guardian_client_id,
        b.guardian_relationship,
        b.notes,
      ],
    );
    const created = await db.get("SELECT * FROM clients WHERE id = ?", [result.returnedId]);
    await recordAudit(db, {
      req, module: "clients", action: "create", entityType: "client", entityId: created.id,
      reason: "Cadastro de cliente", after: { id: created.id, full_name: created.full_name, lifecycle_status: created.lifecycle_status }
    });
    res.status(201).json(clientResponse(created));
  }),
);

async function updateClient(req, res, db) {
  if (!authorizePermission(req, res, P.CLIENTS_EDIT)) return;
  const current = await db.get("SELECT * FROM clients WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Cliente nao encontrado." });
  const normalized = normalizeClientData(req.body, current);
  if (!normalized.valid)
    return res.status(400).json({ error: firstClientError(normalized.errors), field_errors: normalized.errors });
  const b = normalized.data;
  const linkError = await validateClientLinks(db, b, req.params.id);
  if (linkError) return res.status(400).json({ error: linkError });
  const duplicates = await findClientDuplicates(db, b, req.params.id);
  if (duplicates.length) return duplicateResponse(res, duplicates);
  req.body = { ...req.body, full_name: b.full_name, whatsapp: b.whatsapp };
  if (!validateBody(clientUpdateSchema, req, res)) return;
  await db.run(
    `UPDATE clients SET
      full_name=?, social_name=?, phone=?, whatsapp=?, instagram=?, email=?, birth_date=?, cpf=?, tax_id=?,
      preferred_contact=?, postal_code=?, address_line=?, address_number=?, address_complement=?,
      neighborhood=?, city=?, state=?, acquisition_source=?, referred_by_client_id=?, tags=?, lifecycle_status=?,
      blocked_reason=?, operational_consent=?, marketing_consent=?, emergency_contact_name=?,
      emergency_contact_phone=?, guardian_client_id=?, guardian_relationship=?, notes=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [
      b.full_name,
      b.social_name,
      b.phone,
      b.whatsapp,
      b.instagram,
      b.email,
      b.birth_date,
      b.cpf,
      b.cpf,
      b.preferred_contact,
      b.postal_code,
      b.address_line,
      b.address_number,
      b.address_complement,
      b.neighborhood,
      b.city,
      b.state,
      b.acquisition_source,
      b.referred_by_client_id,
      JSON.stringify(b.tags),
      b.lifecycle_status,
      b.blocked_reason,
      b.operational_consent,
      b.marketing_consent,
      b.emergency_contact_name,
      b.emergency_contact_phone,
      b.guardian_client_id,
      b.guardian_relationship,
      b.notes,
      req.params.id,
    ],
  );
  const updated = await db.get("SELECT * FROM clients WHERE id = ?", [req.params.id]);
  await recordAudit(db, {
    req, module: "clients", action: "update", entityType: "client", entityId: updated.id,
    reason: "Alteração de cliente",
    before: { id: current.id, full_name: current.full_name, lifecycle_status: current.lifecycle_status, preferred_contact: current.preferred_contact },
    after: { id: updated.id, full_name: updated.full_name, lifecycle_status: updated.lifecycle_status, preferred_contact: updated.preferred_contact },
    severity: "warning"
  });
  res.json(clientResponse(updated));
}

router.put("/api/clients/:id", withFeature("clients", updateClient));
router.patch("/api/clients/:id", withFeature("clients", updateClient));

// Crédito é exibido separado de pagamentos: ele representa uma obrigação da
// clínica com o cliente e nunca deve desaparecer em uma observação livre.
router.get(
  "/api/clients/:id/credits",
  withFeature("clients", async (req, res, db) => {
    if (!authorizePermission(req, res, P.CLIENTS_VIEW)) return;
    const client = await db.get("SELECT id FROM clients WHERE id=?", [req.params.id]);
    if (!client) return res.status(404).json({ error: "Cliente não encontrado." });
    const credits = await db.all(`SELECT * FROM client_credits WHERE client_id=? ORDER BY created_at DESC, id DESC`, [
      client.id,
    ]);
    const openAmount = credits
      .filter((item) => ["open", "partially_used"].includes(item.status))
      .reduce((sum, item) => sum + Number(item.remaining_amount || 0), 0);
    res.json({ credits, open_amount: Number(openAmount.toFixed(2)) });
  }),
);

router.delete(
  "/api/clients/:id",
  withFeature("clients", async (req, res, db) => {
    if (!authorizePermission(req, res, P.CLIENTS_DELETE)) return;
    const id = req.params.id;
    if (req.body?.confirmation !== "EXCLUIR CLIENTE")
      return res.status(400).json({ error: "Digite EXCLUIR CLIENTE para confirmar." });
    const reason = String(req.body?.reason || "").trim();
    if (!reason) return res.status(400).json({ error: "Informe o motivo da exclusão." });
    const client = await db.get("SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!client) return res.status(404).json({ error: "Cliente não encontrado." });
    const linked = await clientDeletionImpact(db, id);
    const total = Object.values(linked).reduce((sum, value) => sum + Number(value || 0), 0);
    const action = total > 0 ? "anonymize" : "hard_delete";
    await db.transaction(async (tx) => {
      if (action === "anonymize") {
        await tx.run(
          `UPDATE clients SET full_name=?, social_name='', whatsapp=?, phone='', instagram='', email='', birth_date='', cpf='', tax_id='', preferred_contact='whatsapp', postal_code='', address_line='', address_number='', address_complement='', neighborhood='', city='', state='', acquisition_source='', referred_by_client_id=NULL, tags='[]'::jsonb, lifecycle_status='inactive', blocked_reason='', operational_consent=false, marketing_consent=false, emergency_contact_name='', emergency_contact_phone='', guardian_client_id=NULL, guardian_relationship='', notes='', deleted_at=?, anonymized_at=?, updated_at=? WHERE id=?`,
          [
            `Cliente anonimizado #${id}`,
            `anonimizado-${id}`,
            new Date().toISOString(),
            new Date().toISOString(),
            new Date().toISOString(),
            id,
          ],
        );
      } else {
        await tx.run("DELETE FROM clients WHERE id = ?", [id]);
      }
      await tx.run(
        "INSERT INTO administrative_audit_logs (entity_type, entity_id, action, reason, user_id, snapshot) VALUES ('client', ?, ?, ?, ?, ?)",
        [id, action, reason, req.user?.id || null, JSON.stringify({ client, impact: linked })],
      );
    });
    // Só a exclusão de verdade muda a contagem da cota — a anonimização preserva
    // a linha (e o vínculo com agendamentos, pagamentos e prontuários).
    if (action === "hard_delete") invalidateUsageCache(req.tenant?.id);
    res.json({ ok: true, action, impact: linked });
  }),
);

async function clientDeletionImpact(db, id) {
  const row = await db.get(
    `
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
  `,
    [id, id, id, id, id, id, id, id, id, id, id],
  );
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, Number(value || 0)]));
}

router.get(
  "/api/clients/:id/deletion-impact",
  withFeature("clients", async (req, res, db) => {
    if (!authorizePermission(req, res, P.CLIENTS_DELETE)) return;
    const client = await db.get("SELECT id FROM clients WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
    if (!client) return res.status(404).json({ error: "Cliente não encontrado." });
    const impact = await clientDeletionImpact(db, req.params.id);
    res.json({ impact, action: Object.values(impact).some(Number) ? "anonymize" : "hard_delete" });
  }),
);

// Listagem ENXUTA: só as colunas da própria tabela `clients`, que é o que a
// tela de listagem/busca exibe. O enriquecimento (timeline, prontuários,
// fidelidade...) saiu daqui e virou GET /api/clients/:id — antes esta rota
// carregava onze tabelas inteiras em memória para montar a timeline de todos.
router.get(
  "/api/clients",
  withFeature("clients", async (req, res, db) => {
    if (!authorizePermission(req, res, P.CLIENTS_VIEW)) return;
    const clauses = [];
    const params = [];
    if (req.query.search) {
      const search = String(req.query.search).trim();
      const searchDigits = search.replace(/\D/g, "");
      const textColumns = ["full_name", "social_name", "email", "instagram", "city", "address_line", "neighborhood", "acquisition_source", "CAST(tags AS TEXT)"];
      const matches = textColumns.map((column) => `${column} ILIKE ?`);
      params.push(...Array(textColumns.length).fill(`%${search}%`));
      if (searchDigits) {
        for (const column of ["whatsapp", "phone", "cpf", "postal_code"]) {
          matches.push(`regexp_replace(COALESCE(${column}, ''), '[^0-9]', '', 'g') LIKE ?`);
          params.push(`%${searchDigits}%`);
        }
      }
      clauses.push(`(${matches.join(" OR ")})`);
    }
    clauses.unshift("deleted_at IS NULL");
    if (req.query.status && ["active", "inactive", "blocked"].includes(String(req.query.status))) {
      clauses.push("lifecycle_status=?");
      params.push(String(req.query.status));
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const paging = parsePaging(req.query, {
      sortable: CLIENT_SORTABLE,
      tieBreak: "id",
      defaultOrderBy: "ORDER BY full_name",
    });
    const { rows, total } = await fetchPage(db, {
      select: "*",
      from: "clients",
      where,
      params,
      orderBy: paging.orderBy,
      paging,
    });
    await recordPrivacyAudit(db, {
      req,
      action: "client_list_read",
      resourceType: "client_list",
      detail: { result_count: rows.length, searched: Boolean(req.query.search) },
    });
    res.json(pageResponse(rows.map(clientResponse), total, paging));
  }),
);

router.get(
  "/api/clients/:id",
  withFeature("clients", async (req, res, db) => {
    if (!authorizePermission(req, res, P.CLIENTS_VIEW)) return;
    const client = await getClientWithDetails(db, req.params.id);
    if (client?.deleted_at) return res.status(404).json({ error: "Cliente nao encontrado." });
    if (!client) return res.status(404).json({ error: "Cliente nao encontrado." });
    // Recepção não enxerga prontuário nem termo (mesma regra da listagem antiga).
    const canReadClinical = hasPermission(req.user, P.CLINICAL_FILES_VIEW);
    const visible = !canReadClinical
      ? { ...client, medicalRecords: [], terms: [], followups: [], clinical_access: false }
      : { ...client, clinical_access: true };
    await recordPrivacyAudit(db, {
      req,
      action: canReadClinical ? "clinical_record_read" : "client_profile_read",
      resourceType: "client",
      resourceId: client.id,
      clientId: client.id,
    });
    res.json(clientResponse(visible));
  }),
);

router.post(
  "/api/clients/:id/loyalty-redemptions",
  withFeature("clients", async (req, res, db) => {
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
      [req.params.id, points, discount, req.body.notes || ""],
    );
    res.status(201).json(await getClientLoyalty(db, req.params.id));
  }),
);

router.post(
  "/api/clients/:id/medical-records",
  withFeature("clients", async (req, res, db) => {
    if (!authorizePermission(req, res, P.CLINICAL_FILES_EDIT)) return;
    await parseUpload(
      privateUpload.fields([
        { name: "before_photo", maxCount: 1 },
        { name: "after_photo", maxCount: 1 },
      ]),
      req,
      res,
      { imagesOnly: true },
    );
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
        body.returns_done || "",
      ],
    );
    res.status(201).json(await getMedicalRecord(db, result.returnedId));
  }),
);

router.delete(
  "/api/clients/:clientId/medical-records/:recordId",
  withFeature("clients", async (req, res, db) => {
    if (!authorizePermission(req, res, P.CLINICAL_FILES_EDIT)) return;
    await db.run("DELETE FROM client_medical_records WHERE id = ? AND client_id = ?", [
      req.params.recordId,
      req.params.clientId,
    ]);
    res.json({ ok: true });
  }),
);

export default router;
