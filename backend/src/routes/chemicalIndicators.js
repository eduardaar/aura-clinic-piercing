// Indicador químico de esterilização registrado por procedimento realizado.
//
// As regras moram em services/chemicalIndicators.js; aqui ficam plano,
// permissão, upload e tradução do erro tipado em status HTTP.
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { parseUpload, privateUpload } from "../middleware/upload.js";
import { P } from "../config/permissions.js";
import { hasPermission } from "../services/permissionService.js";
import { recordPrivacyAudit } from "../services/privacy.js";
import {
  ChemicalIndicatorError,
  createChemicalIndicator,
  getAppointmentChemicalIndicators,
  listClientChemicalIndicators,
  voidChemicalIndicator
} from "../services/chemicalIndicators.js";

const router = Router();

// Erro tipado vira resposta; o resto sobe para o withDb (500 + error_logs).
function sendServiceError(res, error) {
  if (error instanceof ChemicalIndicatorError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

// Erros do multer e da validação de imagem acontecem DENTRO do withDb e, sem
// este tratamento, virariam um 500 genérico — o usuário que mandou uma foto
// HEIC ou grande demais precisa saber o que fazer.
async function parseIndicatorPhoto(req, res) {
  try {
    await parseUpload(privateUpload.single("photo"), req, res, { imagesOnly: true });
    return true;
  } catch (error) {
    if (error?.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "A foto excede o limite de 6 MB." });
    } else if (error?.code === "LIMIT_UNEXPECTED_FILE" || error?.code === "LIMIT_FILE_COUNT") {
      res.status(400).json({ error: "Envie uma única foto no campo \"photo\"." });
    } else {
      res.status(400).json({ error: error?.message || "Não foi possível ler a foto enviada." });
    }
    return false;
  }
}

const canViewClinicalFiles = (req) => hasPermission(req.user, P.CLINICAL_FILES_VIEW);

// O registro devolvido pelo serviço sai com a foto; quem edita mas teve a
// leitura de arquivo clínico negada individualmente recebe a versão do painel,
// já filtrada pela mesma regra.
const pickFromPanel = (payload, indicator) =>
  payload.indicators.find((item) => Number(item.id) === Number(indicator.id)) || indicator;

// Painel do atendimento. Quem enxerga a agenda vê o que foi registrado (a
// recepção precisa saber se o procedimento já tem indicador), mas a foto só
// sai para quem pode ver arquivo clínico.
router.get("/api/appointments/:id/chemical-indicators", withFeature("agenda", async (req, res, db) => {
  const canView = canViewClinicalFiles(req);
  if (!canView && !hasPermission(req.user, P.APPOINTMENTS_VIEW)) {
    return res.status(403).json({ error: "Você não tem permissão para esta ação." });
  }
  try {
    const payload = await getAppointmentChemicalIndicators(db, req.params.id, { canViewPhoto: canView });
    if (canView && payload.indicators.length) {
      await recordPrivacyAudit(db, {
        req, action: "chemical_indicator_read", resourceType: "appointment",
        resourceId: payload.appointment.id, clientId: payload.appointment.client_id,
        detail: { indicator_count: payload.indicators.length }
      });
    }
    res.json(payload);
  } catch (error) {
    if (!sendServiceError(res, error)) throw error;
  }
}));

router.post("/api/appointments/:id/chemical-indicators", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CLINICAL_FILES_EDIT)) return;
  if (!(await parseIndicatorPhoto(req, res))) return;
  try {
    const indicator = await createChemicalIndicator(db, {
      appointmentId: req.params.id, body: req.body || {}, file: req.file || null, req
    });
    const payload = await getAppointmentChemicalIndicators(db, req.params.id, { canViewPhoto: canViewClinicalFiles(req) });
    res.status(201).json({ ...payload, indicator: pickFromPanel(payload, indicator) });
  } catch (error) {
    if (!sendServiceError(res, error)) throw error;
  }
}));

router.post("/api/appointments/:id/chemical-indicators/:indicatorId/void", withFeature("agenda", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CLINICAL_FILES_EDIT)) return;
  try {
    const indicator = await voidChemicalIndicator(db, {
      appointmentId: req.params.id, indicatorId: req.params.indicatorId, reason: req.body?.reason, req
    });
    const payload = await getAppointmentChemicalIndicators(db, req.params.id, { canViewPhoto: canViewClinicalFiles(req) });
    res.json({ ...payload, indicator: pickFromPanel(payload, indicator) });
  } catch (error) {
    if (!sendServiceError(res, error)) throw error;
  }
}));

// Histórico clínico do cliente: só quem vê arquivo clínico, e toda leitura
// fica na trilha de privacidade (sem copiar o conteúdo).
router.get("/api/clients/:id/chemical-indicators", withFeature("clients", async (req, res, db) => {
  if (!authorizePermission(req, res, P.CLINICAL_FILES_VIEW)) return;
  try {
    const includeVoided = !["0", "false", "nao"].includes(String(req.query.include_voided ?? "").toLowerCase());
    const payload = await listClientChemicalIndicators(db, req.params.id, { canViewPhoto: true, includeVoided });
    await recordPrivacyAudit(db, {
      req, action: "chemical_indicator_history_read", resourceType: "client",
      resourceId: payload.client.id, clientId: payload.client.id,
      detail: { indicator_count: payload.indicators.length }
    });
    res.json(payload);
  } catch (error) {
    if (!sendServiceError(res, error)) throw error;
  }
}));

export default router;
