import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfessionalCommissionRules, validateCommissionRate } from "../src/features/agenda/ProfessionalCommissionRules";
import { apiFetch } from "../src/lib/api";

const session = { user: { id: 7, role: "admin" } };
const invalidate = vi.fn();

vi.mock("../src/lib/api", () => ({
  apiFetch: vi.fn(),
  readStoredSession: () => session,
  tenantSlug: () => "clinica-teste",
  useApiInvalidate: () => invalidate,
  useFetch: () => ({ data: null, loading: true, error: "" })
}));

const reply = (payload, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => payload });

const SERVICES = [{ id: 1, name: "Lóbulo" }, { id: 2, name: "Helix" }, { id: 3, name: "Septo" }];
const RULES = [
  { id: 10, scope: "servico_padrao", service_id: null, rate_type: "percentual", rate_value: "30.00", active: true, notes: "Acordo inicial" },
  { id: 11, scope: "servico", service_id: 2, rate_type: "valor_fixo", rate_value: "50.00", active: true, notes: null },
  { id: 12, scope: "produto_padrao", service_id: null, rate_type: "percentual", rate_value: "10.00", active: true, notes: null }
];
const HISTORY = [{
  id: 90, action: "rule_update", actor_name: "Bruna Admin", created_at: "2026-09-28T13:45:00.000Z",
  before: { rule: { scope: "servico_padrao", rate_type: "percentual", rate_value: 25, active: true } },
  after: { rule: { scope: "servico_padrao", rate_type: "percentual", rate_value: 30, active: true } }
}];

function mockApi({ rules = RULES, getStatus = 200, getPayload, putPayload } = {}) {
  apiFetch.mockImplementation((path, options = {}) => {
    if (path.endsWith("/commission-rules/history")) return reply(HISTORY);
    if (path.endsWith("/commission-rules") && options.method === "PUT") return reply(putPayload ?? { rules: JSON.parse(options.body).rules.map((rule, index) => ({ id: 100 + index, ...rule })) });
    if (path.endsWith("/commission-rules")) return reply(getPayload ?? { professional: { id: 5, name: "Ana" }, rules, services: SERVICES }, getStatus);
    return reply({ error: "rota inesperada" }, 404);
  });
}

beforeEach(() => {
  apiFetch.mockReset();
  invalidate.mockReset();
  session.user = { id: 7, role: "admin" };
});

describe("regras de comissão do profissional", () => {
  it("carrega as regras gravadas nos três blocos", async () => {
    mockApi();
    render(<ProfessionalCommissionRules professionalId={5} features={["commissions"]} />);

    expect(await screen.findByLabelText("Percentual (%) — padrão de serviços")).toHaveValue("30");
    expect(apiFetch).toHaveBeenCalledWith("/professionals/5/commission-rules");
    expect(screen.getByLabelText("Valor (R$) da regra 1")).toHaveValue("50");
    // Regra gravada não troca de serviço (o serviço é a identidade da regra).
    expect(screen.queryByRole("combobox", { name: "Serviço da regra 1" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Valor (R$) da regra 1").closest("article")).toHaveTextContent("Helix");
    expect(screen.getByLabelText("Percentual (%) — produtos e joias")).toHaveValue("10");
    expect(screen.getByLabelText("Observações — padrão de serviços")).toHaveValue("Acordo inicial");
    // Regra já gravada não é removível: corrigir = desativar (o backend nunca apaga).
    expect(screen.queryByRole("button", { name: "Remover regra 1" })).not.toBeInTheDocument();
  });

  it("recusa percentual acima de 100 sem chamar a API", async () => {
    const user = userEvent.setup();
    mockApi();
    render(<ProfessionalCommissionRules professionalId={5} features={["commissions"]} />);

    const field = await screen.findByLabelText("Percentual (%) — padrão de serviços");
    await user.clear(field);
    await user.type(field, "150");
    await user.click(screen.getByRole("button", { name: "Salvar comissão" }));

    expect(screen.getByText("O percentual deve estar entre 0 e 100.")).toBeInTheDocument();
    expect(screen.getByText("Corrija os campos destacados antes de salvar.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith("/professionals/5/commission-rules", expect.objectContaining({ method: "PUT" }));
  });

  it("valida valor, casas decimais e serviço repetido", async () => {
    expect(validateCommissionRate("percentual", "100")).toBe("");
    expect(validateCommissionRate("percentual", "12,5")).toBe("");
    expect(validateCommissionRate("valor_fixo", "250")).toBe("");
    expect(validateCommissionRate("valor_fixo", "-1")).toBe("O valor não pode ser negativo.");
    expect(validateCommissionRate("valor_fixo", "1,234")).toBe("Use um número com até 2 casas decimais.");
    expect(validateCommissionRate("percentual", "")).toBe("Informe o valor.");

    const user = userEvent.setup();
    mockApi({ rules: [] });
    render(<ProfessionalCommissionRules professionalId={5} features={["commissions"]} />);
    await user.click(await screen.findByRole("button", { name: /Adicionar regra por serviço/ }));
    await user.click(screen.getByRole("button", { name: "Salvar comissão" }));
    expect(screen.getByText("Escolha o serviço.")).toBeInTheDocument();
    expect(screen.getByText("Informe o valor.")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("envia o PUT no formato da SPEC, com todas as regras existentes", async () => {
    const user = userEvent.setup();
    mockApi();
    render(<ProfessionalCommissionRules professionalId={5} features={["commissions"]} />);

    const field = await screen.findByLabelText("Percentual (%) — padrão de serviços");
    await user.clear(field);
    await user.type(field, "12,5");

    await user.click(screen.getByRole("button", { name: /Adicionar regra por serviço/ }));
    await user.click(screen.getByRole("combobox", { name: "Serviço da regra 2" }));
    await user.click(await screen.findByRole("option", { name: "Lóbulo" }));
    await user.type(screen.getByLabelText("Percentual (%) da regra 2"), "40");

    // Desativar o padrão de produtos envia active:false (não some do conjunto).
    await user.click(screen.getByRole("switch", { name: "Comissão em produtos e joias" }));
    await user.click(screen.getByRole("button", { name: "Salvar comissão" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/professionals/5/commission-rules", expect.objectContaining({ method: "PUT" })));
    const [, options] = apiFetch.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(options.body)).toEqual({
      rules: [
        { scope: "servico_padrao", service_id: null, rate_type: "percentual", rate_value: 12.5, active: true, notes: "Acordo inicial" },
        { scope: "produto_padrao", service_id: null, rate_type: "percentual", rate_value: 10, active: false, notes: null },
        { scope: "servico", service_id: 2, rate_type: "valor_fixo", rate_value: 50, active: true, notes: null },
        { scope: "servico", service_id: 1, rate_type: "percentual", rate_value: 40, active: true, notes: null }
      ]
    });
    expect(await screen.findByText(/Regras de comissão salvas/)).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith("/professionals");
  });

  it("regra inativa com valor inválido envia o tipo e o valor gravados, juntos", async () => {
    const user = userEvent.setup();
    mockApi();
    render(<ProfessionalCommissionRules professionalId={5} features={["commissions"]} />);

    // Regra de Helix: valor fixo R$ 50. Desativa e troca o tipo para percentual
    // com 250 — inválido, mas regra inativa não é validada.
    await user.click(await screen.findByRole("switch", { name: "Regra ativa da regra 1" }));
    await user.click(screen.getByRole("combobox", { name: "Tipo da regra 1" }));
    await user.click(await screen.findByRole("option", { name: "Percentual (%)" }));
    const field = screen.getByLabelText("Percentual (%) da regra 1");
    await user.clear(field);
    await user.type(field, "250");
    await user.click(screen.getByRole("button", { name: "Salvar comissão" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/professionals/5/commission-rules", expect.objectContaining({ method: "PUT" })));
    const [, options] = apiFetch.mock.calls.find(([, init]) => init?.method === "PUT");
    const helix = JSON.parse(options.body).rules.find((rule) => rule.service_id === 2);
    // Sem isso iria "percentual 250" e o backend recusaria o PUT inteiro.
    expect(helix).toEqual({ scope: "servico", service_id: 2, rate_type: "valor_fixo", rate_value: 50, active: false, notes: null });
  });

  it("mostra o erro do backend quando o PUT é recusado", async () => {
    const user = userEvent.setup();
    apiFetch.mockImplementation((path, options = {}) => {
      if (path.endsWith("/commission-rules/history")) return reply([]);
      if (options.method === "PUT") return reply({ error: "Serviço da regra de comissão não encontrado." }, 400);
      return reply({ professional: { id: 5 }, rules: RULES, services: SERVICES });
    });
    render(<ProfessionalCommissionRules professionalId={5} features={["commissions"]} />);
    await user.click(await screen.findByRole("button", { name: "Salvar comissão" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Serviço da regra de comissão não encontrado.");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("mostra o histórico com usuário, data e antes → depois", async () => {
    const user = userEvent.setup();
    mockApi();
    render(<ProfessionalCommissionRules professionalId={5} features={["commissions"]} />);

    await user.click(await screen.findByRole("button", { name: /Histórico de alterações/ }));
    const history = await screen.findByRole("list", { name: "Histórico de alterações da comissão" });
    expect(history).toHaveTextContent("Regra alterada");
    expect(history).toHaveTextContent("Bruna Admin");
    expect(history).toHaveTextContent("28/09/2026");
    expect(history).toHaveTextContent("Padrão de serviços · 25% · ativa → Padrão de serviços · 30% · ativa");
  });

  it("fica somente leitura para quem só pode ver todas as comissões", async () => {
    session.user = { id: 8, role: "finance" };
    mockApi();
    render(<ProfessionalCommissionRules professionalId={5} features={["commissions"]} />);

    const list = await screen.findByRole("list", { name: "Regras de comissão" });
    expect(list).toHaveTextContent("Padrão de serviços");
    expect(list).toHaveTextContent("30%");
    expect(list).toHaveTextContent("Helix");
    expect(screen.getByText(/Somente leitura/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar comissão" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("esconde a comissão de quem não tem permissão nenhuma", () => {
    session.user = { id: 9, role: "reception" };
    render(<ProfessionalCommissionRules professionalId={5} features={["commissions"]} />);
    expect(screen.getByText("Você não tem permissão para ver a comissão deste profissional.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("mostra o aviso de plano sem o recurso de comissões", () => {
    const onUpgrade = vi.fn();
    render(<ProfessionalCommissionRules professionalId={5} features={["basic_finance"]} onUpgrade={onUpgrade} />);
    expect(screen.getByRole("note")).toHaveTextContent("Comissões fazem parte do plano Studio");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("pede para salvar o profissional antes de configurar", () => {
    render(<ProfessionalCommissionRules professionalId={null} features={["commissions"]} />);
    expect(screen.getByText("Salve o profissional para configurar a comissão.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("avisa o pai quando há regra editada e não salva, e limpa depois de salvar", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    mockApi();
    render(<ProfessionalCommissionRules professionalId={5} features={["commissions"]} onDirtyChange={onDirtyChange} />);
    const field = await screen.findByLabelText("Percentual (%) — padrão de serviços");
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);

    await user.clear(field);
    await user.type(field, "35");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    // A seção fica fora da detecção automática do modal do profissional.
    expect(field.closest("[data-modal-ignore-dirty]")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Salvar comissão" }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });
});
