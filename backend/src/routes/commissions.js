// Regras e lançamentos de comissão por profissional.
//
// Tudo aqui exige o recurso de plano "commissions" (Studio). Permissões:
// - commission.edit: configura regras e recalcula (também enxerga tudo);
// - commission.view_all: lê regras e extrato de todos os profissionais;
// - commission.view_own: lê só o profissional vinculado ao usuário
//   (users.professional_id) — o filtro é forçado no servidor.
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { P } from "../config/permissions.js";
import { hasPermission } from "../services/permissionService.js";
import { recordAudit } from "../services/audit.js";
import {
  listAppointmentCommissionEntries,
  normalizeCommissionRulesPayload,
  refreshAppointmentCommissions,
  toCents
} from "../services/commissions.js";

const router = Router();

const FORBIDDEN = "Você não tem permissão para esta ação.";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function commissionAccess(req) {
  const canEdit = hasPermission(req.user, P.COMMISSION_EDIT);
  const canViewAll = canEdit || hasPermission(req.user, P.COMMISSION_VIEW_ALL);
  const canViewOwn = hasPermission(req.user, P.COMMISSION_VIEW_OWN);
  const ownProfessionalId = Number(req.user?.professional_id) || null;
  return { canEdit, canViewAll, canViewOwn, ownProfessionalId };
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Leitura de regras/histórico de UM profissional: quem vê tudo, ou o próprio
// profissional vinculado ao usuário com view_own.
function canReadProfessional(req, professionalId) {
  const access = commissionAccess(req);
  return access.canViewAll || (access.canViewOwn && access.ownProfessionalId === professionalId);
}

// Fotografia da regra para a auditoria (sempre OBJETO: array no topo viraria
// array do Postgres em vez de JSON).
function ruleSnapshot(rule, serviceName = null) {
  if (!rule) return null;
  return {
    id: rule.id,
    scope: rule.scope,
    service_id: rule.service_id ?? null,
    service_name: serviceName,
    rate_type: rule.rate_type,
    rate_value: Number(rule.rate_value),
    active: Boolean(rule.active),
    notes: rule.notes || null
  };
}

async function loadRulesPayload(db, professionalId) {
  const professional = await db.get(
    "SELECT id, name, specialty, active, calendar_color FROM professionals WHERE id = ?",
    [professionalId]
  );
  if (!professional) return null;
  const rules = await db.all(
    `SELECT r.id, r.professional_id, r.scope, r.service_id, s.name AS service_name, r.rate_type, r.rate_value,
            r.active, r.notes, r.created_at, r.updated_at,
            cu.name AS created_by_name, uu.name AS updated_by_name
       FROM professional_commission_rules r
       LEFT JOIN services s ON s.id = r.service_id
       LEFT JOIN users cu ON cu.id = r.created_by_user_id
       LEFT JOIN users uu ON uu.id = r.updated_by_user_id
      WHERE r.professional_id = ?
      ORDER BY CASE r.scope WHEN 'servico_padrao' THEN 0 WHEN 'produto_padrao' THEN 1 ELSE 2 END, s.name, r.id`,
    [professionalId]
  );
  // Serviços para o seletor das regras específicas; `linked` indica os que o
  // profissional realiza (professional_services), para a tela destacar.
  const services = await db.all(
    `SELECT s.id, s.name, s.price, s.is_active,
            EXISTS (SELECT 1 FROM professional_services ps WHERE ps.service_id = s.id AND ps.professional_id = ?) AS linked
       FROM services s
      ORDER BY s.name, s.id`,
    [professionalId]
  );
  return { professional, rules, services };
}

router.get("/api/professionals/:id/commission-rules", withFeature("commissions", async (req, res, db) => {
  const professionalId = positiveId(req.params.id);
  if (!professionalId) return res.status(404).json({ error: "Profissional não encontrado." });
  if (!canReadProfessional(req, professionalId)) return res.status(403).json({ error: FORBIDDEN });
  const payload = await loadRulesPayload(db, professionalId);
  if (!payload) return res.status(404).json({ error: "Profissional não encontrado." });
  res.json(payload);
}));

router.put("/api/professionals/:id/commission-rules", withFeature("commissions", async (req, res, db) => {
  if (!commissionAccess(req).canEdit) return res.status(403).json({ error: FORBIDDEN });
  const professionalId = positiveId(req.params.id);
  if (!professionalId) return res.status(404).json({ error: "Profissional não encontrado." });
  const normalized = normalizeCommissionRulesPayload(req.body?.rules);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const reason = String(req.body?.reason || "").trim().slice(0, 500) || null;

  const serviceIds = [...new Set(normalized.rules.filter((rule) => rule.service_id).map((rule) => rule.service_id))];
  const serviceNames = new Map();
  if (serviceIds.length) {
    const rows = await db.all(`SELECT id, name FROM services WHERE id IN (${serviceIds.map(() => "?").join(",")})`, serviceIds);
    for (const row of rows) serviceNames.set(Number(row.id), row.name);
    if (serviceNames.size !== serviceIds.length) {
      return res.status(400).json({ error: "Serviço da regra de comissão não encontrado." });
    }
  }

  const outcome = await db.transaction(async (tx) => {
    // Trava o profissional: dois PUTs simultâneos não podem inserir a mesma
    // regra (índice único) nem auditar alterações sobrepostas.
    const professional = await tx.get("SELECT id, name, commission_percentage FROM professionals WHERE id = ? FOR UPDATE", [professionalId]);
    if (!professional) return { notFound: true };
    const existing = await tx.all("SELECT * FROM professional_commission_rules WHERE professional_id = ? ORDER BY id FOR UPDATE", [professionalId]);
    const byKey = new Map(existing.map((rule) => [`${rule.scope}:${rule.service_id || 0}`, rule]));
    // Regra por serviço que ficou fora do conjunto também precisa do nome do
    // serviço na auditoria (o histórico mostra "Hélix", não "#12").
    const missingNames = [...new Set(existing.map((rule) => Number(rule.service_id)).filter((id) => id && !serviceNames.has(id)))];
    if (missingNames.length) {
      const rows = await tx.all(`SELECT id, name FROM services WHERE id IN (${missingNames.map(() => "?").join(",")})`, missingNames);
      for (const row of rows) serviceNames.set(Number(row.id), row.name);
    }
    const userId = req.user?.id || null;
    const changes = [];
    const audit = (action, before, after) => recordAudit(tx, {
      req,
      module: "commission",
      action,
      entityType: "commission_rule",
      entityId: (after || before).id,
      reason,
      before: ruleSnapshot(before, serviceNames.get(Number(before?.service_id)) || null),
      after: ruleSnapshot(after, serviceNames.get(Number(after?.service_id)) || null),
      metadata: { professional_id: professionalId, professional_name: professional.name },
      severity: action === "rule_deactivate" ? "warning" : "info"
    });

    const keep = new Set();
    for (const rule of normalized.rules) {
      const key = `${rule.scope}:${rule.service_id || 0}`;
      keep.add(key);
      const current = byKey.get(key);
      if (!current) {
        const inserted = await tx.get(
          `INSERT INTO professional_commission_rules
             (professional_id, scope, service_id, rate_type, rate_value, active, notes, created_by_user_id, updated_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
          [professionalId, rule.scope, rule.service_id, rule.rate_type, rule.rate_value, rule.active, rule.notes, userId, userId]
        );
        await audit("rule_create", null, inserted);
        changes.push({ action: "rule_create", rule_id: inserted.id });
        continue;
      }
      const unchanged = current.rate_type === rule.rate_type
        && toCents(current.rate_value) === toCents(rule.rate_value)
        && Boolean(current.active) === rule.active
        && (current.notes || null) === rule.notes;
      if (unchanged) continue;
      const updated = await tx.get(
        `UPDATE professional_commission_rules
            SET rate_type = ?, rate_value = ?, active = ?, notes = ?, updated_by_user_id = ?, updated_at = now()
          WHERE id = ? RETURNING *`,
        [rule.rate_type, rule.rate_value, rule.active, rule.notes, userId, current.id]
      );
      const action = current.active && !rule.active ? "rule_deactivate" : "rule_update";
      await audit(action, current, updated);
      changes.push({ action, rule_id: updated.id });
    }

    // "Substitui o conjunto" sem apagar: o que ficou de fora é desativado,
    // preservando o histórico (e o rule_id dos lançamentos já gravados).
    for (const current of existing) {
      const key = `${current.scope}:${current.service_id || 0}`;
      if (keep.has(key) || !current.active) continue;
      const updated = await tx.get(
        "UPDATE professional_commission_rules SET active = false, updated_by_user_id = ?, updated_at = now() WHERE id = ? RETURNING *",
        [userId, current.id]
      );
      await audit("rule_deactivate", current, updated);
      changes.push({ action: "rule_deactivate", rule_id: updated.id });
    }

    // Compatibilidade: a coluna legada espelha o percentual padrão de
    // serviços. Nenhum cálculo novo a lê — só telas/integrações antigas.
    const defaultRule = await tx.get(
      "SELECT rate_type, rate_value FROM professional_commission_rules WHERE professional_id = ? AND scope = 'servico_padrao' AND active = true",
      [professionalId]
    );
    const mirrored = defaultRule?.rate_type === "percentual" ? Number(defaultRule.rate_value) : 0;
    if (toCents(professional.commission_percentage) !== toCents(mirrored)) {
      await tx.run("UPDATE professionals SET commission_percentage = ? WHERE id = ?", [mirrored, professionalId]);
    }
    return { changes };
  });
  if (outcome.notFound) return res.status(404).json({ error: "Profissional não encontrado." });
  // Mudança de regra NÃO recalcula atendimentos passados (SPEC 5.2): o
  // recálculo é manual, por atendimento, em POST /api/commissions/recalculate.
  res.json({ ...(await loadRulesPayload(db, professionalId)), changes: outcome.changes });
}));

router.get("/api/professionals/:id/commission-rules/history", withFeature("commissions", async (req, res, db) => {
  const professionalId = positiveId(req.params.id);
  if (!professionalId) return res.status(404).json({ error: "Profissional não encontrado." });
  if (!canReadProfessional(req, professionalId)) return res.status(403).json({ error: FORBIDDEN });
  const professional = await db.get("SELECT id, name FROM professionals WHERE id = ?", [professionalId]);
  if (!professional) return res.status(404).json({ error: "Profissional não encontrado." });
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 500);
  // `->>` (e não os operadores jsonb com `?`, que o adaptador trocaria por $n).
  const rows = await db.all(
    `SELECT id, action, entity_id, actor_user_id, actor_name, reason, before_data, after_data, created_at
       FROM audit_events
      WHERE module = 'commission' AND entity_type = 'commission_rule' AND metadata->>'professional_id' = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    [String(professionalId), limit]
  );
  res.json({
    professional,
    items: rows.map((row) => ({
      id: row.id,
      action: row.action,
      rule_id: row.entity_id ? Number(row.entity_id) : null,
      user_id: row.actor_user_id,
      user_name: row.actor_name,
      reason: row.reason,
      before: row.before_data,
      after: row.after_data,
      created_at: row.created_at
    }))
  });
}));

router.get("/api/commissions", withFeature("commissions", async (req, res, db) => {
  const access = commissionAccess(req);
  if (!access.canViewAll && !access.canViewOwn) return res.status(403).json({ error: FORBIDDEN });
  const query = req.query || {};
  const clauses = [];
  const params = [];

  let professionalId = query.professional_id ? positiveId(query.professional_id) : null;
  if (query.professional_id && !professionalId) return res.status(400).json({ error: "Profissional inválido." });
  if (!access.canViewAll) {
    // view_own: o filtro é sempre o profissional do usuário, qualquer que seja
    // o parâmetro enviado (mesma regra dos relatórios próprios).
    if (!access.ownProfessionalId) {
      return res.status(409).json({ error: "Vincule este usuário a um profissional para ver as próprias comissões." });
    }
    professionalId = access.ownProfessionalId;
  }
  if (professionalId) { clauses.push("ce.professional_id = ?"); params.push(professionalId); }

  const dateFrom = String(query.date_from || query.from || "").trim();
  const dateTo = String(query.date_to || query.to || "").trim();
  if (dateFrom && !DATE_PATTERN.test(dateFrom)) return res.status(400).json({ error: "Data inicial inválida (use AAAA-MM-DD)." });
  if (dateTo && !DATE_PATTERN.test(dateTo)) return res.status(400).json({ error: "Data final inválida (use AAAA-MM-DD)." });
  if (dateFrom) { clauses.push("ce.reference_date >= ?"); params.push(dateFrom); }
  if (dateTo) { clauses.push("ce.reference_date <= ?"); params.push(dateTo); }

  for (const [param, column, label] of [["service_id", "ce.service_id", "Serviço"], ["appointment_id", "ce.appointment_id", "Atendimento"]]) {
    if (query[param] === undefined || query[param] === "") continue;
    const id = positiveId(query[param]);
    if (!id) return res.status(400).json({ error: `${label} inválido.` });
    clauses.push(`${column} = ?`);
    params.push(id);
  }

  const status = String(query.status || "ativa");
  if (!["ativa", "estornada", "todas"].includes(status)) return res.status(400).json({ error: "Situação inválida: use ativa, estornada ou todas." });
  const statusClause = status === "todas" ? "" : "ce.status = ?";
  const itemClauses = statusClause ? [...clauses, statusClause] : clauses;
  const itemParams = statusClause ? [...params, status] : params;
  const where = itemClauses.length ? `WHERE ${itemClauses.join(" AND ")}` : "";

  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(query.page_size, 10) || 50, 1), 200);

  const from = `FROM commission_entries ce
    JOIN professionals p ON p.id = ce.professional_id
    JOIN appointments a ON a.id = ce.appointment_id
    LEFT JOIN clients c ON c.id = a.client_id
    LEFT JOIN services s ON s.id = ce.service_id
    LEFT JOIN users cu ON cu.id = ce.calculated_by_user_id
    LEFT JOIN users ru ON ru.id = ce.reversed_by_user_id`;
  const items = await db.all(
    `SELECT ce.id, ce.appointment_id, ce.service_execution_id, ce.professional_id, p.name AS professional_name,
            a.client_id, c.full_name AS client_name, a.appointment_time, ce.reference_date,
            ce.item_kind, ce.appointment_item_id, ce.service_id, s.name AS service_name, ce.procedure_id, ce.product_id,
            ce.item_description, ce.quantity, ce.gross_amount, ce.discount_amount, ce.adjustment_amount, ce.base_amount,
            ce.rule_id, ce.rule_scope, ce.rate_type, ce.rate_value, ce.commission_amount, ce.status,
            ce.calculated_at, cu.name AS calculated_by_name, ce.reversed_at, ru.name AS reversed_by_name, ce.reversal_reason
       ${from}
       ${where}
      ORDER BY ce.reference_date DESC, ce.appointment_id DESC, ce.id DESC
      LIMIT ? OFFSET ?`,
    [...itemParams, pageSize, (page - 1) * pageSize]
  );
  const count = await db.get(`SELECT COUNT(*)::int AS total ${from} ${where}`, itemParams);
  // Totais somados no Postgres (exatos em decimal). Com status=todas os totais
  // consideram só os ativos: somar estornados junto contaria o mesmo item duas vezes.
  const totalsClauses = status === "estornada" ? [...clauses, "ce.status = 'estornada'"] : [...clauses, "ce.status = 'ativa'"];
  const totals = await db.get(
    `SELECT COUNT(*)::int AS entries,
            COALESCE(SUM(ce.gross_amount), 0) AS gross,
            COALESCE(SUM(ce.discount_amount), 0) AS discount,
            COALESCE(SUM(ce.adjustment_amount), 0) AS adjustment,
            COALESCE(SUM(ce.base_amount), 0) AS base,
            COALESCE(SUM(ce.commission_amount), 0) AS commission
       FROM commission_entries ce
      WHERE ${totalsClauses.join(" AND ")}`,
    params
  );
  const total = Number(count?.total || 0);
  res.json({
    items,
    totals: {
      entries: Number(totals.entries || 0),
      gross: Number(totals.gross || 0),
      discount: Number(totals.discount || 0),
      adjustment: Number(totals.adjustment || 0),
      base: Number(totals.base || 0),
      commission: Number(totals.commission || 0),
      status: status === "estornada" ? "estornada" : "ativa"
    },
    page,
    page_size: pageSize,
    total,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
    scope: access.canViewAll ? "all" : "own"
  });
}));

router.post("/api/commissions/recalculate", withFeature("commissions", async (req, res, db) => {
  if (!commissionAccess(req).canEdit) return res.status(403).json({ error: FORBIDDEN });
  const appointmentId = positiveId(req.body?.appointment_id);
  if (!appointmentId) return res.status(400).json({ error: "Informe o atendimento a recalcular." });
  const reason = String(req.body?.reason || "").trim();
  if (reason.length > 500) return res.status(400).json({ error: "O motivo aceita até 500 caracteres." });
  const outcome = await db.transaction(async (tx) => {
    const appointment = await tx.get("SELECT id, status, professional_id FROM appointments WHERE id = ? FOR UPDATE", [appointmentId]);
    if (!appointment) return null;
    const before = await listAppointmentCommissionEntries(tx, appointmentId);
    const result = await refreshAppointmentCommissions(tx, appointmentId, {
      userId: req.user?.id || null,
      reason: reason || "Recálculo manual da comissão."
    });
    const entries = await listAppointmentCommissionEntries(tx, appointmentId);
    const summarize = (rows) => ({
      entries: rows.length,
      commission: rows.reduce((sum, row) => sum + toCents(row.commission_amount), 0) / 100
    });
    await recordAudit(tx, {
      req,
      module: "commission",
      action: "recalculate",
      entityType: "appointment",
      entityId: appointmentId,
      reason: reason || null,
      before: summarize(before),
      after: summarize(entries),
      metadata: { appointment_status: appointment.status, professional_id: appointment.professional_id, ...result }
    });
    return { result, entries };
  });
  if (!outcome) return res.status(404).json({ error: "Atendimento não encontrado." });
  res.json({ appointment_id: appointmentId, ...outcome.result, entries: outcome.entries });
}));

export default router;
