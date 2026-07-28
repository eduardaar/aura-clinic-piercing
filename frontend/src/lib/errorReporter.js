// Captura global de erros do frontend e envio para o log central da API.
// Robusto por design: nunca lança, faz dedupe e limita o volume para não
// floodar a tabela nem entrar em laço (um erro no envio não gera outro envio).
import { API, tenantSlug, readStoredSession } from "./api";

/**
 * Erro a reportar. Todos os campos são opcionais: o reporter é chamado de
 * handlers globais, onde não há garantia nenhuma sobre o que chegou.
 * @typedef {object} ErrorPayload
 * @property {string} [message] Truncada em 2000 caracteres no envio.
 * @property {"error" | "warn" | "info"} [level] Padrão: "error".
 * @property {string} [stack] Truncada em 8000 caracteres.
 * @property {string} [url] Padrão: `location.href`.
 * @property {Record<string, any>} [context] Dados extras (componentStack, arquivo/linha…).
 */

/** @type {Set<string>} */
const seen = new Set();
let sent = 0;
const MAX_PER_SESSION = 30;

/**
 * Envia um erro para o log central. NUNCA lança e nunca gera outro envio.
 * @param {ErrorPayload} [payload]
 * @returns {void}
 */
export function reportError(payload = {}) {
  try {
    if (sent >= MAX_PER_SESSION) return;
    const message = String(payload.message || "erro desconhecido").slice(0, 2000);
    const url = payload.url || (typeof location !== "undefined" ? location.href : "");
    const key = `${message}|${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;

    const session = readStoredSession();
    const headers = { "Content-Type": "application/json", "X-Tenant": tenantSlug() };
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;

    const body = JSON.stringify({
      level: payload.level || "error",
      message,
      stack: payload.stack ? String(payload.stack).slice(0, 8000) : null,
      url,
      user_email: session?.user?.email || null,
      context: payload.context || null
    });

    // keepalive garante o envio mesmo durante navegação/unload. Falha é ignorada.
    fetch(`${API}/error-logs`, { method: "POST", headers, body, keepalive: true }).catch(() => {});
  } catch {
    // Reporter jamais propaga erro.
  }
}

// Instala os hooks globais uma única vez.
// A marca da instalação vive no `window` (e não num módulo) de propósito: o
// HMR do Vite recarrega o módulo e o guard de escopo de módulo se perderia,
// duplicando os listeners a cada salvamento.
/**
 * @typedef {Window & typeof globalThis & { __auraErrorHook?: boolean }} AuraWindow
 */
/**
 * @returns {void}
 */
export function installGlobalErrorReporting() {
  if (typeof window === "undefined") return;
  const auraWindow = /** @type {AuraWindow} */ (window);
  if (auraWindow.__auraErrorHook) return;
  auraWindow.__auraErrorHook = true;

  window.addEventListener("error", (event) => {
    reportError({
      message: event.message || "window.onerror",
      stack: event.error?.stack,
      url: typeof location !== "undefined" ? location.href : "",
      context: { filename: event.filename, lineno: event.lineno, colno: event.colno }
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportError({
      message: reason?.message || String(reason) || "unhandledrejection",
      stack: reason?.stack,
      url: typeof location !== "undefined" ? location.href : "",
      context: { type: "unhandledrejection" }
    });
  });
}
