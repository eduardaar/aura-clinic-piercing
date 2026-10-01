// Ajustes de valor do atendimento (acréscimo/abatimento com motivo).
//
// Ajuste é separado do desconto: tem tipo, motivo obrigatório, autor e data, e
// nunca é editado nem apagado — corrigir é anular com motivo, preservando o
// histórico discriminado. Cada inclusão/anulação recalcula o dinheiro do
// agendamento na MESMA transação (finance.recalculateAppointmentFinancials) e,
// se o atendimento já foi fechado, atualiza a execução, o recebível e a
// comissão pelo mesmo caminho da finalização.
import {
  FinancialRuleError,
  NEGATIVE_NET_MESSAGE,
  parseMoneyInputCents,
  recalculateAppointmentFinancials
} from "./finance.js";
import { hasSettledServiceExecutionReceivable, refreshServiceExecutionFinancials } from "./serviceExecutions.js";
import { refreshAppointmentCommissions } from "./commissions.js";
import { recordAudit } from "./audit.js";

export const ADJUSTMENT_TYPES = Object.freeze(["acrescimo", "abatimento"]);
export const SETTLED_RECEIVABLE_MESSAGE = "Já existe parcela recebida deste atendimento; corrija pelo Financeiro.";
const BLOCKED_STATUSES = new Set(["cancelado", "nao_compareceu"]);
const MAX_REASON = 500;
const MAX_IDEMPOTENCY_KEY = 120;

const cents = (value) => Math.round(Number(value || 0) * 100);

function requiredReason(value, emptyMessage) {
  const reason = String(value ?? "").trim();
  if (!reason) throw new FinancialRuleError(emptyMessage);
  if (reason.length > MAX_REASON) throw new FinancialRuleError(`O motivo deve ter no máximo ${MAX_REASON} caracteres.`);
  return reason;
}

// Valida o corpo do ajuste ANTES de abrir a transação: erro de digitação não
// precisa travar o agendamento.
export function normalizeAdjustmentInput(body = {}, headerIdempotencyKey = "") {
  const adjustmentType = String(body.adjustment_type ?? "").trim().toLowerCase();
  if (!ADJUSTMENT_TYPES.includes(adjustmentType)) {
    throw new FinancialRuleError("Tipo de ajuste inválido. Use acréscimo ou abatimento.");
  }
  const amountCents = parseMoneyInputCents(body.amount, "O valor do ajuste");
  if (!amountCents) throw new FinancialRuleError("Informe um valor de ajuste maior que zero.");
  const reason = requiredReason(body.reason, "Informe o motivo do ajuste.");
  const idempotencyKey = String(headerIdempotencyKey || body.idempotency_key || "").trim();
  if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY) {
    throw new FinancialRuleError(`Idempotency-Key deve ter no máximo ${MAX_IDEMPOTENCY_KEY} caracteres.`);
  }
  return { adjustmentType, amountCents, amount: amountCents / 100, reason, idempotencyKey: idempotencyKey || null };
}

export function normalizeVoidInput(body = {}) {
  return { reason: requiredReason(body.reason, "Informe o motivo da anulação do ajuste.") };
}

const ADJUSTMENT_SELECT = `
  SELECT a.*, cu.name AS created_by_name, vu.name AS voided_by_name
  FROM appointment_value_adjustments a
  LEFT JOIN users cu ON cu.id = a.created_by_user_id
  LEFT JOIN users vu ON vu.id = a.voided_by_user_id`;

// Lista completa (ativos e anulados), na ordem em que foram lançados.
export async function listAppointmentValueAdjustments(db, appointmentId) {
  return db.all(`${ADJUSTMENT_SELECT} WHERE a.appointment_id = ? ORDER BY a.created_at, a.id`, [appointmentId]);
}

async function getAdjustment(db, adjustmentId) {
  return db.get(`${ADJUSTMENT_SELECT} WHERE a.id = ?`, [adjustmentId]);
}

// Regras de estado comuns à inclusão e à anulação, checadas com o
// agendamento já travado.
async function assertAdjustable(tx, appointment, { canEditFinance }) {
  if (BLOCKED_STATUSES.has(appointment.status)) {
    throw new FinancialRuleError("Não é possível ajustar o valor de um atendimento cancelado ou sem comparecimento.", 409);
  }
  if (appointment.status === "atendido") {
    if (!canEditFinance) {
      throw new FinancialRuleError("Você não tem permissão para alterar o valor de um atendimento concluído.", 403);
    }
    if (await hasSettledServiceExecutionReceivable(tx, appointment.id)) {
      throw new FinancialRuleError(SETTLED_RECEIVABLE_MESSAGE, 409);
    }
  }
}

// Confere o líquido resultante: nunca negativo e, quando o valor cai, nunca
// abaixo do que o cliente já pagou (sinal, pagamentos e crédito confirmados).
function assertResultingNet(snapshot, deltaCents, { negativeMessage, belowPaidMessage }) {
  const resulting = cents(snapshot.netBeforeAdjustments) + cents(snapshot.adjustmentTotal) + deltaCents;
  if (resulting < 0) throw new FinancialRuleError(negativeMessage);
  if (deltaCents < 0 && resulting < cents(snapshot.totalPaid)) throw new FinancialRuleError(belowPaidMessage);
  return resulting;
}

function moneySummary(row = {}) {
  return {
    subtotal_value: Number(row.subtotal_value || 0),
    discount_value: Number(row.discount_value || 0),
    adjustment_total: Number(row.adjustment_total || 0),
    total_value: Number(row.total_value || 0),
    remaining_value: Number(row.remaining_value || 0)
  };
}

// Efeitos de um atendimento já fechado: execução e recebível com o novo
// líquido (sem revisão operacional) e comissão recalculada.
async function propagateToClosedAppointment(tx, appointment, { userId, reason }) {
  if (appointment.status !== "atendido") return;
  await refreshServiceExecutionFinancials(tx, appointment.id);
  await refreshAppointmentCommissions(tx, appointment.id, { userId, reason });
}

async function writeFinancialAudit(tx, { appointmentId, userId, action, reason, before, after }) {
  await tx.run(
    "INSERT INTO appointment_financial_audit (appointment_id, user_id, action, reason, before_snapshot, after_snapshot) VALUES (?, ?, ?, ?, ?, ?)",
    [appointmentId, userId, action, reason, JSON.stringify(before), JSON.stringify(after)]
  );
}

/**
 * Inclui um ajuste. Repetir a mesma `idempotency_key` com o mesmo conteúdo
 * devolve o ajuste já gravado (`created: false`); com conteúdo diferente, 409.
 */
export async function createAppointmentValueAdjustment(db, appointmentId, input, { req = null, canEditFinance = false } = {}) {
  const userId = req?.user?.id || null;
  return db.transaction(async (tx) => {
    const current = await recalculateAppointmentFinancials(tx, appointmentId);
    if (!current) throw new FinancialRuleError("Agendamento não encontrado.", 404);
    const appointment = current.appointment;

    if (input.idempotencyKey) {
      const repeated = await tx.get(
        "SELECT * FROM appointment_value_adjustments WHERE appointment_id = ? AND idempotency_key = ?",
        [appointment.id, input.idempotencyKey]
      );
      if (repeated) {
        const sameContent = repeated.adjustment_type === input.adjustmentType &&
          cents(repeated.amount) === input.amountCents && String(repeated.reason) === input.reason;
        if (!sameContent) throw new FinancialRuleError("Esta chave de idempotência já foi usada para outro ajuste.", 409);
        return {
          created: false,
          adjustment: await getAdjustment(tx, repeated.id),
          adjustments: await listAppointmentValueAdjustments(tx, appointment.id),
          financial: current.snapshot
        };
      }
    }

    await assertAdjustable(tx, appointment, { canEditFinance });
    const delta = input.adjustmentType === "abatimento" ? -input.amountCents : input.amountCents;
    const netAfterCents = assertResultingNet(current.snapshot, delta, {
      negativeMessage: NEGATIVE_NET_MESSAGE,
      belowPaidMessage: "O abatimento deixaria o valor líquido abaixo do que o cliente já pagou."
    });
    const execution = await tx.get("SELECT id FROM service_executions WHERE appointment_id = ? AND status = 'completed'", [appointment.id]);
    const inserted = await tx.run(
      `INSERT INTO appointment_value_adjustments
        (appointment_id, adjustment_type, amount, reason, net_before, net_after, service_execution_id, idempotency_key, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [appointment.id, input.adjustmentType, input.amount, input.reason, current.snapshot.netTotal,
        netAfterCents / 100, execution?.id || null, input.idempotencyKey, userId]
    );
    const after = await recalculateAppointmentFinancials(tx, appointment.id);
    await writeFinancialAudit(tx, {
      appointmentId: appointment.id, userId, action: "value_adjustment", reason: input.reason,
      before: current.before, after: after.appointment
    });
    await recordAudit(tx, {
      req, module: "appointments", action: "value_adjustment_add", entityType: "appointment", entityId: appointment.id,
      reason: input.reason,
      before: moneySummary(current.before),
      after: moneySummary(after.appointment),
      metadata: {
        adjustment_id: inserted.returnedId, adjustment_type: input.adjustmentType, amount: input.amount,
        idempotency_key: input.idempotencyKey, appointment_status: appointment.status
      },
      severity: "warning"
    });
    await propagateToClosedAppointment(tx, appointment, { userId, reason: `Ajuste de valor: ${input.reason}` });
    return {
      created: true,
      adjustment: await getAdjustment(tx, inserted.returnedId),
      adjustments: await listAppointmentValueAdjustments(tx, appointment.id),
      financial: after.snapshot
    };
  });
}

/** Anula um ajuste ativo, com motivo. O registro original é preservado. */
export async function voidAppointmentValueAdjustment(db, appointmentId, adjustmentId, input, { req = null, canEditFinance = false } = {}) {
  const userId = req?.user?.id || null;
  return db.transaction(async (tx) => {
    const current = await recalculateAppointmentFinancials(tx, appointmentId);
    if (!current) throw new FinancialRuleError("Agendamento não encontrado.", 404);
    const appointment = current.appointment;
    const adjustment = await tx.get(
      "SELECT * FROM appointment_value_adjustments WHERE id = ? AND appointment_id = ? FOR UPDATE",
      [adjustmentId, appointment.id]
    );
    if (!adjustment) throw new FinancialRuleError("Ajuste não encontrado.", 404);
    if (adjustment.status === "anulado") throw new FinancialRuleError("Este ajuste já foi anulado.", 409);
    await assertAdjustable(tx, appointment, { canEditFinance });
    // Anular desfaz o efeito: acréscimo anulado reduz o líquido; abatimento
    // anulado o aumenta.
    const delta = adjustment.adjustment_type === "abatimento" ? cents(adjustment.amount) : -cents(adjustment.amount);
    assertResultingNet(current.snapshot, delta, {
      negativeMessage: "A anulação deixaria o valor líquido negativo.",
      belowPaidMessage: "A anulação deixaria o valor líquido abaixo do que o cliente já pagou."
    });
    await tx.run(
      `UPDATE appointment_value_adjustments
         SET status = 'anulado', voided_by_user_id = ?, voided_at = now(), void_reason = ?
       WHERE id = ?`,
      [userId, input.reason, adjustment.id]
    );
    const after = await recalculateAppointmentFinancials(tx, appointment.id);
    await writeFinancialAudit(tx, {
      appointmentId: appointment.id, userId, action: "value_adjustment_void", reason: input.reason,
      before: current.before, after: after.appointment
    });
    await recordAudit(tx, {
      req, module: "appointments", action: "value_adjustment_void", entityType: "appointment", entityId: appointment.id,
      reason: input.reason,
      before: { ...moneySummary(current.before), adjustment_status: "ativo" },
      after: { ...moneySummary(after.appointment), adjustment_status: "anulado" },
      metadata: {
        adjustment_id: adjustment.id, adjustment_type: adjustment.adjustment_type, amount: Number(adjustment.amount),
        adjustment_reason: adjustment.reason, appointment_status: appointment.status
      },
      severity: "warning"
    });
    await propagateToClosedAppointment(tx, appointment, { userId, reason: `Ajuste de valor anulado: ${input.reason}` });
    return {
      adjustment: await getAdjustment(tx, adjustment.id),
      adjustments: await listAppointmentValueAdjustments(tx, appointment.id),
      financial: after.snapshot
    };
  });
}
