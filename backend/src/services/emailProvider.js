// Provedor oficial de e-mail transacional (Resend).
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

export function isValidEmailAddress(value) {
  const email = String(value || "").trim();
  // Validação propositalmente simples: a confirmação definitiva é do Resend,
  // mas evita chamadas e débitos para destinos claramente inválidos.
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function emailProviderStatus() {
  return { provider: "resend", configured: resendEmailEnabled, enabled: resendEmailEnabled, from: resendEmailEnabled ? EMAIL_FROM : null };
}

export function buildResendPayload({ to, subject, text }) {
  return {
    from: EMAIL_FROM,
    to: [String(to || "").trim()],
    subject: String(subject || "Mensagem da sua clínica").trim().slice(0, 200) || "Mensagem da sua clínica",
    text: String(text || "").slice(0, 100000)
  };
}

export async function sendTransactionalEmail({ to, subject, text }) {
  if (!resendEmailEnabled) return null;
  if (!isValidEmailAddress(to)) throw new Error("Destino de e-mail inválido.");
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
  return { messageId: result?.id || null };
}
