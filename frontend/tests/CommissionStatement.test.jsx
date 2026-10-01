import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppointmentCommissionSummary, CommissionStatement } from "../src/features/finance/CommissionStatement";
import { FinanceWorkspace } from "../src/features/finance/FinanceWorkspace";
import { apiFetch, useFetch } from "../src/lib/api";
import { currency } from "../src/features/shared/helpers";

// O Testing Library normaliza o espaço não separável de "R$ 1,00" para espaço comum.
const brl = (value) => currency.format(value).replace(/\s/g, " ");

const session = { user: { id: 7, role: "admin" } };

vi.mock("../src/lib/api", () => ({
  apiFetch: vi.fn(),
  readStoredSession: () => session,
  tenantSlug: () => "clinica-teste",
  useApiInvalidate: () => vi.fn(),
  useFetch: vi.fn(() => ({ data: null, loading: true, error: "" }))
}));

const reply = (payload, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => payload });

const ENTRY = {
  id: 1, appointment_id: 120, reference_date: "2026-09-15", client_name: "Carla Souza", professional_name: "Ana Piercer",
  item_kind: "servico", item_description: "Perfuração de helix", gross_amount: "149.90", discount_amount: "10.00",
  adjustment_amount: "-5.00", base_amount: "134.90", rule_scope: "servico_padrao", rate_type: "percentual",
  rate_value: "30.00", commission_amount: "40.47", status: "ativa"
};

function mockApi(commissions = { items: [ENTRY], totals: { gross: 149.9, discount: 10, adjustment: -5, base: 134.9, commission: 40.47 }, page: 1, page_size: 25, total: 1 }, status = 200) {
  apiFetch.mockImplementation((path) => {
    if (path === "/professionals") return reply([{ id: 3, name: "Ana Piercer" }, { id: 4, name: "Bruno" }]);
    if (path === "/services") return reply([{ id: 2, name: "Helix" }]);
    if (path.startsWith("/commissions?")) return reply(typeof commissions === "function" ? commissions(path) : commissions, status);
    return reply({ error: "rota inesperada" }, 404);
  });
}

const commissionCalls = () => apiFetch.mock.calls.map(([path]) => path).filter((path) => path.startsWith("/commissions?"));
const lastQuery = () => new URLSearchParams(commissionCalls().at(-1).split("?")[1]);

beforeEach(() => {
  apiFetch.mockReset();
  useFetch.mockReset();
  useFetch.mockImplementation(() => ({ data: null, loading: true, error: "" }));
  session.user = { id: 7, role: "admin" };
});

describe("extrato de comissões", () => {
  it("transforma os filtros em query string", async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CommissionStatement features={["commissions"]} />);

    await screen.findByText("Perfuração de helix");
    const initial = lastQuery();
    expect(initial.get("status")).toBe("ativa");
    expect(initial.get("page")).toBe("1");
    expect(initial.get("page_size")).toBe("25");
    expect(initial.get("date_from")).toMatch(/^\d{4}-\d{2}-01$/);
    expect(initial.get("date_to")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(initial.has("professional_id")).toBe(false);

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-09-30" } });
    await user.type(screen.getByLabelText("Atendimento nº"), "12a0");

    await user.click(screen.getByRole("combobox", { name: "Profissional" }));
    await user.click(await screen.findByRole("option", { name: "Ana Piercer" }));
    await user.click(screen.getByRole("combobox", { name: "Serviço" }));
    await user.click(await screen.findByRole("option", { name: "Helix" }));
    await user.click(screen.getByRole("combobox", { name: "Situação" }));
    await user.click(await screen.findByRole("option", { name: "Todas" }));

    await waitFor(() => expect(lastQuery().get("status")).toBe("todas"));
    const query = lastQuery();
    expect(query.get("date_from")).toBe("2026-09-01");
    expect(query.get("date_to")).toBe("2026-09-30");
    expect(query.get("appointment_id")).toBe("120");
    expect(query.get("professional_id")).toBe("3");
    expect(query.get("service_id")).toBe("2");
  });

  it("exibe as colunas da base e os totais do servidor", async () => {
    mockApi();
    render(<CommissionStatement features={["commissions"]} />);

    const row = (await screen.findByText("Perfuração de helix")).closest("tr");
    expect(row).toHaveTextContent("#120");
    expect(row).toHaveTextContent("Carla Souza");
    expect(row).toHaveTextContent("Ana Piercer");
    expect(row).toHaveTextContent("Serviço");
    expect(row).toHaveTextContent(`− ${brl(10)}`);
    expect(row).toHaveTextContent(`− ${brl(5)}`);
    expect(row).toHaveTextContent("30% · Padrão de serviços");
    expect(row).toHaveTextContent(brl(40.47));

    const totals = screen.getByLabelText("Totais das comissões");
    expect(within(totals).getByText("Bruto").nextSibling).toHaveTextContent(brl(149.9));
    expect(within(totals).getByText("Descontos").nextSibling).toHaveTextContent(brl(10));
    expect(within(totals).getByText("Ajustes").nextSibling).toHaveTextContent(`− ${brl(5)}`);
    expect(within(totals).getByText("Base (líquido)").nextSibling).toHaveTextContent(brl(134.9));
    expect(within(totals).getByText("Comissão").nextSibling).toHaveTextContent(brl(40.47));
  });

  it("soma os totais em centavos quando a resposta é uma lista simples", async () => {
    mockApi([
      { ...ENTRY, id: 1, commission_amount: "0.10", base_amount: "0.10", gross_amount: "0.10", discount_amount: "0", adjustment_amount: "0" },
      { ...ENTRY, id: 2, commission_amount: "0.20", base_amount: "0.20", gross_amount: "0.20", discount_amount: "0", adjustment_amount: "0" }
    ]);
    render(<CommissionStatement features={["commissions"]} />);
    const totals = await screen.findByLabelText("Totais das comissões");
    expect(within(totals).getByText("Comissão").nextSibling).toHaveTextContent(brl(0.3));
  });

  it("mostra o estado vazio", async () => {
    mockApi({ items: [], totals: { gross: 0, discount: 0, adjustment: 0, base: 0, commission: 0 }, page: 1, page_size: 25, total: 0 });
    render(<CommissionStatement features={["commissions"]} />);
    expect(await screen.findByText("Nenhuma comissão no período e nos filtros escolhidos.")).toBeInTheDocument();
  });

  it("com view_own esconde o filtro de profissional", async () => {
    session.user = { id: 9, role: "piercer", granted_permissions: ["commission.view_own"] };
    mockApi();
    render(<CommissionStatement features={["commissions"]} />);
    await screen.findByText("Perfuração de helix");
    expect(screen.getByText("Você vê apenas as suas comissões.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Profissional" })).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith("/professionals");
    expect(lastQuery().has("professional_id")).toBe(false);
  });

  it("sem permissão de comissão não consulta a API", () => {
    session.user = { id: 9, role: "reception" };
    render(<CommissionStatement features={["commissions"]} />);
    expect(screen.getByRole("note")).toHaveTextContent("Você não tem permissão para ver comissões.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("sem o recurso do plano mostra o aviso de upgrade", () => {
    render(<CommissionStatement features={["basic_finance"]} onUpgrade={vi.fn()} />);
    expect(screen.getByRole("note")).toHaveTextContent("Comissões fazem parte do plano Studio");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("quem tem commission.edit vê todos os profissionais, como no backend", async () => {
    session.user = { id: 9, role: "piercer", permissions: ["commission.edit"] };
    mockApi();
    render(<CommissionStatement features={["commissions"]} />);
    await screen.findByText("Perfuração de helix");
    expect(screen.getByRole("combobox", { name: "Profissional" })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/professionals");
  });

  it("explica o que os totais somam quando a situação não é só ativas", async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CommissionStatement features={["commissions"]} />);
    await screen.findByText("Perfuração de helix");
    expect(screen.queryByText(/Os totais somam só os lançamentos ativos/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Situação" }));
    await user.click(await screen.findByRole("option", { name: "Todas" }));
    expect(await screen.findByText(/Os totais somam só os lançamentos ativos/)).toBeInTheDocument();
  });

  it("falha ao ler o plano não vira aviso de upgrade", () => {
    useFetch.mockReturnValue({ data: { error: "Sem conexão." }, loading: false, error: "Sem conexão." });
    render(<FinanceWorkspace initialView="comissoes" onNavigate={vi.fn()} />);
    expect(screen.getByText("Sem conexão.")).toBeInTheDocument();
    expect(screen.queryByText(/plano Studio/)).not.toBeInTheDocument();
  });

  it("sem features da página, lê o plano da identidade da loja", async () => {
    useFetch.mockReturnValue({ data: { subscription: { features: ["commissions"] } }, loading: false, error: "" });
    mockApi();
    render(<FinanceWorkspace initialView="comissoes" onNavigate={vi.fn()} />);
    expect(await screen.findByText("Perfuração de helix")).toBeInTheDocument();
  });

  it("entra no Financeiro como área Comissões", async () => {
    mockApi();
    render(<FinanceWorkspace initialView="comissoes" features={["basic_finance", "commissions"]} onNavigate={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Comissões" })).toBeInTheDocument();
    expect(await screen.findByText("Perfuração de helix")).toBeInTheDocument();
  });
});

describe("comissão do atendimento", () => {
  it("lista os lançamentos ativos e o total do atendimento", async () => {
    mockApi({ items: [ENTRY, { ...ENTRY, id: 2, item_kind: "produto", item_description: "Labret titânio", commission_amount: "9.53", rate_type: "valor_fixo", rate_value: "15.00", rule_scope: "produto_padrao" }], total: 2 });
    render(<AppointmentCommissionSummary appointmentId={120} />);

    expect(await screen.findByText("Labret titânio")).toBeInTheDocument();
    const query = lastQuery();
    expect(query.get("appointment_id")).toBe("120");
    expect(query.get("status")).toBe("ativa");
    expect(screen.getByText(`Total da comissão: ${brl(50)}`)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s15,00 fixo · Padrão de produtos/)).toBeInTheDocument();
  });

  it("mostra aviso discreto quando o plano não tem o recurso", async () => {
    mockApi({ error: "Este recurso não está incluído no seu plano.", code: "plan_upgrade_required" }, 403);
    render(<AppointmentCommissionSummary appointmentId={120} />);
    expect(await screen.findByRole("note")).toHaveTextContent("Comissões fazem parte do plano Studio.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("usuário sem vínculo com profissional (409) vê a orientação do backend", async () => {
    session.user = { id: 9, role: "piercer", granted_permissions: ["commission.view_own"] };
    mockApi({ error: "Vincule este usuário a um profissional para ver as próprias comissões." }, 409);
    render(<AppointmentCommissionSummary appointmentId={120} />);
    expect(await screen.findByRole("note")).toHaveTextContent("Vincule este usuário a um profissional");
  });

  it("não renderiza nem consulta a API sem permissão de comissão", () => {
    session.user = { id: 9, role: "reception" };
    const { container } = render(<AppointmentCommissionSummary appointmentId={120} />);
    expect(container).toBeEmptyDOMElement();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
