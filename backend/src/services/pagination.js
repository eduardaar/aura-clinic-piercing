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

// --- Contrato de paginação -------------------------------------------------
//
// Estes typedefs são a fonte da verdade do envelope que o frontend consome.
// Quem mexer aqui muda o contrato de ~20 telas: mantenha os nomes dos campos.

/**
 * Estado de paginação resolvido a partir da query string.
 * @typedef {object} Paging
 * @property {boolean} paginated Cliente pediu página? (mandou `limit` ou `offset`)
 * @property {number} limit Tamanho da página já normalizado (1..maxLimit).
 * @property {number} offset Deslocamento já normalizado (>= 0).
 * @property {string} orderBy Trecho "ORDER BY …" pronto, ou "" quando não há ordenação.
 */

/**
 * Opções de leitura da query string.
 * @typedef {object} ParsePagingOptions
 * @property {number} [defaultLimit] Página padrão quando o cliente não manda `limit`.
 * @property {number} [maxLimit] Teto do `limit`, para o cliente não pedir a base inteira.
 * @property {Record<string, string>} [sortable] Whitelist chave-de-consulta -> coluna SQL.
 * @property {string} [tieBreak] Coluna de desempate, para páginas estáveis.
 * @property {string} [defaultOrderBy] "ORDER BY …" usado quando `sort` é inválido/ausente.
 */

/**
 * Envelope devolvido ao cliente QUANDO paginado.
 * É este o formato que o frontend deve esperar em `/clients`, `/sales`,
 * `/appointments` e `/jewelry` sempre que enviar `limit` ou `offset`.
 * @template T
 * @typedef {object} PagedResponse
 * @property {T[]} items Linhas da página atual.
 * @property {number} total Total de linhas QUE PASSAM NOS FILTROS (não é o total da tabela).
 * @property {number} limit Tamanho de página efetivamente aplicado.
 * @property {number} offset Deslocamento efetivamente aplicado.
 */

/**
 * Resultado interno de uma consulta paginada (antes de virar envelope).
 * @template T
 * @typedef {{ rows: T[], total: number }} PageResult
 */

/**
 * Superfície mínima do adaptador de banco usada aqui (ver src/db/postgres.js).
 * Declarada por estrutura de propósito: paginação não precisa conhecer o
 * adaptador inteiro, só saber ler linhas.
 * @typedef {object} PagingDb
 * @property {(sql: string, params?: unknown[]) => Promise<any[]>} all
 * @property {(sql: string, params?: unknown[]) => Promise<any>} get
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function toInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPresent(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

// `sort` chega como "campo:asc|desc". O campo nunca vai para a SQL: serve só
// para procurar a coluna no whitelist `sortable`. Chave desconhecida (ou
// tentativa de injeção) cai silenciosamente na ordenação padrão.
/**
 * @param {unknown} rawSort "campo:asc|desc" vindo da query string.
 * @param {Record<string, string>} sortable Whitelist chave -> coluna SQL.
 * @param {string} tieBreak Coluna de desempate (ou "").
 * @param {string} fallback "ORDER BY …" usado quando a chave não está na whitelist.
 * @returns {string}
 */
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
/**
 * @param {Record<string, any>} [query] `req.query` do Express.
 * @param {ParsePagingOptions} [options]
 * @returns {Paging}
 */
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
/**
 * @param {Paging} [paging]
 * @returns {{ clause: string, params: number[] }}
 */
export function limitOffset(paging) {
  return paging?.paginated
    ? { clause: " LIMIT ? OFFSET ?", params: [paging.limit, paging.offset] }
    : { clause: "", params: [] };
}

// Executa a página e, quando paginado, o COUNT(*) com EXATAMENTE o mesmo
// FROM/WHERE (sem LIMIT/OFFSET) — é isso que faz `total` respeitar os filtros.
/**
 * @param {PagingDb} db
 * @param {object} query
 * @param {string} query.select Lista de colunas (escrita pelo servidor, nunca pelo cliente).
 * @param {string} query.from FROM + JOINs.
 * @param {string} [query.where] "WHERE …" já montado com placeholders `?`.
 * @param {unknown[]} [query.params] Params do WHERE, na ordem dos `?`.
 * @param {string} [query.orderBy] "ORDER BY …" (use `paging.orderBy`).
 * @param {Paging} [query.paging]
 * @returns {Promise<PageResult<any>>}
 */
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
/**
 * @param {PagingDb} db
 * @param {{ from: string, where?: string, params?: unknown[] }} query
 * @returns {Promise<number>}
 */
export async function countRows(db, { from, where = "", params = [] }) {
  const counted = await db.get(`SELECT COUNT(*) AS total FROM ${from} ${where}`, params);
  return Number(counted?.total || 0);
}

// Envelope quando paginado; array puro caso contrário.
//
// O tipo de retorno é união DE PROPÓSITO: é a retrocompatibilidade descrita no
// topo do arquivo. No frontend, leia sempre de forma tolerante aos dois
// formatos — o padrão da casa é `asArray(asObject(payload).items)` combinado
// com `asArray(payload)` (ver frontend/src/lib/utils.js) — em vez de assumir um
// deles. A união aqui é o lembrete de que assumir quebra a outra metade.
/**
 * @template T
 * @param {T[]} items
 * @param {number} total
 * @param {Paging} [paging]
 * @returns {PagedResponse<T> | T[]}
 */
export function pageResponse(items, total, paging) {
  return paging?.paginated ? { items, total, limit: paging.limit, offset: paging.offset } : items;
}
