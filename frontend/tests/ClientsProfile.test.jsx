import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEditForm, ClientsMedical } from "../src/features/clients/ClientsMedical";

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
  readStoredSession: () => ({ user: { id: 10, role: "admin" } }),
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
  beforeEach(() => localStorage.clear());

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
