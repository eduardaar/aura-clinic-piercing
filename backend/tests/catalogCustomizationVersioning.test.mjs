import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";

const context = {};

function api(path, options = {}) {
  return req(path, { tenant: context.slug, token: context.token, ...options });
}

before(async () => {
  Object.assign(context, await createTenant("catalog-builder"));
  context.platformToken = await platformLogin();
  context.token = (await loginTenant(context.slug, context.adminEmail, context.adminPassword)).token;
  const plan = await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } });
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
});

after(async () => {
  if (context.tenant?.id) await deleteTenant(context.platformToken, context.tenant.id, context.slug);
});

test("catalog builder mantém draft fora do público, publica snapshot, cria histórico e rollback imutável", async () => {
  const beforePublic = await req("/catalog", { tenant: context.slug });
  assert.equal(beforePublic.status, 200, JSON.stringify(beforePublic.json));
  assert.ok(Array.isArray(beforePublic.json.catalogSections), "GET público sempre entrega catalogSections");

  const initialDraft = await api("/catalog-customization");
  assert.equal(initialDraft.status, 200, JSON.stringify(initialDraft.json));
  assert.equal(initialDraft.json.version.draft, 0);

  const draftTitle = "Rascunho isolado do catálogo";
  const firstSave = await api("/catalog-customization", {
    method: "PATCH",
    body: {
      expected_draft_version: initialDraft.json.version.draft,
      settings: { title: draftTitle },
      catalogSections: [{ section_key: "hero-1", section_type: "hero", title: "Hero em rascunho", is_active: true, sort_order: 1 }]
    }
  });
  assert.equal(firstSave.status, 200, JSON.stringify(firstSave.json));
  assert.equal(firstSave.json.version.draft, 1);
  assert.equal(firstSave.json.settings.title, draftTitle);

  const stillPublic = await req("/catalog", { tenant: context.slug });
  assert.equal(stillPublic.status, 200, JSON.stringify(stillPublic.json));
  assert.equal(stillPublic.json.title, beforePublic.json.title, "PATCH não pode alterar a vitrine publicada");
  assert.notEqual(stillPublic.json.catalogSections[0]?.title, "Hero em rascunho");

  const published = await api("/catalog-customization/publish", {
    method: "POST",
    body: { expected_draft_version: firstSave.json.version.draft }
  });
  assert.equal(published.status, 200, JSON.stringify(published.json));
  assert.equal(published.json.revision.version, 1);
  assert.equal(published.json.version.published, 1);
  assert.equal(published.json.checklist.ready, true, JSON.stringify(published.json.checklist));

  const publishedPublic = await req("/catalog", { tenant: context.slug });
  assert.equal(publishedPublic.status, 200, JSON.stringify(publishedPublic.json));
  assert.equal(publishedPublic.json.title, draftTitle);
  assert.equal(publishedPublic.json.catalogSections[0].title, "Hero em rascunho");
  assert.equal(publishedPublic.json.version.published, 1);

  const secondSave = await api("/catalog-customization", {
    method: "PATCH",
    body: { expected_draft_version: published.json.version.draft, settings: { title: "Segundo rascunho" } }
  });
  assert.equal(secondSave.status, 200, JSON.stringify(secondSave.json));
  assert.equal(secondSave.json.version.draft, 2);

  const conflict = await api("/catalog-customization", {
    method: "PATCH",
    body: { expected_draft_version: 1, settings: { title: "Não deve salvar" } }
  });
  assert.equal(conflict.status, 409, JSON.stringify(conflict.json));
  assert.equal(conflict.json.code, "catalog_version_conflict");

  const publicAfterSecondDraft = await req("/catalog", { tenant: context.slug });
  assert.equal(publicAfterSecondDraft.json.title, draftTitle, "novo draft continua isolado da vitrine");

  const history = await api("/catalog-customization/history");
  assert.equal(history.status, 200, JSON.stringify(history.json));
  assert.equal(history.json.revisions.length, 1);
  assert.equal(history.json.revisions[0].version, 1);
  const revision = await api("/catalog-customization/history/1");
  assert.equal(revision.status, 200, JSON.stringify(revision.json));
  assert.equal(revision.json.revision.snapshot.settings.title, draftTitle);

  const rollback = await api("/catalog-customization/rollback/1", {
    method: "POST",
    body: {
      expected_draft_version: secondSave.json.version.draft,
      expected_published_version: 1
    }
  });
  assert.equal(rollback.status, 200, JSON.stringify(rollback.json));
  assert.equal(rollback.json.restored_from_version, 1);
  assert.equal(rollback.json.revision.action, "rollback");
  assert.equal(rollback.json.revision.version, 2);

  const afterRollback = await req("/catalog", { tenant: context.slug });
  assert.equal(afterRollback.status, 200, JSON.stringify(afterRollback.json));
  assert.equal(afterRollback.json.title, draftTitle);
  assert.equal(afterRollback.json.version.published, 2);
});

test("checklist do catálogo é autenticado e impede publicar rascunho inseguro", async () => {
  const anonymous = await req("/catalog-customization/checklist", { tenant: context.slug });
  assert.equal(anonymous.status, 401, JSON.stringify(anonymous.json));

  const current = await api("/catalog-customization");
  assert.equal(current.status, 200, JSON.stringify(current.json));

  const saved = await api("/catalog-customization", {
    method: "PATCH",
    body: {
      expected_draft_version: current.json.version.draft,
      banners: [{
        title: "Banner inseguro",
        image_url: "javascript:alert(1)",
        button_link: "data:text/html,alert(1)",
        is_active: true,
        sort_order: 1
      }],
      settings: {
        content_sections: [{ media_type: "video", media_url: "https://evil.example/embed/123" }]
      },
      catalogSections: [{ section_key: "codigo-1", section_type: "codigo-terceiro", sort_order: 1 }]
    }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));

  const checklist = await api("/catalog-customization/checklist");
  assert.equal(checklist.status, 200, JSON.stringify(checklist.json));
  assert.equal(checklist.json.checklist.ready, false);
  const codes = checklist.json.checklist.errors.map((item) => item.code);
  assert.ok(codes.includes("unsafe_banner_url"));
  assert.ok(codes.includes("unsafe_cta_url"));
  assert.ok(codes.includes("unallowed_catalog_embed"));
  assert.ok(codes.includes("unknown_catalog_block"));

  const blocked = await api("/catalog-customization/publish", {
    method: "POST",
    body: { expected_draft_version: saved.json.version.draft }
  });
  assert.equal(blocked.status, 422, JSON.stringify(blocked.json));
  assert.equal(blocked.json.code, "catalog_publish_blocked");
  assert.equal(blocked.json.checklist.ready, false);

  const history = await api("/catalog-customization/history");
  assert.equal(history.status, 200, JSON.stringify(history.json));
  assert.equal(history.json.revisions.length, 2, "publicação bloqueada não pode criar revisão");
});

test("integrações nativas ficam no draft, publicam junto da revisão e rejeitam código arbitrário", async () => {
  const current = await api("/catalog-customization");
  assert.equal(current.status, 200, JSON.stringify(current.json));

  const plugins = [{
    id: "whatsapp-principal",
    pluginId: "whatsapp_cta",
    enabled: true,
    config: {
      phone: "+55 (71) 99999-1111",
      label: "Falar com a equipe",
      message: "Olá! Vim pelo catálogo.",
      style: "outline"
    }
  }];
  const saved = await api("/catalog-customization", {
    method: "PATCH",
    body: {
      expected_draft_version: current.json.version.draft,
      plugins,
      banners: [{ image_url: "https://cdn.example.test/banner.webp", button_link: "/agendar", is_active: true, sort_order: 1 }],
      settings: { content_sections: [] },
      catalogSections: [{ section_key: "hero-1", section_type: "hero", sort_order: 1, is_active: true }]
    }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.plugins[0].config.phone, "5571999991111");

  const beforePublish = await req("/catalog", { tenant: context.slug });
  assert.equal(beforePublish.status, 200, JSON.stringify(beforePublish.json));
  assert.notEqual(beforePublish.json.plugins?.[0]?.id, "whatsapp-principal", "rascunho de plugin não pode vazar para o público");

  const published = await api("/catalog-customization/publish", {
    method: "POST",
    body: { expected_draft_version: saved.json.version.draft }
  });
  assert.equal(published.status, 200, JSON.stringify(published.json));

  const publicCatalog = await req("/catalog", { tenant: context.slug });
  assert.equal(publicCatalog.status, 200, JSON.stringify(publicCatalog.json));
  assert.equal(publicCatalog.json.plugins[0].id, "whatsapp-principal");
  assert.equal(publicCatalog.json.plugins[0].config.phone, "5571999991111");

  const invalid = await api("/catalog-customization", {
    method: "PATCH",
    body: {
      expected_draft_version: published.json.version.draft,
      plugins: [{ pluginId: "whatsapp_cta", config: { phone: "+55 71 99999-1111", html: "<script>alert(1)</script>" } }]
    }
  });
  assert.equal(invalid.status, 422, JSON.stringify(invalid.json));
  assert.equal(invalid.json.code, "catalog_plugins_invalid");
});

test("plugins ativos respeitam a cota do plano e Google Analytics exige Studio", async () => {
  const professional = await api("/subscription", { method: "PATCH", body: { plan_code: "profissional" } });
  assert.equal(professional.status, 200, JSON.stringify(professional.json));

  const current = await api("/catalog-customization");
  assert.equal(current.status, 200, JSON.stringify(current.json));
  const plugins = [
    { pluginId: "faq", config: { items: [{ question: "Como agendo?", answer: "Escolha seu horário pelo catálogo." }] } },
    { pluginId: "seo_metadata", config: { title: "Catálogo Aura", description: "Joias para piercing." } },
    { pluginId: "instagram_profile", config: { username: "aura.clinic" } }
  ];

  const blocked = await api("/catalog-customization", {
    method: "PATCH",
    body: { expected_draft_version: current.json.version.draft, plugins }
  });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.json));
  assert.equal(blocked.json.code, "catalog_plugin_limit_reached");
  assert.equal(blocked.json.limit_key, "catalog_plugins");
  assert.equal(blocked.json.limit, 2);
  assert.equal(blocked.json.used, 3);

  const twoActive = await api("/catalog-customization", {
    method: "PATCH",
    body: {
      expected_draft_version: current.json.version.draft,
      plugins: [...plugins.slice(0, 2), { ...plugins[2], enabled: false }]
    }
  });
  assert.equal(twoActive.status, 200, JSON.stringify(twoActive.json));

  const analyticsBlocked = await api("/catalog-customization", {
    method: "PATCH",
    body: {
      expected_draft_version: twoActive.json.version.draft,
      plugins: [{ pluginId: "google_analytics", config: { measurementId: "G-AB12CD34EF" } }]
    }
  });
  assert.equal(analyticsBlocked.status, 403, JSON.stringify(analyticsBlocked.json));
  assert.equal(analyticsBlocked.json.code, "catalog_plugin_feature_unavailable");

  const studio = await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } });
  assert.equal(studio.status, 200, JSON.stringify(studio.json));
  const analyticsSaved = await api("/catalog-customization", {
    method: "PATCH",
    body: {
      expected_draft_version: twoActive.json.version.draft,
      plugins: [{ pluginId: "google_analytics", config: { measurementId: "G-AB12CD34EF" } }]
    }
  });
  assert.equal(analyticsSaved.status, 200, JSON.stringify(analyticsSaved.json));
  assert.equal(analyticsSaved.json.plugins[0].config.measurementId, "G-AB12CD34EF");
});

test("biblioteca de mídia do catálogo exige sessão, registra asset e atualiza somente alt text", async () => {
  const anonymous = await req("/catalog-media", { tenant: context.slug });
  assert.equal(anonymous.status, 401, JSON.stringify(anonymous.json));

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "catalogo.png");
  const uploaded = await api("/catalog-media", { method: "POST", body: form });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.json));
  assert.match(uploaded.json.item.url, /^(?:\/uploads\/[^/]+|https:\/\/[^/]+\/.+)$/);
  assert.match(uploaded.json.item.storage_key, /^tenant_\d+\/catalog\//);

  const listed = await api("/catalog-media");
  assert.equal(listed.status, 200, JSON.stringify(listed.json));
  assert.ok(listed.json.items.some((item) => item.id === uploaded.json.item.id));

  const updated = await api(`/catalog-media/${uploaded.json.item.id}`, {
    method: "PATCH",
    body: { alt_text: "  Foto  da  joia  " }
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.item.alt_text, "Foto da joia");

  const invalidAlt = await api(`/catalog-media/${uploaded.json.item.id}`, {
    method: "PATCH",
    body: { alt_text: "<script>alert(1)</script>" }
  });
  assert.equal(invalidAlt.status, 422, JSON.stringify(invalidAlt.json));
  assert.equal(invalidAlt.json.code, "catalog_media_alt_text_invalid");
});
