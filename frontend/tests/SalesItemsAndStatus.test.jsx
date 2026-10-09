import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SalesWorkspace } from "../src/features/sales/Sales";
import { apiFetch } from "../src/lib/api";

// Lacunas de interface da venda: item em dobro e venda "aberta" exibida como paga.

const JEWELRY = [
  { id: 1, name: "Argola Titânio", sku: "ARG-1", sale_value: 100, quantity: 5, inventory_quantity: 5, can_sell: 1, variants: [] },
];

vi.mock("../src/lib/api", () => ({
  apiFetch: vi.fn(),
  readStoredSession: () => ({ user: { id: 7, role: "admin" } }),
  tenantSlug: () => "clinica-teste",
  useApiInvalidate: () => vi.fn(),
  useFetch: (path) => ({ data: path === "/jewelry" ? JEWELRY : [], loading: false, error: "" }),
}));

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  localStorage.clear();
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path, options = {}) => {
    if (path === "/sales-orders/quote") {
      const body = JSON.parse(options.body);
      const gross = body.items.reduce((sum, item) => sum + Math.round(Number(item.unit_price) * 100) * Number(item.quantity), 0);
      return json({ subtotal_value: gross / 100, coupon_discount_value: 0, manual_discount_value: 0, discount_value: 0, total_value: gross / 100, coupon_code: null, coupon: null });
    }
    if (path === "/sales-orders" && options.method === "POST") return json({ id: 77 }, 201);
    return json({});
  });
});

async function openSale(user) {
  render(<SalesWorkspace features={["basic_catalog", "basic_finance"]} />);
  await user.click(screen.getByRole("button", { name: /Nova venda/i }));
  await user.type(screen.getByRole("textbox", { name: "Cliente" }), "Maria");
  await user.type(screen.getByRole("textbox", { name: "WhatsApp" }), "11999990000");
}

async function pickJewelry(name) {
  const combobox = screen.getByRole("combobox", { name: "Joia" });
  fireEvent.focus(combobox);
  fireEvent.change(combobox, { target: { value: name.split(" ")[0] } });
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

describe("venda: itens e status", () => {
  it("deixa quantidade e preço vazios e recusa quantidade vazia", async () => {
    const user = userEvent.setup();
    await openSale(user);
    await user.click(screen.getByRole("button", { name: /2\. Itens/i }));
    await pickJewelry("Argola Titânio");
    const quantity = screen.getByLabelText("Quantidade");
    const price = screen.getByLabelText("Valor unitário");
    await user.clear(quantity);
    expect(quantity).toHaveValue(null);
    await user.click(screen.getByRole("button", { name: "Salvar alteração" }));
    expect(screen.getByText("Informe uma quantidade inteira maior que zero.")).toBeInTheDocument();
    await user.type(quantity, "2");
    await user.clear(price);
    expect(price).toHaveValue(null);
    await user.type(price, "0");
    expect(price).toHaveValue(0);
    await user.click(screen.getByRole("button", { name: "Salvar alteração" }));
    expect(screen.getByText("1 item(ns) adicionado(s)")).toBeInTheDocument();
  });
  it("escolher a joia e confirmar a linha não duplica o item", async () => {
    const user = userEvent.setup();
    await openSale(user);
    await user.click(screen.getByRole("button", { name: /2\. Itens/i }));
    await pickJewelry("Argola Titânio");
    expect(screen.getByText("1 item(ns) adicionado(s)")).toBeInTheDocument();

    // A linha passa a editar o item já colocado no carrinho.
    await user.click(screen.getByRole("button", { name: "Salvar alteração" }));
    expect(screen.getByText("1 item(ns) adicionado(s)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar alteração" })).not.toBeInTheDocument();
  });

  it("venda aberta com “Recebido agora” não aparece como paga e não oferece criar cancelada", async () => {
    const user = userEvent.setup();
    await openSale(user);
    await user.click(screen.getByRole("button", { name: /Contato e status/i }));
    const status = screen.getByRole("combobox", { name: "Status" });
    await user.click(status);
    expect(screen.queryByRole("option", { name: "cancelada" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "aberta" }));

    await user.click(screen.getByRole("button", { name: /2\. Itens/i }));
    await pickJewelry("Argola Titânio");
    await user.click(screen.getByRole("button", { name: /3\. Pagamento/i }));
    const summary = screen.getByRole("region", { name: "Resumo financeiro" });
    await waitFor(() => expect(within(summary).getByText("Pendente")).toBeInTheDocument());
    expect(within(summary).queryByText("Pago")).not.toBeInTheDocument();
    expect(screen.getByText("Recebido ao concluir a venda")).toBeInTheDocument();
  });
});
