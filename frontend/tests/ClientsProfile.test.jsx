import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEditForm, ClientsMedical } from "../src/features/clients/ClientsMedical";
import { apiFetch, readStoredSession } from "../src/lib/api";

const client = {
  id: 1,
  full_name: "Maria Aparecida",
  social_name: "Maria",
  whatsapp: "11999998888",
  phone: "1133334444",
  email: "maria@example.com",
  cpf: "52998224725",
  preferred_contact: "email",
  birth_date: "1992-09-12",
  created_at: "2026-08-30 10:00:00",
};

vi.mock("../src/lib/api", () => ({
  apiFetch: vi.fn(),
  readStoredSession: vi.fn(() => ({ user: { id: 10, role: "admin" } })),
  tenantSlug: () => "clinica-teste",
  useApiInvalidate: () => vi.fn(),
  useFetch: (path) => {
    if (path === "/clients") return { data: [client] };
    if (path === "/clients/1/credits") return { data: { open_amount: 20 } };
    if (path === "/clients/1") {
      return {
        data: {
          ...client,
          clinical_access: true,
          history: [],
          payments: [],
          medicalRecords: [],
          timeline: [],
          loyalty: { availablePoints: 5 },
          summary: { last_appointment: null, next_appointment: null, total_spent: 100, pending_amount: 30 },
          terms: [{ id: 7, procedure: "Perfuração", piercing_region: "Hélix", signed_at: "2026-08-20" }],
          followups: [
            { id: 9, reminder_day: 7, healing_status: "Boa evolução", status: "concluido", due_date: "2026-08-27" },
          ],
        },
      };
    }
    return { data: [] };
  },
}));

describe("clientes e perfil 360", () => {
  beforeEach(() => {
    localStorage.clear();
    apiFetch.mockReset();
    readStoredSession.mockImplementation(() => ({ user: { id: 10, role: "admin" } }));
  });

  it("abre o perfil com dados, histórico, termos e pós-atendimento em abas", async () => {
    const user = userEvent.setup();
    render(<ClientsMedical onNavigate={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Ver perfil" }));
    expect(screen.getByRole("tab", { name: "Dados" })).toBeInTheDocument();
    expect(screen.getByText(/100,00/)).toBeInTheDocument();
    expect(screen.getByText("maria@example.com")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Termos digitais" }));
    expect(screen.getByText("Perfuração")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Pós-atendimento" }));
    expect(screen.getByText("Boa evolução")).toBeInTheDocument();
  });

  it("mostra no histórico os indicadores químicos dos procedimentos para quem vê arquivos clínicos", async () => {
    apiFetch.mockImplementation(async (path) => ({
      ok: path === "/clients/1/chemical-indicators",
      status: path === "/clients/1/chemical-indicators" ? 200 : 404,
      json: async () => path === "/clients/1/chemical-indicators"
        ? {
          client: { id: 1, full_name: "Maria Aparecida" },
          indicators: [{
            id: 3, appointment_id: 4, appointment_date: "2026-09-29", procedure_name: "Hélix",
            jewelry_name: "Argola titânio", indicator_type: "Classe 4 — multiparâmetro", indicator_lot: "L123", result: "aprovado", status: "ativo",
          }],
        }
        : {},
    }));
    const user = userEvent.setup();
    render(<ClientsMedical onNavigate={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Ver perfil" }));
    await user.click(screen.getByRole("tab", { name: "Histórico e atendimentos" }));
    const section = screen.getByRole("region", { name: "Procedimentos e indicadores químicos" });
    expect(await within(section).findByText("Lote L123")).toBeInTheDocument();
    expect(within(section).getByText("Argola titânio")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/clients/1/chemical-indicators");
  });

  it("esconde os indicadores químicos de quem não tem clinical_files.view", async () => {
    readStoredSession.mockImplementation(() => ({ user: { id: 11, role: "reception", permissions: ["clients.view"] } }));
    const user = userEvent.setup();
    render(<ClientsMedical onNavigate={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Ver perfil" }));
    await user.click(screen.getByRole("tab", { name: "Histórico e atendimentos" }));
    expect(screen.getByText("Linha do tempo")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Procedimentos e indicadores químicos" })).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith("/clients/1/chemical-indicators");
  });

  it("oferece cadastro curto, máscaras brasileiras e endereço recolhível", async () => {
    const user = userEvent.setup();
    render(<ClientEditForm onSaved={() => {}} />);

    expect(screen.getByLabelText("Nome civil completo")).toBeRequired();
    expect(screen.getByLabelText("Nascimento")).toBeRequired();
    expect(screen.getByLabelText("WhatsApp")).toBeRequired();

    await user.type(screen.getByLabelText("WhatsApp"), "11999998888");
    await user.type(screen.getByLabelText("CPF"), "52998224725");
    expect(screen.getByLabelText("WhatsApp")).toHaveValue("(11) 99999-8888");
    expect(screen.getByLabelText("CPF")).toHaveValue("529.982.247-25");

    await user.click(screen.getByRole("button", { name: /Endereço e dados adicionais/ }));
    expect(screen.getByLabelText("CEP")).toBeInTheDocument();
    expect(screen.getByText(/canal preferido é apenas indicativo/i)).toBeInTheDocument();
  });
});
