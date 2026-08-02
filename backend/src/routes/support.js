// Suporte: chamados entre as clínicas e a Monitence.
//
// Dois blocos de rota no mesmo arquivo, e a fronteira entre eles é o ponto:
//
//   /api/support/*           clínica  — `withDb` (resolve o tenant do token) +
//                            papel `admin`. O tenant vem SEMPRE de
//                            `req.tenant.id`; nenhum id de clínica é aceito da
//                            URL ou do corpo.
//   /api/platform/support/*  super-admin — `verifyPlatformToken`, sem `withDb`
//                            (ele não pertence a clínica nenhuma), igual ao que
//                            routes/landing.js faz com o editor da landing.
//
// Os dois domínios de token já não se cruzam por construção: `authenticateRequest`
// recusa token de plataforma (plt: true) nas rotas de clínica, e
// `verifyPlatformToken` exige plt === true. As rotas abaixo só herdam isso.
//
// Papel `admin` no lado da clínica, e não `reception`, por três motivos: o
// chamado fala em nome da clínica com o fornecedor; a categoria `financeiro`
// trata de assinatura e cobrança, que é assunto de quem responde pelo contrato;
// e cada papel a mais é mais uma porta para encher a fila do suporte. Se um dia
// a recepção precisar abrir chamado, o lugar da mudança é o array de papéis
// nestas rotas — mais nada muda.
import { Router } from "express";
import { z } from "zod";
import { withDb } from "../middleware/withDb.js";
import { requireRole, verifyPlatformToken } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { parsePaging, pageResponse } from "../services/pagination.js";
import { isProduction } from "../config/index.js";
import {
  SupportError,
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  listTenantTickets,
  getTenantTicket,
  createTicket,
  replyAsTenant,
  closeTicketAsTenant,
  listAllTickets,
  getPlatformTicket,
  replyAsSupport,
  updateTicketAsSupport,
  countOpenTickets
} from "../services/support.js";

const router = Router();

function requirePlatform(req, res, next) {
  const decoded = verifyPlatformToken(req);
  if (!decoded) {
    return res.status(401).json({ error: "Sessão de plataforma inválida ou expirada." });
  }
  req.platformUser = decoded;
  next();
}

// Erro de regra vira o status que o serviço escolheu (404 de isolamento, 409 de
// chamado fechado, 429 do teto). Qualquer outro vira 500 sem detalhe em
// produção — a mensagem crua pode carregar SQL e nome de coluna.
function handleSupportError(res, error) {
  if (error instanceof SupportError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(`[support] ${error?.message || error}`);
  return res.status(500).json({
    error: isProduction ? "Erro interno no servidor." : `Erro interno: ${error.message}`
  });
}

// Os limites de tamanho vivem no serviço (é lá que valem para os dois lados);
// aqui eles só antecipam a recusa, para o corpo gigante não chegar ao banco.
const bodyField = z
  .string({ error: "A mensagem deve ser um texto." })
  .trim()
  .min(1, "Escreva a mensagem antes de enviar.")
  .max(MAX_BODY_LENGTH, `A mensagem pode ter no máximo ${MAX_BODY_LENGTH} caracteres.`);

const messageSchema = z.object({ body: bodyField }).passthrough();

const newTicketSchema = z.object({
  subject: z
    .string({ error: "O assunto deve ser um texto." })
    .trim()
    .min(1, "Informe o assunto do chamado.")
    .max(MAX_SUBJECT_LENGTH, `O assunto pode ter no máximo ${MAX_SUBJECT_LENGTH} caracteres.`),
  category: z
    .enum(TICKET_CATEGORIES, { error: `Categoria inválida. Use uma de: ${TICKET_CATEGORIES.join(", ")}.` })
    .optional(),
  body: bodyField
}).passthrough();

const supportReplySchema = z.object({
  body: bodyField,
  // Nota interna: só o lado do suporte pode marcar, e a rota da clínica sequer
  // conhece este campo.
  internal_note: z.boolean({ error: "Use verdadeiro ou falso." }).optional()
}).passthrough();

const ticketUpdateSchema = z.object({
  status: z.enum(TICKET_STATUSES, { error: `Status inválido. Use um de: ${TICKET_STATUSES.join(", ")}.` }).optional(),
  priority: z.enum(TICKET_PRIORITIES, { error: `Prioridade inválida. Use uma de: ${TICKET_PRIORITIES.join(", ")}.` }).optional()
}).passthrough();

// ---------------------------------------------------------------------------
// Clínica
// ---------------------------------------------------------------------------

router.get("/api/support/tickets", withDb(async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;
  try {
    // `parsePaging` sem `sortable`: a ordem é sempre "mexido por último no
    // topo", que é como uma caixa de entrada se lê. Deixar o cliente ordenar por
    // outra coluna só criaria paginação instável entre requisições.
    const paging = parsePaging(req.query, { defaultLimit: 25, maxLimit: 100 });
    const { rows, total } = await listTenantTickets(req.tenant.id, {
      status: String(req.query.status || ""),
      limit: paging.limit,
      offset: paging.offset,
      paginated: paging.paginated
    });
    res.json(pageResponse(rows, total, paging));
  } catch (error) {
    handleSupportError(res, error);
  }
}));

router.post("/api/support/tickets", withDb(async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;
  if (!validateBody(newTicketSchema, req, res)) return;
  try {
    const ticket = await createTicket(req.tenant.id, {
      user: req.user,
      subject: req.body.subject,
      category: req.body.category,
      body: req.body.body
    });
    res.status(201).json(ticket);
  } catch (error) {
    handleSupportError(res, error);
  }
}));

// O id da URL é do CHAMADO; o dono continua sendo `req.tenant.id`. Chamado de
// outra clínica cai no mesmo 404 de chamado inexistente.
router.get("/api/support/tickets/:id", withDb(async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;
  try {
    res.json(await getTenantTicket(req.tenant.id, req.params.id));
  } catch (error) {
    handleSupportError(res, error);
  }
}));

router.post("/api/support/tickets/:id/messages", withDb(async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;
  if (!validateBody(messageSchema, req, res)) return;
  try {
    res.status(201).json(await replyAsTenant(req.tenant.id, req.params.id, {
      user: req.user,
      body: req.body.body
    }));
  } catch (error) {
    handleSupportError(res, error);
  }
}));

// Rota própria em vez de um PATCH de status: fechar é a única transição que a
// clínica pode fazer, e um PATCH genérico abriria caminho para ela marcar como
// 'resolvido' o que o suporte não resolveu.
router.post("/api/support/tickets/:id/close", withDb(async (req, res) => {
  if (!requireRole(req, res, ["admin"])) return;
  try {
    res.json(await closeTicketAsTenant(req.tenant.id, req.params.id));
  } catch (error) {
    handleSupportError(res, error);
  }
}));

// ---------------------------------------------------------------------------
// Plataforma (super-admin)
// ---------------------------------------------------------------------------

router.get("/api/platform/support/tickets", requirePlatform, async (req, res) => {
  try {
    const paging = parsePaging(req.query, { defaultLimit: 25, maxLimit: 100 });
    const { rows, total } = await listAllTickets({
      status: String(req.query.status || ""),
      tenantId: req.query.tenant_id,
      search: String(req.query.search || ""),
      limit: paging.limit,
      offset: paging.offset,
      paginated: paging.paginated
    });
    res.json(pageResponse(rows, total, paging));
  } catch (error) {
    handleSupportError(res, error);
  }
});

// Contador do badge. Antes do :id na ordem de declaração porque "open-count"
// casaria com "/tickets/:id" e o serviço responderia 404 com um id não numérico.
router.get("/api/platform/support/open-count", requirePlatform, async (_req, res) => {
  try {
    res.json(await countOpenTickets());
  } catch (error) {
    handleSupportError(res, error);
  }
});

router.get("/api/platform/support/tickets/:id", requirePlatform, async (req, res) => {
  try {
    res.json(await getPlatformTicket(req.params.id));
  } catch (error) {
    handleSupportError(res, error);
  }
});

router.post("/api/platform/support/tickets/:id/messages", requirePlatform, async (req, res) => {
  if (!validateBody(supportReplySchema, req, res)) return;
  try {
    res.status(201).json(await replyAsSupport(req.params.id, {
      authorName: req.platformUser?.name || "Suporte Monitence",
      body: req.body.body,
      internalNote: req.body.internal_note === true
    }));
  } catch (error) {
    handleSupportError(res, error);
  }
});

router.patch("/api/platform/support/tickets/:id", requirePlatform, async (req, res) => {
  if (!validateBody(ticketUpdateSchema, req, res)) return;
  try {
    res.json(await updateTicketAsSupport(req.params.id, {
      status: req.body.status,
      priority: req.body.priority
    }));
  } catch (error) {
    handleSupportError(res, error);
  }
});

export default router;
