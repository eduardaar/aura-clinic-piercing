import React, { useEffect, useState } from "react";

export const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
export const API_ORIGIN = API.replace(/\/api$/, "");

// --- Multi-tenant: identificação da clínica (slug) ---------------------------
const TENANT_STORAGE_KEY = "aura-tenant";
const DEFAULT_TENANT_SLUG = "aura";
const TENANT_SLUG_PATTERN = /^[a-z0-9-]+$/;

export function tenantSlug() {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlTenant = String(params.get("t") || params.get("tenant") || params.get("clinic") || "").trim().toLowerCase();
    if (TENANT_SLUG_PATTERN.test(urlTenant)) {
      setTenantSlug(urlTenant);
      return urlTenant;
    }
    const stored = (localStorage.getItem(TENANT_STORAGE_KEY) || "").trim();
    return TENANT_SLUG_PATTERN.test(stored) ? stored : DEFAULT_TENANT_SLUG;
  } catch {
    return DEFAULT_TENANT_SLUG;
  }
}

export function setTenantSlug(slug) {
  const normalized = String(slug || "").trim().toLowerCase();
  if (!TENANT_SLUG_PATTERN.test(normalized)) return;
  try {
    localStorage.setItem(TENANT_STORAGE_KEY, normalized);
  } catch {
    // localStorage indisponível: as chamadas seguem com o fallback padrão.
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

export function authToken() {
  try {
    return JSON.parse(localStorage.getItem("aura-session") || "null")?.token || "";
  } catch {
    localStorage.removeItem("aura-session");
    return "";
  }
}

export function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = authToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // Multi-tenant: identifica a clínica em todas as chamadas (não sobrescreve um X-Tenant explícito).
  if (!headers.has("X-Tenant")) headers.set("X-Tenant", tenantSlug());
  return fetch(`${API}${path}`, { ...options, headers }).then((response) => {
    if (response.status === 401 && path !== "/login") {
      localStorage.removeItem("aura-session");
      window.location.reload();
    }
    return response;
  });
}

export function publicApiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("X-Tenant")) headers.set("X-Tenant", tenantSlug());
  return fetch(`${API}${path}`, { ...options, headers });
}

export async function downloadApiFile(path, filename) {
  const response = await apiFetch(path);
  if (!response.ok) return;
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

export function useFetch(path) {
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    apiFetch(`${path}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { error: json.error || "Não foi possível carregar os dados." };
        return json;
      })
      .then((json) => active && setData(json))
      .catch(() => active && setData({ error: "Não foi possível conectar com a API." }));
    return () => { active = false; };
  }, [path, tick]);
  return { data, refresh: () => setTick((value) => value + 1) };
}

export function usePublicFetch(path) {
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
