// Suporte: chamados entre as clínicas e a Monitence.
//
// Duas audiências no MESMO dado, e é isso que manda no desenho deste arquivo:
//
//   1. A clínica só enxerga os chamados DELA. Toda função deste lado recebe
//      `tenantId` e o embute no WHERE. Nenhuma delas aceita "buscar por id e
//      depois conferir o dono" — a conferência esquecida é justamente o bug que
//      vaza a conversa de uma clínica para outra.
//   2. Chamado inexistente e chamado de outra clínica devolvem o MESMO 404.
//      Um 403 confirmaria que aquele id existe, o que já é informação sobre a
//      concorrente (quantos chamados a plataforma tem, quem abriu antes).
//
// As tabelas vivem no schema `platform` porque o chamado cruza a fronteira
// clínica↔Monitence. Por isso este arquivo usa `query()` de database/connection
// com placeholders `$1` — e não a camada `db` com `?`, que é ligada ao
// search_path de um tenant.
import { pool, query } from "../database/connection.js";

// Tetos de tamanho. O assunto é uma linha de lista; o corpo é uma mensagem de
// conversa, não um anexo. Sem limite, o campo vira depósito: um paste de log de
// 2 MB entraria inteiro no banco e depois seria servido em toda abertura da
// caixa de entrada do suporte.
export const MAX_SUBJECT_LENGTH = 120;
export const MAX_BODY_LENGTH = 4000;

// Teto de chamados EM ABERTO por clínica.
//
// Guarda contra "abrir 500 chamados seguidos" sem inventar um rate limit novo.
// A escolha é deliberadamente um teto de estoque, e não de frequência: quem
// legitimamente abre três chamados numa manhã ruim não é punido, e o limite se
// desfaz sozinho conforme o suporte resolve a fila. Chamado resolvido ou
// fechado não conta.
export const MAX_OPEN_TICKETS_PER_TENANT = 10;

export const TICKET_CATEGORIES = ["duvida", "problema", "sugestao", "financeiro", "outro"];
export const TICKET_PRIORITIES = ["baixa", "normal", "alta"];
export const TICKET_STATUSES = ["aberto", "em_andamento", "aguardando_cliente", "resolvido", "fechado"];

// Status que ainda pedem ação de alguém — a definição de "em aberto" usada no
// teto acima e no contador do painel.
const OPEN_STATUSES = ["aberto", "em_andamento", "aguardando_cliente"];

export class SupportError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "SupportError";
    this.statusCode = statusCode;
  }
}

// Colunas devolvidas ao cliente. Escrita à mão em vez de `SELECT *` para que uma
// coluna nova (uma nota interna resumida, por exemplo) não passe a vazar sozinha
// no dia em que for criada.
const TICKET_FIELDS = `id, tenant_id, opened_by_user_id, opened_by_name, opened_by_email,
  subject, category, priority, status, created_at, updated_at, closed_at,
  last_clinic_message_at, last_support_message_at`;
// Mesma lista com o prefixo do JOIN. Duas constantes em vez de um replace no
// texto da SQL: um `t.` trocado por engano dentro de um nome de coluna geraria
// uma query inválida só em tempo de execução.
const TICKET_COLUMNS = TICKET_FIELDS.split(",").map((field) => `t.${field.trim()}`).join(", ");

function trimmedText(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Validação compartilhada pelos dois lados: a mesma regra vale para a primeira
// mensagem da clínica e para a resposta do suporte.
function assertBody(value) {
  const body = trimmedText(value);
  if (!body) throw new SupportError("Escreva a mensagem antes de enviar.");
  if (body.length > MAX_BODY_LENGTH) {
    throw new SupportError(`A mensagem pode ter no máximo ${MAX_BODY_LENGTH} caracteres.`);
  }
  return body;
}

function assertSubject(value) {
  const subject = trimmedText(value);
  if (!subject) throw new SupportError("Informe o assunto do chamado.");
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new SupportError(`O assunto pode ter no máximo ${MAX_SUBJECT_LENGTH} caracteres.`);
  }
  return subject;
}

function assertCategory(value) {
  const category = trimmedText(value) || "duvida";
  if (!TICKET_CATEGORIES.includes(category)) {
    throw new SupportError(`Categoria inválida. Use uma de: ${TICKET_CATEGORIES.join(", ")}.`);
  }
  return category;
}

// Id vindo da URL. `Number.isInteger` em vez de `Number(...)` solto porque
// "12abc" e "1e3" viram número em JS e chegariam ao banco como id de outro
// chamado.
function assertTicketId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new SupportError("Chamado não encontrado.", 404);
  return id;
}

// Transação: inserir a mensagem e mexer no chamado precisam andar juntos.
// Metade aplicada deixaria uma resposta invisível (mensagem gravada e
// `last_*_message_at` velho, então nada indicaria a novidade) ou um chamado
// "respondido" sem resposta nenhuma.
async function inTransaction(run) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Lado da clínica
// ---------------------------------------------------------------------------

// Lista os chamados DA CLÍNICA. `tenantId` vem de `req.tenant.id` (resolvido do
// token), nunca da URL ou do corpo.
export async function listTenantTickets(tenantId, { status = "", limit = 50, offset = 0, paginated = false } = {}) {
  const params = [tenantId];
  let where = "WHERE t.tenant_id = $1";
  if (status && TICKET_STATUSES.includes(status)) {
    params.push(status);
    where += ` AND t.status = $${params.length}`;
  }

  const rows = await query(
    `SELECT ${TICKET_COLUMNS},
            (SELECT COUNT(*) FROM platform.support_messages m
              WHERE m.ticket_id = t.id AND m.internal_note = false) AS message_count
       FROM platform.support_tickets t
       ${where}
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  if (!paginated) return { rows: rows.rows, total: rows.rows.length };
  const counted = await query(`SELECT COUNT(*)::int AS total FROM platform.support_tickets t ${where}`, params);
  return { rows: rows.rows, total: counted.rows[0]?.total || 0 };
}

// O chamado com a conversa. `internal_note = false` no WHERE das mensagens é a
// linha que impede a nota do suporte de vazar para a clínica — está aqui, na
// única função que a clínica usa para ler a conversa, e não na rota, para não
// depender de a rota lembrar de filtrar.
export async function getTenantTicket(tenantId, ticketId) {
  const id = assertTicketId(ticketId);
  const ticket = await query(
    `SELECT ${TICKET_COLUMNS} FROM platform.support_tickets t WHERE t.id = $1 AND t.tenant_id = $2`,
    [id, tenantId]
  );
  if (!ticket.rows[0]) throw new SupportError("Chamado não encontrado.", 404);

  const messages = await query(
    `SELECT id, ticket_id, author_side, author_name, body, created_at
       FROM platform.support_messages
      WHERE ticket_id = $1 AND internal_note = false
      ORDER BY created_at, id`,
    [id]
  );
  return { ...ticket.rows[0], messages: messages.rows };
}

export async function createTicket(tenantId, { user, subject, category, body }) {
  const finalSubject = assertSubject(subject);
  const finalCategory = assertCategory(category);
  const finalBody = assertBody(body);

  const open = await query(
    `SELECT COUNT(*)::int AS total
       FROM platform.support_tickets
      WHERE tenant_id = $1 AND status = ANY($2)`,
    [tenantId, OPEN_STATUSES]
  );
  if ((open.rows[0]?.total || 0) >= MAX_OPEN_TICKETS_PER_TENANT) {
    // 429 e não 400: o pedido está correto, o que sobrou foi paciência. A
    // mensagem diz o caminho de saída (responder no chamado que já existe),
    // senão o usuário só reenvia o mesmo formulário.
    throw new SupportError(
      `Você já tem ${MAX_OPEN_TICKETS_PER_TENANT} chamados em aberto. Responda ou feche algum antes de abrir outro — se for sobre um assunto já em andamento, responda no próprio chamado.`,
      429
    );
  }

  return inTransaction(async (client) => {
    const created = await client.query(
      `INSERT INTO platform.support_tickets
         (tenant_id, opened_by_user_id, opened_by_name, opened_by_email, subject, category, last_clinic_message_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       RETURNING ${TICKET_FIELDS}`,
      [tenantId, user?.id ?? null, user?.name || "", user?.email || null, finalSubject, finalCategory]
    );
    const ticket = created.rows[0];
    const message = await client.query(
      `INSERT INTO platform.support_messages (ticket_id, author_side, author_name, body)
       VALUES ($1, 'clinica', $2, $3)
       RETURNING id, ticket_id, author_side, author_name, body, created_at`,
      [ticket.id, user?.name || "", finalBody]
    );
    return { ...ticket, messages: message.rows };
  });
}

export async function replyAsTenant(tenantId, ticketId, { user, body }) {
  const id = assertTicketId(ticketId);
  const finalBody = assertBody(body);

  const found = await query(
    "SELECT id, status FROM platform.support_tickets WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  const ticket = found.rows[0];
  if (!ticket) throw new SupportError("Chamado não encontrado.", 404);
  if (ticket.status === "fechado") {
    throw new SupportError("Este chamado está fechado. Abra um novo chamado para continuar o assunto.", 409);
  }

  // Responder num chamado dado como resolvido é o sinal mais claro de que ele
  // não estava: volta para 'aberto' em vez de a resposta morrer numa fila que
  // ninguém mais olha. 'em_andamento' é preservado — o suporte já está nele.
  const nextStatus = ticket.status === "em_andamento" ? "em_andamento" : "aberto";

  await inTransaction(async (client) => {
    await client.query(
      `INSERT INTO platform.support_messages (ticket_id, author_side, author_name, body)
       VALUES ($1, 'clinica', $2, $3)`,
      [id, user?.name || "", finalBody]
    );
    await client.query(
      `UPDATE platform.support_tickets
          SET status = $1, last_clinic_message_at = now(), updated_at = now(), closed_at = NULL
        WHERE id = $2`,
      [nextStatus, id]
    );
  });
  // A releitura fica FORA da transação de propósito: ela usa outro client do
  // pool e, antes do COMMIT, enxergaria o chamado sem a mensagem recém-inserida.
  return getTenantTicket(tenantId, id);
}

// Fechar é uma rota própria, e não um PATCH de status: assim a clínica não tem
// nenhum caminho para escrever um status arbitrário (marcar como 'resolvido' o
// que o suporte não resolveu, por exemplo).
export async function closeTicketAsTenant(tenantId, ticketId) {
  const id = assertTicketId(ticketId);
  const updated = await query(
    `UPDATE platform.support_tickets
        SET status = 'fechado', closed_at = now(), updated_at = now()
      WHERE id = $1 AND tenant_id = $2 AND status <> 'fechado'
      RETURNING id`,
    [id, tenantId]
  );
  if (!updated.rows[0]) {
    // Já fechado e inexistente caem no mesmo 404 de propósito: distinguir os
    // dois diria a uma clínica que o id existe em outra.
    const exists = await query(
      "SELECT status FROM platform.support_tickets WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );
    if (!exists.rows[0]) throw new SupportError("Chamado não encontrado.", 404);
    throw new SupportError("Este chamado já está fechado.", 409);
  }
  return getTenantTicket(tenantId, id);
}

// ---------------------------------------------------------------------------
// Lado da plataforma (super-admin)
// ---------------------------------------------------------------------------

export async function listAllTickets({ status = "", tenantId = null, search = "", limit = 50, offset = 0, paginated = false } = {}) {
  const params = [];
  const clauses = [];

  // "abertos" é um filtro AGREGADO, não um status do banco: é a pergunta que a
  // fila do suporte realmente faz ("o que ainda depende de alguém?") e que
  // nenhum status sozinho responde. Status desconhecido é ignorado em silêncio
  // — devolver a fila inteira é melhor do que uma lista vazia inexplicável.
  if (status === "abertos") {
    params.push(OPEN_STATUSES);
    clauses.push(`t.status = ANY($${params.length})`);
  } else if (status && TICKET_STATUSES.includes(status)) {
    params.push(status);
    clauses.push(`t.status = $${params.length}`);
  }
  const numericTenant = Number(tenantId);
  if (Number.isInteger(numericTenant) && numericTenant > 0) {
    params.push(numericTenant);
    clauses.push(`t.tenant_id = $${params.length}`);
  }
  const term = trimmedText(search);
  if (term) {
    // ILIKE com o termo como PARÂMETRO: o `%` entra na string do parâmetro, não
    // na SQL, então nada do que o super-admin digitar é interpretado como
    // consulta.
    params.push(`%${term}%`);
    clauses.push(
      `(t.subject ILIKE $${params.length} OR t.opened_by_name ILIKE $${params.length}
        OR t.opened_by_email ILIKE $${params.length} OR c.name ILIKE $${params.length}
        OR c.slug ILIKE $${params.length})`
    );
  }

  const from = "platform.support_tickets t JOIN platform.tenants c ON c.id = t.tenant_id";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const rows = await query(
    `SELECT ${TICKET_COLUMNS}, c.name AS tenant_name, c.slug AS tenant_slug,
            (SELECT COUNT(*) FROM platform.support_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM ${from}
       ${where}
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  if (!paginated) return { rows: rows.rows, total: rows.rows.length };
  const counted = await query(`SELECT COUNT(*)::int AS total FROM ${from} ${where}`, params);
  return { rows: rows.rows, total: counted.rows[0]?.total || 0 };
}

// A leitura do suporte devolve TODAS as mensagens, inclusive as notas internas.
// É a única função que faz isso, e ela só é alcançável por rota com token de
// plataforma.
export async function getPlatformTicket(ticketId) {
  const id = assertTicketId(ticketId);
  const ticket = await query(
    `SELECT ${TICKET_COLUMNS}, c.name AS tenant_name, c.slug AS tenant_slug
       FROM platform.support_tickets t
       JOIN platform.tenants c ON c.id = t.tenant_id
      WHERE t.id = $1`,
    [id]
  );
  if (!ticket.rows[0]) throw new SupportError("Chamado não encontrado.", 404);

  const messages = await query(
    `SELECT id, ticket_id, author_side, author_name, body, internal_note, created_at
       FROM platform.support_messages
      WHERE ticket_id = $1
      ORDER BY created_at, id`,
    [id]
  );
  return { ...ticket.rows[0], messages: messages.rows };
}

export async function replyAsSupport(ticketId, { authorName, body, internalNote = false }) {
  const id = assertTicketId(ticketId);
  const finalBody = assertBody(body);
  const isNote = internalNote === true || internalNote === "true";

  const found = await query("SELECT id, status FROM platform.support_tickets WHERE id = $1", [id]);
  const ticket = found.rows[0];
  if (!ticket) throw new SupportError("Chamado não encontrado.", 404);
  if (ticket.status === "fechado") {
    throw new SupportError("Este chamado está fechado. Reabra-o (mudando o status) antes de responder.", 409);
  }

  await inTransaction(async (client) => {
    await client.query(
      `INSERT INTO platform.support_messages (ticket_id, author_side, author_name, body, internal_note)
       VALUES ($1, 'suporte', $2, $3, $4)`,
      [id, authorName || "Suporte Monitence", finalBody, isNote]
    );
    // Nota interna NÃO mexe em `last_support_message_at` nem no status: para a
    // clínica, nada aconteceu — e é justamente isso que ela é. Marcar o chamado
    // como respondido por causa de uma anotação faria a clínica ver "respondido"
    // sem resposta alguma.
    if (!isNote) {
      await client.query(
        `UPDATE platform.support_tickets
            SET status = CASE WHEN status = 'aberto' THEN 'aguardando_cliente' ELSE status END,
                last_support_message_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [id]
      );
    } else {
      await client.query("UPDATE platform.support_tickets SET updated_at = now() WHERE id = $1", [id]);
    }
  });
  return getPlatformTicket(id);
}

export async function updateTicketAsSupport(ticketId, { status, priority }) {
  const id = assertTicketId(ticketId);
  const nextStatus = trimmedText(status);
  const nextPriority = trimmedText(priority);

  if (nextStatus && !TICKET_STATUSES.includes(nextStatus)) {
    throw new SupportError(`Status inválido. Use um de: ${TICKET_STATUSES.join(", ")}.`);
  }
  if (nextPriority && !TICKET_PRIORITIES.includes(nextPriority)) {
    throw new SupportError(`Prioridade inválida. Use uma de: ${TICKET_PRIORITIES.join(", ")}.`);
  }
  if (!nextStatus && !nextPriority) {
    throw new SupportError("Informe o status ou a prioridade a alterar.");
  }

  const updated = await query(
    `UPDATE platform.support_tickets
        SET status = COALESCE($1::text, status),
            priority = COALESCE($2::text, priority),
            -- A data de fechamento acompanha o status em vez de virar campo
            -- solto: reabrir um chamado sem limpá-la deixaria a lista dizendo
            -- que ele foi fechado numa data e continua aberto.
            closed_at = CASE
              WHEN $1::text = 'fechado' THEN COALESCE(closed_at, now())
              WHEN $1::text IS NULL THEN closed_at
              ELSE NULL
            END,
            updated_at = now()
      WHERE id = $3
      RETURNING id`,
    [nextStatus || null, nextPriority || null, id]
  );
  if (!updated.rows[0]) throw new SupportError("Chamado não encontrado.", 404);
  return getPlatformTicket(id);
}

// Contador do badge do painel. Uma consulta agregada só, porque o painel a
// chama em toda abertura: trazer a lista para contar no cliente cresceria com a
// base inteira.
export async function countOpenTickets() {
  const result = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = ANY($1))::int AS open,
       COUNT(*) FILTER (WHERE status = 'aberto')::int AS untouched,
       COUNT(*)::int AS total
     FROM platform.support_tickets`,
    [OPEN_STATUSES]
  );
  return result.rows[0] || { open: 0, untouched: 0, total: 0 };
}
