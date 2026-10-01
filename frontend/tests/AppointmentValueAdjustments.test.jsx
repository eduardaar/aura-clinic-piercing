import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../src/lib/api";
import { AppointmentValueAdjustments } from "../src/features/agenda/AppointmentValueAdjustments";

vi.mock("../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal()),
  apiFetch: vi.fn(),
}));

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const ACTIVE = {
  id: 11,
  adjustment_type: "acrescimo",
  amount: 20,
  reason: "Material adicional",
  status: "ativo",
  created_at: "2026-09-30T14:05:00-03:00",
  created_by_name: "Ana Recepção",
};
const VOIDED = {
  id: 10,
  adjustment_type: "abatimento",
  amount: 5,
  reason: "Atraso do cliente",
  status: "anulado",
  created_at: "2026-09-30T13:00:00-03:00",
  created_by_name: "Bruno Piercer",
  voided_at: "2026-09-30T13:30:00-03:00",
  voided_by_name: "Carla Financeiro",
  void_reason: "Lançado em duplicidade",
};
const FINANCIAL = { grossTotal: 149.9, discountTotal: 10, adjustmentTotal: 20, netTotal: 159.9, outstandingBalance: 109.9 };

function mockRoutes(handlers) {
  apiFetch.mockImplementation(async (path, options = {}) => {
    const method = options.method || "GET";
    const handler = handlers[`${method} ${path}`];
    if (!handler) throw new Error(`rota inesperada: ${method} ${path}`);
    return handler(options);
  });
}

// As notas do painel não têm role="note" (o modal da agenda já tem a sua).
function adjustmentNote() {
  return /** @type {HTMLElement} */ (document.querySelector(".value-adjustments__note"));
}

describe("AppointmentValueAdjustments", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it("lista os ajustes discriminados com tipo, valor, motivo, autor, data e situação", async () => {
    mockRoutes({ "GET /appointments/7/value-adjustments": () => jsonResponse({ adjustments: [ACTIVE, VOIDED], financial: FINANCIAL }) });
    render(<AppointmentValueAdjustments appointment={{ id: 7, status: "confirmado" }} canEdit />);

    const list = await screen.findByRole("list", { name: "Ajustes registrados" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(first).toHaveTextContent("Acréscimo (+)");
    expect(first).toHaveTextContent("+ R$ 20,00");
    expect(first).toHaveTextContent("Material adicional");
    expect(first).toHaveTextContent("Ana Recepção");
    expect(first).toHaveTextContent(/30\/09\/2026/);
    expect(within(first).getByText("Ativo")).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: /Anular Acréscimo/ })).toBeInTheDocument();

    expect(second).toHaveTextContent("Abatimento (−)");
    expect(second).toHaveTextContent("− R$ 5,00");
    expect(within(second).getByText("Anulado")).toBeInTheDocument();
    expect(second).toHaveTextContent("Carla Financeiro");
    expect(second).toHaveTextContent("Lançado em duplicidade");
    // Anulado não pode ser anulado de novo.
    expect(within(second).queryByRole("button", { name: /Anular/ })).not.toBeInTheDocument();
    // Total considera só os ativos.
    expect(screen.getByText("1 ajuste ativo", { exact: false })).toHaveTextContent("+ R$ 20,00");
  });

  it("mostra estado vazio e erro de carga com nova tentativa", async () => {
    let calls = 0;
    mockRoutes({
      "GET /appointments/8/value-adjustments": () => {
        calls += 1;
        return calls === 1 ? jsonResponse({ error: "Agendamento não encontrado." }, 404) : jsonResponse({ adjustments: [], financial: FINANCIAL });
      },
    });
    const user = userEvent.setup();
    render(<AppointmentValueAdjustments appointment={{ id: 8, status: "pendente" }} canEdit />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Agendamento não encontrado.");
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Nenhum ajuste registrado neste atendimento.")).toBeInTheDocument();
  });

  it("inclui um ajuste com chave de idempotência e avisa o pai com o snapshot recalculado", async () => {
    const created = { ...ACTIVE, id: 12, adjustment_type: "abatimento", amount: 15.5, reason: "Atraso do cliente" };
    const recalculated = { ...FINANCIAL, adjustmentTotal: 4.5, netTotal: 144.4 };
    mockRoutes({
      "GET /appointments/7/value-adjustments": () => jsonResponse({ adjustments: [ACTIVE], financial: FINANCIAL }),
      "POST /appointments/7/value-adjustments": () => jsonResponse({ adjustment: created, adjustments: [ACTIVE, created], financial: recalculated }, 201),
    });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<AppointmentValueAdjustments appointment={{ id: 7, status: "em_atendimento" }} canEdit onChanged={onChanged} />);
    await screen.findByRole("list", { name: "Ajustes registrados" });

    await user.click(screen.getByRole("combobox", { name: "Tipo" }));
    await user.click(await screen.findByRole("option", { name: "Abatimento (−)" }));
    await user.type(screen.getByLabelText("Valor (R$)"), "15.5");
    await user.type(screen.getByLabelText(/^Motivo \(obrigatório/), "  Atraso do cliente  ");
    await user.click(screen.getByRole("button", { name: "Adicionar ajuste" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ adjustments: [ACTIVE, created], financial: recalculated }));
    const post = apiFetch.mock.calls.find(([, options]) => options?.method === "POST");
    const body = JSON.parse(post[1].body);
    expect(body).toMatchObject({ adjustment_type: "abatimento", amount: 15.5, reason: "Atraso do cliente" });
    expect(typeof body.idempotency_key).toBe("string");
    expect(body.idempotency_key.length).toBeGreaterThan(8);
    expect(await screen.findByText("Ajuste registrado.")).toBeInTheDocument();
    expect(screen.getByLabelText("Valor (R$)")).toHaveValue(null);
    expect(within(screen.getByRole("list", { name: "Ajustes registrados" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("valida valor e motivo antes de enviar e reaproveita a chave ao repetir após falha", async () => {
    let posts = 0;
    mockRoutes({
      "GET /appointments/7/value-adjustments": () => jsonResponse({ adjustments: [], financial: FINANCIAL }),
      "POST /appointments/7/value-adjustments": () => {
        posts += 1;
        if (posts === 1) throw new TypeError("Failed to fetch");
        return jsonResponse({ adjustment: ACTIVE, adjustments: [ACTIVE], financial: FINANCIAL }, 201);
      },
    });
    const user = userEvent.setup();
    render(<AppointmentValueAdjustments appointment={{ id: 7, status: "confirmado" }} canEdit />);
    await screen.findByText("Nenhum ajuste registrado neste atendimento.");

    await user.click(screen.getByRole("button", { name: "Adicionar ajuste" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Informe um valor maior que zero.");
    expect(screen.getByLabelText("Valor (R$)")).toHaveAttribute("aria-invalid", "true");

    await user.type(screen.getByLabelText("Valor (R$)"), "20.123");
    await user.click(screen.getByRole("button", { name: "Adicionar ajuste" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Use no máximo duas casas decimais.");

    await user.clear(screen.getByLabelText("Valor (R$)"));
    await user.type(screen.getByLabelText("Valor (R$)"), "20");
    await user.click(screen.getByRole("button", { name: "Adicionar ajuste" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Informe o motivo do ajuste.");
    expect(apiFetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);

    await user.type(screen.getByLabelText(/^Motivo \(obrigatório/), "Material adicional");
    await user.click(screen.getByRole("button", { name: "Adicionar ajuste" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível conectar com a API.");
    await user.click(screen.getByRole("button", { name: "Adicionar ajuste" }));
    await screen.findByText("Ajuste registrado.");

    const keys = apiFetch.mock.calls
      .filter(([, options]) => options?.method === "POST")
      .map(([, options]) => JSON.parse(options.body).idempotency_key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("bloqueia abatimento maior que o líquido e mostra o erro do backend", async () => {
    mockRoutes({
      "GET /appointments/7/value-adjustments": () => jsonResponse({ adjustments: [], financial: { ...FINANCIAL, netTotal: 50 } }),
      "POST /appointments/7/value-adjustments": () => jsonResponse({ error: "Você não tem permissão para alterar o valor final." }, 403),
    });
    const user = userEvent.setup();
    render(<AppointmentValueAdjustments appointment={{ id: 7, status: "confirmado" }} canEdit />);
    await screen.findByText("Nenhum ajuste registrado neste atendimento.");

    await user.click(screen.getByRole("combobox", { name: "Tipo" }));
    await user.click(await screen.findByRole("option", { name: "Abatimento (−)" }));
    await user.type(screen.getByLabelText("Valor (R$)"), "60");
    await user.type(screen.getByLabelText(/^Motivo \(obrigatório/), "Desistiu de um furo");
    await user.click(screen.getByRole("button", { name: "Adicionar ajuste" }));
    expect(screen.getByRole("alert")).toHaveTextContent("O abatimento deixaria o valor líquido negativo.");

    await user.clear(screen.getByLabelText("Valor (R$)"));
    await user.type(screen.getByLabelText("Valor (R$)"), "10");
    await user.click(screen.getByRole("button", { name: "Adicionar ajuste" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Você não tem permissão para alterar o valor final.");
  });

  it("anula um ajuste exigindo motivo no modal", async () => {
    const voided = { ...ACTIVE, status: "anulado", voided_at: "2026-09-30T15:00:00-03:00", voided_by_name: "Ana Recepção", void_reason: "Cobrado por engano" };
    const recalculated = { ...FINANCIAL, adjustmentTotal: 0, netTotal: 139.9 };
    mockRoutes({
      "GET /appointments/7/value-adjustments": () => jsonResponse({ adjustments: [ACTIVE], financial: FINANCIAL }),
      "POST /appointments/7/value-adjustments/11/void": () => jsonResponse({ adjustment: voided, adjustments: [voided], financial: recalculated }),
    });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<AppointmentValueAdjustments appointment={{ id: 7, status: "atendido" }} canEdit requireReason onChanged={onChanged} />);
    await screen.findByRole("list", { name: "Ajustes registrados" });
    expect(screen.getByText(/Atendimento já finalizado/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Anular Acréscimo/ }));
    const dialog = await screen.findByRole("dialog", { name: "Anular ajuste de valor" });
    const confirm = within(dialog).getByRole("button", { name: "Anular ajuste" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Motivo da anulação (obrigatório)"), "Cobrado por engano");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ adjustments: [voided], financial: recalculated }));
    const call = apiFetch.mock.calls.find(([path]) => path.endsWith("/void"));
    expect(JSON.parse(call[1].body)).toEqual({ reason: "Cobrado por engano" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Anulado")).toBeInTheDocument();
    expect(screen.getByText("Ajuste anulado.")).toBeInTheDocument();
  });

  it("sem permissão fica somente leitura com explicação", async () => {
    mockRoutes({ "GET /appointments/7/value-adjustments": () => jsonResponse({ adjustments: [ACTIVE], financial: FINANCIAL }) });
    render(<AppointmentValueAdjustments appointment={{ id: 7, status: "atendido" }} canEdit={false} requireReason />);
    await screen.findByRole("list", { name: "Ajustes registrados" });

    expect(adjustmentNote()).toHaveTextContent("Somente leitura");
    expect(adjustmentNote()).toHaveTextContent("“Editar” do Financeiro");
    expect(screen.queryByRole("button", { name: "Adicionar ajuste" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Anular/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Valor (R$)")).not.toBeInTheDocument();
  });

  it("atendimento cancelado não aceita novos ajustes, mesmo com permissão", async () => {
    mockRoutes({ "GET /appointments/9/value-adjustments": () => jsonResponse({ adjustments: [], financial: FINANCIAL }) });
    render(<AppointmentValueAdjustments appointment={{ id: 9, status: "cancelado" }} canEdit />);
    await screen.findByText("Nenhum ajuste registrado neste atendimento.");

    expect(adjustmentNote()).toHaveTextContent("cancelado");
    expect(screen.queryByRole("button", { name: "Adicionar ajuste" })).not.toBeInTheDocument();
  });

  it("com requireReason num agendamento em aberto não anuncia atendimento finalizado", async () => {
    mockRoutes({ "GET /appointments/7/value-adjustments": () => jsonResponse({ adjustments: [], financial: FINANCIAL }) });
    render(<AppointmentValueAdjustments appointment={{ id: 7, status: "confirmado" }} canEdit requireReason />);
    await screen.findByText("Nenhum ajuste registrado neste atendimento.");

    expect(screen.queryByText(/Atendimento já finalizado/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Motivo (obrigatório, fica na auditoria)")).toBeRequired();
  });

  it("sem permissão num agendamento em aberto não cita a permissão financeira", async () => {
    mockRoutes({ "GET /appointments/7/value-adjustments": () => jsonResponse({ adjustments: [], financial: FINANCIAL }) });
    render(<AppointmentValueAdjustments appointment={{ id: 7, status: "confirmado" }} canEdit={false} requireReason />);
    await screen.findByText("Nenhum ajuste registrado neste atendimento.");

    expect(adjustmentNote()).toHaveTextContent("Alterar valor final");
    expect(adjustmentNote()).not.toHaveTextContent("Financeiro");
  });

  it("relê o snapshot quando o pai regrava o agendamento, sem usar o líquido velho na pré-checagem", async () => {
    let net = 50;
    mockRoutes({
      "GET /appointments/7/value-adjustments": () => jsonResponse({ adjustments: [], financial: { ...FINANCIAL, netTotal: net } }),
      "POST /appointments/7/value-adjustments": () => jsonResponse({ adjustment: ACTIVE, adjustments: [ACTIVE], financial: FINANCIAL }, 201),
    });
    const user = userEvent.setup();
    const { rerender } = render(<AppointmentValueAdjustments appointment={{ id: 7, status: "confirmado", total_value: 50 }} canEdit />);
    await screen.findByText("Nenhum ajuste registrado neste atendimento.");

    // Outro salvamento tirou o desconto: o líquido gravado passou a 150.
    net = 150;
    rerender(<AppointmentValueAdjustments appointment={{ id: 7, status: "confirmado", total_value: 150 }} canEdit />);
    await waitFor(() => expect(apiFetch.mock.calls.filter(([, options]) => !options?.method)).toHaveLength(2));
    expect(screen.queryByText("Carregando ajustes…")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Tipo" }));
    await user.click(await screen.findByRole("option", { name: "Abatimento (−)" }));
    await user.type(screen.getByLabelText("Valor (R$)"), "100");
    await user.type(screen.getByLabelText(/^Motivo \(obrigatório/), "Desistiu de um furo");
    await user.click(screen.getByRole("button", { name: "Adicionar ajuste" }));
    expect(await screen.findByText("Ajuste registrado.")).toBeInTheDocument();
  });

  it("ignora a resposta atrasada de outro agendamento", async () => {
    let releaseFirst;
    const OTHER = { ...ACTIVE, id: 99, reason: "Do agendamento antigo" };
    mockRoutes({
      "GET /appointments/1/value-adjustments": () => new Promise((resolve) => { releaseFirst = () => resolve(jsonResponse({ adjustments: [OTHER], financial: FINANCIAL })); }),
      "GET /appointments/2/value-adjustments": () => jsonResponse({ adjustments: [], financial: FINANCIAL }),
    });
    const { rerender } = render(<AppointmentValueAdjustments appointment={{ id: 1, status: "confirmado" }} canEdit />);
    rerender(<AppointmentValueAdjustments appointment={{ id: 2, status: "confirmado" }} canEdit />);
    await screen.findByText("Nenhum ajuste registrado neste atendimento.");
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/Do agendamento antigo/)).not.toBeInTheDocument();
    expect(screen.getByText("Nenhum ajuste registrado neste atendimento.")).toBeInTheDocument();
  });

  it("agendamento ainda não salvo não chama a API", () => {
    render(<AppointmentValueAdjustments appointment={null} canEdit />);
    expect(screen.getByText("Salve o agendamento para registrar acréscimos ou abatimentos.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("bloqueio de plano usa a explicação do pai e não cita permissão", async () => {
    mockRoutes({ "GET /appointments/7/value-adjustments": () => jsonResponse({ adjustments: [], financial: FINANCIAL }) });
    render(<AppointmentValueAdjustments appointment={{ id: 7, status: "atendido" }} canEdit={false} lockedReason="Atendimento finalizado: ajustar o valor exige o Financeiro básico do plano Profissional." requireReason />);
    await screen.findByText("Nenhum ajuste registrado neste atendimento.");

    expect(adjustmentNote()).toHaveTextContent("Financeiro básico do plano Profissional");
    expect(adjustmentNote()).not.toHaveTextContent("Somente leitura");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
