import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_SESSION_ENDED_EVENT, apiFetch,
  readStoredSession,
  storeAccessSession,
  tenantSlug } from "../src/lib/api";

const SESSION = { token: "access-token", user: { id: 1, name: "Admin", role: "admin" } };

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("sessão da clínica", () => {
  it("Manter conectado escolhe armazenamento persistente; acesso temporário fica na aba", () => {
    storeAccessSession(SESSION, false);
    expect(localStorage.getItem("aura-session")).toBeNull();
    expect(JSON.parse(sessionStorage.getItem("aura-session"))).toEqual(SESSION);
    expect(readStoredSession()).toEqual(SESSION);
    storeAccessSession(SESSION, true);
    expect(sessionStorage.getItem("aura-session")).toBeNull();
    expect(JSON.parse(localStorage.getItem("aura-session"))).toEqual(SESSION);
  });
  it("compartilha a renovação entre requisições simultâneas", async () => {
    let renew = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        if (String(url).endsWith("/auth/refresh")) {
          renew += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return jsonResponse(200, { token: "renewed", user: SESSION.user });
        }
        return options.headers.get("Authorization") === "Bearer renewed"
          ? jsonResponse(200, { ok: true })
          : jsonResponse(401, { error: "Expirado" });
      }),
    );
    const responses = await Promise.all([
      apiFetch("/appointments"),
      apiFetch("/dashboard"),
      apiFetch("/finance/ledger"),
    ]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(renew).toBe(1);
    expect(JSON.parse(localStorage.getItem("aura-session")).token).toBe("renewed");
  });

  it.each(["offline", "unavailable"])(
    "preserva a sessão quando a renovação falha temporariamente (%s)",
    async (mode) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) => {
          if (String(url).endsWith("/auth/refresh")) {
            if (mode === "offline") throw new TypeError("Network error");
            return jsonResponse(503, { error: "Indisponível" });
          }
          return jsonResponse(401, { error: "Expirado" });
        }),
      );
      await expect(apiFetch("/appointments")).rejects.toThrow();
      expect(JSON.parse(localStorage.getItem("aura-session"))).toEqual(SESSION);
    },
  );

  it("encerra a sessão quando o servidor confirma que o refresh expirou", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(401, { error: "Sessão expirada" })),
    );
    await apiFetch("/appointments");
    expect(localStorage.getItem("aura-session")).toBeNull();
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("aura-session", JSON.stringify(SESSION));
    localStorage.setItem("aura-tenant", "clinica-a");
    window.history.replaceState({}, "", "/app/dashboard");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    [403, "tenant_mismatch"],
    [403, "tenant_suspended"],
    [404, "tenant_not_found"],
  ])("encerra a sessão quando a clínica deixa de ser válida (%s/%s)", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, { error: "Clínica inválida.", code })));
    const onSessionEnded = vi.fn();
    window.addEventListener(ACCESS_SESSION_ENDED_EVENT, onSessionEnded, { once: true });

    const response = await apiFetch("/appointments");

    expect(response.status).toBe(status);
    expect(localStorage.getItem("aura-session")).toBeNull();
    expect(onSessionEnded).toHaveBeenCalledOnce();
  });

  it.each([
    [403, { error: "Você não tem permissão para esta ação." }],
    [404, { error: "Agendamento não encontrado." }],
  ])("preserva a sessão em erros comuns de recurso (%s)", async (status, payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, payload)));
    const onSessionEnded = vi.fn();
    window.addEventListener(ACCESS_SESSION_ENDED_EVENT, onSessionEnded, { once: true });

    await apiFetch("/appointments/999");

    expect(JSON.parse(localStorage.getItem("aura-session"))).toEqual(SESSION);
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it("não inventa uma clínica quando URL e storage estão vazios", () => {
    localStorage.removeItem("aura-tenant");
    expect(tenantSlug()).toBe("");
  });
});
