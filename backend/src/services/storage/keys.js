// Convenção de CHAVES do object storage — a fonte da verdade, e a única.
//
// Este arquivo existe separado do resto da camada de storage por um motivo
// prático: o script de migração (que sobe o que já está no disco para o R2)
// importa daqui. Se a convenção fosse reescrita à mão lá, o dia em que as duas
// versões divergirem é o dia em que um arquivo some — gravado numa chave e
// procurado em outra.
//
//   BUCKET PÚBLICO   tenant_<id>/<categoria>/<arquivo>
//                    plataforma/<categoria>/<arquivo>   (landing da Monitence)
//   BUCKET PRIVADO   tenant_<id>/<pasta>/<arquivo>      (pasta vem do purpose)
//                    orfaos/<arquivo>                   (sem dono identificável)
//
// `<id>` é o id INTEIRO do tenant (`req.tenant.id`), o mesmo que nomeia o schema
// Postgres. Nunca o slug: o slug pode ser trocado pela clínica e levaria embora
// o caminho de todos os arquivos dela.

// Categorias aceitas no bucket público. Lista fechada de propósito: categoria
// livre vira lixeira ("img", "imgs", "images") e ninguém mais acha nada.
export const PUBLIC_CATEGORIES = ["joias", "catalogo", "catalog", "banners", "logo", "landing", "geral"];
export const DEFAULT_PUBLIC_CATEGORY = "geral";

// Prefixos de quem não é clínica.
export const PLATFORM_PREFIX = "plataforma";
export const ORPHAN_PREFIX = "orfaos";

// De `private_files.purpose` para a pasta do bucket privado.
//
// A regra geral é "pasta = purpose". A exceção é o termo digital: o purpose
// gravado no banco desde sempre é `digital_term`, mas a pasta combinada é
// `termos`. O apelido mora AQUI, num mapa, para que quem grava (services/terms)
// quem lê (GET /api/private-files) e o script de migração cheguem os três à
// mesma chave. Acrescentar apelido novo é acrescentar linha neste objeto.
const PURPOSE_FOLDERS = {
  digital_term: "termos"
};

export const DEFAULT_PRIVATE_FOLDER = "geral";

/** Pasta do bucket privado correspondente a um `private_files.purpose`. */
export function folderForPurpose(purpose) {
  const normalized = sanitizeSegment(purpose);
  if (!normalized) return DEFAULT_PRIVATE_FOLDER;
  return PURPOSE_FOLDERS[normalized] || normalized;
}

/** Prefixo do tenant: `tenant_<id>`. Devolve "" se o id não for um inteiro. */
export function tenantPrefix(tenantId) {
  const id = Number(tenantId);
  if (!Number.isInteger(id) || id <= 0) return "";
  return `tenant_${id}`;
}

// Segmento de caminho (categoria/pasta): minúsculas, dígitos, hífen e
// underscore. Qualquer outra coisa vira hífen — inclusive `/` e `..`, que é o
// que impede um purpose vindo do banco de escapar do prefixo do tenant.
function sanitizeSegment(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Nome de arquivo seguro para virar o último segmento da chave.
 * Descarta qualquer caminho (`../`, `C:\`) e mantém só `[A-Za-z0-9._-]`.
 */
export function sanitizeFilename(value) {
  const base = String(value ?? "")
    .split(/[/\\]/)
    .filter(Boolean)
    .pop() || "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "");
  return cleaned.slice(0, 180);
}

/**
 * Monta a chave completa do objeto. É esta função que o script de migração
 * importa — nenhum outro ponto do sistema pode concatenar a chave à mão.
 *
 * @param {object} params
 * @param {"public"|"private"} params.scope  bucket de destino
 * @param {number|null} [params.tenantId]    id inteiro do tenant; ausente cai
 *   em `plataforma/` (público) ou `orfaos/` (privado)
 * @param {string} [params.category]         só no público (ver PUBLIC_CATEGORIES)
 * @param {string} [params.purpose]          só no privado (private_files.purpose)
 * @param {string} params.filename           nome do arquivo já gerado
 * @returns {string} chave, ex.: `tenant_7/termos/termo-digital-3.pdf`
 */
export function buildKey({ scope, tenantId = null, category = null, purpose = null, filename }) {
  const safeName = sanitizeFilename(filename);
  if (!safeName) throw new Error("Nome de arquivo inválido para a chave de storage.");
  const prefix = tenantPrefix(tenantId);

  if (scope === "private") {
    // Sem tenant identificável o arquivo não pode ser enfiado no prefixo de
    // clínica nenhuma: vai para `orfaos/`, onde é visível como pendência.
    if (!prefix) return `${ORPHAN_PREFIX}/${safeName}`;
    return `${prefix}/${folderForPurpose(purpose)}/${safeName}`;
  }

  if (scope === "public") {
    const normalized = sanitizeSegment(category) || DEFAULT_PUBLIC_CATEGORY;
    const folder = PUBLIC_CATEGORIES.includes(normalized) ? normalized : DEFAULT_PUBLIC_CATEGORY;
    // Sem tenant, é imagem da própria Monitence (landing) — não de clínica.
    return `${prefix || PLATFORM_PREFIX}/${folder}/${safeName}`;
  }

  throw new Error(`Escopo de storage desconhecido: ${scope}`);
}
