// Termos digitais assinados pelo próprio cliente: modelos geridos pela
// clínica, link individual (estúdio ou à distância), página pública, registro
// imutável no histórico do cliente e trilha de auditoria.
//
// Rode (de backend/):
//   node tests/run-suite.mjs tests/termRequests.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { query } from "../src/database/connection.js";
import { req, createTenant, loginTenant, platformLogin, deleteTenant } from "./helpers.mjs";

const PW = "SenhaForte123";
// PNG 1x1 válido: o backend valida o formato e o PDF anexa a imagem.
const SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const ctx = { platformToken: null, tenant: null, adminToken: null, receptionToken: null, schema: null, clientId: null, templates: [], request: null, token: null };

const api = (path, options = {}) => req(path, { token: ctx.adminToken, ...options });
const publicApi = (path, options = {}) => req(path, { tenant: ctx.tenant.slug, ...options });
const tokenOf = (url) => /\/termo\/([A-Za-z0-9_-]+)/.exec(url)?.[1] || "";

function signedBody(overrides = {}) {
  return {
    full_name: "Camila Ferreira Lima",
    document_number: "123.456.789-09",
    birth_date: "1996-05-10",
    whatsapp: "11999990003",
    orientations_confirmed: true,
    health_declaration: "Sem alergias conhecidas.",
    signature_data_url: SIGNATURE,
    form_data: { health_history: { diabetes: false, anemia: true }, minor: { is_minor: false } },
    ...overrides
  };
}

before(async () => {
  ctx.platformToken = await platformLogin();
  ctx.tenant = await createTenant("qa-termos");
  const admin = await loginTenant(ctx.tenant.slug, ctx.tenant.adminEmail, ctx.tenant.adminPassword);
  ctx.adminToken = admin.token;
  const row = await query("SELECT schema_name FROM platform.tenants WHERE id = $1", [ctx.tenant.tenant.id]);
  ctx.schema = row.rows[0]?.schema_name;
  const client = await api("/clients", { method: "POST", body: { full_name: "Camila Ferreira Lima", whatsapp: "11999990003", birth_date: "1996-05-10" } });
  assert.equal(client.status, 201, JSON.stringify(client.json));
  ctx.clientId = client.json.id;
  const reception = await api("/users", { method: "POST", body: { name: "Recepção", email: `recepcao@${ctx.tenant.slug}.test`, password: PW, role: "reception" } });
  assert.equal(reception.status, 201, JSON.stringify(reception.json));
  ctx.receptionToken = (await loginTenant(ctx.tenant.slug, `recepcao@${ctx.tenant.slug}.test`, PW)).token;
});

after(async () => {
  if (ctx.platformToken && ctx.tenant?.tenant?.id) await deleteTenant(ctx.platformToken, ctx.tenant.tenant.id, ctx.tenant.slug);
});

test("clínica nova já nasce com modelos de termo prontos", async () => {
  const list = await api("/term-templates");
  assert.equal(list.status, 200, JSON.stringify(list.json));
  ctx.templates = list.json.items;
  assert.ok(ctx.templates.length >= 2, "modelos semeados");
  assert.ok(ctx.templates.some((item) => item.kind === "consent"));
  assert.ok(ctx.templates.some((item) => item.kind === "authorization"));
  assert.ok(list.json.kinds.some((kind) => kind.value === "procedure"));
});

test("modelos: criar, editar, recusar tipo inválido e arquivar em vez de apagar quando já usado", async () => {
  const created = await api("/term-templates", { method: "POST", body: { name: "Termo de troca de joia", kind: "procedure", content: "Declaro estar ciente dos cuidados na troca de joia e da higienização necessária.", requires_health_history: false } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.requires_health_history, false);
  assert.equal(created.json.kind_label, "Termo específico de procedimento");

  const invalid = await api("/term-templates", { method: "POST", body: { name: "Ruim", kind: "qualquer", content: "Texto suficiente para passar na validação." } });
  assert.equal(invalid.status, 400);

  const patched = await api(`/term-templates/${created.json.id}`, { method: "PATCH", body: { name: "Termo de troca de joia (v2)" } });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal(patched.json.name, "Termo de troca de joia (v2)");

  // Sem uso: apaga de verdade.
  const removed = await api(`/term-templates/${created.json.id}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.equal(removed.json.archived, false);

  // Recepção não gerencia termos clínicos.
  const forbidden = await req("/term-templates", { token: ctx.receptionToken });
  assert.equal(forbidden.status, 403);
});

test("gera link individual para o cliente, com WhatsApp e mensagem prontos", async () => {
  const consent = ctx.templates.find((item) => item.kind === "consent");
  const created = await api("/term-requests", { method: "POST", body: { client_id: ctx.clientId, template_id: consent.id, channel: "remote", message: "Assine antes do horário, por favor." } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.status, "pending");
  assert.match(created.json.url, /\/termo\/[A-Za-z0-9_-]{32,}\?t=/);
  assert.ok(created.json.url.includes(`t=${ctx.tenant.slug}`), "link carrega a clínica");
  assert.match(created.json.whatsapp_url, /^https:\/\/wa\.me\/5511999990003\?text=/);
  assert.ok(created.json.message_text.includes(created.json.url));
  ctx.request = created.json;
  ctx.token = tokenOf(created.json.url);

  // Na listagem o token nunca reaparece.
  const list = await api(`/term-requests?client_id=${ctx.clientId}`);
  assert.equal(list.status, 200);
  const item = list.json.items.find((entry) => entry.id === created.json.id);
  assert.ok(item, "solicitação listada");
  assert.equal(item.url, null);

  // Recepção não vê a fila clínica.
  assert.equal((await req("/term-requests", { token: ctx.receptionToken })).status, 403);
});

test("página pública: abre com o texto do termo e os dados do cliente, sem sessão", async () => {
  const opened = await publicApi(`/public/terms/${ctx.token}`);
  assert.equal(opened.status, 200, JSON.stringify(opened.json));
  assert.equal(opened.json.client.full_name, "Camila Ferreira Lima");
  assert.equal(opened.json.template.kind, "consent");
  assert.ok(opened.json.template.content.length > 50);
  assert.equal(opened.json.request.message, "Assine antes do horário, por favor.");
  assert.ok(opened.json.clinic.name, "nome da clínica");
  // Nada de prontuário ou dados internos no payload público.
  assert.equal(opened.json.client.notes, undefined);
  assert.equal(opened.json.request.token_hash, undefined);

  const invalid = await publicApi("/public/terms/token-invalido-que-nao-existe-1234567890");
  assert.equal(invalid.status, 404);
});

test("cliente assina pelo link: termo entra no histórico, link vira usado e o registro é imutável", async () => {
  const semAssinatura = await publicApi(`/public/terms/${ctx.token}`, { method: "POST", body: signedBody({ signature_data_url: "" }) });
  assert.equal(semAssinatura.status, 400, JSON.stringify(semAssinatura.json));
  const semAceite = await publicApi(`/public/terms/${ctx.token}`, { method: "POST", body: signedBody({ orientations_confirmed: false }) });
  assert.equal(semAceite.status, 400);

  const signed = await publicApi(`/public/terms/${ctx.token}`, { method: "POST", body: signedBody() });
  assert.equal(signed.status, 201, JSON.stringify(signed.json));
  assert.ok(signed.json.term.id);

  // O mesmo link não assina duas vezes.
  assert.equal((await publicApi(`/public/terms/${ctx.token}`, { method: "POST", body: signedBody() })).status, 409);
  const reopened = await publicApi(`/public/terms/${ctx.token}`);
  assert.equal(reopened.status, 409);
  assert.equal(reopened.json.code, "completed");

  // Solicitação concluída e termo no histórico do cliente, com rastreio.
  const list = await api(`/term-requests?client_id=${ctx.clientId}`);
  const item = list.json.items.find((entry) => entry.id === ctx.request.id);
  assert.equal(item.status, "completed");
  assert.equal(item.digital_term_id, signed.json.term.id);

  const terms = await api(`/digital-terms?client_id=${ctx.clientId}`);
  assert.equal(terms.status, 200);
  const term = (Array.isArray(terms.json) ? terms.json : terms.json.items).find((entry) => entry.id === signed.json.term.id);
  assert.ok(term, "termo listado");
  assert.equal(term.channel, "remote");
  assert.equal(term.template_name, ctx.request.template_name);
  assert.match(term.content_hash, /^[a-f0-9]{64}$/);
  assert.match(term.pdf_url, /\/api\/private-files\/termo-digital-\d+\.pdf$/);

  const profile = await api(`/clients/${ctx.clientId}`);
  assert.equal(profile.status, 200);
  assert.ok(profile.json.terms.some((entry) => entry.id === signed.json.term.id));
  assert.ok(profile.json.termRequests.some((entry) => entry.id === ctx.request.id && entry.status === "completed"));
  // O que o cliente informou atualiza o cadastro.
  assert.equal(profile.json.cpf, "123.456.789-09");

  // Imutável: nem por SQL direto se muda o que foi assinado.
  await assert.rejects(
    query(`UPDATE "${ctx.schema}".digital_terms SET signature_data_url = $1 WHERE id = $2`, ["data:image/png;base64,AAAA", signed.json.term.id]),
    /não pode ser alterado/
  );

  // Auditoria: quem assinou, por qual canal.
  const trilha = await query(
    `SELECT action, reason, metadata FROM "${ctx.schema}".audit_events WHERE module = 'terms' AND action = 'term_signed_by_client' AND entity_id = $1`,
    [String(signed.json.term.id)]
  );
  assert.equal(trilha.rows.length, 1);
  assert.equal(trilha.rows[0].metadata?.channel, "remote");
});

test("cancelar, renovar e expirar: cada link só vale enquanto pendente", async () => {
  const consent = ctx.templates.find((item) => item.kind === "consent");
  const created = await api("/term-requests", { method: "POST", body: { client_id: ctx.clientId, template_id: consent.id, channel: "in_studio" } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const firstToken = tokenOf(created.json.url);

  // Gerar link novo cancela o anterior.
  const renewed = await api(`/term-requests/${created.json.id}/renew`, { method: "POST", body: {} });
  assert.equal(renewed.status, 201, JSON.stringify(renewed.json));
  assert.notEqual(tokenOf(renewed.json.url), firstToken);
  assert.equal((await publicApi(`/public/terms/${firstToken}`)).status, 410);
  assert.equal((await publicApi(`/public/terms/${tokenOf(renewed.json.url)}`)).status, 200);

  // Cancelamento explícito.
  const cancelled = await api(`/term-requests/${renewed.json.id}/cancel`, { method: "POST", body: { reason: "Cliente desistiu" } });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
  assert.equal(cancelled.json.status, "cancelled");
  const afterCancel = await publicApi(`/public/terms/${tokenOf(renewed.json.url)}`);
  assert.equal(afterCancel.status, 410);
  assert.equal(afterCancel.json.code, "cancelled");
  assert.equal((await api(`/term-requests/${renewed.json.id}/cancel`, { method: "POST", body: {} })).status, 409);

  // Expiração pelo tempo.
  const shortLived = await api("/term-requests", { method: "POST", body: { client_id: ctx.clientId, template_id: consent.id, channel: "remote", expires_in_hours: 0.0001 } });
  assert.equal(shortLived.status, 201, JSON.stringify(shortLived.json));
  await new Promise((resolve) => setTimeout(resolve, 600));
  const expired = await publicApi(`/public/terms/${tokenOf(shortLived.json.url)}`);
  assert.equal(expired.status, 410);
  assert.equal(expired.json.code, "expired");
  const listed = await api(`/term-requests?client_id=${ctx.clientId}&status=expired`);
  assert.ok(listed.json.items.some((entry) => entry.id === shortLived.json.id));
});

test("menor de idade só assina com responsável legal, mesmo pelo link", async () => {
  const authorization = ctx.templates.find((item) => item.kind === "authorization");
  const created = await api("/term-requests", { method: "POST", body: { client_id: ctx.clientId, template_id: authorization.id, channel: "remote" } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const token = tokenOf(created.json.url);
  const minorNoGuardian = await publicApi(`/public/terms/${token}`, { method: "POST", body: signedBody({ birth_date: "2012-03-01", form_data: { health_history: {}, minor: { is_minor: false } } }) });
  assert.equal(minorNoGuardian.status, 400);
  assert.match(minorNoGuardian.json.error, /respons[áa]vel/i);
  const withGuardian = await publicApi(`/public/terms/${token}`, { method: "POST", body: signedBody({
    birth_date: "2012-03-01", guardian_signature_data_url: SIGNATURE,
    form_data: { health_history: {}, minor: { is_minor: true, responsible_name: "Maria Lima", responsible_document: "987.654.321-00" } }
  }) });
  assert.equal(withGuardian.status, 201, JSON.stringify(withGuardian.json));

  // Modelo já usado: excluir vira arquivar.
  const archived = await api(`/term-templates/${authorization.id}`, { method: "DELETE" });
  assert.equal(archived.status, 200);
  assert.equal(archived.json.archived, true);
  const active = await api("/term-templates");
  assert.ok(!active.json.items.some((item) => item.id === authorization.id), "arquivado some da lista ativa");
  const all = await api("/term-templates?include_inactive=1");
  assert.ok(all.json.items.some((item) => item.id === authorization.id && item.is_active === false));
});
