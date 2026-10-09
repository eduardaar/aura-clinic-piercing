import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JewelryEditor } from "../src/features/inventory/Inventory";
import { Communications } from "../src/features/communications/Communications";
import { apiFetch } from "../src/lib/api";

const state = vi.hoisted(() => ({ templates: null, rules: null }));
vi.mock("../src/lib/api", () => ({
  apiFetch: vi.fn(),
  API_ORIGIN: "",
  readStoredSession: () => ({ user: { id: 7, role: "admin" } }),
  tenantSlug: () => "test",
  useApiInvalidate: () => vi.fn(),
  useFetch: (path) => ({ data: path === "/communication-templates" ? state.templates : path === "/automation-rules" ? state.rules : [], refresh: vi.fn() }),
}));

beforeEach(() => {
  localStorage.clear();
  state.templates = { templates: [{ id: 1, name: "Lembrete", body: "Texto salvo", is_active: 1, template_key: "appointment_reminder" }] };
  state.rules = [{ id: 2, name: "Lembrete", offset_minutes: -60, is_active: 1, template_key: "appointment_reminder" }];
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
});

describe("edição em formulários com valores derivados e consultas assíncronas", () => {
  it("mantém custo e preço vazios através do cálculo do pai e edições em outros custos", async () => {
    const user = userEvent.setup();
    render(<JewelryEditor editing={{ id: 1, name: "Argola", category: "Argola", variants: [{ id: 3, sku: "ARG", purchase_cost: 10, cost_value: 10, sale_value: 30, quantity: 2 }] }} />);
    await user.click(screen.getByRole("tab", { name: /Variações/ }));
    await user.click(screen.getByRole("button", { name: "Editar Variação" }));
    const cost = screen.getByLabelText("Custo da Joia");
    await user.clear(cost);
    expect(cost).toHaveValue(null);
    const freight = screen.getByLabelText("Frete Rateado");
    await user.clear(freight);
    await user.type(freight, "5");
    expect(cost).toHaveValue(null);
    await user.type(cost, "12.5");
    expect(cost).toHaveValue(12.5);
    const sale = screen.getByLabelText("Preço Final de Venda");
    await user.clear(sale);
    expect(sale).toHaveValue(null);
    await user.type(sale, "0");
    expect(sale).toHaveValue(0);
  });

  it("preserva uma mensagem apagada quando chega uma consulta antiga", async () => {
    const user = userEvent.setup();
    const view = render(<Communications initialTab="templates" />);
    const body = screen.getByLabelText("Mensagem");
    await user.clear(body);
    expect(body).toHaveValue("");
    state.templates = { templates: [{ id: 1, name: "Lembrete", body: "Texto antigo retornado", is_active: 1, template_key: "appointment_reminder" }] };
    view.rerender(<Communications initialTab="templates" />);
    expect(body).toHaveValue("");
    await user.type(body, "Mensagem nova");
    await user.click(screen.getByRole("button", { name: /Salvar modelo/ }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(JSON.parse(apiFetch.mock.calls[0][1].body).body).toBe("Mensagem nova");
  });

  it("permite apagar intervalo e preserva o rascunho após consulta atrasada", async () => {
    const user = userEvent.setup();
    const view = render(<Communications initialTab="automation" />);
    const minutes = screen.getByLabelText("Intervalo em minutos");
    await user.clear(minutes);
    expect(minutes).toHaveValue(null);
    state.rules = [{ ...state.rules[0], offset_minutes: -120 }];
    view.rerender(<Communications initialTab="automation" />);
    expect(minutes).toHaveValue(null);
    fireEvent.change(minutes, { target: { value: "30" } });
    await user.click(screen.getByRole("button", { name: /Salvar automação/ }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const payload = JSON.parse(apiFetch.mock.calls[0][1].body);
    expect(payload.offset_minutes).toBe(-30);
    expect(payload).not.toHaveProperty("timing_minutes");
  });
});
