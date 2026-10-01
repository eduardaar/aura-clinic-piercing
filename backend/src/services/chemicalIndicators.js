// Indicadores químicos por procedimento realizado.
//
// Cada linha de `procedure_chemical_indicators` registra o indicador de
// esterilização usado num procedimento específico do atendimento (tipo, marca,
// lote, data, identificação do ciclo, resultado e foto da etiqueta).
//
// Decisões que moldam este arquivo:
//  - O procedimento é FOTOGRAFADO na linha (nome, região, joia). Os itens do
//    agendamento podem ser regravados numa edição, então `appointment_item_id`
//    é só referência informativa; o histórico continua legível mesmo que o
//    item, o serviço ou a joia mudem de nome ou deixem de existir.
//  - Registro nunca é apagado nem editado: corrigir é anular com motivo e
//    registrar de novo. Assim a trilha clínica responde "quem registrou o quê,
//    quando, e por que foi anulado".
//  - A foto passa pelo mesmo cofre privado do `reference_photo` (purpose
//    "chemical_indicator") e é servida por GET /api/private-files/<arquivo>,
//    que já audita a leitura.
import { registerPrivateFiles } from "../middleware/upload.js";
import { recordAudit } from "./audit.js";
import { localDate } from "./utils.js";

export class ChemicalIndicatorError extends Error {
  constructor(message, status = 400, code = "chemical_indicator_invalid") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const CHEMICAL_INDICATOR_RESULTS = Object.freeze(["aprovado", "reprovado", "nao_informado"]);
export const CHEMICAL_INDICATOR_PHOTO_PURPOSE = "chemical_indicator";

// Atendimento que não aconteceu não tem procedimento a rastrear. Registrar
// indicador nele criaria uma prova de esterilização de algo que nunca foi feito.
const BLOCKED_APPOINTMENT_STATUSES = Object.freeze({
  cancelado: "Não é possível registrar indicador químico em atendimento cancelado.",
  nao_compareceu: "Não é possível registrar indicador químico em atendimento sem comparecimento.",
  recusado: "Não é possível registrar indicador químico em atendimento recusado.",
  remarcado: "Não é possível registrar indicador químico em atendimento remarcado; use o novo agendamento."
});

// Limites de tamanho: generosos para o que vem impresso numa etiqueta, mas
// fechados para que um campo de texto não vire depósito de prontuário.
const LIMITS = Object.freeze({
  procedure_name: 200,
  indicator_type: 120,
  indicator_brand: 120,
  indicator_lot: 120,
  identification: 160,
  notes: 2000,
  void_reason: 500
});

// Remove caracteres de controle (exceto \t, \n e \r, tratados abaixo). Sem
// regex de propósito: o lint proíbe controle dentro de expressão regular.
function stripControl(value) {
  let output = "";
  for (const char of String(value ?? "")) {
    const code = char.codePointAt(0);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) continue;
    output += char;
  }
  return output;
}

function cleanText(value, max) {
  // Quebras de linha só fazem sentido nas observações; nos demais campos
  // viram espaço para a etiqueta continuar buscável por lote/identificação.
  return stripControl(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
}

function cleanMultiline(value, max) {
  return stripControl(value)
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);
}

const MAX_DB_INTEGER = 2147483647;

function optionalPositiveId(value, message) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw || raw === "null" || raw === "undefined") return null;
  const id = Number(raw);
  // Teto do INTEGER do Postgres: id maior viraria erro do banco (500) em vez
  // de "não encontrado"/"inválido".
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id <= 0 || id > MAX_DB_INTEGER) {
    throw new ChemicalIndicatorError(message);
  }
  return id;
}

/**
 * Valida uma data AAAA-MM-DD de calendário real (30/02 não passa) e recusa
 * data futura no fuso da clínica: o indicador registra uma esterilização que
 * já aconteceu.
 */
export function normalizeIndicatorDate(value, today = localDate()) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) throw new ChemicalIndicatorError("Informe a data do indicador no formato AAAA-MM-DD.");
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    year < 2000
  ) {
    throw new ChemicalIndicatorError("Informe uma data do indicador válida.");
  }
  if (raw > today) throw new ChemicalIndicatorError("A data do indicador não pode ser futura.");
  return raw;
}

/**
 * Normaliza o corpo do registro (JSON ou multipart, onde tudo chega como
 * texto). Função pura: não toca no banco, para ser testável sem servidor.
 * @param {Record<string, any>} body
 * @param {{ hasPhoto?: boolean, today?: string }} [options]
 */
export function normalizeChemicalIndicatorInput(body = {}, { hasPhoto = false, today } = {}) {
  const input = {
    appointment_item_id: optionalPositiveId(body.appointment_item_id, "Selecione um procedimento válido do atendimento."),
    procedure_name: cleanText(body.procedure_name, LIMITS.procedure_name),
    indicator_type: cleanText(body.indicator_type, LIMITS.indicator_type),
    indicator_brand: cleanText(body.indicator_brand, LIMITS.indicator_brand),
    indicator_lot: cleanText(body.indicator_lot, LIMITS.indicator_lot),
    indicator_date: normalizeIndicatorDate(body.indicator_date, today),
    identification: cleanText(body.identification, LIMITS.identification),
    result: cleanText(body.result, 40).toLowerCase() || "nao_informado",
    notes: cleanMultiline(body.notes, LIMITS.notes)
  };
  if (!CHEMICAL_INDICATOR_RESULTS.includes(input.result)) {
    throw new ChemicalIndicatorError("Resultado do indicador inválido. Use aprovado, reprovado ou não informado.");
  }
  // Mesmo critério da constraint da migration 0040, mas com mensagem útil
  // antes de chegar ao banco (e antes de subir a foto para o cofre).
  if (!input.indicator_type && !input.indicator_lot && !input.identification && !hasPhoto) {
    throw new ChemicalIndicatorError("Informe ao menos o tipo, o lote, a identificação ou a foto do indicador.");
  }
  return input;
}

export function normalizeVoidReason(value) {
  // Objeto/array viraria "[object Object]" e passaria como motivo.
  if (value != null && typeof value !== "string") throw new ChemicalIndicatorError("Informe o motivo da anulação.");
  const reason = cleanMultiline(value, LIMITS.void_reason + 1);
  if (!reason) throw new ChemicalIndicatorError("Informe o motivo da anulação.");
  if (reason.length > LIMITS.void_reason) {
    throw new ChemicalIndicatorError(`O motivo da anulação deve ter no máximo ${LIMITS.void_reason} caracteres.`);
  }
  return reason;
}

const INDICATOR_SELECT = `
  SELECT pci.*, cu.name AS created_by_name, vu.name AS voided_by_name
  FROM procedure_chemical_indicators pci
  LEFT JOIN users cu ON cu.id = pci.created_by_user_id
  LEFT JOIN users vu ON vu.id = pci.voided_by_user_id
`;

/**
 * Formato devolvido pela API. A URL da foto só sai para quem pode ver arquivo
 * clínico; os demais recebem apenas `has_photo` (a rota do arquivo recusaria
 * a leitura de qualquer forma, e o nome do arquivo não precisa circular).
 */
export function serializeIndicator(row, { canViewPhoto = true } = {}) {
  if (!row) return null;
  const hasPhoto = Boolean(row.photo_filename);
  const { photo_filename: photoFilename, ...rest } = row;
  return {
    ...rest,
    photo_filename: canViewPhoto ? photoFilename || null : null,
    has_photo: hasPhoto,
    photo_url: hasPhoto && canViewPhoto ? `/api/private-files/${photoFilename}` : null,
    is_voided: row.status === "anulado"
  };
}

/**
 * Procedimentos do atendimento, no formato que o painel precisa para oferecer
 * "registrar indicador neste procedimento". Linhas só de joia (o agendamento
 * público grava serviço e joia em linhas separadas) não são procedimentos;
 * quando há um único procedimento, a joia dessas linhas é atribuída a ele.
 * Agendamento legado sem itens vira um procedimento sem `appointment_item_id`.
 */
export async function listAppointmentProcedures(db, appointment) {
  const items = await db.all(`
    SELECT ai.id, ai.service_id, ai.procedure_id, ai.region, ai.jewelry_id, ai.jewelry_variant_id, ai.quantity,
      s.name AS service_name, p.name AS procedure_label, j.name AS jewelry_name,
      v.variation_name AS jewelry_variation_name
    FROM appointment_items ai
    LEFT JOIN services s ON s.id = ai.service_id
    LEFT JOIN procedures p ON p.id = ai.procedure_id
    LEFT JOIN jewelry_inventory j ON j.id = ai.jewelry_id
    LEFT JOIN jewelry_variants v ON v.id = ai.jewelry_variant_id
    WHERE ai.appointment_id = ?
    ORDER BY ai.id
  `, [appointment.id]);

  if (!items.length) {
    const jewelry = appointment.jewelry_id
      ? await db.get("SELECT id, name FROM jewelry_inventory WHERE id = ?", [appointment.jewelry_id])
      : null;
    return [{
      appointment_item_id: null,
      service_id: appointment.service_id || null,
      procedure_id: null,
      procedure_name: appointment.procedure || "Atendimento",
      body_region: appointment.piercing_region || null,
      jewelry_id: jewelry?.id || null,
      jewelry_name: jewelry?.name || null,
      jewelry_variant_id: appointment.jewelry_variant_id || null,
      jewelry_variation_name: null,
      quantity: 1
    }];
  }

  const procedureItems = items.filter((item) => item.service_id || item.procedure_id);
  const jewelryOnly = items.filter((item) => !item.service_id && !item.procedure_id && item.jewelry_id);
  const base = procedureItems.length ? procedureItems : items;
  const loneJewelry = procedureItems.length === 1 && jewelryOnly.length ? jewelryOnly[0] : null;
  return base.map((item) => {
    const jewelrySource = item.jewelry_id ? item : loneJewelry || item;
    return {
      appointment_item_id: item.id,
      service_id: item.service_id || null,
      procedure_id: item.procedure_id || null,
      procedure_name: item.procedure_label || item.service_name || appointment.procedure || "Atendimento",
      body_region: item.region || null,
      jewelry_id: jewelrySource.jewelry_id || null,
      jewelry_name: jewelrySource.jewelry_name || null,
      jewelry_variant_id: jewelrySource.jewelry_variant_id || null,
      jewelry_variation_name: jewelrySource.jewelry_variation_name || null,
      quantity: Number(item.quantity || 1)
    };
  });
}

export async function listAppointmentIndicators(db, appointmentId, { canViewPhoto = true } = {}) {
  const rows = await db.all(`${INDICATOR_SELECT} WHERE pci.appointment_id = ? ORDER BY pci.created_at, pci.id`, [appointmentId]);
  return rows.map((row) => serializeIndicator(row, { canViewPhoto }));
}

async function loadAppointment(db, appointmentId, { lock = false } = {}) {
  const id = optionalPositiveId(appointmentId, "Agendamento inválido.");
  if (!id) throw new ChemicalIndicatorError("Agendamento não encontrado.", 404, "appointment_not_found");
  const appointment = await db.get(
    `SELECT id, client_id, professional_id, service_id, jewelry_id, jewelry_variant_id, procedure, piercing_region,
       appointment_date, appointment_time, status
     FROM appointments WHERE id = ?${lock ? " FOR UPDATE" : ""}`,
    [id]
  );
  if (!appointment) throw new ChemicalIndicatorError("Agendamento não encontrado.", 404, "appointment_not_found");
  return appointment;
}

/** Payload completo do painel: procedimentos + indicadores (inclui anulados). */
export async function getAppointmentChemicalIndicators(db, appointmentId, { canViewPhoto = true } = {}) {
  const appointment = await loadAppointment(db, appointmentId);
  return {
    appointment: {
      id: appointment.id,
      client_id: appointment.client_id,
      status: appointment.status,
      appointment_date: appointment.appointment_date
    },
    procedures: await listAppointmentProcedures(db, appointment),
    indicators: await listAppointmentIndicators(db, appointment.id, { canViewPhoto })
  };
}

/**
 * Registra um indicador. `file` é o `req.file` já validado e convertido por
 * `parseUpload`; ele só é gravado no cofre DEPOIS de o atendimento e o
 * procedimento terem sido validados, para recusa não deixar arquivo órfão.
 */
export async function createChemicalIndicator(db, { appointmentId, body = {}, file = null, req = null }) {
  const input = normalizeChemicalIndicatorInput(body, { hasPhoto: Boolean(file) });
  const userId = req?.user?.id || null;
  return db.transaction(async (tx) => {
    // Trava o atendimento: um cancelamento concorrente não pode passar entre a
    // checagem de status e a gravação do indicador.
    const appointment = await loadAppointment(tx, appointmentId, { lock: true });
    const blocked = BLOCKED_APPOINTMENT_STATUSES[appointment.status];
    if (blocked) throw new ChemicalIndicatorError(blocked, 409, "appointment_not_active");

    const procedures = await listAppointmentProcedures(tx, appointment);
    let procedure;
    if (input.appointment_item_id) {
      const ownsItem = await tx.get(
        "SELECT id FROM appointment_items WHERE id = ? AND appointment_id = ?",
        [input.appointment_item_id, appointment.id]
      );
      if (!ownsItem) throw new ChemicalIndicatorError("O procedimento informado não pertence a este atendimento.");
      // Item que existe mas não aparece como procedimento (linha só de joia
      // quando há procedimentos) ainda recebe o retrato da própria linha.
      procedure = procedures.find((item) => Number(item.appointment_item_id) === input.appointment_item_id)
        || (await listItemSnapshot(tx, input.appointment_item_id, appointment));
    } else {
      procedure = resolveProcedureWithoutItem(procedures, input.procedure_name);
    }

    // Se a execução já existe (registro feito depois da finalização), o
    // vínculo vale desde já; senão a finalização faz isso em
    // linkIndicatorsToExecution.
    const execution = await tx.get(
      "SELECT id FROM service_executions WHERE appointment_id = ? AND status <> 'cancelled'",
      [appointment.id]
    );

    let photoFilename = null;
    if (file) {
      await registerPrivateFiles(tx, file, CHEMICAL_INDICATOR_PHOTO_PURPOSE, userId);
      photoFilename = file.filename;
    }

    const inserted = await tx.run(
      `INSERT INTO procedure_chemical_indicators
        (appointment_id, service_execution_id, appointment_item_id, client_id, professional_id, service_id, procedure_id,
         procedure_name, body_region, jewelry_id, jewelry_name, indicator_type, indicator_brand, indicator_lot,
         indicator_date, identification, result, photo_filename, notes, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        appointment.id, execution?.id || null, procedure.appointment_item_id || null, appointment.client_id,
        appointment.professional_id || null, procedure.service_id || null, procedure.procedure_id || null,
        procedure.procedure_name, procedure.body_region || null, procedure.jewelry_id || null, procedure.jewelry_name || null,
        input.indicator_type || null, input.indicator_brand || null, input.indicator_lot || null,
        input.indicator_date, input.identification || null, input.result, photoFilename, input.notes || null, userId
      ]
    );
    const row = await tx.get(`${INDICATOR_SELECT} WHERE pci.id = ?`, [inserted.returnedId]);
    await recordAudit(tx, {
      req, module: "clinical", action: "chemical_indicator_create", entityType: "chemical_indicator", entityId: row.id,
      reason: "Indicador químico registrado",
      after: auditSnapshot(row),
      metadata: { appointment_id: appointment.id, client_id: appointment.client_id, appointment_status: appointment.status },
      severity: appointment.status === "atendido" ? "warning" : "info"
    });
    return serializeIndicator(row);
  });
}

const comparableName = (value) => String(value ?? "").normalize("NFC").trim().toLocaleLowerCase("pt-BR");

/**
 * Retrato do procedimento quando o registro chega SEM `appointment_item_id`.
 *
 *  - O nome informado coincide com UM procedimento do atendimento (é o que o
 *    painel manda no agendamento legado, cujo procedimento não tem item):
 *    vale o retrato completo dele, joia inclusive.
 *  - Sem nome e com um único procedimento: é ele.
 *  - Nome livre que não é de nenhum procedimento: fica só o nome. Herdar
 *    serviço/região/joia de outro procedimento atribuiria o indicador ao
 *    procedimento errado nos relatórios de biossegurança.
 *  - Sem nome, ou nome repetido, com vários procedimentos: não há como saber
 *    a qual deles o indicador pertence — o registro é recusado.
 */
export function resolveProcedureWithoutItem(procedures, procedureName) {
  const list = Array.isArray(procedures) ? procedures : [];
  const pick = (item) => ({
    appointment_item_id: item.appointment_item_id || null,
    service_id: item.service_id || null,
    procedure_id: item.procedure_id || null,
    procedure_name: item.procedure_name,
    body_region: item.body_region || null,
    jewelry_id: item.jewelry_id || null,
    jewelry_name: item.jewelry_name || null
  });
  const ambiguous = () => new ChemicalIndicatorError(
    "Este atendimento tem mais de um procedimento; selecione a qual deles o indicador pertence.",
    400,
    "procedure_required"
  );
  if (procedureName) {
    const wanted = comparableName(procedureName);
    const matches = list.filter((item) => comparableName(item.procedure_name) === wanted);
    if (matches.length === 1) return pick(matches[0]);
    if (matches.length > 1) throw ambiguous();
    return {
      appointment_item_id: null, service_id: null, procedure_id: null, procedure_name: procedureName,
      body_region: null, jewelry_id: null, jewelry_name: null
    };
  }
  if (list.length === 1) return pick(list[0]);
  throw ambiguous();
}

async function listItemSnapshot(db, itemId, appointment) {
  const item = await db.get(`
    SELECT ai.id, ai.service_id, ai.procedure_id, ai.region, ai.jewelry_id, s.name AS service_name,
      p.name AS procedure_label, j.name AS jewelry_name
    FROM appointment_items ai
    LEFT JOIN services s ON s.id = ai.service_id
    LEFT JOIN procedures p ON p.id = ai.procedure_id
    LEFT JOIN jewelry_inventory j ON j.id = ai.jewelry_id
    WHERE ai.id = ?
  `, [itemId]);
  return {
    appointment_item_id: item.id,
    service_id: item.service_id || null,
    procedure_id: item.procedure_id || null,
    procedure_name: item.procedure_label || item.service_name || item.jewelry_name || appointment.procedure || "Atendimento",
    body_region: item.region || null,
    jewelry_id: item.jewelry_id || null,
    jewelry_name: item.jewelry_name || null
  };
}

// O que vai para a auditoria: dados do registro, sem o conteúdo da foto (só
// se ela existe) — a trilha não pode virar uma segunda cópia do arquivo.
function auditSnapshot(row) {
  return {
    id: row.id,
    appointment_id: row.appointment_id,
    appointment_item_id: row.appointment_item_id,
    service_execution_id: row.service_execution_id,
    procedure_name: row.procedure_name,
    body_region: row.body_region,
    jewelry_id: row.jewelry_id,
    jewelry_name: row.jewelry_name,
    indicator_type: row.indicator_type,
    indicator_brand: row.indicator_brand,
    indicator_lot: row.indicator_lot,
    indicator_date: row.indicator_date,
    identification: row.identification,
    result: row.result,
    has_photo: Boolean(row.photo_filename),
    status: row.status,
    void_reason: row.void_reason || null
  };
}

/** Anula (nunca apaga) um indicador do atendimento, com motivo obrigatório. */
export async function voidChemicalIndicator(db, { appointmentId, indicatorId, reason, req = null }) {
  const voidReason = normalizeVoidReason(reason);
  const id = optionalPositiveId(indicatorId, "Indicador inválido.");
  if (!id) throw new ChemicalIndicatorError("Indicador químico não encontrado.", 404, "indicator_not_found");
  return db.transaction(async (tx) => {
    const appointment = await loadAppointment(tx, appointmentId, { lock: true });
    const current = await tx.get(
      `${INDICATOR_SELECT} WHERE pci.id = ? AND pci.appointment_id = ? FOR UPDATE OF pci`,
      [id, appointment.id]
    );
    if (!current) throw new ChemicalIndicatorError("Indicador químico não encontrado.", 404, "indicator_not_found");
    if (current.status === "anulado") throw new ChemicalIndicatorError("Este indicador já foi anulado.", 409, "indicator_already_voided");
    await tx.run(
      `UPDATE procedure_chemical_indicators
       SET status = 'anulado', voided_by_user_id = ?, voided_at = now(), void_reason = ?
       WHERE id = ?`,
      [req?.user?.id || null, voidReason, id]
    );
    const row = await tx.get(`${INDICATOR_SELECT} WHERE pci.id = ?`, [id]);
    await recordAudit(tx, {
      req, module: "clinical", action: "chemical_indicator_void", entityType: "chemical_indicator", entityId: id,
      reason: voidReason,
      before: auditSnapshot(current),
      after: auditSnapshot(row),
      metadata: { appointment_id: appointment.id, client_id: appointment.client_id, appointment_status: appointment.status },
      severity: "warning"
    });
    return serializeIndicator(row);
  });
}

/**
 * Histórico do cliente: Cliente → Data → Procedimento → Joia → Indicador →
 * Foto → Lote/identificação, do atendimento mais recente para o mais antigo.
 * Anulados vêm junto (com `is_voided`), salvo `includeVoided: false`.
 */
export async function listClientChemicalIndicators(db, clientId, { canViewPhoto = true, includeVoided = true } = {}) {
  const id = optionalPositiveId(clientId, "Cliente inválido.");
  const client = id ? await db.get("SELECT id, full_name, deleted_at FROM clients WHERE id = ?", [id]) : null;
  if (!client || client.deleted_at) throw new ChemicalIndicatorError("Cliente não encontrado.", 404, "client_not_found");
  const rows = await db.all(`
    SELECT pci.*, cu.name AS created_by_name, vu.name AS voided_by_name,
      a.appointment_date, a.appointment_time, a.status AS appointment_status,
      pr.name AS professional_name
    FROM procedure_chemical_indicators pci
    JOIN appointments a ON a.id = pci.appointment_id
    LEFT JOIN professionals pr ON pr.id = pci.professional_id
    LEFT JOIN users cu ON cu.id = pci.created_by_user_id
    LEFT JOIN users vu ON vu.id = pci.voided_by_user_id
    WHERE pci.client_id = ?${includeVoided ? "" : " AND pci.status = 'ativo'"}
    ORDER BY a.appointment_date DESC, a.appointment_time DESC, pci.created_at DESC, pci.id DESC
  `, [client.id]);
  return {
    client: { id: client.id, full_name: client.full_name },
    indicators: rows.map((row) => serializeIndicator(row, { canViewPhoto }))
  };
}

/**
 * Vincula à execução do serviço os indicadores do atendimento ainda sem
 * vínculo. Chamado na mesma transação da finalização.
 * @param {any} db
 * @param {number|string} appointmentId
 * @param {number|string} serviceExecutionId
 * @returns {Promise<number>} quantidade de registros vinculados
 */
export async function linkIndicatorsToExecution(db, appointmentId, serviceExecutionId) {
  const appointment = Number(appointmentId);
  const execution = Number(serviceExecutionId);
  if (!Number.isInteger(appointment) || appointment <= 0 || !Number.isInteger(execution) || execution <= 0) return 0;
  // Anulados também são vinculados: pertencem ao mesmo atendimento e a
  // anulação faz parte da trilha da execução.
  const result = await db.run(
    `UPDATE procedure_chemical_indicators SET service_execution_id = ?
     WHERE appointment_id = ? AND service_execution_id IS NULL
       AND EXISTS (SELECT 1 FROM service_executions se WHERE se.id = ? AND se.appointment_id = ?)`,
    [execution, appointment, execution, appointment]
  );
  return Number(result?.changes || 0);
}
