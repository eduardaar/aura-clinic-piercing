import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccessAdmin } from "../src/features/access/AccessAdmin";
import { AuditAdmin } from "../src/features/access/AuditAdmin";

const refresh = vi.fn();
const apiFetch = vi.fn();

vi.mock("../src/lib/api", () => ({
  apiFetch: (...args) => apiFetch(...args),
  useFetch: (path) => {
    if (path.startsWith("/users?")) return {
      data: { items: [
        { id: 1, name: "Gestora Aura", email: "gestora@aura.test", role: "admin", status: "active", access_profile_name: null, professional_name: null },
        { id: 2, name: "Atendente Aura", email: "atendente@aura.test", role: "reception", status: "active", access_profile_name: "Recepção enxuta", professional_name: null }
      ] },
      refresh, loading: false, error: ""
    };
    if (path === "/access-profiles") return {
      data: [{ id: 7, name: "Recepção enxuta", description: "Agenda e clientes", base_role: "reception", permissions: ["clients.view"], users_count: 0 }],
      refresh, loading: false, error: ""
    };
    if (path === "/permissions") return {
      data: {
        catalog: [
          { key: "clients.view", module: "clients", module_label: "Clientes", label: "Visualizar", risk: "standard" },
          { key: "clients.delete", module: "clients", module_label: "Clientes", label: "Excluir", risk: "high" }
        ],
        roles: { admin: ["*"], reception: ["clients.view"], piercer: [], finance: [] }
      },
      refresh, loading: false, error: ""
    };
    if (path.startsWith("/professionals?")) return {
      data: { items: [{ id: 4, name: "Ana Piercer" }] }, refresh, loading: false, error: ""
    };
    if (path.startsWith("/audit-events?")) return {
      data: {
        items: [{
          id: 11, created_at: "2026-08-30T15:20:00.000Z", actor_name: "Gestora Aura",
          actor_email: "gestora@aura.test", module: "users", action: "update", entity_type: "user",
          entity_id: "8", severity: "warning", reason: "Mudança de função"
        }],
        total: 1
      },
      refresh, loading: false, error: ""
    };
    return { data: null, refresh, loading: false, error: "" };
  }
}));

describe("gestão de acessos", () => {
  it("oferece usuários, perfis, vínculo profissional e catálogo legível", async () => {
    const user = userEvent.setup();
    render(<AccessAdmin />);

    expect(screen.getByText("Gestora Aura")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Perfis de acesso" }));
    expect(screen.getByText("Recepção enxuta")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Novo perfil" }));
    expect(screen.getByRole("heading", { name: "Permissões do perfil" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await user.click(screen.getByRole("tab", { name: "Usuários" }));
    await user.click(screen.getByRole("button", { name: "Novo usuário" }));
    expect(screen.getAllByText("Profissional vinculado").length).toBeGreaterThan(0);
    expect(screen.getByText("Visualizar")).toBeInTheDocument();
    expect(screen.getByText(/ação sensível/)).toBeInTheDocument();
  });

  it("exige motivo e envia-o ao excluir um usuário", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<AccessAdmin />);

    const row = screen.getByText("Atendente Aura").closest("tr");
    await user.click(within(row).getByRole("button", { name: "Mais ações" }));
    await user.click(screen.getByRole("menuitem", { name: "Excluir usuário" }));
    await user.type(screen.getByLabelText("Motivo da exclusão"), "Desligamento da equipe");
    await user.type(screen.getByLabelText(/Digite SIM/), "SIM");
    await user.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/users/2", expect.objectContaining({ method: "DELETE" })));
    const options = apiFetch.mock.calls.find(([path]) => path === "/users/2")[1];
    expect(JSON.parse(options.body)).toEqual({ reason: "Desligamento da equipe" });
  });

  it("exibe auditoria paginada com rótulos em português", () => {
    render(<AuditAdmin />);
    expect(screen.getByRole("heading", { name: "Auditoria" })).toBeInTheDocument();
    expect(screen.getByText("Gestora Aura")).toBeInTheDocument();
    expect(screen.getByText("Usuários e acessos")).toBeInTheDocument();
    expect(screen.getByText("Alteração")).toBeInTheDocument();
    expect(screen.getByText("Mudança de função")).toBeInTheDocument();
  });
});
