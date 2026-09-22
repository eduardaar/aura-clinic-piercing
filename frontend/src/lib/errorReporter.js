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

// Ruído conhecido do navegador: não é falha do app e só polui a central.
// "ResizeObserver loop…" é emitido por reflow em cascata e a própria spec
// trata como aviso benigno — descartamos antes de gastar uma requisição.
const IGNORED_PATTERNS = [/^ResizeObserver loop/i];

// Import dinâmico que falhou. Quase sempre é uma aba aberta ANTES de um deploy
// pedindo um chunk cujo hash não existe mais. Recarregar resolve, então isso
// entra na central como aviso e não como erro.
const STALE_CHUNK_PATTERNS = [
  /Importing a module script failed/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Unable to preload CSS/i,
  /is not a valid JavaScript MIME type/i,
  /ChunkLoadError/i
];

// Falha de rede do visitante (offline, aba suspensa, request abortado).
// "Load failed" é o texto do Safari; "Failed to fetch" o do Chromium. Não é
// bug do produto, mas continua registrado como aviso para não cegar uma queda real.
const NETWORK_PATTERNS = [/^Load failed$/i, /^Failed to fetch$/i, /^NetworkError/i, /^The operation was aborted/i];

const RELOAD_KEY = "aura:stale-chunk-reload";
const RELOAD_COOLDOWN_MS = 60000;

/**
 * @param {RegExp[]} patterns
 * @param {string} message
 * @returns {boolean}
 */
function matches(patterns, message) {
  return patterns.some((pattern) => pattern.test(message));
}

/**
 * Erro de chunk defasado por deploy — recuperável com um reload.
 * @param {string} [message]
 * @returns {boolean}
 */
export function isStaleChunkError(message) {
  return matches(STALE_CHUNK_PATTERNS, String(message || ""));
}

/**
 * Recarrega a página para buscar o index.html novo (servido com no-cache).
 * Usa janela de espera em vez de "uma vez por sessão": um deploy posterior na
 * mesma aba volta a poder se recuperar, mas um chunk realmente ausente não
 * entra em laço de recarga — na segunda tentativa o erro chega ao usuário.
 * @returns {boolean} true se a recarga foi disparada.
 */
export function reloadOnceForStaleChunk() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    location.reload();
    return true;
  } catch {
    // sessionStorage indisponível (modo privado): não arrisca laço de recarga.
    return false;
  }
}

/**
 * Severidade derivada da mensagem quando quem chama não informa uma.
 * @param {string} message
 * @returns {"error" | "warn"}
 */
function levelForMessage(message) {
  return isStaleChunkError(message) || matches(NETWORK_PATTERNS, message) ? "warn" : "error";
}

/**
 * Envia um erro para o log central. NUNCA lança e nunca gera outro envio.
 * @param {ErrorPayload} [payload]
 * @returns {void}
 */
export function reportError(payload = {}) {
  try {
    if (sent >= MAX_PER_SESSION) return;
    const message = String(payload.message || "erro desconhecido").slice(0, 2000);
    if (matches(IGNORED_PATTERNS, message)) return;
    const url = payload.url || (typeof location !== "undefined" ? location.href : "");
    const key = `${message}|${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;

    const session = readStoredSession();
    const headers = { "Content-Type": "application/json", "X-Tenant": tenantSlug() };
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;

    const body = JSON.stringify({
      level: payload.level || levelForMessage(message),
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
    const message = event.message || "window.onerror";
    reportError({
      message,
      stack: event.error?.stack,
      url: typeof location !== "undefined" ? location.href : "",
      context: { filename: event.filename, lineno: event.lineno, colno: event.colno }
    });
    // O envio usa keepalive, então o relato sobrevive à recarga.
    if (isStaleChunkError(message)) reloadOnceForStaleChunk();
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason?.message || String(reason) || "unhandledrejection";
    reportError({
      message,
      stack: reason?.stack,
      url: typeof location !== "undefined" ? location.href : "",
      context: { type: "unhandledrejection" }
    });
    if (isStaleChunkError(message)) reloadOnceForStaleChunk();
  });
}
