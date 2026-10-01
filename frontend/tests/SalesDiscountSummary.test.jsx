import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SalesWorkspace } from "../src/features/sales/Sales";
import { apiFetch } from "../src/lib/api";

// Integração com o FinancialSummary REAL (sem stub): o campo de desconto, o
// atalho % e o cupom precisam conversar com a cotação oficial da venda.

const JEWELRY = [
  { id: 1, name: "Argola Titânio", sku: "ARG-1", sale_value: 100, quantity: 5, inventory_quantity: 5, can_sell: 1, variants: [] },
  { id: 2, name: "Labret Cristal", sku: "LAB-2", sale_value: 49.9, quantity: 5, inventory_quantity: 5, can_sell: 1, variants: [] },
];

vi.mock("../src/lib/api", () => ({
  apiFetch: vi.fn(),
  readStoredSession: () => ({ user: { id: 7, role: "admin" } }),
  tenantSlug: () => "clinica-teste",
  useApiInvalidate: () => vi.fn(),
  useFetch: (path) => ({ data: path === "/jewelry" ? JEWELRY : [], loading: false, error: "" }),
}));

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const cents = (value) => Math.round(Number(value) * 100);

function quoteFromBody(body) {
  const gross = body.items.reduce((sum, item) => sum + cents(item.unit_price) * Number(item.quantity), 0);
  const coupon = body.coupon_code === "BEMVINDA" ? 1500 : 0;
  const manual = cents(body.manual_discount_value || 0);
  if (coupon + manual > gross) return [{ error: "O desconto não pode ser maior que o valor bruto." }, 400];
  return [{
    subtotal_value: gross / 100,
    coupon_discount_value: coupon / 100,
    manual_discount_value: manual / 100,
    discount_value: (coupon + manual) / 100,
    total_value: (gross - coupon - manual) / 100,
    coupon_code: coupon ? "BEMVINDA" : null,
    coupon: coupon ? { code: "BEMVINDA" } : null,
  }, 200];
}

const quoteCalls = () => apiFetch.mock.calls.filter(([path]) => path === "/sales-orders/quote").map(([, options]) => JSON.parse(options.body));
const postCalls = () => apiFetch.mock.calls.filter(([path, options]) => path === "/sales-orders" && options?.method === "POST").map(([, options]) => JSON.parse(options.body));

async function addJewelry(name) {
  const combobox = screen.getByRole("combobox", { name: "Joia" });
  fireEvent.focus(combobox);
  fireEvent.change(combobox, { target: { value: name.split(" ")[0] } });
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

async function openSale(user) {
  render(<SalesWorkspace features={["basic_catalog", "basic_finance"]} />);
  await user.click(screen.getByRole("button", { name: /Nova venda/i }));
  await user.type(screen.getByRole("textbox", { name: "Cliente" }), "Maria");
  await user.type(screen.getByRole("textbox", { name: "WhatsApp" }), "11999990000");
  await user.click(screen.getByRole("button", { name: /2\. Itens/i }));
  await addJewelry("Argola Titânio");
  await addJewelry("Labret Cristal");
  await user.click(screen.getByRole("button", { name: /3\. Pagamento/i }));
  await screen.findByText("Total conferido pelo sistema.");
}

beforeEach(() => {
  localStorage.clear();
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path, options = {}) => {
    if (path === "/sales-orders/quote") return json(...quoteFromBody(JSON.parse(options.body)));
    if (path === "/sales-orders" && options.method === "POST") return json({ id: 77 }, 201);
    return json({});
  });
});

describe("venda com o resumo financeiro real", () => {
  it("149,90 − 10,00 = 139,90 pelo campo “Desconto (R$)” e envia o valor no POST", async () => {
    const user = userEvent.setup();
    await openSale(user);
    const summary = screen.getByRole("region", { name: "Resumo financeiro" });
    await user.type(within(summary).getByRole("spinbutton", { name: "Desconto (R$)" }), "10");
    await user.type(within(summary).getByRole("textbox", { name: /Motivo do desconto/ }), "Cliente fidelidade");
    await waitFor(() => expect(quoteCalls().at(-1)).toMatchObject({ manual_discount_value: 10 }));
    await waitFor(() => expect(within(summary).getAllByText(/139,90/).length).toBeGreaterThan(0));

    await user.click(screen.getByRole("button", { name: "Salvar venda" }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0]).toMatchObject({ manual_discount_value: 10, manual_discount_reason: "Cliente fidelidade" });
  });

  it("atalho % converte sobre bruto − cupom mesmo enquanto a nova cotação não chega", async () => {
    const user = userEvent.setup();
    await openSale(user);
    await user.type(screen.getByLabelText("Cupom"), "bemvinda");
    await user.click(screen.getByRole("button", { name: "Aplicar cupom" }));
    const summary = screen.getByRole("region", { name: "Resumo financeiro" });
    await waitFor(() => expect(within(summary).getAllByText(/134,90/).length).toBeGreaterThan(0));

    // Digitado tecla a tecla: "1" e depois "10". A 2ª tecla chega antes da
    // cotação do "1%"; a base precisa continuar sendo 149,90 − 15,00 = 134,90.
    await user.type(within(summary).getByRole("spinbutton", { name: "Atalho %" }), "10");
    // O cupom não "some" do resumo enquanto o desconto manual é recotado.
    expect(within(summary).getAllByText(/Cupom BEMVINDA/).length).toBeGreaterThan(0);
    await waitFor(() => expect(quoteCalls().at(-1)).toMatchObject({ coupon_code: "BEMVINDA", manual_discount_value: 13.49 }));
    await waitFor(() => expect(within(summary).getAllByText(/121,41/).length).toBeGreaterThan(0));
  });

  it("desconto acima do teto não é cotado nem salvo", async () => {
    const user = userEvent.setup();
    await openSale(user);
    const before = quoteCalls().length;
    const summary = screen.getByRole("region", { name: "Resumo financeiro" });
    fireEvent.change(within(summary).getByRole("spinbutton", { name: "Desconto (R$)" }), { target: { value: "200" } });
    expect((await screen.findAllByText(/O desconto não pode ser maior que/)).length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(quoteCalls()).toHaveLength(before);
    expect(screen.queryByText("Conferindo o total da venda…")).not.toBeInTheDocument();
    expect(screen.queryByText("Total conferido pelo sistema.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Salvar venda" }));
    expect(postCalls()).toHaveLength(0);
  });
});
