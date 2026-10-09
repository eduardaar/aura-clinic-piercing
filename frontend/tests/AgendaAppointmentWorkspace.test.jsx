import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppointmentCreateModal, AppointmentQuickModal, professionalCommissionLabel } from "../src/features/agenda/Agenda";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  session: { user: { id: 1, role: "admin" } },
  summaries: /** @type {any[]} */ ([]),
}));

vi.mock("../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal()),
  apiFetch: (...args) => mocks.apiFetch(...args),
  readStoredSession: () => mocks.session,
  tenantSlug: () => "clinica-teste",
}));

// O FinancialSummary real é testado em FinancialSummary.test.jsx; aqui importa
// o que a agenda entrega a ele (permissão, resumo e callbacks).
vi.mock("../src/components/common/Ui", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    FinancialSummary: (props) => {
      mocks.summaries.push(props);
      return <div data-testid="financial-summary" data-editable={String(Boolean(props.discountEditable))} />;
    },
  };
});
vi.mock("../src/features/agenda/AppointmentValueAdjustments", () => ({
  AppointmentValueAdjustments: (props) => <div data-testid="value-adjustments" data-can-edit={String(Boolean(props.canEdit))} data-require-reason={String(Boolean(props.requireReason))} />,
}));
vi.mock("../src/features/agenda/ChemicalIndicatorPanel", () => ({
  ChemicalIndicatorPanel: (props) => <div data-testid="chemical-panel" data-can-edit={String(Boolean(props.canEdit))} />,
  ChemicalIndicatorHistory: () => null,
}));

const services = [
  { id: 1, name: "Perfuração", price: 120, deposit_value: 25, duration_minutes: 40 },
  { id: 2, name: "Troca de joia", price: 80, deposit_value: 25, duration_minutes: 20 },
];

// Exemplo da SPEC: bruto 149,90 − desconto 10,00 = 139,90; sinal pago 50,00 → restante 89,90.
const baseAppointment = {
  id: 10,
  full_name: "Cliente Teste",
  status: "confirmado",
  appointment_date: "2026-09-30",
  appointment_time: "10:00",
  service_id: 1,
  subtotal_value: 149.9,
  discount_value: 10,
  manual_discount_value: 10,
  manual_discount_reason: "Cliente fiel",
  adjustment_total: 0,
  total_value: 139.9,
  deposit_value: 50,
  deposit_status: "pago",
  deposit_payment_method: "Pix",
  remaining_value: 89.9,
  remaining_payment_method: "Pix",
  items: [
    { id: 11, service_id: 1, region: "Hélix", quantity: 1, procedure_price: 99.9, jewelry_id: null, jewelry_unit_price: 0, duration_minutes: 40 },
    { id: 12, service_id: 2, region: "Lóbulo", quantity: 1, procedure_price: 50, jewelry_id: null, jewelry_unit_price: 0, duration_minutes: 20 },
  ],
};

function okResponse(body = {}) {
  return { ok: true, status: 200, json: async () => body };
}

function callsTo(predicate) {
  return mocks.apiFetch.mock.calls.filter(([path, options]) => predicate(String(path), options || {}));
}

function patchBodies() {
  return callsTo((path, options) => path === "/appointments/10" && options.method === "PATCH").map(([, options]) => JSON.parse(options.body));
}

function lastSummary() {
  return mocks.summaries.at(-1);
}

function renderQuick(appointment = baseAppointment) {
  const onSaved = vi.fn();
  render(
    <AppointmentQuickModal
      appointment={appointment}
      options={{ serviceItems: [] }}
      services={services}
      procedures={[]}
      features={["basic_catalog", "basic_finance"]}
      onClose={() => {}}
      onSaved={onSaved}
    />
  );
  return { onSaved };
}

beforeEach(() => {
  localStorage.clear();
  mocks.session = { user: { id: 1, role: "admin" } };
  mocks.summaries.length = 0;
  mocks.apiFetch.mockReset();
  // A prévia oficial falha de propósito: a tela deve seguir com o cálculo local.
  mocks.apiFetch.mockImplementation(async (path) => (String(path) === "/appointments/financial-preview"
    ? { ok: false, status: 503, json: async () => ({}) }
    : okResponse({})));
});

describe("Detalhes do Agendamento — área de trabalho", () => {
  it("conferir sinal preserva expectativa e recalcula o pagamento antes da finalização", async () => {
    const user = userEvent.setup();
    mocks.apiFetch.mockImplementation(async (path, options) => path === "/appointments/10" && options?.method === "PATCH"
      ? okResponse({ remaining_value: 79.9 })
      : path === "/appointments/financial-preview" ? { ok: false, status: 503, json: async () => ({}) } : okResponse({}));
    renderQuick({ ...baseAppointment, deposit_expected_value: 25 });
    expect(screen.getByText(/Sinal esperado:/)).toHaveTextContent("25,00");
    const input = screen.getByLabelText("Valor do sinal (R$)");
    await user.clear(input);
    await user.type(input, "60");
    await waitFor(() => expect(mocks.summaries.at(-1).summary.depositPaid).toBe(60));
    expect(mocks.summaries.at(-1).summary.outstandingBalance).toBe(79.9);
    expect(screen.getByText(/Sinal conferido:/)).toHaveTextContent("60,00");
    await user.click(screen.getByRole("button", { name: "Revisar e finalizar" }));
    await waitFor(() => expect(patchBodies()).toHaveLength(1));
    expect(patchBodies()[0].deposit_value).toBe(60);
    expect(patchBodies()[0]).not.toHaveProperty("deposit_expected_value");
    const completion = callsTo((path) => path === "/appointments/10/complete");
    expect(JSON.parse(completion[0][1].body).payments[0].amount).toBe(79.9);
  });
  it("permite apagar região, quantidade, sinal e valor de pagamento sem restaurar conteúdo", async () => {
    const user = userEvent.setup();
    renderQuick();
    for (const input of [screen.getAllByLabelText("Região")[0], screen.getAllByLabelText("Qtd.")[0], screen.getByLabelText("Valor do sinal (R$)"), screen.getByRole("spinbutton", { name: "Valor 1" })]) {
      await user.clear(input);
      expect(input.value).toBe("");
      await user.type(input, input.type === "number" ? "2" : "Texto");
      await user.clear(input);
      expect(input.value).toBe("");
    }
    await user.type(screen.getAllByLabelText("Qtd.")[0], "1");
    await user.click(screen.getByRole("button", { name: "Revisar e finalizar" }));
    expect(patchBodies()).toHaveLength(0);
    expect(screen.getAllByText("Informe um valor válido para cada pagamento.").length).toBeGreaterThan(0);
  });

  it("divide Pix e crédito, preserva a linha ao mudar a forma e envia valores separados", async () => {
    const user = userEvent.setup();
    renderQuick();
    await user.click(screen.getByRole("button", { name: "Dividir pagamento" }));
    const firstAmount = screen.getByRole("spinbutton", { name: "Valor 1" });
    await user.clear(firstAmount);
    await user.type(firstAmount, "40");
    const secondAmount = screen.getByRole("spinbutton", { name: "Valor 2" });
    await user.clear(secondAmount);
    await user.type(secondAmount, "49.90");
    await user.click(screen.getByRole("combobox", { name: "Forma 2" }));
    await user.click(screen.getByRole("option", { name: /cartão de crédito/i }));
    expect(screen.getByRole("spinbutton", { name: "Valor 2" })).toBe(secondAmount);
    const installments = screen.getByRole("spinbutton", { name: "Parcelas 2" });
    await user.clear(installments);
    expect(installments.value).toBe("");
    await user.type(installments, "3");
    await user.click(screen.getByRole("button", { name: "Revisar e finalizar" }));
    await waitFor(() => expect(callsTo((path) => path === "/appointments/10/complete")).toHaveLength(1));
    const [, options] = callsTo((path) => path === "/appointments/10/complete")[0];
    expect(JSON.parse(options.body).payments.map((row) => row.amount)).toEqual([40, 49.9]);
    expect(JSON.parse(options.body).payments[1].installments).toBe(3);
    expect(JSON.parse(options.body).payments[0]).not.toHaveProperty("row_key");
  });

  it("barra excesso da soma incluindo pagamentos pendentes antes de gravar itens", async () => {
    const user = userEvent.setup();
    renderQuick();
    await user.click(screen.getByRole("button", { name: "Dividir pagamento" }));
    const secondAmount = screen.getByRole("spinbutton", { name: "Valor 2" });
    await user.clear(secondAmount);
    await user.type(secondAmount, "10");
    await user.click(screen.getByRole("combobox", { name: "Status 2" }));
    await user.click(screen.getByRole("option", { name: "Pendente" }));
    await user.click(screen.getByRole("button", { name: "Revisar e finalizar" }));
    expect(patchBodies()).toHaveLength(0);
    expect(screen.getAllByText("A soma dos pagamentos não pode superar o saldo do atendimento.").length).toBeGreaterThan(0);
  });

  it("refetch do atendimento e carregamento das opções não sobrescrevem a edição", async () => {
    const user = userEvent.setup();
    const props = { appointment: baseAppointment, options: { serviceItems: [] }, services, procedures: [], features: ["basic_catalog", "basic_finance"], onClose: () => {}, onSaved: () => {} };
    const { rerender } = render(<AppointmentQuickModal {...props} />);
    await user.click(screen.getByRole("button", { name: "Dividir pagamento" }));
    const amount = screen.getByRole("spinbutton", { name: "Valor 2" });
    await user.clear(amount);
    await user.type(amount, "25");
    const region = screen.getAllByLabelText("Região")[0];
    await user.clear(region);
    await user.type(region, "Tragus");
    rerender(<AppointmentQuickModal {...props} appointment={{ ...baseAppointment }} options={{ serviceItems: [] }} services={[...services]} />);
    expect(screen.getByRole("spinbutton", { name: "Valor 2" })).toBe(amount);
    expect(amount.value).toBe("25");
    expect(region.value).toBe("Tragus");
    rerender(<AppointmentQuickModal {...props} appointment={{ ...baseAppointment, id: 20 }} />);
    expect(screen.queryByRole("spinbutton", { name: "Valor 2" })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Região")[0].value).toBe("Hélix");
  });

  it("abre como área de trabalho larga", () => {
    renderQuick();
    expect(screen.getByRole("dialog", { name: "Detalhes do Agendamento" })).toHaveClass("modal-workspace");
  });

  it("semeia TODOS os itens de appointment.items e reenvia os ids no PATCH, com desconto e sem deposit_*", async () => {
    const user = userEvent.setup();
    renderQuick();
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(patchBodies()).toHaveLength(1));
    const [body] = patchBodies();
    expect(body.appointment_items).toHaveLength(2);
    expect(body.appointment_items.map((item) => item.id)).toEqual([11, 12]);
    expect(body.appointment_items.map((item) => item.procedure_price)).toEqual([99.9, 50]);
    expect(body.appointment_items.map((item) => item.service_id)).toEqual([1, 2]);
    expect(body.manual_discount_value).toBe(10);
    expect(body.manual_discount_reason).toBe("Cliente fiel");
    for (const field of ["deposit_value", "deposit_status", "deposit_payment_method", "deposit_paid_at", "remaining_value", "deposit_manual"]) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it("usa appointment_items como alternativa quando a API não manda items", async () => {
    const user = userEvent.setup();
    const { items, ...rest } = baseAppointment;
    renderQuick({ ...rest, appointment_items: items });
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(patchBodies()).toHaveLength(1));
    expect(patchBodies()[0].appointment_items.map((item) => item.id)).toEqual([11, 12]);
  });

  it("mostra o resumo local na conta da SPEC enquanto a prévia oficial não responde", () => {
    renderQuick();
    const summary = lastSummary().summary;
    expect(summary.grossTotal).toBe(149.9);
    expect(summary.discountTotal).toBe(10);
    expect(summary.netTotal).toBe(139.9);
    expect(summary.depositPaid).toBe(50);
    expect(summary.outstandingBalance).toBe(89.9);
    expect(summary.manualDiscount).toBe(10);
    expect(summary.paymentStatus).toBe("parcial");
  });

  it("pede a prévia oficial com debounce e passa a exibir o valor dela", async () => {
    mocks.apiFetch.mockImplementation(async (path) => (String(path) === "/appointments/financial-preview"
      ? okResponse({ financial: { serviceSubtotal: 149.9, productSubtotal: 0, couponDiscount: 0, manualDiscount: 10, adjustmentTotal: 5, depositPaid: 50, otherPayments: 0 } })
      : okResponse({})));
    renderQuick();
    await waitFor(() => expect(callsTo((path) => path === "/appointments/financial-preview")).toHaveLength(1));
    const [, options] = callsTo((path) => path === "/appointments/financial-preview")[0];
    const body = JSON.parse(options.body);
    expect(body.appointment_id).toBe(10);
    expect(body.manual_discount_value).toBe(10);
    expect(body.appointment_items.map((item) => item.id)).toEqual([11, 12]);
    await waitFor(() => expect(lastSummary().summary.adjustmentTotal).toBe(5));
    expect(lastSummary().summary.netTotal).toBe(144.9);
    expect(lastSummary().summary.outstandingBalance).toBe(94.9);
  });

  it("desconto editável só com a permissão de aplicar desconto", () => {
    mocks.session = { user: { id: 2, role: "reception" } };
    renderQuick();
    expect(screen.getByTestId("financial-summary")).toHaveAttribute("data-editable", "true");
  });

  it("sem a permissão, o desconto fica só leitura e a tela explica o motivo", () => {
    mocks.session = { user: { id: 3, role: "reception", denied_permissions: ["appointments.apply_discount"] } };
    renderQuick();
    expect(screen.getByTestId("financial-summary")).toHaveAttribute("data-editable", "false");
    expect(screen.getByText("Desconto manual exige a permissão “Aplicar desconto”.")).toBeInTheDocument();
  });

  it("o desconto digitado vai no PATCH como manual_discount_value", async () => {
    const user = userEvent.setup();
    renderQuick();
    act(() => lastSummary().onDiscountChange(15.5));
    act(() => lastSummary().onDiscountReasonChange("Indicação"));
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(patchBodies()).toHaveLength(1));
    expect(patchBodies()[0].manual_discount_value).toBe(15.5);
    expect(patchBodies()[0].manual_discount_reason).toBe("Indicação");
  });

  it("desconto acima do bruto é barrado antes de enviar", async () => {
    const user = userEvent.setup();
    renderQuick();
    act(() => lastSummary().onDiscountChange(200));
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findAllByText("O desconto não pode ser maior que o valor bruto.")).not.toHaveLength(0);
    expect(patchBodies()).toHaveLength(0);
  });

  it("registrar o sinal envia deposit_* no PATCH", async () => {
    const user = userEvent.setup();
    renderQuick({ ...baseAppointment, deposit_status: "pendente", remaining_value: 139.9 });
    await user.click(screen.getByRole("switch", { name: /Sinal recebido/ }));
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(patchBodies()).toHaveLength(1));
    const [body] = patchBodies();
    expect(body.deposit_status).toBe("pago");
    expect(body.deposit_value).toBe(50);
    expect(body.deposit_payment_method).toBe("Pix");
    expect(body.deposit_paid_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("sinal já recebido fica travado para quem não tem permissão financeira", () => {
    mocks.session = { user: { id: 2, role: "reception" } };
    renderQuick();
    expect(screen.queryByRole("switch", { name: /Sinal recebido/ })).not.toBeInTheDocument();
    expect(screen.getByText("Sinal já recebido. Para corrigir, é preciso a permissão financeira.")).toBeInTheDocument();
  });

  it("o seletor de status não oferece \"Atendido\"", async () => {
    const user = userEvent.setup();
    renderQuick();
    const [statusField] = screen.getAllByRole("combobox", { name: "Status" });
    await user.click(statusField);
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "Confirmado" })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: "Atendido" })).not.toBeInTheDocument();
  });

  it("\"Revisar e finalizar\" grava itens sem status e conclui pelo /complete", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderQuick();
    await user.click(screen.getByRole("button", { name: "Revisar e finalizar" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [patch] = patchBodies();
    expect(patch).not.toHaveProperty("status");
    expect(patch.appointment_items.map((item) => item.id)).toEqual([11, 12]);
    const complete = callsTo((path) => path === "/appointments/10/complete");
    expect(complete).toHaveLength(1);
    expect(JSON.parse(complete[0][1].body).payments[0].amount).toBe(89.9);
  });

  it("sem permissão de finalizar, o botão fica desabilitado com explicação", () => {
    mocks.session = { user: { id: 2, role: "reception" } };
    renderQuick();
    expect(screen.getByRole("button", { name: "Revisar e finalizar" })).toBeDisabled();
    expect(screen.getByText("Finalizar o atendimento exige a permissão “Finalizar atendimento”.")).toBeInTheDocument();
  });

  it("ajustes e indicador químico continuam visíveis no atendimento já finalizado", () => {
    mocks.session = { user: { id: 4, role: "piercer" } };
    renderQuick({ ...baseAppointment, status: "atendido" });
    expect(screen.queryByText("Observações clínicas (opcional)")).not.toBeInTheDocument();
    expect(screen.getByTestId("chemical-panel")).toHaveAttribute("data-can-edit", "true");
    // Piercer tem edit_final_value, mas sem finance.edit não mexe em valor depois do fechamento.
    expect(screen.getByTestId("value-adjustments")).toHaveAttribute("data-can-edit", "false");
    expect(screen.getByTestId("value-adjustments")).toHaveAttribute("data-require-reason", "true");
  });

  it("antes do fechamento, ajuste de valor segue appointments.edit_final_value", () => {
    mocks.session = { user: { id: 4, role: "piercer" } };
    renderQuick();
    expect(screen.getByTestId("value-adjustments")).toHaveAttribute("data-can-edit", "true");
  });

  it("atendimento finalizado sem mudança de valor salva só os campos não financeiros, sem motivo", async () => {
    const user = userEvent.setup();
    renderQuick({ ...baseAppointment, status: "atendido" });
    expect(screen.queryByLabelText(/Motivo da alteração/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Observação"), "Cliente pediu recibo");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(patchBodies()).toHaveLength(1));
    const [body] = patchBodies();
    expect(body.notes).toBe("Cliente pediu recibo");
    for (const field of ["appointment_items", "manual_discount_value", "manual_discount_reason", "total_value", "coupon_code", "deposit_value", "reason"]) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it("atendimento finalizado com desconto alterado exige motivo e envia o motivo", async () => {
    const user = userEvent.setup();
    renderQuick({ ...baseAppointment, status: "atendido" });
    act(() => lastSummary().onDiscountChange(12));
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByText("Atendimento finalizado: informe o motivo da alteração.")).toBeInTheDocument();
    expect(patchBodies()).toHaveLength(0);
    await user.type(screen.getByLabelText(/Motivo da alteração/), "Correção de valor");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(patchBodies()).toHaveLength(1));
    expect(patchBodies()[0].reason).toBe("Correção de valor");
    expect(patchBodies()[0].manual_discount_value).toBe(12);
    expect(patchBodies()[0].appointment_items.map((item) => item.id)).toEqual([11, 12]);
  });

  it("atendimento finalizado: sem permissão financeira, mudança de item é barrada antes do PATCH", async () => {
    mocks.session = { user: { id: 4, role: "piercer" } };
    const user = userEvent.setup();
    renderQuick({ ...baseAppointment, status: "atendido" });
    const [region] = screen.getAllByLabelText("Região");
    await user.clear(region);
    await user.type(region, "Tragus");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByText("Atendimento finalizado: alterar itens, desconto ou status exige a permissão financeira.")).toBeInTheDocument();
    expect(patchBodies()).toHaveLength(0);
  });

  it("atendimento finalizado não oferece refazer o fechamento nem atalhos de status", () => {
    renderQuick({ ...baseAppointment, status: "atendido" });
    expect(screen.queryByRole("button", { name: "Revisar e finalizar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reagendar" })).not.toBeInTheDocument();
    expect(screen.getByText(/diferenças de valor entram como ajuste/)).toBeInTheDocument();
  });

  it("sem a prévia oficial, a linha padrão de pagamento acompanha o restante local após um desconto", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderQuick();
    act(() => lastSummary().onDiscountChange(20));
    await waitFor(() => expect(lastSummary().summary.outstandingBalance).toBe(79.9));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    await user.click(screen.getByRole("button", { name: "Revisar e finalizar" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const complete = callsTo((path) => path === "/appointments/10/complete");
    expect(JSON.parse(complete[0][1].body).payments[0].amount).toBe(79.9);
  });

  it("mostra o erro de cupom que a prévia oficial devolve em 200 e não marca o cupom como aplicado", async () => {
    mocks.apiFetch.mockImplementation(async (path) => (String(path) === "/appointments/financial-preview"
      ? okResponse({
          serviceSubtotal: 149.9, productSubtotal: 0, couponDiscount: 0, manualDiscount: 10, adjustmentTotal: 0, depositPaid: 50, otherPayments: 0,
          coupon: { code: "VOLTA10", valid: false, error: "Cupom expirado.", discount: 0 },
          validation: { discount: null, coupon: "Cupom expirado.", net: null }
        })
      : okResponse({})));
    renderQuick({ ...baseAppointment, coupon_code: "VOLTA10" });
    expect(await screen.findByText("Cupom expirado.")).toBeInTheDocument();
    expect(lastSummary().summary.couponCode).toBeNull();
    expect(lastSummary().summary.netTotal).toBe(139.9);
  });
});

describe("Lista de profissionais — coluna Comissão", () => {
  it("lê o resumo no formato do backend (padrão de serviço, produto e regras por serviço)", () => {
    const result = professionalCommissionLabel({
      commission_percentage: 99,
      commission_summary: { service_default: { rate_type: "percentual", rate_value: 40 }, product_default: { rate_type: "valor_fixo", rate_value: 5 }, service_rules: 2, active_rules: 4 }
    });
    expect(result.label).toBe("Serviços: 40%");
    expect(result.extra).toContain("Produtos:");
    expect(result.extra).toContain("2 regra(s) por serviço");
  });

  it("com resumo sem padrão de serviço, não cai no percentual legado", () => {
    expect(professionalCommissionLabel({ commission_percentage: 30, commission_summary: { service_default: null, product_default: null, service_rules: 3, active_rules: 3 } }).label).toBe("Regras por serviço");
    expect(professionalCommissionLabel({ commission_percentage: 30, commission_summary: { service_default: null, product_default: null, service_rules: 0, active_rules: 0 } }).label).toBe("Sem comissão");
  });

  it("sem resumo (dados antigos), usa o percentual legado", () => {
    expect(professionalCommissionLabel({ commission_percentage: 30 }).label).toBe("Serviços: 30%");
  });
});

describe("Novo Agendamento — área de trabalho", () => {
  const seed = { full_name: "Ana", whatsapp: "11999990000", professional_id: "7", appointment_date: "2026-10-01", appointment_time: "14:00", service_id: 1 };

  function renderCreate() {
    const onSaved = vi.fn();
    render(
      <AppointmentCreateModal
        seed={seed}
        options={{ serviceItems: [], professionals: [{ id: 7, name: "Bia" }] }}
        clients={[]}
        services={services}
        procedures={[]}
        onClose={() => {}}
        onSaved={onSaved}
      />
    );
    return { onSaved };
  }

  function postBodies() {
    return callsTo((path, options) => path === "/appointments" && options.method === "POST").map(([, options]) => JSON.parse(options.body));
  }

  it("abre largo e não oferece \"Atendido\" no status", async () => {
    const user = userEvent.setup();
    renderCreate();
    expect(screen.getByRole("dialog", { name: "Novo Agendamento" })).toHaveClass("modal-workspace");
    await user.click(screen.getByRole("combobox", { name: "Status" }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "Pendente" })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: "Atendido" })).not.toBeInTheDocument();
  });

  it("\"Continuar\" confere a primeira etapa antes de avançar", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.clear(screen.getByLabelText("WhatsApp"));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Informe o WhatsApp.")).toBeInTheDocument();
    expect(screen.queryByText("Procedimentos e joias")).not.toBeInTheDocument();
  });

  it("envia desconto manual e sinal registrado quando há permissão", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderCreate();
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.type(screen.getByLabelText("Região"), "Hélix");
    expect(screen.getByTestId("financial-summary")).toHaveAttribute("data-editable", "true");
    act(() => lastSummary().onDiscountChange(20));
    await user.click(screen.getByRole("switch", { name: /Sinal recebido/ }));
    await user.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [body] = postBodies();
    expect(body.manual_discount_value).toBe(20);
    expect(body.deposit_value).toBe(25);
    expect(body.deposit_status).toBe("pago");
    expect(body.status).toBe("pendente");
    expect(body).not.toHaveProperty("deposit_manual");
    expect(body.appointment_items).toHaveLength(1);
  });

  it("sem permissão de desconto, o POST não leva manual_discount_value", async () => {
    mocks.session = { user: { id: 3, role: "reception", denied_permissions: ["appointments.apply_discount"] } };
    const user = userEvent.setup();
    const { onSaved } = renderCreate();
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.type(screen.getByLabelText("Região"), "Hélix");
    expect(screen.getByTestId("financial-summary")).toHaveAttribute("data-editable", "false");
    await user.click(screen.getByRole("button", { name: "Salvar agendamento" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [body] = postBodies();
    expect(body).not.toHaveProperty("manual_discount_value");
    expect(body.deposit_status).toBe("pendente");
  });
});
