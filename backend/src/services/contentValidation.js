export const CONTENT_TYPES = new Set(["news", "manual"]);
const CONTENT_STATUSES = new Set(["draft", "published", "archived"]);

export class ContentHubError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ContentHubError";
    this.statusCode = statusCode;
  }
}

export function compactContentText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function articleSlug(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function normalizeArticlePayload(body = {}, current = {}) {
  const contentType = compactContentText(body.content_type ?? current.content_type).toLowerCase();
  const title = compactContentText(body.title ?? current.title);
  const slug = articleSlug(body.slug ?? current.slug ?? title);
  const summary = compactContentText(body.summary ?? current.summary);
  const content = String(body.content ?? current.content ?? "").trim();
  const category = compactContentText(body.category ?? current.category ?? "Geral") || "Geral";
  const status = compactContentText(body.status ?? current.status ?? "draft").toLowerCase();
  const numericSort = Number(body.sort_order ?? current.sort_order ?? 0);
  const sortOrder = Number.isInteger(numericSort) ? numericSort : 0;

  if (!CONTENT_TYPES.has(contentType)) throw new ContentHubError("Tipo de conteúdo inválido.");
  if (!CONTENT_STATUSES.has(status)) throw new ContentHubError("Status de publicação inválido.");
  if (!title) throw new ContentHubError("Informe o título.");
  if (!slug) throw new ContentHubError("Informe um endereço válido para o conteúdo.");
  if (!content) throw new ContentHubError("Informe o conteúdo da publicação.");
  if (title.length > 180 || slug.length > 120 || category.length > 80 || summary.length > 500) {
    throw new ContentHubError("Título, resumo, categoria ou endereço excede o tamanho permitido.");
  }
  if (content.length > 40000) throw new ContentHubError("O conteúdo excede o limite de 40.000 caracteres.");
  if (sortOrder < -10000 || sortOrder > 10000) throw new ContentHubError("A ordem deve ficar entre -10000 e 10000.");

  return {
    content_type: contentType,
    slug,
    title,
    summary,
    content,
    category,
    status,
    sort_order: sortOrder,
  };
}
