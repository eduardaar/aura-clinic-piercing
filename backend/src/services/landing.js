// Conteúdo editável da landing (a página pública da plataforma, em "/").
//
// O super-admin controla texto, imagens, ordem e ligado/desligado de cada
// bloco. O LAYOUT de cada bloco continua sendo código React — o editor não
// inventa estrutura, e é isso que impede a página de ser quebrada pelo painel.
import { pool, query } from "../database/connection.js";

// Os blocos que o React sabe renderizar. Uma chave fora desta lista não tem
// componente correspondente e viraria um buraco na página, então é recusada na
// escrita — mesmo que alguém a insira direto no banco, a leitura a ignora.
export const SECTION_KEYS = [
  "hero",
  "features",
  "about",
  "carousel",
  "plans",
  "showcase_links",
  "closing"
];

// Cache curto. A landing é a página mais acessada da plataforma e o conteúdo
// muda raramente (alguém editando no painel), então repetir a query a cada
// visita é desperdício. 60s é o bastante para o super-admin ver o efeito da
// edição quase na hora — e a escrita invalida o cache de qualquer forma.
const CACHE_TTL_MS = 60 * 1000;
let cache = null;

export function invalidateLandingCache() {
  cache = null;
}

// Blocos ordenados. `onlyEnabled` separa as duas audiências: a página pública
// recebe só o que está ligado; o editor precisa ver TUDO, senão um bloco
// desligado sumiria do painel e não haveria como religá-lo.
export async function listLandingSections({ onlyEnabled = true } = {}) {
  if (onlyEnabled && cache && cache.expiresAt > Date.now()) return cache.value;

  const result = await query(
    `SELECT section_key, enabled, sort_order, content, updated_at
       FROM platform.landing_sections
      ORDER BY sort_order, section_key`
  );
  const rows = result.rows
    .filter((row) => SECTION_KEYS.includes(row.section_key))
    .filter((row) => (onlyEnabled ? row.enabled : true));

  if (onlyEnabled) cache = { value: rows, expiresAt: Date.now() + CACHE_TTL_MS };
  return rows;
}

export class LandingError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "LandingError";
    this.statusCode = statusCode;
  }
}

// Teto de tamanho do JSON de um bloco.
//
// O conteúdo vem do painel e vai para JSONB sem esquema rígido — sem um limite,
// um paste acidental (ou uma imagem em base64 no lugar de uma URL) entraria
// inteiro no banco e depois seria servido a cada visita da landing.
const MAX_CONTENT_BYTES = 64 * 1024;

// Aceita apenas caminho relativo do próprio servidor ou URL http(s).
//
// Recusar `javascript:` e `data:` importa porque estes valores vão para `src`
// de <img> e `href` de <a> na página pública: um `javascript:` num href é XSS
// armazenado, disparado em quem visitar a landing.
function assertSafeUrls(value, path = "content") {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\s*(javascript|data|vbscript):/i.test(trimmed)) {
      throw new LandingError(
        `Endereço não permitido em "${path}". Use um caminho do site (/algo) ou um endereço http(s).`
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertSafeUrls(item, `${path}[${index}]`);
    });
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) assertSafeUrls(inner, `${path}.${key}`);
  }
}

export async function updateLandingSection(sectionKey, { content, enabled, userId }) {
  if (!SECTION_KEYS.includes(sectionKey)) {
    throw new LandingError(`Bloco desconhecido: ${sectionKey}.`, 404);
  }
  if (content !== undefined) {
    if (!content || typeof content !== "object" || Array.isArray(content)) {
      throw new LandingError("O conteúdo do bloco deve ser um objeto.");
    }
    const serialized = JSON.stringify(content);
    if (Buffer.byteLength(serialized, "utf8") > MAX_CONTENT_BYTES) {
      throw new LandingError("Conteúdo do bloco grande demais. Envie a imagem como arquivo, não colada no texto.");
    }
    assertSafeUrls(content);
  }

  // COALESCE preserva o campo que não veio: o painel salva um bloco por vez, e
  // alternar o interruptor não pode zerar o conteúdo (nem o contrário).
  const result = await query(
    `UPDATE platform.landing_sections
        SET content = COALESCE($1::jsonb, content),
            enabled = COALESCE($2::boolean, enabled),
            updated_at = now(),
            updated_by = $3
      WHERE section_key = $4
      RETURNING section_key, enabled, sort_order, content, updated_at`,
    [
      content === undefined ? null : JSON.stringify(content),
      enabled === undefined ? null : Boolean(enabled),
      userId ?? null,
      sectionKey
    ]
  );
  if (!result.rows[0]) throw new LandingError("Bloco não encontrado.", 404);

  invalidateLandingCache();
  return result.rows[0];
}

// Reordena a partir da lista de chaves na ordem desejada.
//
// Numa transação só: uma reordenação aplicada pela metade deixaria a página com
// blocos fora de ordem — visível para todo visitante, e sem nada indicando o
// que aconteceu.
export async function reorderLandingSections(keys, userId = null) {
  if (!Array.isArray(keys) || !keys.length) {
    throw new LandingError("Envie a lista de blocos na ordem desejada.");
  }
  const desconhecido = keys.find((key) => !SECTION_KEYS.includes(key));
  if (desconhecido) throw new LandingError(`Bloco desconhecido: ${desconhecido}.`, 404);
  if (new Set(keys).size !== keys.length) {
    throw new LandingError("A lista tem blocos repetidos.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [index, key] of keys.entries()) {
      await client.query(
        `UPDATE platform.landing_sections
            SET sort_order = $1, updated_at = now(), updated_by = $2
          WHERE section_key = $3`,
        // Passo de 10 para caber inserção manual entre dois blocos sem
        // renumerar tudo.
        [(index + 1) * 10, userId, key]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  invalidateLandingCache();
  return listLandingSections({ onlyEnabled: false });
}
