// Camada única de e-mail transacional. SMTP configurado pelo painel da
// plataforma tem prioridade; Resend por env permanece como fallback para
// instalações existentes.
//
// O módulo falha fechado: se a configuração não estiver completa, ele retorna
// null e quem consome mantém a comunicação disponível para ação manual. Assim
// não existe débito de saldo, nem tentativa para um provedor parcialmente
// configurado.
import {
  EMAIL_FROM,
  EMAIL_TIMEOUT_MS,
  RESEND_API_KEY,
  RESEND_API_URL,
  resendEmailEnabled
} from "../config/index.js";
import {
  createSmtpTransport,
  safeSmtpError,
  SmtpSettingsError,
  smtpSettingsForDelivery,
  smtpSettingsStatus,
} from "./smtpSettings.js";

let pooledTransporter = null;
let pooledTransporterKey = "";

export function isValidEmailAddress(value) {
  const email = String(value || "").trim();
  // Validação propositalmente simples: a confirmação definitiva é do Resend,
  // mas evita chamadas e débitos para destinos claramente inválidos.
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function emailProviderStatus() {
  const smtp = await smtpSettingsStatus();
  if (smtp.enabled && smtp.configured) {
    return { provider: "smtp", configured: true, enabled: true, from: smtp.from_email };
  }
  return {
    provider: resendEmailEnabled ? "resend" : smtp.configured ? "smtp" : null,
    configured: resendEmailEnabled || smtp.configured,
    enabled: resendEmailEnabled,
    from: resendEmailEnabled ? EMAIL_FROM : smtp.from_email || null,
  };
}

export function buildResendPayload({ to, subject, text }) {
  return {
    from: EMAIL_FROM,
    to: [String(to || "").trim()],
    subject: String(subject || "Mensagem da sua clínica").trim().slice(0, 200) || "Mensagem da sua clínica",
    text: String(text || "").slice(0, 100000)
  };
}

export function buildSmtpMessage(settings, { to, subject, text }) {
  return {
    from: settings.from_name
      ? { name: settings.from_name, address: settings.from_email }
      : settings.from_email,
    to: String(to || "").trim(),
    ...(settings.reply_to ? { replyTo: settings.reply_to } : {}),
    subject: String(subject || "Mensagem da sua clínica").trim().slice(0, 200) || "Mensagem da sua clínica",
    text: String(text || "").slice(0, 100000),
  };
}

function transporterFor(settings) {
  const key = [settings.host, settings.port, settings.secure, settings.require_tls, settings.username, settings.updated_at].join("|");
  if (pooledTransporter && pooledTransporterKey === key) return pooledTransporter;
  pooledTransporter?.close();
  pooledTransporter = createSmtpTransport(settings, { pool: true });
  pooledTransporterKey = key;
  return pooledTransporter;
}

async function sendWithSmtp(settings, message, { reuse = true } = {}) {
  const transporter = reuse ? transporterFor(settings) : createSmtpTransport(settings);
  try {
    const result = await transporter.sendMail(message);
    return { messageId: result?.messageId || null, provider: "smtp" };
  } catch (error) {
    if (reuse) {
      pooledTransporter?.close();
      pooledTransporter = null;
      pooledTransporterKey = "";
    }
    throw safeSmtpError(error);
  } finally {
    if (!reuse) transporter.close?.();
  }
}

export async function sendTransactionalEmail({ to, subject, text }) {
  if (!isValidEmailAddress(to)) throw new Error("Destino de e-mail inválido.");
  const smtp = await smtpSettingsForDelivery();
  if (smtp) return sendWithSmtp(smtp, buildSmtpMessage(smtp, { to, subject, text }));
  if (!resendEmailEnabled) return null;
  const payload = buildResendPayload({ to, subject, text });
  let response;
  try {
    response = await fetch(`${RESEND_API_URL}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS)
    });
  } catch {
    throw new Error("Não foi possível conectar ao provedor de e-mail.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(result?.message || result?.name || "O provedor de e-mail recusou a solicitação.").slice(0, 400));
  }
  return { messageId: result?.id || null, provider: "resend" };
}

export async function sendSmtpTestEmail(to) {
  if (!isValidEmailAddress(to)) throw new SmtpSettingsError("Destino de e-mail inválido.");
  const smtp = await smtpSettingsForDelivery({ requireEnabled: false });
  if (!smtp) throw new SmtpSettingsError("Salve uma configuração SMTP completa antes de enviar o teste.");
  return sendWithSmtp(smtp, buildSmtpMessage(smtp, {
    to,
    subject: "Teste SMTP · Aura Clinic",
    text: "Este e-mail confirma que a configuração SMTP da plataforma Aura Clinic está enviando mensagens corretamente.",
  }), { reuse: false });
}
