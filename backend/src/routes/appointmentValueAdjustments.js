// Ajustes de valor do atendimento (acréscimo/abatimento com motivo).
// Regras e efeitos ficam em services/appointmentValueAdjustments.js; aqui só
// permissão, gate de plano e tradução de erro em status HTTP.
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { hasPermission } from "../services/permissionService.js";
import { requireFeature } from "../services/subscriptions.js";
import { P } from "../config/permissions.js";
import { FinancialRuleError, getAppointmentFinancialSnapshot } from "../services/finance.js";
import {
  createAppointmentValueAdjustment,
  listAppointmentValueAdjustments,
  normalizeAdjustmentInput,
  normalizeVoidInput,
  voidAppointmentValueAdjustment
} from "../services/appointmentValueAdjustments.js";

const router = Router();

// Id que não é inteiro positivo nunca existe: 404 aqui, em vez de o Postgres
// recusar o texto na coluna INTEGER e a rota cair em erro 500.
function validId(value) {
  return /^[1-9]\d{0,9}$/.test(String(value ?? "")) && Number(value) <= 2147483647;
}

function appointmentNotFound(req, res) {
  if (validId(req.params.id)) return false;
  res.status(404).json({ error: "Agendamento não encontrado." });
  return true;
}

function adjustmentError(res, error) {
  if (!(error instanceof FinancialRuleError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

// Depois do fechamento, o ajuste mexe no recebível: exige também a permissão
// financeira (403 dentro do serviço, com o agendamento travado) e o recurso de
// financeiro do plano, como a correção financeira do PATCH.
async function closedAppointmentGate(req, res, db) {
  const appointment = await db.get("SELECT id, status FROM appointments WHERE id = ?", [req.params.id]);
  if (!appointment) {
    res.status(404).json({ error: "Agendamento não encontrado." });
    return false;
  }
  if (appointment.status === "atendido") {
    if (!authorizePermission(req, res, P.FINANCE_EDIT)) return false;
    if (!(await requireFeature(req, res, "basic_finance"))) return false;
  }
  return true;
}

router.get("/api/appointments/:id/value-adjustments", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_VIEW)) return;
  if (appointmentNotFound(req, res)) return;
  const financial = await getAppointmentFinancialSnapshot(db, req.params.id);
  if (!financial) return res.status(404).json({ error: "Agendamento não encontrado." });
  res.json({ adjustments: await listAppointmentValueAdjustments(db, req.params.id), financial });
}));

router.post("/api/appointments/:id/value-adjustments", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_EDIT_FINAL_VALUE)) return;
  if (appointmentNotFound(req, res)) return;
  try {
    const input = normalizeAdjustmentInput(req.body || {}, req.get("Idempotency-Key"));
    if (!(await closedAppointmentGate(req, res, db))) return;
    const result = await createAppointmentValueAdjustment(db, req.params.id, input, {
      req, canEditFinance: hasPermission(req.user, P.FINANCE_EDIT)
    });
    const { created, ...payload } = result;
    res.status(created ? 201 : 200).json(payload);
  } catch (error) {
    if (adjustmentError(res, error)) return;
    // Corrida entre duas repetições com a mesma chave: o índice único barra a
    // segunda; devolve o ajuste que ficou gravado.
    if (error?.code === "23505") {
      const key = String(req.get("Idempotency-Key") || req.body?.idempotency_key || "").trim();
      const existing = key ? await db.get("SELECT id FROM appointment_value_adjustments WHERE appointment_id = ? AND idempotency_key = ?", [req.params.id, key]) : null;
      if (existing) {
        const adjustments = await listAppointmentValueAdjustments(db, req.params.id);
        return res.json({
          adjustment: adjustments.find((item) => Number(item.id) === Number(existing.id)),
          adjustments,
          financial: await getAppointmentFinancialSnapshot(db, req.params.id)
        });
      }
    }
    throw error;
  }
}));

router.post("/api/appointments/:id/value-adjustments/:adjustmentId/void", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.APPOINTMENTS_EDIT_FINAL_VALUE)) return;
  if (appointmentNotFound(req, res)) return;
  if (!validId(req.params.adjustmentId)) return res.status(404).json({ error: "Ajuste não encontrado." });
  try {
    const input = normalizeVoidInput(req.body || {});
    if (!(await closedAppointmentGate(req, res, db))) return;
    res.json(await voidAppointmentValueAdjustment(db, req.params.id, req.params.adjustmentId, input, {
      req, canEditFinance: hasPermission(req.user, P.FINANCE_EDIT)
    }));
  } catch (error) {
    if (!adjustmentError(res, error)) throw error;
  }
}));

export default router;
