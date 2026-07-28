// Fundação de paginação/filtro das listagens.
//
// Retrocompatibilidade é o ponto central: a resposta só vira o envelope
// { items, total, limit, offset } quando o cliente manda `limit` ou `offset`.
// Sem esses parâmetros devolvemos o array puro de sempre, para não quebrar os
// chamadores internos nem as telas que ainda consomem a lista inteira.
//
// Segurança: nada vindo do cliente é interpolado em SQL. `limit`/`offset`
// passam por Number() + clamp e viajam como placeholder; `sort` é apenas a
// CHAVE de consulta num mapa cujos valores (nomes de coluna) são escritos por
// nós no servidor.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function toInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function isPresent(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

// `sort` chega como "campo:asc|desc". O campo nunca vai para a SQL: serve só
// para procurar a coluna no whitelist `sortable`. Chave desconhecida (ou
// tentativa de injeção) cai silenciosamente na ordenação padrão.
function resolveOrderBy(rawSort, sortable, tieBreak, fallback) {
  const [field, direction] = String(rawSort || "").split(":");
  const column = Object.prototype.hasOwnProperty.call(sortable, field) ? sortable[field] : null;
  if (!column) return fallback;
  const dir = String(direction || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  // Desempate estável: sem ele duas páginas podem repetir ou pular linhas
  // quando a coluna ordenada tem valores iguais.
  return `ORDER BY ${column} ${dir}${tieBreak ? `, ${tieBreak} ${dir}` : ""}`;
}

// Lê os parâmetros de paginação/ordenação da query string.
export function parsePaging(query = {}, {
  defaultLimit = DEFAULT_LIMIT,
  maxLimit = MAX_LIMIT,
  sortable = {},
  tieBreak = "",
  defaultOrderBy = ""
} = {}) {
  return {
    paginated: isPresent(query.limit) || isPresent(query.offset),
    limit: Math.min(Math.max(toInt(query.limit, defaultLimit), 1), maxLimit),
    offset: Math.max(toInt(query.offset, 0), 0),
    orderBy: resolveOrderBy(query.sort, sortable, tieBreak, defaultOrderBy)
  };
}

// Trecho "LIMIT ? OFFSET ?" + seus params. O adaptador db troca cada `?` por
// $n POSICIONAL, então esses dois params precisam ser sempre os últimos.
export function limitOffset(paging) {
  return paging?.paginated
    ? { clause: " LIMIT ? OFFSET ?", params: [paging.limit, paging.offset] }
    : { clause: "", params: [] };
}

// Executa a página e, quando paginado, o COUNT(*) com EXATAMENTE o mesmo
// FROM/WHERE (sem LIMIT/OFFSET) — é isso que faz `total` respeitar os filtros.
export async function fetchPage(db, { select, from, where = "", params = [], orderBy = "", paging }) {
  const page = limitOffset(paging);
  const rows = await db.all(
    `SELECT ${select} FROM ${from} ${where} ${orderBy}${page.clause}`,
    [...params, ...page.params]
  );
  if (!paging?.paginated) return { rows, total: rows.length };
  const counted = await db.get(`SELECT COUNT(*) AS total FROM ${from} ${where}`, params);
  return { rows, total: Number(counted?.total || 0) };
}

// COUNT(*) avulso, para listagens que montam a SQL por conta própria.
export async function countRows(db, { from, where = "", params = [] }) {
  const counted = await db.get(`SELECT COUNT(*) AS total FROM ${from} ${where}`, params);
  return Number(counted?.total || 0);
}

// Envelope quando paginado; array puro caso contrário.
export function pageResponse(items, total, paging) {
  return paging?.paginated ? { items, total, limit: paging.limit, offset: paging.offset } : items;
}
