import React, { useEffect, useState } from "react";

export const API = "http://localhost:4000/api";
export const API_ORIGIN = API.replace(/\/api$/, "");

export function readStoredSession() {
  try {
    const storedSession = JSON.parse(localStorage.getItem("aura-session") || "null");
    if (storedSession) return storedSession;
    return import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(window.location.hostname)
      ? { user: { id: 1, name: "Administrador Aura", email: "admin@auraclinic.com", role: "admin" } }
      : null;
  } catch {
    localStorage.removeItem("aura-session");
    return import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(window.location.hostname)
      ? { user: { id: 1, name: "Administrador Aura", email: "admin@auraclinic.com", role: "admin" } }
      : null;
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
  return fetch(`${API}${path}`, { ...options, headers }).then((response) => {
    if (response.status === 401 && path !== "/login") {
      localStorage.removeItem("aura-session");
      window.location.reload();
    }
    return response;
  });
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
    fetch(`${API}${path}`)
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
