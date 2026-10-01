// Rotas de profissionais.
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { boolNumber } from "../services/utils.js";
import { normalizeWhatsappNumber } from "../services/notifications.js";
import { parsePaging, fetchPage, pageResponse } from "../services/pagination.js";
import { P } from "../config/permissions.js";
import { hasPermission } from "../services/permissionService.js";
import { hasFeature, tenantSubscription } from "../services/subscriptions.js";
import { recordAudit } from "../services/audit.js";

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

// Colunas cadastrais devolvidas pela API. Lista explícita (nunca `*`): o
// percentual de comissão só sai para quem pode ver comissão, e coluna nova na
// tabela não vaza sozinha.
const PROFESSIONAL_COLUMNS = "id, name, specialty, active, photo_url, phone, email, whatsapp, notification_opt_in, calendar_color";

// Comissão é dado financeiro do profissional: só quem vê (ou edita) a comissão
// de toda a clínica recebe o percentual legado e o resumo das regras.
function canSeeCommission(user) {
  return hasPermission(user, P.COMMISSION_VIEW_ALL) || hasPermission(user, P.COMMISSION_EDIT);
}

function professionalColumns(user) {
  return canSeeCommission(user) ? `${PROFESSIONAL_COLUMNS}, commission_percentage` : PROFESSIONAL_COLUMNS;
}

// Resumo para a coluna "Comissão" da lista: padrão de serviços, padrão de
// produtos e quantidade de regras ativas por serviço. Só com o recurso do plano.
async function attachCommissionSummary(db, professionals) {
  if (!professionals.length) return professionals;
  const placeholders = professionals.map(() => "?").join(",");
  const rules = await db.all(
    `SELECT professional_id, scope, rate_type, rate_value, active
       FROM professional_commission_rules
      WHERE professional_id IN (${placeholders})`,
    professionals.map((professional) => professional.id)
  );
  return professionals.map((professional) => {
    const own = rules.filter((rule) => Number(rule.professional_id) === Number(professional.id));
    const pick = (scope) => {
      const rule = own.find((item) => item.scope === scope && item.active);
      return rule ? { rate_type: rule.rate_type, rate_value: Number(rule.rate_value) } : null;
    };
    return {
      ...professional,
      commission_summary: {
        service_default: pick("servico_padrao"),
        product_default: pick("produto_padrao"),
        service_rules: own.filter((rule) => rule.scope === "servico" && rule.active).length,
        active_rules: own.filter((rule) => rule.active).length
      }
    };
  });
}

// Id de rota inválido ("abc") viraria erro de conversão no Postgres (500).
function professionalIdParam(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Busca direta por id: "listar tudo e procurar" devolveria undefined em
// silêncio assim que a listagem passasse a ser paginada.
async function getProfessional(db, id, user = null) {
  const professional = await db.get(`SELECT ${professionalColumns(user)} FROM professionals WHERE id = ?`, [id]);
  if (!professional) return null;
  const rows = await db.all("SELECT service_id FROM professional_services WHERE professional_id = ?", [professional.id]);
  return { ...professional, service_ids: rows.map((row) => row.service_id) };
}

// Fotografia do cadastro para a auditoria (objeto; sem dados de comissão, que
// têm trilha própria no módulo "commission").
async function auditSnapshot(db, id) {
  const professional = await getProfessional(db, id);
  if (!professional) return null;
  return { ...professional, service_ids: [...professional.service_ids].map(Number).sort((a, b) => a - b) };
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
    select: professionalColumns(req.user),
    from: "professionals",
    where,
    params,
    orderBy: paging.orderBy,
    paging
  });
  let professionals = await attachServiceIds(db, rows);
  if (canSeeCommission(req.user) && hasFeature(await tenantSubscription(req.tenant?.id), "commissions")) {
    professionals = await attachCommissionSummary(db, professionals);
  }
  res.json(pageResponse(professionals, total, paging));
}));

router.post("/api/professionals", withFeature("procedures", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const { name, specialty, phone, email, calendar_color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome do profissional é obrigatório." });
  const whatsapp = normalizeWhatsappNumber(req.body.whatsapp || phone);
  // Cadastro, vínculos de serviço e auditoria na mesma transação: sem trilha
  // não há cadastro (e vice-versa).
  const id = await db.transaction(async (tx) => {
    const result = await tx.run(
      "INSERT INTO professionals (name, specialty, phone, email, whatsapp, notification_opt_in, calendar_color, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
      [name.trim(), specialty || "", phone || "", email || "", whatsapp, boolNumber(req.body.notification_opt_in ?? true), calendar_color || "#C8A96A", req.body.active === false ? 0 : 1]
    );
    await replaceProfessionalServices(tx, result.returnedId, req.body.service_ids || []);
    await recordAudit(tx, {
      req, module: "professionals", action: "create", entityType: "professional", entityId: result.returnedId,
      after: await auditSnapshot(tx, result.returnedId)
    });
    return result.returnedId;
  });
  res.status(201).json(await getProfessional(db, id, req.user));
}));

router.patch("/api/professionals/:id", withFeature("procedures", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  if (!professionalIdParam(req.params.id)) return res.status(404).json({ error: "Profissional não encontrado." });
  const professional = await db.get("SELECT * FROM professionals WHERE id = ?", [req.params.id]);
  if (!professional) return res.status(404).json({ error: "Profissional não encontrado." });
  // Alteração e trilha de auditoria (antes/depois) na mesma transação.
  await db.transaction(async (tx) => {
    const before = await auditSnapshot(tx, req.params.id);
    await tx.run(
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
    if (req.body.service_ids) await replaceProfessionalServices(tx, req.params.id, req.body.service_ids);
    const after = await auditSnapshot(tx, req.params.id);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await recordAudit(tx, {
        req, module: "professionals", action: "update", entityType: "professional", entityId: req.params.id,
        before, after
      });
    }
  });
  res.json(await getProfessional(db, req.params.id, req.user));
}));

router.delete("/api/professionals/:id", withFeature("procedures", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const professionalId = professionalIdParam(req.params.id);
  if (!professionalId) return res.status(404).json({ error: "Profissional não encontrado." });
  const outcome = await db.transaction(async (tx) => {
    // Trava a linha: um agendamento criado entre a contagem e o DELETE
    // faria a exclusão falhar com erro de chave estrangeira.
    if (!(await tx.get("SELECT id FROM professionals WHERE id = ? FOR UPDATE", [professionalId]))) return null;
    const before = await auditSnapshot(tx, professionalId);
    // Histórico que referencia o profissional sem CASCADE (agendamentos,
    // bloqueios de agenda, fila de notificações, execuções e lançamentos de
    // comissão — estes podem continuar com o profissional antigo depois de
    // uma troca no atendimento) impede a exclusão física: nesses casos ele é
    // arquivado, como já acontecia com agendamentos.
    const linked = await tx.get(
      `SELECT (SELECT COUNT(*) FROM appointments WHERE professional_id = ?)
            + (SELECT COUNT(*) FROM schedule_blocks WHERE professional_id = ?)
            + (SELECT COUNT(*) FROM notification_queue WHERE professional_id = ?)
            + (SELECT COUNT(*) FROM service_executions WHERE professional_id = ?)
            + (SELECT COUNT(*) FROM commission_entries WHERE professional_id = ?) AS count`,
      Array(5).fill(professionalId)
    );
    const archived = Number(linked.count) > 0;
    if (archived) {
      await tx.run("UPDATE professionals SET active = 0 WHERE id = ?", [professionalId]);
    } else {
      await tx.run("DELETE FROM professional_availability WHERE professional_id = ?", [professionalId]);
      await tx.run("DELETE FROM professional_services WHERE professional_id = ?", [professionalId]);
      await tx.run("DELETE FROM professionals WHERE id = ?", [professionalId]);
    }
    await recordAudit(tx, {
      req, module: "professionals", action: archived ? "archive" : "delete", entityType: "professional", entityId: professionalId,
      before, after: archived ? { ...before, active: 0 } : null,
      severity: archived ? "info" : "warning"
    });
    return { archived };
  });
  if (!outcome) return res.status(404).json({ error: "Profissional não encontrado." });
  res.json({ ok: true, archived: outcome.archived });
}));

export default router;
