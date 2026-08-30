import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_SESSION_ENDED_EVENT, apiFetch, tenantSlug } from "../src/lib/api";

const SESSION = { token: "access-token", user: { id: 1, name: "Admin", role: "admin" } };

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("sessão da clínica", () => {
  beforeEach(() => {
    localStorage.clear();
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
