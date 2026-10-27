import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { req, createTenant, loginTenant, platformLogin, deleteTenant } from "./helpers.mjs";
import { campaignState, withCategoryPaths } from "../src/services/catalogCollections.js";

const ctx = { tokens: {} };
const PW = "SenhaForte123";

before(async () => {
  ctx.platformToken = await platformLogin();
  Object.assign(ctx, await createTenant("qa-vitrine"));
  ctx.tokens.admin = (await loginTenant(ctx.slug, ctx.adminEmail, ctx.adminPassword)).token;
  const plan = await api("/subscription", { method: "PATCH", body: { plan_code: "studio" } });
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
  for (const role of ["reception", "piercer"]) {
    const email = `${role}@${ctx.slug}.test`;
    const created = await api("/users", { method: "POST", body: { name: `Usuário ${role}`, email, password: PW, role } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    ctx.tokens[role] = (await loginTenant(ctx.slug, email, PW)).token;
  }
  ctx.products = [];
  for (const [name, quantity] of [["Topo Morcego Titânio", 4], ["Argola Segmento Titânio", 0], ["Labret Rosca Interna", 7]]) {
    const product = await api("/jewelry", { method: "POST", body: {
      name, category: "Topos", material: "Titânio", color: "Prata", quantity, cost_value: 10, sale_value: 80,
      is_catalog_active: true, is_published: true, virtual_store_active: true, can_sell: true, can_publish: true
    } });
    assert.equal(product.status, 201, JSON.stringify(product.json));
    ctx.products.push(product.json);
  }
});

after(async () => {
  if (ctx.tenant?.id) await deleteTenant(ctx.platformToken, ctx.tenant.id, ctx.slug);
  if (ctx.other?.tenant?.id) await deleteTenant(ctx.platformToken, ctx.other.tenant.id, ctx.other.slug);
});

function api(path, { as = "admin", ...options } = {}) {
  return req(path, { tenant: ctx.slug, token: ctx.tokens[as], ...options });
}

async function stockSnapshot() {
  const list = await api("/jewelry");
  const rows = (list.json.items || list.json).filter((item) => ctx.products.some((product) => product.id === item.id));
  assert.equal(rows.length, ctx.products.length, "o retrato do estoque precisa conter todos os produtos do teste");
  assert.ok(rows.every((item) => item.sku), "todos os produtos têm SKU");
  return rows.map((item) => [item.id, item.sku, Number(item.quantity)]).sort((a, b) => a[0] - b[0]);
}

test("árvore de caminhos e estado da campanha são calculados sem depender do banco", () => {
  const rows = withCategoryPaths([
    { id: 3, parent_id: 2, name: "Natural" }, { id: 1, parent_id: null, name: "Argolas" }, { id: 2, parent_id: 1, name: "Titânio" }
  ]);
  assert.deepEqual(rows.map((row) => [row.path, row.depth]), [["Argolas", 0], ["Argolas › Titânio", 1], ["Argolas › Titânio › Natural", 2]]);
  const now = new Date("2026-10-31T12:00:00Z");
  assert.equal(campaignState({ status: "published", starts_at: "2026-11-01T00:00:00Z" }, now), "scheduled");
  assert.equal(campaignState({ status: "published", starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-11-01T00:00:00Z" }, now), "active");
  assert.equal(campaignState({ status: "published", ends_at: "2026-10-31T12:00:00Z" }, now), "ended");
  assert.equal(campaignState({ status: "paused" }, now), "paused");
  assert.equal(campaignState({ status: "draft" }, now), "draft");
});

test("categorias hierárquicas: níveis, nomes, endereços, ciclos, ocultação e exclusão protegida", async () => {
  const argolas = await api("/catalog-categories", { method: "POST", body: { name: "Argolas" } });
  assert.equal(argolas.status, 201, JSON.stringify(argolas.json));
  assert.equal(argolas.json.slug, "argolas");
  const titanio = await api("/catalog-categories", { method: "POST", body: { name: "Titânio", parent_id: argolas.json.id } });
  const natural = await api("/catalog-categories", { method: "POST", body: { name: "Titânio natural", parent_id: titanio.json.id } });
  assert.equal(natural.status, 201, JSON.stringify(natural.json));
  assert.equal(natural.json.path, "Argolas › Titânio › Titânio natural");
  assert.equal(natural.json.depth, 2);

  // Mesmo nome é permitido em outro ramo; o endereço ganha o da categoria principal.
  const labrets = await api("/catalog-categories", { method: "POST", body: { name: "Labrets" } });
  const labretTitanio = await api("/catalog-categories", { method: "POST", body: { name: "Titanio", parent_id: labrets.json.id } });
  assert.equal(labretTitanio.status, 201, JSON.stringify(labretTitanio.json));
  assert.equal(labretTitanio.json.slug, "labrets-titanio");
  // Mas não no mesmo nível, nem com variação de acento ou caixa.
  const duplicate = await api("/catalog-categories", { method: "POST", body: { name: "titanio", parent_id: argolas.json.id } });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.json));
  assert.equal(duplicate.json.code, "catalog_category_duplicate");
  const slugConflict = await api("/catalog-categories", { method: "POST", body: { name: "Outra", slug: "argolas" } });
  assert.equal(slugConflict.status, 409);
  assert.equal(slugConflict.json.code, "catalog_slug_conflict");
  const cycle = await api(`/catalog-categories/${argolas.json.id}`, { method: "PATCH", body: { parent_id: natural.json.id } });
  assert.equal(cycle.status, 409, JSON.stringify(cycle.json));
  assert.equal(cycle.json.code, "catalog_category_cycle");

  const reorder = await api("/catalog-categories/order", { method: "PATCH", body: { parent_id: null, ids: [labrets.json.id, argolas.json.id] } });
  assert.equal(reorder.status, 200, JSON.stringify(reorder.json));
  assert.deepEqual(reorder.json.filter((row) => row.depth === 0).map((row) => row.name), ["Labrets", "Argolas"]);

  // Um produto em várias categorias, sem duplicar cadastro, SKU ou estoque.
  const before = await stockSnapshot();
  const [topo] = ctx.products;
  for (const category of [natural.json, labretTitanio.json]) {
    const added = await api(`/catalog-categories/${category.id}/products`, { method: "POST", body: { product_ids: [topo.id] } });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.equal(added.json.added, 1);
  }
  const again = await api(`/catalog-categories/${natural.json.id}/products`, { method: "POST", body: { product_ids: [topo.id, topo.id] } });
  assert.equal(again.json.added, 0);
  assert.equal(again.json.already_linked, 1);
  assert.deepEqual(await stockSnapshot(), before);

  let catalog = await req("/catalog", { tenant: ctx.slug });
  const publicTopo = catalog.json.items.find((item) => item.id === topo.id);
  assert.deepEqual([...publicTopo.category_ids].sort(), [natural.json.id, labretTitanio.json.id].sort());
  assert.ok(catalog.json.catalogCategories.some((row) => row.slug === "argolas"));
  assert.equal(catalog.json.items.filter((item) => item.id === topo.id).length, 1);

  // Ocultar a principal esconde toda a descendência na vitrine.
  await api(`/catalog-categories/${argolas.json.id}`, { method: "PATCH", body: { is_active: false } });
  catalog = await req("/catalog", { tenant: ctx.slug });
  assert.equal(catalog.json.catalogCategories.some((row) => [argolas.json.id, titanio.json.id, natural.json.id].includes(row.id)), false);
  assert.deepEqual(catalog.json.items.find((item) => item.id === topo.id).category_ids, [labretTitanio.json.id]);

  const blocked = await api(`/catalog-categories/${titanio.json.id}`, { method: "DELETE" });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.child_count, 1);
  const withProducts = await api(`/catalog-categories/${natural.json.id}`, { method: "DELETE" });
  assert.equal(withProducts.status, 409);
  assert.equal(withProducts.json.product_count, 1);
  const removed = await api(`/catalog-categories/${natural.json.id}/products/${topo.id}`, { method: "DELETE" });
  assert.equal(removed.json.removed, 1);
  assert.deepEqual(await stockSnapshot(), before);
  assert.equal((await api(`/catalog-categories/${natural.json.id}`, { method: "DELETE" })).status, 200);

  // A estrutura sugerida cria só o que falta e não duplica ao repetir.
  const suggested = await api("/catalog-categories/suggested", { method: "POST" });
  assert.equal(suggested.status, 201, JSON.stringify(suggested.json));
  assert.ok(suggested.json.created > 10);
  assert.equal((await api("/catalog-categories/suggested", { method: "POST" })).json.created, 0);
});

test("permissões: recepção edita, só admin exclui e piercer não gerencia a vitrine", async () => {
  const created = await api("/catalog-categories", { as: "reception", method: "POST", body: { name: "Navel" + Date.now() } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal((await api(`/catalog-categories/${created.json.id}`, { as: "reception", method: "DELETE" })).status, 403);
  assert.equal((await api("/catalog-categories", { as: "piercer" })).status, 403);
  assert.equal((await api("/catalog-categories", { as: "piercer", method: "POST", body: { name: "Indevida" } })).status, 403);
  assert.equal((await api("/catalog-campaigns", { as: "piercer", method: "POST", body: { name: "Indevida" } })).status, 403);
  assert.equal((await api(`/catalog-categories/${created.json.id}`, { method: "DELETE" })).status, 200);
});

test("campanhas: rascunho, agendamento, vigência, encerramento automático, pausa e link expirado", async () => {
  const [topo, esgotado] = ctx.products;
  const draft = await api("/catalog-campaigns", { method: "POST", body: { name: "Halloween 2026", title: "Halloween", summary: "Joias temáticas.", ends_local: "2099-11-01T00:00" } });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  assert.equal(draft.json.state, "draft");
  assert.equal(draft.json.slug, "halloween");
  assert.ok(draft.json.warnings.includes("Campanha sem produtos."));
  const conflict = await api("/catalog-campaigns", { method: "POST", body: { name: "Outra", slug: "halloween" } });
  assert.equal(conflict.status, 409);

  const section = await api(`/catalog-campaigns/${draft.json.id}/sections`, { method: "POST", body: { name: "Topos temáticos" } });
  assert.equal(section.status, 201, JSON.stringify(section.json));
  const before = await stockSnapshot();
  const linked = await api(`/catalog-campaigns/${draft.json.id}/products`, { method: "POST", body: { product_ids: [topo.id, esgotado.id], section_id: section.json.id } });
  assert.equal(linked.json.added, 2);
  assert.equal((await api(`/catalog-campaigns/${draft.json.id}/products`, { method: "POST", body: { product_ids: [topo.id] } })).json.already_linked, 1);
  assert.deepEqual(await stockSnapshot(), before, "vincular à campanha não altera estoque nem SKU");
  const detail = await api(`/catalog-campaigns/${draft.json.id}`);
  assert.equal(detail.json.products.length, 2);
  assert.equal(detail.json.unavailable_count, 1, "o produto esgotado aparece como indisponível");

  // Rascunho não aparece e o link público não revela o título.
  let catalog = await req("/catalog", { tenant: ctx.slug });
  assert.equal(catalog.json.campaigns.length, 0);
  assert.equal((await req("/catalog/campaigns/halloween", { tenant: ctx.slug })).status, 404);

  // Publicada com início futuro: agendada, fora da vitrine.
  await api(`/catalog-campaigns/${draft.json.id}`, { method: "PATCH", body: { starts_local: "2099-10-01T00:00" } });
  const scheduled = await api(`/catalog-campaigns/${draft.json.id}/status`, { method: "POST", body: { action: "publish" } });
  assert.equal(scheduled.status, 200, JSON.stringify(scheduled.json));
  assert.equal(scheduled.json.state, "scheduled");
  catalog = await req("/catalog", { tenant: ctx.slug });
  assert.equal(catalog.json.campaigns.length, 0);
  assert.deepEqual((await req("/catalog/campaigns/halloween", { tenant: ctx.slug })).json, { state: "unavailable" });

  // Início alcançado: aparece sozinha, sem nova publicação.
  const active = await api(`/catalog-campaigns/${draft.json.id}`, { method: "PATCH", body: { starts_local: "" } });
  assert.equal(active.json.state, "active");
  catalog = await req("/catalog", { tenant: ctx.slug });
  const publicCampaign = catalog.json.campaigns.find((campaign) => campaign.slug === "halloween");
  assert.ok(publicCampaign);
  assert.deepEqual(publicCampaign.products.map((product) => product.product_id).sort(), [topo.id, esgotado.id].sort());
  assert.equal(publicCampaign.sections[0].name, "Topos temáticos");
  assert.equal("name" in publicCampaign, false, "o nome interno não sai na vitrine");

  const paused = await api(`/catalog-campaigns/${draft.json.id}/status`, { method: "POST", body: { action: "pause" } });
  assert.equal(paused.json.state, "paused");
  assert.equal((await req("/catalog", { tenant: ctx.slug })).json.campaigns.length, 0);
  await api(`/catalog-campaigns/${draft.json.id}/status`, { method: "POST", body: { action: "resume" } });

  // Encerramento alcançado: sai da vitrine; o link mostra que terminou.
  const ended = await api(`/catalog-campaigns/${draft.json.id}`, { method: "PATCH", body: { ends_local: "2020-01-02T00:00" } });
  assert.equal(ended.json.state, "ended");
  assert.equal((await req("/catalog", { tenant: ctx.slug })).json.campaigns.length, 0);
  assert.deepEqual((await req("/catalog/campaigns/halloween", { tenant: ctx.slug })).json, { state: "ended", title: "Halloween" });
  // Produtos continuam no catálogo permanente com o mesmo estoque.
  assert.ok((await req("/catalog", { tenant: ctx.slug })).json.items.some((item) => item.id === topo.id));
  assert.deepEqual(await stockSnapshot(), before);

  const manualEnd = await api(`/catalog-campaigns/${draft.json.id}/status`, { method: "POST", body: { action: "end" } });
  assert.equal(manualEnd.json.status, "ended");
  const reactivateLate = await api(`/catalog-campaigns/${draft.json.id}/status`, { method: "POST", body: { action: "reactivate" } });
  assert.equal(reactivateLate.status, 409, "reativar exige novo período");
  await api(`/catalog-campaigns/${draft.json.id}`, { method: "PATCH", body: { ends_local: "2099-12-31T23:00" } });
  const reactivated = await api(`/catalog-campaigns/${draft.json.id}/status`, { method: "POST", body: { action: "reactivate" } });
  assert.equal(reactivated.json.state, "active");
  assert.equal((await api(`/catalog-campaigns/${draft.json.id}`, { method: "DELETE" })).status, 409, "publicadas ficam no histórico");
});

test("o horário digitado é interpretado no fuso configurado da loja", async () => {
  assert.equal((await api("/catalog-campaigns/settings", { method: "PUT", body: { timezone: "Marte/Olympus" } })).status, 400);
  await api("/catalog-campaigns/settings", { method: "PUT", body: { timezone: "America/Sao_Paulo" } });
  const campaign = await api("/catalog-campaigns", { method: "POST", body: { name: "Natal", starts_local: "2030-12-01T10:00" } });
  assert.equal(campaign.status, 201, JSON.stringify(campaign.json));
  assert.equal(new Date(campaign.json.starts_at).toISOString(), "2030-12-01T13:00:00.000Z");
  assert.equal(campaign.json.starts_local, "2030-12-01T10:00");

  await api("/catalog-campaigns/settings", { method: "PUT", body: { timezone: "Asia/Tokyo" } });
  // A mesma data já gravada continua no mesmo instante, exibida no novo fuso.
  const shown = await api(`/catalog-campaigns/${campaign.json.id}`);
  assert.equal(shown.json.starts_local, "2030-12-01T22:00");
  const updated = await api(`/catalog-campaigns/${campaign.json.id}`, { method: "PATCH", body: { starts_local: "2030-12-01T10:00" } });
  assert.equal(new Date(updated.json.after?.starts_at || updated.json.starts_at).toISOString(), "2030-12-01T01:00:00.000Z");
  await api("/catalog-campaigns/settings", { method: "PUT", body: { timezone: "America/Sao_Paulo" } });
});

test("isolamento entre clínicas e plano sem campanhas", async () => {
  ctx.other = await createTenant("qa-vitrine-b");
  const otherToken = (await loginTenant(ctx.other.slug, ctx.other.adminEmail, ctx.other.adminPassword)).token;
  const other = (path, options = {}) => req(path, { tenant: ctx.other.slug, token: otherToken, ...options });
  const mine = (await api("/catalog-categories")).json;
  assert.ok(mine.length > 0);
  assert.deepEqual((await other("/catalog-categories")).json, []);
  const foreignCategory = await other(`/catalog-categories/${mine[0].id}/products`);
  assert.equal(foreignCategory.status, 404);
  const ownCategory = await other("/catalog-categories", { method: "POST", body: { name: "Argolas" } });
  assert.equal(ownCategory.status, 201, "o mesmo nome e endereço podem existir em outra clínica");
  const foreignProduct = await other(`/catalog-categories/${ownCategory.json.id}/products`, { method: "POST", body: { product_ids: [ctx.products[0].id] } });
  assert.ok([404].includes(foreignProduct.status), JSON.stringify(foreignProduct.json));
  assert.equal((await req("/catalog/campaigns/halloween", { tenant: ctx.other.slug })).status, 404);
  // Plano sem a feature "Campanhas": a gestão é recusada e a vitrine não lista campanhas.
  const blocked = await other("/catalog-campaigns");
  assert.ok([402, 403].includes(blocked.status), JSON.stringify(blocked.json));
});
