import { Router } from "express";
import { withDb, withFeature } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";
import { whatsappLink } from "../services/notifications.js";
import { processDueCommunications, TEMPLATE_VARIABLES } from "../services/communications.js";
import {
  COMMUNICATION_CREDIT_PRODUCTS,
  CommunicationCreditError,
  communicationCreditBalance,
  communicationCreditHistory,
  communicationCreditProduct
} from "../services/communicationCredits.js";
import { parsePaging, limitOffset, countRows, pageResponse } from "../services/pagination.js";

const router = Router();

const NOTIFICATION_FROM = `
    notification_queue nq
    LEFT JOIN professionals p ON p.id = nq.professional_id
    LEFT JOIN appointments a ON a.id = nq.appointment_id
`;

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const NOTIFICATION_SORTABLE = {
  created_at: "nq.created_at",
  scheduled_at: "nq.scheduled_at",
  sent_at: "nq.sent_at",
  status: "nq.status",
  channel: "nq.channel",
  professional: "p.name"
};

// Teto histórico da rota: quem não pede paginação continua recebendo as 100
// mais recentes, exatamente como antes. Quem manda limit/offset entra na
// paginação real (LIMIT/OFFSET + total com os mesmos filtros).
const LEGACY_LIMIT = 100;

function communicationCreditError(res, error) {
  if (error instanceof CommunicationCreditError) {
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

// Saldo por canal, franquia mensal do plano e extrato da competência atual.
// Não exige feature de automação: mesmo no plano sem WhatsApp a clínica precisa
// enxergar o saldo e as recargas disponíveis antes de decidir fazer upgrade.
router.get("/api/communication-credits", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  try {
    const periodKey = req.query.period ? String(req.query.period) : undefined;
    // O mesmo client do tenant não pode abrir duas transações concorrentes.
    const balance = await communicationCreditBalance(db, req.tenant.id, { periodKey });
    const history = await communicationCreditHistory(db, req.tenant.id, { periodKey, limit: req.query.limit });
    res.json({ balance, products: COMMUNICATION_CREDIT_PRODUCTS, history });
  } catch (error) {
    if (!communicationCreditError(res, error)) throw error;
  }
}));

// Checkout ainda não está conectado. Esta rota registra somente a intenção,
// com preço e créditos definidos pelo servidor (nunca pelo browser), e não
// altera saldo. O webhook do gateway será o único caminho para grantTopup().
router.post("/api/communication-credits/purchase", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const product = communicationCreditProduct(req.body?.product_key);
  if (!product) return res.status(400).json({ error: "Pacote de créditos inválido.", code: "invalid_credit_product" });
  const created = await db.run(
    `INSERT INTO communication_credit_purchase_intents
      (product_key, channel, credits, amount_cents, metadata)
     VALUES (?, ?, ?, ?, ?) RETURNING id, product_key, channel, credits, amount_cents, status, created_at`,
    [product.key, product.channel, product.credits, product.price_cents, JSON.stringify({ requested_by_user_id: req.user.id })]
  );
  res.status(201).json({ intent: created.rows[0], checkout: { status: "pending", message: "Checkout de créditos será disponibilizado em breve." } });
}));

router.get("/api/notifications", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  const clauses = [];
  const params = [];
  if (req.query.status) {
    clauses.push("nq.status = ?");
    params.push(req.query.status);
  }
  if (req.query.channel) {
    clauses.push("nq.channel = ?");
    params.push(req.query.channel);
  }
  if (req.query.professional_id) {
    clauses.push("nq.professional_id = ?");
    params.push(req.query.professional_id);
  }
  if (req.query.appointment_id) {
    clauses.push("nq.appointment_id = ?");
    params.push(req.query.appointment_id);
  }
  if (req.query.from) {
    clauses.push("nq.created_at >= ?");
    params.push(req.query.from);
  }
  if (req.query.to) {
    clauses.push("nq.created_at <= ?");
    params.push(`${req.query.to} 23:59:59`);
  }
  if (req.query.search) {
    clauses.push("(nq.destination ILIKE ? OR nq.message ILIKE ? OR nq.template ILIKE ?)");
    params.push(...Array(3).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: NOTIFICATION_SORTABLE,
    tieBreak: "nq.id",
    defaultOrderBy: "ORDER BY nq.created_at DESC, nq.id DESC"
  });
  const page = limitOffset(paging);
  // Sem paginação, o teto histórico entra como placeholder (nada interpolado).
  const legacy = paging.paginated ? { clause: "", params: [] } : { clause: " LIMIT ?", params: [LEGACY_LIMIT] };
  const rows = await db.all(
    `SELECT nq.*, p.name AS professional_name, a.appointment_date, a.appointment_time
     FROM ${NOTIFICATION_FROM} ${where} ${paging.orderBy}${page.clause}${legacy.clause}`,
    [...params, ...page.params, ...legacy.params]
  );
  const total = paging.paginated ? await countRows(db, { from: NOTIFICATION_FROM, where, params }) : rows.length;
  const items = rows.map((row) => ({
    ...row,
    whatsapp_link: row.destination ? whatsappLink(row.destination, row.message) : ""
  }));
  res.json(pageResponse(items, total, paging));
}));

router.get("/api/communication-templates", withFeature("message_templates", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  res.json({ variables: TEMPLATE_VARIABLES, templates: await db.all("SELECT * FROM communication_templates ORDER BY name") });
}));

router.patch("/api/communication-templates/:id", withFeature("message_templates", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const current = await db.get("SELECT * FROM communication_templates WHERE id=?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Template não encontrado." });
  const body = String(req.body?.body || "").trim();
  if (!body || body.length > 4000) return res.status(400).json({ error: "O texto deve possuir entre 1 e 4000 caracteres." });
  await db.run("UPDATE communication_templates SET name=?, channel=?, subject=?, body=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [
    String(req.body?.name || current.name).trim(), req.body?.channel || current.channel, req.body?.subject || "",
    body, Number(req.body?.is_active ?? current.is_active), req.params.id
  ]);
  res.json(await db.get("SELECT * FROM communication_templates WHERE id=?", [req.params.id]));
}));

router.get("/api/automation-rules", withFeature("message_templates", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  res.json(await db.all(`
    SELECT ar.*, ct.name AS template_name,
      (SELECT COUNT(*) FROM automation_runs r WHERE r.rule_id=ar.id) AS run_count
    FROM automation_rules ar LEFT JOIN communication_templates ct ON ct.template_key=ar.template_key
    ORDER BY ar.name
  `));
}));

router.patch("/api/automation-rules/:id", withFeature("message_templates", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  const current = await db.get("SELECT * FROM automation_rules WHERE id=?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Automação não encontrada." });
  const currentSettings = typeof current.settings === "string"
    ? JSON.parse(current.settings || "{}")
    : (current.settings || {});
  await db.run("UPDATE automation_rules SET name=?, template_key=?, channel=?, offset_minutes=?, is_active=?, settings=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [
    req.body?.name || current.name, req.body?.template_key || current.template_key, req.body?.channel || current.channel,
    Number(req.body?.offset_minutes ?? current.offset_minutes), Number(req.body?.is_active ?? current.is_active),
    JSON.stringify(req.body?.settings || currentSettings), req.params.id
  ]);
  res.json(await db.get("SELECT * FROM automation_rules WHERE id=?", [req.params.id]));
}));

router.post("/api/automations/process", withFeature("message_templates", async (req, res, db) => {
  if (!requireRole(req, res, ["admin", "reception"])) return;
  res.json({ ok: true, ready: await processDueCommunications(db, req.body?.limit) });
}));

router.get("/api/automation-runs", withFeature("message_templates", async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  res.json(await db.all("SELECT * FROM automation_runs ORDER BY executed_at DESC, id DESC LIMIT 200"));
}));

export default router;
