import { query } from "../database/connection.js";
import {
  CONTENT_TYPES,
  ContentHubError,
  articleSlug,
  compactContentText,
  normalizeArticlePayload,
} from "./contentValidation.js";

export { ContentHubError } from "./contentValidation.js";

const ARTICLE_SELECT = `
  id, content_type, slug, title, summary, content, category, status,
  sort_order, version, published_at, created_at, updated_at
`;

export async function listPublishedArticles(contentType, { limit = 100 } = {}) {
  if (!CONTENT_TYPES.has(contentType)) throw new ContentHubError("Tipo de conteúdo inválido.");
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 100));
  const orderBy = contentType === "manual" ? "sort_order ASC, title ASC" : "published_at DESC NULLS LAST, id DESC";
  const result = await query(
    `SELECT ${ARTICLE_SELECT}
       FROM platform.content_articles
      WHERE content_type = $1 AND status = 'published'
      ORDER BY ${orderBy}
      LIMIT $2`,
    [contentType, safeLimit],
  );
  return result.rows;
}

export async function getPublishedArticle(contentType, slug) {
  if (!CONTENT_TYPES.has(contentType)) throw new ContentHubError("Tipo de conteúdo inválido.");
  const result = await query(
    `SELECT ${ARTICLE_SELECT}
       FROM platform.content_articles
      WHERE content_type = $1 AND slug = $2 AND status = 'published'`,
    [contentType, articleSlug(slug)],
  );
  if (!result.rows[0]) throw new ContentHubError("Publicação não encontrada.", 404);
  return result.rows[0];
}

export async function listAdminArticles(contentType = "") {
  const normalizedType = compactContentText(contentType).toLowerCase();
  if (normalizedType && !CONTENT_TYPES.has(normalizedType)) throw new ContentHubError("Tipo de conteúdo inválido.");
  const result = await query(
    `SELECT ${ARTICLE_SELECT}
       FROM platform.content_articles
      WHERE ($1 = '' OR content_type = $1)
      ORDER BY content_type, sort_order, updated_at DESC`,
    [normalizedType],
  );
  return result.rows;
}

export async function createArticle(body, userId = null) {
  const article = normalizeArticlePayload(body);
  try {
    const result = await query(
      `INSERT INTO platform.content_articles
        (content_type, slug, title, summary, content, category, status, sort_order, published_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
         CASE WHEN $7 = 'published' THEN now() ELSE NULL END, $9)
       RETURNING ${ARTICLE_SELECT}`,
      [
        article.content_type,
        article.slug,
        article.title,
        article.summary,
        article.content,
        article.category,
        article.status,
        article.sort_order,
        userId,
      ],
    );
    return result.rows[0];
  } catch (error) {
    if (error?.code === "23505") throw new ContentHubError("Já existe uma publicação com este endereço.", 409);
    throw error;
  }
}

export async function updateArticle(id, body, userId = null) {
  const currentResult = await query("SELECT * FROM platform.content_articles WHERE id = $1", [id]);
  const current = currentResult.rows[0];
  if (!current) throw new ContentHubError("Publicação não encontrada.", 404);
  const article = normalizeArticlePayload(body, current);
  try {
    const result = await query(
      `UPDATE platform.content_articles
          SET content_type = $1, slug = $2, title = $3, summary = $4,
              content = $5, category = $6, status = $7, sort_order = $8,
              version = version + 1,
              published_at = CASE
                WHEN $7 = 'published' THEN COALESCE(published_at, now())
                ELSE published_at
              END,
              updated_at = now(), updated_by = $9
        WHERE id = $10
        RETURNING ${ARTICLE_SELECT}`,
      [
        article.content_type,
        article.slug,
        article.title,
        article.summary,
        article.content,
        article.category,
        article.status,
        article.sort_order,
        userId,
        id,
      ],
    );
    return result.rows[0];
  } catch (error) {
    if (error?.code === "23505") throw new ContentHubError("Já existe uma publicação com este endereço.", 409);
    throw error;
  }
}

export async function archiveArticle(id, userId = null) {
  const result = await query(
    `UPDATE platform.content_articles
        SET status = 'archived', version = version + 1, updated_at = now(), updated_by = $1
      WHERE id = $2
      RETURNING ${ARTICLE_SELECT}`,
    [userId, id],
  );
  if (!result.rows[0]) throw new ContentHubError("Publicação não encontrada.", 404);
  return result.rows[0];
}
