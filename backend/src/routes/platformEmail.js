import { Router } from "express";
import { requirePlatformAuth } from "../middleware/auth.js";
import { emailProviderStatus, isValidEmailAddress, sendSmtpTestEmail } from "../services/emailProvider.js";
import {
  clearSmtpSettings,
  rewrapSmtpPasswordIfNeeded,
  saveSmtpSettings,
  SmtpSettingsError,
  smtpSettingsStatus,
  verifyStoredSmtpConnection,
} from "../services/smtpSettings.js";

const router = Router();

function handleError(res, error) {
  if (error instanceof SmtpSettingsError) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code });
  }
  console.error("[smtp]", error);
  return res.status(500).json({ error: "Não foi possível concluir a operação SMTP." });
}

router.get("/api/platform/email-settings", requirePlatformAuth, async (_req, res) => {
  try {
    await rewrapSmtpPasswordIfNeeded();
    res.json({ smtp: await smtpSettingsStatus(), active: await emailProviderStatus() });
  } catch (error) {
    handleError(res, error);
  }
});

router.put("/api/platform/email-settings", requirePlatformAuth, async (req, res) => {
  try {
    const smtp = await saveSmtpSettings(req.body || {}, req.platformUser.sub);
    res.json({ smtp, active: await emailProviderStatus() });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete("/api/platform/email-settings", requirePlatformAuth, async (_req, res) => {
  try {
    res.json({ smtp: await clearSmtpSettings(), active: await emailProviderStatus() });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/api/platform/email-settings/verify", requirePlatformAuth, async (_req, res) => {
  try {
    res.json(await verifyStoredSmtpConnection());
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/api/platform/email-settings/test", requirePlatformAuth, async (req, res) => {
  try {
    const to = String(req.body?.to || "").trim().toLowerCase();
    if (!isValidEmailAddress(to)) {
      return res.status(400).json({ error: "Informe um destinatário de teste válido.", code: "smtp_test_recipient_invalid" });
    }
    const result = await sendSmtpTestEmail(to);
    res.json({ ok: true, message_id: result.messageId });
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
