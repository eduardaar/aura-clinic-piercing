// Captura global de erros do frontend e envio para o log central da API.
// Robusto por design: nunca lança, faz dedupe e limita o volume para não
// floodar a tabela nem entrar em laço (um erro no envio não gera outro envio).
import { API, tenantSlug, readStoredSession } from "./api";

const seen = new Set();
let sent = 0;
const MAX_PER_SESSION = 30;

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
export function installGlobalErrorReporting() {
  if (typeof window === "undefined" || window.__auraErrorHook) return;
  window.__auraErrorHook = true;

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
