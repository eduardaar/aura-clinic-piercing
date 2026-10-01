// Indicador químico por procedimento (SPEC seção 3).
//
// Parte 1: unitários da normalização (sem servidor).
// Parte 2: endpoints numa clínica de teste própria — registro com foto pelo
//          cofre privado, retrato do procedimento, validações, anulação,
//          histórico do cliente, permissões, atendimento cancelado, vínculo
//          com a execução, exportação LGPD e mesclagem de clientes.
//
// Estados que dependem de outros fluxos (status cancelado/atendido, execução
// do serviço) são montados direto no banco: o teste é do indicador, não da
// finalização, e não pode quebrar quando aquele fluxo mudar.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import {
  ChemicalIndicatorError,
  linkIndicatorsToExecution,
  normalizeChemicalIndicatorInput,
  normalizeIndicatorDate,
  normalizeVoidReason,
  resolveProcedureWithoutItem,
  serializeIndicator
} from "../src/services/chemicalIndicators.js";

// ---------------------------------------------------------------- parte 1 ---

test("normalização exige ao menos tipo, lote, identificação ou foto", () => {
  assert.throws(
    () => normalizeChemicalIndicatorInput({ indicator_brand: "Marca", notes: "só observação" }),
    (error) => error instanceof ChemicalIndicatorError && error.status === 400 && /ao menos/.test(error.message)
  );
  assert.equal(normalizeChemicalIndicatorInput({}, { hasPhoto: true }).result, "nao_informado");
  const input = normalizeChemicalIndicatorInput({
    appointment_item_id: "12", indicator_type: "  Classe 4 — multiparâmetro ", indicator_lot: "L\n123",
    result: "APROVADO", indicator_date: "2026-09-01"
  }, { today: "2026-09-30" });
  assert.equal(input.appointment_item_id, 12);
  assert.equal(input.indicator_type, "Classe 4 — multiparâmetro");
  assert.equal(input.indicator_lot, "L 123", "quebra de linha em campo curto vira espaço");
  assert.equal(input.result, "aprovado");
});

test("data do indicador: formato, calendário real e nada no futuro", () => {
  assert.equal(normalizeIndicatorDate("", "2026-09-30"), null);
  assert.equal(normalizeIndicatorDate("2026-09-30", "2026-09-30"), "2026-09-30");
  for (const invalid of ["30/09/2026", "2026-02-30", "2026-13-01", "abc"]) {
    assert.throws(() => normalizeIndicatorDate(invalid, "2026-09-30"), ChemicalIndicatorError, invalid);
  }
  assert.throws(() => normalizeIndicatorDate("2026-10-01", "2026-09-30"), /futura/);
});

test("resultado fora da lista, item inválido e motivo de anulação são recusados", () => {
  assert.throws(() => normalizeChemicalIndicatorInput({ indicator_lot: "L1", result: "ok" }), /Resultado/);
  assert.throws(() => normalizeChemicalIndicatorInput({ indicator_lot: "L1", appointment_item_id: "-3" }), /procedimento válido/);
  assert.throws(() => normalizeVoidReason("   "), /motivo/);
  assert.throws(() => normalizeVoidReason("x".repeat(501)), /500/);
  assert.equal(normalizeVoidReason("  Etiqueta trocada  "), "Etiqueta trocada");
});

test("serialização esconde o arquivo de quem não vê arquivo clínico", () => {
  const row = { id: 1, status: "ativo", photo_filename: "abc.webp" };
  assert.equal(serializeIndicator(row).photo_url, "/api/private-files/abc.webp");
  const hidden = serializeIndicator(row, { canViewPhoto: false });
  assert.equal(hidden.photo_url, null);
  assert.equal(hidden.photo_filename, null);
  assert.equal(hidden.has_photo, true);
  assert.equal(serializeIndicator({ ...row, status: "anulado" }).is_voided, true);
});

test("sem item: nome igual ao de um procedimento herda o retrato completo; nome livre fica só com o nome", () => {
  const legacy = [{ appointment_item_id: null, service_id: 3, procedure_id: null, procedure_name: "Perfuração QA", body_region: "Orelha", jewelry_id: 9, jewelry_name: "Argola" }];
  const fromName = resolveProcedureWithoutItem(legacy, " perfuração qa ");
  assert.equal(fromName.jewelry_id, 9, "o agendamento legado não perde a joia");
  assert.equal(fromName.body_region, "Orelha");
  assert.equal(fromName.procedure_name, "Perfuração QA");
  assert.equal(resolveProcedureWithoutItem(legacy, "").jewelry_name, "Argola");

  const two = [
    { appointment_item_id: 1, service_id: 3, procedure_name: "Lóbulo", body_region: "Esquerdo", jewelry_id: 9, jewelry_name: "Argola" },
    { appointment_item_id: 2, service_id: 3, procedure_name: "Hélix", body_region: "Direito" }
  ];
  const free = resolveProcedureWithoutItem(two, "Troca de joia");
  assert.deepEqual(
    [free.appointment_item_id, free.service_id, free.body_region, free.jewelry_id],
    [null, null, null, null],
    "nome livre não herda dados de outro procedimento"
  );
  assert.equal(Number(resolveProcedureWithoutItem(two, "hélix").appointment_item_id), 2);
  assert.throws(() => resolveProcedureWithoutItem(two, ""), (error) => error.status === 400 && /selecione/.test(error.message));
  const twins = [{ ...two[0] }, { ...two[0], appointment_item_id: 3 }];
  assert.throws(() => resolveProcedureWithoutItem(twins, "Lóbulo"), /selecione/);
});

test("ids fora do INTEGER e motivo que não é texto são recusados com 400", () => {
  assert.throws(() => normalizeChemicalIndicatorInput({ indicator_lot: "L1", appointment_item_id: "99999999999" }), /procedimento válido/);
  assert.throws(() => normalizeChemicalIndicatorInput({ indicator_lot: "L1", appointment_item_id: "1e3" }), /procedimento válido/);
  assert.throws(() => normalizeVoidReason({ text: "x" }), /motivo/);
  assert.throws(() => normalizeVoidReason(["a"]), /motivo/);
});

// ---------------------------------------------------------------- parte 2 ---

const PW = "SenhaForte123";
const ctx = { tokens: {}, userIds: {} };
const api = (path, options = {}) => req(path, { token: ctx.tokens.admin, tenant: ctx.tenant?.slug, ...options });
const as = (role, path, options = {}) => api(path, { token: ctx.tokens[role], ...options });

// PNG 1x1 válido: passa pela validação de conteúdo e vira WebP no cofre.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function indicatorForm(fields, { photo = false } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  if (photo) form.append("photo", new Blob([PNG], { type: "image/png" }), "etiqueta.png");
  return form;
}

const tenantDb = (fn) => withTenantSchema(ctx.tenant.tenant.id, fn);

async function createAppointment({ clientId, fullName, whatsapp, date, time, items }) {
  const created = await api("/appointments", {
    method: "POST",
    body: {
      client_id: clientId, full_name: fullName, whatsapp, professional_id: ctx.professionalId,
      service_id: ctx.serviceId, procedure: "Perfuração QA", piercing_region: "Orelha",
      appointment_date: date, appointment_time: time, deposit_value: 0, status: "confirmado",
      ...(items ? { appointment_items: items } : {})
    }
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json;
}

async function auditEvents(action) {
  const response = await api(`/audit-events?module=clinical&action=${action}`);
  assert.equal(response.status, 200, JSON.stringify(response.json));
  return Array.isArray(response.json) ? response.json : response.json.items;
}

before(async () => {
  ctx.platformToken = await platformLogin();
  ctx.tenant = await createTenant("qa-chem-ind");
  ctx.tokens.admin = (await loginTenant(ctx.tenant.slug, ctx.tenant.adminEmail, ctx.tenant.adminPassword)).token;
  for (const role of ["piercer", "reception"]) {
    const email = `${role}@${ctx.tenant.slug}.test`;
    const created = await api("/users", { method: "POST", body: { name: `Usuário ${role}`, email, password: PW, role } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    ctx.userIds[role] = created.json.id;
    ctx.tokens[role] = (await loginTenant(ctx.tenant.slug, email, PW)).token;
  }
  const service = await api("/services", { method: "POST", body: { name: "Perfuração de lóbulo", duration_minutes: 30, price: 120 } });
  assert.equal(service.status, 201, JSON.stringify(service.json));
  ctx.serviceId = service.json.id;
  const professional = await api("/professionals", { method: "POST", body: { name: "Piercer Indicador", specialty: "Piercing" } });
  ctx.professionalId = professional.json.id;
  const jewelry = await api("/jewelry", {
    method: "POST",
    body: { name: "Labret Titânio Polido", category: "Labret", material: "Titânio", color: "Prata", quantity: 10, cost_value: 15, sale_value: 60 }
  });
  assert.ok([200, 201].includes(jewelry.status), JSON.stringify(jewelry.json));
  ctx.jewelryId = jewelry.json.id;
  ctx.variantId = jewelry.json.variants?.[0]?.id || null;

  const appointment = await createAppointment({
    fullName: "Cliente Indicador", whatsapp: "11988887701", date: "2026-09-20", time: "10:00",
    items: [
      { service_id: ctx.serviceId, region: "Lóbulo esquerdo", jewelry_id: ctx.jewelryId, jewelry_variant_id: ctx.variantId, quantity: 1 },
      { service_id: ctx.serviceId, region: "Hélix direito" }
    ]
  });
  ctx.appointment = appointment;
  ctx.clientId = appointment.client_id;
  ctx.items = appointment.items;
  assert.equal(ctx.items.length, 2, "o agendamento precisa ter dois procedimentos");
});

after(async () => {
  if (ctx.platformToken && ctx.tenant?.tenant?.id) {
    await deleteTenant(ctx.platformToken, ctx.tenant.tenant.id, ctx.tenant.slug);
  }
});

test("painel lista os procedimentos do atendimento com região e joia", async () => {
  const panel = await api(`/appointments/${ctx.appointment.id}/chemical-indicators`);
  assert.equal(panel.status, 200, JSON.stringify(panel.json));
  assert.deepEqual(panel.json.indicators, []);
  assert.equal(panel.json.procedures.length, 2);
  const [first, second] = panel.json.procedures;
  assert.equal(Number(first.appointment_item_id), Number(ctx.items[0].id));
  assert.equal(first.procedure_name, "Perfuração de lóbulo");
  assert.equal(first.body_region, "Lóbulo esquerdo");
  assert.equal(Number(first.jewelry_id), Number(ctx.jewelryId));
  assert.equal(first.jewelry_name, "Labret Titânio Polido");
  assert.equal(second.body_region, "Hélix direito");
  assert.equal(second.jewelry_id, null);

  const missing = await api("/appointments/99999999/chemical-indicators");
  assert.equal(missing.status, 404, JSON.stringify(missing.json));
  const huge = await api("/appointments/99999999999/chemical-indicators");
  assert.equal(huge.status, 400, `id fora do INTEGER não pode virar 500: ${JSON.stringify(huge.json)}`);
});

test("registro com foto (multipart) grava retrato do procedimento e a foto é lida pela rota privada", async () => {
  const created = await as("piercer", `/appointments/${ctx.appointment.id}/chemical-indicators`, {
    method: "POST",
    body: indicatorForm({
      appointment_item_id: ctx.items[0].id, indicator_type: "Classe 4 — multiparâmetro", indicator_brand: "Marca QA",
      indicator_lot: "LOTE-001", indicator_date: "2026-09-20", identification: "Ciclo 42", result: "aprovado",
      notes: "Etiqueta virou por completo."
    }, { photo: true })
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const indicator = created.json.indicator;
  assert.equal(Number(indicator.appointment_item_id), Number(ctx.items[0].id));
  assert.equal(Number(indicator.client_id), Number(ctx.clientId));
  assert.equal(Number(indicator.professional_id), Number(ctx.professionalId));
  assert.equal(Number(indicator.service_id), Number(ctx.serviceId));
  assert.equal(indicator.procedure_name, "Perfuração de lóbulo");
  assert.equal(indicator.body_region, "Lóbulo esquerdo");
  assert.equal(Number(indicator.jewelry_id), Number(ctx.jewelryId));
  assert.equal(indicator.jewelry_name, "Labret Titânio Polido");
  assert.equal(indicator.indicator_lot, "LOTE-001");
  assert.equal(indicator.indicator_date, "2026-09-20");
  assert.equal(indicator.result, "aprovado");
  assert.equal(indicator.status, "ativo");
  assert.equal(indicator.is_voided, false);
  assert.equal(indicator.service_execution_id, null, "sem execução ainda, o vínculo fica para a finalização");
  assert.equal(indicator.created_by_name, "Usuário piercer");
  assert.match(indicator.photo_url, /^\/api\/private-files\/[a-f0-9]+\.webp$/);
  assert.equal(created.json.indicators.length, 1, "a resposta já traz o painel atualizado");
  assert.equal(created.json.procedures.length, 2);
  ctx.photoIndicator = indicator;

  const stored = await tenantDb((db) => db.get("SELECT purpose, uploaded_by FROM private_files WHERE filename=?", [indicator.photo_filename]));
  assert.equal(stored.purpose, "chemical_indicator");

  const photoPath = indicator.photo_url.replace(/^\/api/, "");
  const own = await api(photoPath);
  assert.equal(own.status, 200);
  assert.match(own.headers.get("content-type") || "", /^image\/webp\b/);
  assert.equal(own.headers.get("cache-control"), "private, no-store");
  const reception = await as("reception", photoPath);
  assert.equal(reception.status, 403, "recepção não lê foto clínica");
});

test("registro sem item usa o nome informado; item de outro atendimento é recusado", async () => {
  const named = await api(`/appointments/${ctx.appointment.id}/chemical-indicators`, {
    method: "POST",
    body: { procedure_name: "Troca de joia", identification: "Pacote 7" }
  });
  assert.equal(named.status, 201, JSON.stringify(named.json));
  assert.equal(named.json.indicator.appointment_item_id, null);
  assert.equal(named.json.indicator.procedure_name, "Troca de joia");
  assert.equal(named.json.indicator.result, "nao_informado");

  const other = await createAppointment({ clientId: ctx.clientId, fullName: "Cliente Indicador", whatsapp: "11988887701", date: "2026-09-21", time: "11:00" });
  const foreignItem = await api(`/appointments/${ctx.appointment.id}/chemical-indicators`, {
    method: "POST", body: { appointment_item_id: other.items[0].id, indicator_lot: "L-X" }
  });
  assert.equal(foreignItem.status, 400, JSON.stringify(foreignItem.json));
  assert.match(foreignItem.json.error, /não pertence/);
  ctx.otherAppointment = other;
});

test("exige ao menos um dado do indicador e data válida", async () => {
  const path = `/appointments/${ctx.appointment.id}/chemical-indicators`;
  const empty = await api(path, { method: "POST", body: indicatorForm({ appointment_item_id: ctx.items[1].id, indicator_brand: "Só marca" }) });
  assert.equal(empty.status, 400, JSON.stringify(empty.json));
  assert.equal(empty.json.error, "Informe ao menos o tipo, o lote, a identificação ou a foto do indicador.");

  for (const indicatorDate of ["30/09/2026", "2026-02-30", "2999-01-01"]) {
    const invalid = await api(path, { method: "POST", body: { appointment_item_id: ctx.items[1].id, indicator_lot: "L2", indicator_date: indicatorDate } });
    assert.equal(invalid.status, 400, `${indicatorDate}: ${JSON.stringify(invalid.json)}`);
  }
  const badResult = await api(path, { method: "POST", body: { indicator_lot: "L2", result: "talvez" } });
  assert.equal(badResult.status, 400, JSON.stringify(badResult.json));

  // Dois procedimentos e nenhum indicado: não dá para adivinhar a qual deles
  // o indicador pertence.
  const noProcedure = await api(path, { method: "POST", body: { indicator_lot: "L2" } });
  assert.equal(noProcedure.status, 400, JSON.stringify(noProcedure.json));
  assert.match(noProcedure.json.error, /selecione/);

  const notImage = new FormData();
  notImage.append("indicator_lot", "L3");
  notImage.append("photo", new Blob([Buffer.from("%PDF-1.4\n%%EOF")], { type: "application/pdf" }), "etiqueta.pdf");
  const pdf = await api(path, { method: "POST", body: notImage });
  assert.equal(pdf.status, 400, JSON.stringify(pdf.json));
  assert.match(pdf.json.error, /JPEG, PNG ou WebP/);

  const count = await tenantDb((db) => db.get("SELECT COUNT(*)::int AS total FROM procedure_chemical_indicators WHERE appointment_id=?", [ctx.appointment.id]));
  assert.equal(count.total, 2, "nenhum registro recusado pode ter sido gravado");
});

test("permissões: recepção vê o painel sem a foto, mas não registra nem anula nem lê o histórico clínico", async () => {
  const panel = await as("reception", `/appointments/${ctx.appointment.id}/chemical-indicators`);
  assert.equal(panel.status, 200, JSON.stringify(panel.json));
  const withPhoto = panel.json.indicators.find((item) => item.id === ctx.photoIndicator.id);
  assert.equal(withPhoto.has_photo, true);
  assert.equal(withPhoto.photo_url, null);

  const create = await as("reception", `/appointments/${ctx.appointment.id}/chemical-indicators`, {
    method: "POST", body: { indicator_lot: "L-REC" }
  });
  assert.equal(create.status, 403, JSON.stringify(create.json));
  const voided = await as("reception", `/appointments/${ctx.appointment.id}/chemical-indicators/${ctx.photoIndicator.id}/void`, {
    method: "POST", body: { reason: "Teste" }
  });
  assert.equal(voided.status, 403, JSON.stringify(voided.json));
  const history = await as("reception", `/clients/${ctx.clientId}/chemical-indicators`);
  assert.equal(history.status, 403, JSON.stringify(history.json));
});

test("permissão individual: piercer sem clinical_files.edit recebe 403", async () => {
  const target = ctx.userIds.piercer;
  const denied = await api(`/users/${target}/permissions`, {
    method: "PUT",
    body: { reason: "Teste de autorização do indicador", overrides: [{ permission: "clinical_files.edit", allowed: false }] }
  });
  assert.equal(denied.status, 200, JSON.stringify(denied.json));
  const blocked = await as("piercer", `/appointments/${ctx.appointment.id}/chemical-indicators`, {
    method: "POST", body: { indicator_lot: "L-BLOQ" }
  });
  assert.equal(blocked.status, 403, JSON.stringify(blocked.json));
  const restored = await api(`/users/${target}/permissions`, { method: "PUT", body: { reason: "Restaurar padrão", overrides: [] } });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
});

test("anulação exige motivo, é única e fica na auditoria com antes e depois", async () => {
  const base = `/appointments/${ctx.appointment.id}/chemical-indicators/${ctx.photoIndicator.id}/void`;
  const noReason = await api(base, { method: "POST", body: { reason: "  " } });
  assert.equal(noReason.status, 400, JSON.stringify(noReason.json));

  const voided = await api(base, { method: "POST", body: { reason: "Etiqueta de outro pacote" } });
  assert.equal(voided.status, 200, JSON.stringify(voided.json));
  assert.equal(voided.json.indicator.status, "anulado");
  assert.equal(voided.json.indicator.is_voided, true);
  assert.equal(voided.json.indicator.void_reason, "Etiqueta de outro pacote");
  assert.ok(voided.json.indicator.voided_at);
  assert.match(voided.json.indicator.voided_by_name, /^administrador qa$/i);
  assert.ok(voided.json.indicators.some((item) => item.id === ctx.photoIndicator.id && item.is_voided), "o painel mantém o anulado");

  const again = await api(base, { method: "POST", body: { reason: "De novo" } });
  assert.equal(again.status, 409, JSON.stringify(again.json));
  const wrongAppointment = await api(`/appointments/${ctx.otherAppointment.id}/chemical-indicators/${ctx.photoIndicator.id}/void`, {
    method: "POST", body: { reason: "Atendimento errado" }
  });
  assert.equal(wrongAppointment.status, 404, JSON.stringify(wrongAppointment.json));

  const stillThere = await tenantDb((db) => db.get("SELECT id FROM procedure_chemical_indicators WHERE id=?", [ctx.photoIndicator.id]));
  assert.ok(stillThere, "anular nunca apaga");

  const createEvents = await auditEvents("chemical_indicator_create");
  const createEvent = createEvents.find((event) => String(event.entity_id) === String(ctx.photoIndicator.id));
  assert.ok(createEvent, JSON.stringify(createEvents));
  assert.equal(createEvent.entity_type, "chemical_indicator");
  assert.equal(createEvent.after_data.indicator_lot, "LOTE-001");
  assert.equal(createEvent.after_data.has_photo, true);
  assert.equal(Number(createEvent.metadata.appointment_id), Number(ctx.appointment.id));

  const voidEvents = await auditEvents("chemical_indicator_void");
  const voidEvent = voidEvents.find((event) => String(event.entity_id) === String(ctx.photoIndicator.id));
  assert.ok(voidEvent, JSON.stringify(voidEvents));
  assert.equal(voidEvent.reason, "Etiqueta de outro pacote");
  assert.equal(voidEvent.before_data.status, "ativo");
  assert.equal(voidEvent.after_data.status, "anulado");
});

test("agendamento legado sem itens: o nome do procedimento do painel mantém região e joia", async () => {
  // Cliente próprio: não interfere nas contagens do histórico abaixo.
  const legacy = await createAppointment({ fullName: "Cliente Legado", whatsapp: "11988887711", date: "2026-09-19", time: "08:00" });
  await tenantDb(async (db) => {
    await db.run("DELETE FROM appointment_items WHERE appointment_id=?", [legacy.id]);
    await db.run("UPDATE appointments SET jewelry_id=? WHERE id=?", [ctx.jewelryId, legacy.id]);
  });
  const panel = await api(`/appointments/${legacy.id}/chemical-indicators`);
  assert.equal(panel.status, 200, JSON.stringify(panel.json));
  assert.equal(panel.json.procedures.length, 1);
  const [procedure] = panel.json.procedures;
  assert.equal(procedure.appointment_item_id, null);

  // É exatamente o que o painel envia quando o procedimento não tem item.
  const created = await api(`/appointments/${legacy.id}/chemical-indicators`, {
    method: "POST", body: indicatorForm({ procedure_name: procedure.procedure_name, indicator_lot: "L-LEGADO" })
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.indicator.procedure_name, "Perfuração QA");
  assert.equal(created.json.indicator.body_region, "Orelha");
  assert.equal(Number(created.json.indicator.jewelry_id), Number(ctx.jewelryId));
  assert.equal(created.json.indicator.jewelry_name, "Labret Titânio Polido");
});

test("histórico do cliente vem do atendimento mais recente para o mais antigo", async () => {
  const later = await api(`/appointments/${ctx.otherAppointment.id}/chemical-indicators`, {
    method: "POST", body: { appointment_item_id: ctx.otherAppointment.items[0].id, indicator_type: "Classe 5 — integrador", result: "reprovado" }
  });
  assert.equal(later.status, 201, JSON.stringify(later.json));

  const history = await api(`/clients/${ctx.clientId}/chemical-indicators`);
  assert.equal(history.status, 200, JSON.stringify(history.json));
  assert.equal(Number(history.json.client.id), Number(ctx.clientId));
  const items = history.json.indicators;
  assert.equal(items.length, 3);
  assert.equal(items[0].appointment_date, "2026-09-21", "o atendimento mais recente vem primeiro");
  assert.equal(items[0].result, "reprovado");
  assert.ok(items.every((item, index) => index === 0 || items[index - 1].appointment_date >= item.appointment_date));
  assert.equal(items.find((item) => item.id === ctx.photoIndicator.id).is_voided, true);
  assert.equal(items[0].professional_name, "Piercer Indicador");

  const activeOnly = await api(`/clients/${ctx.clientId}/chemical-indicators?include_voided=false`);
  assert.equal(activeOnly.json.indicators.length, 2);

  const missing = await api("/clients/99999999/chemical-indicators");
  assert.equal(missing.status, 404, JSON.stringify(missing.json));

  const audit = await api(`/privacy/audit?client_id=${ctx.clientId}&action=chemical_indicator_history_read`);
  assert.equal(audit.status, 200, JSON.stringify(audit.json));
  assert.ok(audit.json.items.length >= 1, "a leitura do histórico clínico fica na trilha de privacidade");
});

test("atendimento cancelado ou sem comparecimento não recebe indicador (409)", async () => {
  const cancelled = await createAppointment({ clientId: ctx.clientId, fullName: "Cliente Indicador", whatsapp: "11988887701", date: "2026-09-22", time: "09:00" });
  for (const status of ["cancelado", "nao_compareceu"]) {
    await tenantDb((db) => db.run("UPDATE appointments SET status=? WHERE id=?", [status, cancelled.id]));
    const blocked = await api(`/appointments/${cancelled.id}/chemical-indicators`, {
      method: "POST", body: indicatorForm({ indicator_lot: "L-CANC" }, { photo: true })
    });
    assert.equal(blocked.status, 409, `${status}: ${JSON.stringify(blocked.json)}`);
  }
  const files = await tenantDb((db) => db.get("SELECT COUNT(*)::int AS total FROM private_files WHERE purpose='chemical_indicator'"));
  assert.equal(files.total, 1, "foto recusada não é registrada no cofre");
});

test("execução existente vincula na hora; linkIndicatorsToExecution vincula os pendentes", async () => {
  const appointment = await createAppointment({ clientId: ctx.clientId, fullName: "Cliente Indicador", whatsapp: "11988887701", date: "2026-09-23", time: "15:00" });
  const before = await api(`/appointments/${appointment.id}/chemical-indicators`, {
    method: "POST", body: { appointment_item_id: appointment.items[0].id, indicator_lot: "L-ANTES" }
  });
  assert.equal(before.status, 201, JSON.stringify(before.json));
  assert.equal(before.json.indicator.service_execution_id, null);

  const executionId = await tenantDb(async (db) => {
    await db.run("UPDATE appointments SET status='atendido' WHERE id=?", [appointment.id]);
    const inserted = await db.run(
      "INSERT INTO service_executions (appointment_id, client_id, professional_id, service_id) VALUES (?, ?, ?, ?) RETURNING id",
      [appointment.id, appointment.client_id, ctx.professionalId, ctx.serviceId]
    );
    return inserted.returnedId;
  });

  const afterExecution = await api(`/appointments/${appointment.id}/chemical-indicators`, {
    method: "POST", body: { appointment_item_id: appointment.items[0].id, identification: "Ciclo 99" }
  });
  assert.equal(afterExecution.status, 201, JSON.stringify(afterExecution.json));
  assert.equal(Number(afterExecution.json.indicator.service_execution_id), Number(executionId), "execução já existe: vínculo imediato");

  const linked = await tenantDb(async (db) => ({
    wrongExecution: await linkIndicatorsToExecution(db, ctx.appointment.id, executionId),
    first: await linkIndicatorsToExecution(db, appointment.id, executionId),
    second: await linkIndicatorsToExecution(db, appointment.id, executionId),
    rows: await db.all("SELECT service_execution_id FROM procedure_chemical_indicators WHERE appointment_id=?", [appointment.id])
  }));
  assert.equal(linked.wrongExecution, 0, "execução de outro atendimento não vincula nada");
  assert.equal(linked.first, 1, "só o registro sem vínculo é atualizado");
  assert.equal(linked.second, 0, "chamada repetida é inócua");
  assert.ok(linked.rows.every((row) => Number(row.service_execution_id) === Number(executionId)));
});

test("exportação LGPD inclui os indicadores sem expor o arquivo da foto", async () => {
  const request = await api("/privacy/data-subject-requests", {
    method: "POST", body: { client_id: ctx.clientId, request_type: "access", notes: "Pedido do titular." }
  });
  assert.equal(request.status, 201, JSON.stringify(request.json));
  await api(`/privacy/data-subject-requests/${request.json.id}`, { method: "PATCH", body: { status: "identity_verified" } });
  const exported = await api(`/privacy/data-subject-requests/${request.json.id}/export`);
  assert.equal(exported.status, 200, JSON.stringify(exported.json));
  const indicators = exported.json.chemical_indicators;
  assert.ok(Array.isArray(indicators) && indicators.length >= 3, JSON.stringify(exported.json));
  const withPhoto = indicators.find((item) => item.id === ctx.photoIndicator.id);
  assert.equal(withPhoto.has_photo, true);
  assert.equal(withPhoto.photo_filename, undefined);
  assert.equal(withPhoto.status, "anulado");
});

test("mesclagem de clientes leva os indicadores para o cadastro de destino", async () => {
  const target = await api("/clients", { method: "POST", body: { full_name: "Destino Indicador", whatsapp: "11988887799" } });
  assert.equal(target.status, 201, JSON.stringify(target.json));
  const source = await api("/clients", { method: "POST", body: { full_name: "Origem Indicador", whatsapp: "11988887798" } });
  const appointment = await createAppointment({ clientId: source.json.id, fullName: "Origem Indicador", whatsapp: "11988887798", date: "2026-09-24", time: "13:00" });
  const created = await api(`/appointments/${appointment.id}/chemical-indicators`, { method: "POST", body: { indicator_lot: "L-MERGE" } });
  assert.equal(created.status, 201, JSON.stringify(created.json));

  const merged = await api(`/clients/${source.json.id}/merge`, {
    method: "POST", body: { target_client_id: target.json.id, confirmation: "MESCLAR CLIENTES", reason: "Cadastro duplicado do indicador" }
  });
  assert.equal(merged.status, 200, JSON.stringify(merged.json));
  assert.equal(merged.json.moved_records.procedure_chemical_indicators, 1);
  const history = await api(`/clients/${target.json.id}/chemical-indicators`);
  assert.equal(history.status, 200, JSON.stringify(history.json));
  assert.deepEqual(history.json.indicators.map((item) => item.indicator_lot), ["L-MERGE"]);
});
