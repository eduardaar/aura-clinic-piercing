import assert from "node:assert/strict";
import test from "node:test";
import { ContentHubError, articleSlug, normalizeArticlePayload } from "../src/services/contentValidation.js";

test("normaliza publicação administrável como texto simples", () => {
  assert.equal(articleSlug("  Agenda e Pós-atendimento  "), "agenda-e-pos-atendimento");
  assert.deepEqual(
    normalizeArticlePayload({
      content_type: "manual",
      title: "  Primeiros   passos ",
      summary: "  Uma orientação objetiva. ",
      category: " Começar ",
      content: "Passo 1.\n\nPasso 2.",
      status: "published",
      sort_order: "20",
    }),
    {
      content_type: "manual",
      slug: "primeiros-passos",
      title: "Primeiros passos",
      summary: "Uma orientação objetiva.",
      category: "Começar",
      content: "Passo 1.\n\nPasso 2.",
      status: "published",
      sort_order: 20,
    },
  );
});

test("recusa tipo, status e conteúdo inválidos", () => {
  assert.throws(
    () => normalizeArticlePayload({ content_type: "banner", title: "X", content: "Y" }),
    (error) => error instanceof ContentHubError && /tipo/i.test(error.message),
  );
  assert.throws(
    () => normalizeArticlePayload({ content_type: "news", title: "X", content: "Y", status: "hidden" }),
    (error) => error instanceof ContentHubError && /status/i.test(error.message),
  );
  assert.throws(
    () => normalizeArticlePayload({ content_type: "news", title: "X", content: "" }),
    (error) => error instanceof ContentHubError && /conteúdo/i.test(error.message),
  );
});
