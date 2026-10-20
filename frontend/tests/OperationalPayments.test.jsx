import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CardFeePreview, CardFeesSettings } from "../src/features/finance/CardFees";
import { AppointmentMaterials } from "../src/features/agenda/AppointmentMaterials";

const state = vi.hoisted(() => ({ tables: [], materials: [], failure: false, calls: [] }));
vi.mock("../src/lib/api", () => ({
  apiFetch: vi.fn(async (path, options) => {
    state.calls.push({ path, options });
    if (state.failure) throw new Error("Conexão interrompida");
    return { ok: true, json: async () => (path.includes("materials") ? { items: state.materials } : state.tables) };
  }),
}));
beforeEach(() => {
  state.tables = [];
  state.materials = [];
  state.failure = false;
  state.calls = [];
});

it("aplica a taxa da parcela selecionada, calcula líquido e ignora vigência futura", async () => {
  state.tables = [
    { id: 2, operator_name: "Operadora", valid_from: "2099-01-01", debit_percent: 50, credit_rates: { 12: 50 } },
    {
      id: 1,
      operator_name: "Operadora",
      valid_from: "2020-01-01",
      debit_percent: 1.5,
      credit_rates: { 1: 2, 12: 8.5 },
    },
  ];
  const onChange = vi.fn();
  render(
    <CardFeePreview
      payment={{ method: "Cartão de crédito", amount: 200, installments: 12, fee_amount: 0 }}
      onChange={onChange}
    />,
  );
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ card_fee_table_id: 1, fee_amount: 17 }));
  expect(screen.getByText(/Líquido/)).toHaveTextContent(/183,00/);
});

it("não consulta taxas de cartão para pagamento Pix", () => {
  render(<CardFeePreview payment={{ method: "Pix", amount: 100 }} onChange={vi.fn()} />);
  expect(state.calls).toHaveLength(0);
});

it("envia débito e cada uma das doze taxas independentes", async () => {
  render(<CardFeesSettings />);
  fireEvent.change(screen.getByLabelText("Operadora ou maquininha"), { target: { value: "Máquina de teste" } });
  fireEvent.change(screen.getByLabelText("Débito (%)"), { target: { value: "1.5" } });
  for (let count = 1; count <= 12; count++)
    fireEvent.change(screen.getByLabelText(`Crédito ${count}x (%)`), { target: { value: String(count + 1) } });
  fireEvent.submit(screen.getByRole("button", { name: "Salvar tabela de taxas" }).closest("form"));
  await screen.findByText(/Tabela de taxas salva/);
  const payload = JSON.parse(state.calls.find(({ options }) => options?.method === "POST").options.body);
  expect(payload.operator_name).toBe("Máquina de teste");
  expect(payload.debit_percent).toBe("1.5");
  expect(Object.values(payload.credit_rates)).toEqual(Array.from({ length: 12 }, (_, index) => String(index + 2)));
});

it("confere o consumo real e mantém opcionais e reutilizáveis sem baixa inicial", async () => {
  state.materials = [
    { inventory_item_id: 1, inventory_item_name: "Gaze", quantity: 1, is_required: true, auto_consume: true },
    { inventory_item_id: 2, inventory_item_name: "Wrap", quantity: 1, is_required: false, auto_consume: true },
    { inventory_item_id: 3, inventory_item_name: "Pinça", quantity: 1, usage_stage: "reusable" },
  ];
  const onChange = vi.fn();
  render(<AppointmentMaterials appointmentId={4} serviceIds="8" onChange={onChange} />);
  await screen.findByLabelText("Consumo de Gaze");
  expect(onChange).toHaveBeenLastCalledWith([
    { inventory_item_id: 1, quantity: 1 },
    { inventory_item_id: 2, quantity: 0 },
    { inventory_item_id: 3, quantity: 0 },
  ]);
  fireEvent.change(screen.getByLabelText("Consumo de Gaze"), { target: { value: "2" } });
  expect(onChange.mock.lastCall[0][0].quantity).toBe(2);
  expect(screen.queryByLabelText("Consumo de Pinça")).not.toBeInTheDocument();
});

it("não libera a confirmação de materiais quando a consulta falha", async () => {
  state.failure = true;
  const onChange = vi.fn();
  render(<AppointmentMaterials appointmentId={4} onChange={onChange} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Conexão interrompida");
  expect(onChange).toHaveBeenCalledExactlyOnceWith(undefined);
});
