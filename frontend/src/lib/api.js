import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// Produção usa sempre a API no mesmo domínio, servida pelo nginx em `/api`.
// Localhost é fallback exclusivo do Vite em desenvolvimento — deixar esse
// valor como fallback geral faz o navegador do cliente tentar acessar a
// própria máquina em builds que não receberam VITE_API_URL.
export const API = import.meta.env.PROD
  ? "/api"
  : (import.meta.env.VITE_API_URL || "http://localhost:4000/api");
export const API_ORIGIN = API.replace(/\/api$/, "");

// --- Contratos da camada de dados -------------------------------------------

/**
 * Envelope de listagem paginada do backend.
 * Espelha `backend/src/services/pagination.js` — mudou lá, muda aqui.
 * @template [T=any]
 * @typedef {object} PagedResponse
 * @property {T[]} items Linhas da página atual.
 * @property {number} total Total JÁ FILTRADO (não é o total da tabela). É o que o
 *   `DataView` no modo `server` espera receber em `total`.
 * @property {number} limit Tamanho de página aplicado.
 * @property {number} offset Deslocamento aplicado.
 */

/**
 * O MESMO endpoint devolve array puro quando a tela não manda `limit`/`offset`.
 * Por isso todo consumo deve ser tolerante aos dois formatos — o padrão da casa
 * é `asArray(payload)` combinado com `asArray(asObject(payload).items)`.
 * @template [T=any]
 * @typedef {PagedResponse<T> | T[]} ListResponse
 */

/**
 * Erro de API: um `Error` comum com o HTTP status preservado. O `status` é o que
 * a política de retry do TanStack Query lê para NÃO insistir em 4xx
 * (ver lib/queryClient.js).
 * @typedef {Error & { status?: number }} ApiError
 */

/**
 * Sessão gravada no localStorage após o login.
 * @typedef {object} StoredSession
 * @property {string} token Access token curto enviado no header Authorization.
 * @property {{ id?: number, name?: string, email?: string, role?: import("./permissions.js").Role }} [user]
 */

/**
 * Chave de cache do TanStack Query: segmentos da rota + (opcional) objeto de query.
 * @typedef {Array<string | Record<string, string>>} ApiQueryKey
 */

// --- Multi-tenant: identificação da clínica (slug) ---------------------------
const TENANT_STORAGE_KEY = "aura-tenant";
const TENANT_SLUG_PATTERN = /^[a-z0-9-]+$/;

/**
 * Slug da clínica ativa, na ordem: `?t=` da URL > localStorage. Sem uma
 * identificação explícita, devolve vazio em vez de chutar outra clínica.
 * @returns {string}
 */
export function tenantSlug() {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlTenant = String(params.get("t") || params.get("tenant") || params.get("clinic") || "").trim().toLowerCase();
    if (TENANT_SLUG_PATTERN.test(urlTenant)) {
      setTenantSlug(urlTenant);
      return urlTenant;
    }
    const stored = (localStorage.getItem(TENANT_STORAGE_KEY) || "").trim();
    return TENANT_SLUG_PATTERN.test(stored) ? stored : "";
  } catch {
    return "";
  }
}

/**
 * Grava o slug da clínica. Slug fora do padrão `[a-z0-9-]+` é ignorado.
 * @param {unknown} slug
 * @returns {void}
 */
export function setTenantSlug(slug) {
  const normalized = String(slug || "").trim().toLowerCase();
  if (!TENANT_SLUG_PATTERN.test(normalized)) return;
  try {
    localStorage.setItem(TENANT_STORAGE_KEY, normalized);
  } catch {
    // localStorage indisponível: a tela ainda pode enviar o slug explicitamente.
  }
}

// Permite compartilhar links públicos por clínica (ex.: /catalogo?t=aura):
// se a URL de entrada tiver ?t=<slug> válido, gravamos antes de qualquer chamada à API.
try {
  const urlTenant = new URLSearchParams(window.location.search).get("t");
  if (urlTenant) setTenantSlug(urlTenant);
} catch {
  // Ambiente sem window/URLSearchParams: ignora.
}

/**
 * @returns {StoredSession | null} Sessão do localStorage, ou null. Nunca fabrica sessão.
 */
export function readStoredSession() {
  try {
    // Retorna a sessão armazenada no localStorage ou null. Não fabrica sessão de admin em nenhum ambiente.
    const storedSession = JSON.parse(localStorage.getItem("aura-session") || "null");
    return storedSession || null;
  } catch {
    localStorage.removeItem("aura-session");
    return null;
  }
}

/**
 * @returns {string} Token da sessão, ou "" quando não há sessão.
 */
export function authToken() {
  try {
    return JSON.parse(localStorage.getItem("aura-session") || "null")?.token || "";
  } catch {
    localStorage.removeItem("aura-session");
    return "";
  }
}

function saveAccessSession(payload) {
  try {
    const current = readStoredSession() || {};
    const next = { ...current, token: payload.token, ...(payload.user ? { user: payload.user } : {}) };
    localStorage.setItem("aura-session", JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

function clearAccessSession() {
  try { localStorage.removeItem("aura-session"); } catch { /* storage indisponível */ }
}

export const ACCESS_SESSION_ENDED_EVENT = "aura:session-ended";
const TENANT_SESSION_ERROR_CODES = new Set(["tenant_mismatch", "tenant_not_found", "tenant_suspended"]);

function endAccessSession() {
  clearAccessSession();
  try { window.dispatchEvent(new Event(ACCESS_SESSION_ENDED_EVENT)); } catch { /* ambiente sem DOM */ }
}

async function isTenantSessionError(response) {
  if (![403, 404].includes(response.status)) return false;
  const payload = await response.clone().json().catch(() => null);
  return TENANT_SESSION_ERROR_CODES.has(payload?.code);
}

async function refreshAccessToken() {
  const response = await fetch(`${API}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "X-Tenant": tenantSlug() }
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload?.token ? saveAccessSession(payload) : null;
}

/**
 * Chamada AUTENTICADA à API. É a única porta de saída do app para o backend:
 * injeta `Authorization`, `X-Tenant` e `Content-Type` (exceto em FormData) e
 * derruba a sessão em 401 ou quando a clínica da sessão deixou de ser válida.
 *
 * Devolve a `Response` CRUA — não faz `.json()` nem lança em erro HTTP. Para
 * leitura já tratada, use `fetchApiJson`/`useFetch`.
 *
 * @param {string} path Caminho relativo à API, começando com "/" (ex.: "/clients?limit=25").
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = authToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // Multi-tenant: identifica a clínica em todas as chamadas (não sobrescreve um X-Tenant explícito).
  const tenant = tenantSlug();
  if (!headers.has("X-Tenant") && tenant) headers.set("X-Tenant", tenant);
  let response = await fetch(`${API}${path}`, { ...options, headers, credentials: "include" });
  const isSessionEndpoint = ["/login", "/auth/refresh", "/auth/logout"].includes(path);
  if (!isSessionEndpoint && await isTenantSessionError(response)) {
    endAccessSession();
    return response;
  }
  // Um token copiado do localStorage só vale 15 min. A credencial duradoura
  // fica no cookie HttpOnly e é rotacionada aqui antes de repetir UMA vez.
  if (response.status !== 401 || isSessionEndpoint) return response;
  const session = await refreshAccessToken().catch(() => null);
  if (session?.token) {
    headers.set("Authorization", `Bearer ${session.token}`);
    response = await fetch(`${API}${path}`, { ...options, headers, credentials: "include" });
    if (response.status !== 401) {
      if (await isTenantSessionError(response)) endAccessSession();
      return response;
    }
  }
  endAccessSession();
  return response;
}

/**
 * Chamada às rotas PÚBLICAS (catálogo, agendamento online): manda `X-Tenant`,
 * nunca o token.
 * @param {string} path
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export function publicApiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const tenant = tenantSlug();
  if (!headers.has("X-Tenant") && tenant) headers.set("X-Tenant", tenant);
  return fetch(`${API}${path}`, { ...options, headers, credentials: "include" });
}

/**
 * Baixa um arquivo autenticado (PDF, XLSX…) e dispara o download no navegador.
 * Falha em silêncio quando a resposta não é OK.
 * @param {string} path
 * @param {string} filename Nome sugerido do arquivo.
 * @returns {Promise<void>}
 */
export async function downloadApiFile(path, filename) {
  const response = await apiFetch(path);
  if (!response.ok) throw await apiFileError(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function openApiFile(path) {
  const popup = window.open("", "_blank", "noopener,noreferrer");
  try {
    const response = await apiFetch(path);
    if (!response.ok) throw await apiFileError(response);
    if (!(response.headers.get("content-type") || "").toLowerCase().includes("application/pdf")) {
      throw new Error("O servidor não retornou um PDF válido.");
    }
    const url = URL.createObjectURL(await response.blob());
    if (popup) popup.location.replace(url);
    else window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    popup?.close();
    throw error;
  }
}

async function apiFileError(response) {
  const payload = await response.json().catch(() => ({}));
  /** @type {ApiError} */
  const error = new Error(payload.error || "Não foi possível carregar o arquivo.");
  error.status = response.status;
  return error;
}

// --- Leituras cacheadas (TanStack Query) -------------------------------------

// Chave de cache derivada da rota, em segmentos: "/clients/12?full=1" vira
// ["api", "clients", "12", { full: "1" }]. Assim invalidar ["api","clients"]
// alcança a listagem, os filtros e o detalhe de cada cliente de uma vez, que é
// o que se espera depois de salvar. Chave de string única não permitiria isso.
/**
 * @param {string} path
 * @returns {ApiQueryKey}
 */
export function apiQueryKey(path) {
  const [route = "", search = ""] = String(path || "").split("?");
  // A anotação é necessária: sem ela o TS infere `string[]` a partir do
  // primeiro elemento e o objeto de query não caberia no array.
  /** @type {ApiQueryKey} */
  const key = ["api", ...route.split("/").filter(Boolean)];
  if (search) key.push(Object.fromEntries(new URLSearchParams(search)));
  return key;
}

// A única porta de saída continua sendo o apiFetch. O erro vira exceção com o
// `status` preservado, que é o que a política de retry usa para não insistir
// em 4xx.
/**
 * @param {string} path
 * @returns {Promise<any>} JSON da resposta (frequentemente um `ListResponse`).
 * @throws {ApiError} Com `status` preenchido quando o erro veio do servidor.
 */
export async function fetchApiJson(path) {
  let response;
  try {
    response = await apiFetch(path);
  } catch {
    throw new Error("Não foi possível conectar com a API.");
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    /** @type {ApiError} */
    const error = new Error(json.error || "Não foi possível carregar os dados.");
    error.status = response.status;
    throw error;
  }
  return json;
}

// Mesma assinatura do useFetch antigo — `{ data, refresh }`, com `data === null`
// enquanto carrega e `{ error }` quando falha — agora servida pelo cache. Os
// campos extras (`loading`, `error`, `fetching`) existem para quem quiser passar
// direto ao DataView em vez de derivar de `data`.
/**
 * Resultado do `useFetch`.
 * @template [T=any]
 * @typedef {object} UseFetchResult
 * @property {T | { error: string } | null} data `null` enquanto carrega; `{ error }` quando
 *   falha. A forma de sempre — as telas antigas derivam tudo daqui.
 * @property {() => Promise<void>} refresh Invalida esta rota no cache e refaz a leitura.
 * @property {boolean} loading Primeira carga (sem nada em cache).
 * @property {string} error Mensagem de erro pronta, ou "". Pode ir direto no `DataView`.
 * @property {boolean} fetching Alguma requisição em voo, inclusive revalidação silenciosa.
 */

/**
 * Leitura cacheada de uma rota da API.
 * @param {string} path Rota (ex.: "/clients?limit=25"). Vazio/`null` desliga a query.
 * @returns {UseFetchResult}
 */
export function useFetch(path) {
  const queryClient = useQueryClient();
  const queryKey = apiQueryKey(path);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchApiJson(path),
    enabled: Boolean(path)
  });

  const errorMessage = query.isError ? (query.error?.message || "Não foi possível carregar os dados.") : "";
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: apiQueryKey(path) }),
    [queryClient, path]
  );

  return {
    data: errorMessage ? { error: errorMessage } : (query.data ?? null),
    refresh,
    loading: query.isPending,
    error: errorMessage,
    fetching: query.isFetching
  };
}

// Invalidação após mutação: `invalidate("/clients", "/dashboard")` marca as
// rotas como velhas, refaz as que estão na tela e deixa as demais recarregarem
// na próxima montagem. Substitui o `refresh()` manual — que dependia de o
// autor lembrar de chamá-lo, e só atualizava a própria tela.
/**
 * @returns {(...paths: Array<string | string[]>) => void} Invalida as rotas informadas.
 */
export function useApiInvalidate() {
  const queryClient = useQueryClient();
  return useCallback((...paths) => {
    for (const path of paths.flat()) {
      if (path) queryClient.invalidateQueries({ queryKey: apiQueryKey(path) });
    }
  }, [queryClient]);
}

/**
 * Leitura de rota pública, SEM cache do TanStack Query (as telas públicas são
 * de vida curta e não compartilham estado com o app autenticado).
 * @param {string} path
 * @returns {{ data: any | { error: string } | null }}
 */
export function usePublicFetch(path) {
  /** @type {[any, (value: any) => void]} */
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    // Rotas públicas também precisam identificar a clínica via X-Tenant.
    publicApiFetch(path)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { error: json.error || "Não foi possível carregar os dados." };
        return json;
      })
      .then((json) => active && setData(json))
      .catch(() => active && setData({ error: "Não foi possível conectar com a API." }));
    return () => { active = false; };
  }, [path]);
  return { data };
}
