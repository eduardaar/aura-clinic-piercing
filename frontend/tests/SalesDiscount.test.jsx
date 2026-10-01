import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SalesWorkspace,
  normalizeSalesQuote,
  saleItemDiscountCents,
  saleReturnRefundCents,
} from "../src/features/sales/Sales";
import { apiFetch } from "../src/lib/api";

const session = vi.hoisted(() => ({ user: { id: 7, role: "admin" } }));
const fetched = vi.hoisted(() => ({ orders: [] }));

const JEWELRY = [
  { id: 1, name: "Argola Titânio", sku: "ARG-1", sale_value: 100, quantity: 5, inventory_quantity: 5, can_sell: 1, variants: [] },
  { id: 2, name: "Labret Cristal", sku: "LAB-2", sale_value: 49.9, quantity: 5, inventory_quantity: 5, can_sell: 1, variants: [] },
];

vi.mock("../src/lib/api", () => ({
  apiFetch: vi.fn(),
  readStoredSession: () => ({ user: session.user }),
  tenantSlug: () => "clinica-teste",
  useApiInvalidate: () => vi.fn(),
  useFetch: (path) => ({ data: path === "/jewelry" ? JEWELRY : path === "/sales-orders" ? fetched.orders : [], loading: false, error: "" }),
}));

// O resumo financeiro real é de outro pacote (FE-FINANCEIRO). Aqui interessa o
// contrato que a venda entrega a ele: valores da cotação e props do desconto.
vi.mock("../src/components/common/Ui", async (importOriginal) => {
  const actual = await importOriginal();
  function FinancialSummaryStub({ summary = {}, discountEditable, onDiscountChange, discountReason, onDiscountReasonChange, discountMax }) {
    return (
      <section aria-label="Resumo financeiro (teste)">
        <output data-testid="summary-gross">{String(summary.grossTotal)}</output>
        <output data-testid="summary-coupon">{String(summary.couponDiscount)}</output>
        <output data-testid="summary-manual">{String(summary.manualDiscount)}</output>
        <output data-testid="summary-discount">{String(summary.discountTotal)}</output>
        <output data-testid="summary-net">{String(summary.netTotal)}</output>
        <output data-testid="summary-max">{String(discountMax)}</output>
        {discountEditable ? (
          <>
            <input aria-label="Desconto (R$)" onChange={(event) => onDiscountChange(Number(event.target.value))} />
            <input aria-label="Motivo do desconto" value={discountReason || ""} onChange={(event) => onDiscountReasonChange(event.target.value)} />
          </>
        ) : (
          <span>Desconto somente leitura</span>
        )}
      </section>
    );
  }
  return { ...actual, FinancialSummary: FinancialSummaryStub };
});

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const cents = (value) => Math.round(Number(value) * 100);

function quoteFromBody(body, { couponCode = "BEMVINDA", couponDiscount = 15 } = {}) {
  const gross = body.items.reduce((sum, item) => sum + cents(item.unit_price) * Number(item.quantity), 0);
  const coupon = body.coupon_code === couponCode ? cents(couponDiscount) : 0;
  const manual = cents(body.manual_discount_value || 0);
  return {
    subtotal_value: gross / 100,
    coupon_discount_value: coupon / 100,
    manual_discount_value: manual / 100,
    discount_value: (coupon + manual) / 100,
    // Promoção NÃO entra na venda interna: um campo desses na resposta
    // não pode virar desconto na tela.
    promotion_discount: 99,
    total_value: (gross - coupon - manual) / 100,
    coupon: coupon ? { code: couponCode } : null,
  };
}

function installApi({ rejectCoupon = false } = {}) {
  apiFetch.mockImplementation(async (path, options = {}) => {
    if (path === "/sales-orders/quote") {
      const body = JSON.parse(options.body);
      if (rejectCoupon && body.coupon_code) return json({ error: "Cupom expirado." }, 400);
      return json(quoteFromBody(body));
    }
    if (path === "/sales-orders" && options.method === "POST") return json({ id: 99 }, 201);
    if (/\/sales-orders\/\d+\/returns$/.test(path)) return json([]);
    return json({});
  });
}

const quoteCalls = () => apiFetch.mock.calls.filter(([path]) => path === "/sales-orders/quote").map(([, options]) => JSON.parse(options.body));
const postCalls = () => apiFetch.mock.calls.filter(([path, options]) => path === "/sales-orders" && options?.method === "POST").map(([, options]) => JSON.parse(options.body));

async function addJewelry(_user, name) {
  const combobox = screen.getByRole("combobox", { name: "Joia" });
  fireEvent.focus(combobox);
  fireEvent.change(combobox, { target: { value: name.split(" ")[0] } });
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

async function openSaleWithItems(user, names = ["Argola Titânio", "Labret Cristal"]) {
  render(<SalesWorkspace features={["basic_catalog", "basic_finance"]} />);
  await user.click(screen.getByRole("button", { name: /Nova venda/i }));
  await user.type(screen.getByRole("textbox", { name: "Cliente" }), "Maria");
  await user.type(screen.getByRole("textbox", { name: "WhatsApp" }), "11999990000");
  await user.click(screen.getByRole("button", { name: /2\. Itens/i }));
  for (const name of names) await addJewelry(user, name);
  await user.click(screen.getByRole("button", { name: /3\. Pagamento/i }));
}

beforeEach(() => {
  localStorage.clear();
  apiFetch.mockReset();
  fetched.orders = [];
  installApi();
});

afterEach(() => {
  session.user = { id: 7, role: "admin" };
});

describe("desconto manual na venda", () => {
  it("sem a permissão sales.apply_discount o desconto fica somente leitura e não é enviado", async () => {
    session.user = { id: 8, role: "reception", permissions: ["sales.view", "sales.create", "coupons.apply"] };
    const user = userEvent.setup();
    await openSaleWithItems(user);

    expect(screen.getByText("Desconto somente leitura")).toBeInTheDocument();
    expect(screen.queryByLabelText("Desconto (R$)")).not.toBeInTheDocument();
    expect(screen.getByText(/Desconto manual indisponível para o seu perfil/)).toBeInTheDocument();

    await screen.findByText("Total conferido pelo sistema.");
    expect(screen.getByTestId("summary-net")).toHaveTextContent("149.9");
    await user.click(screen.getByRole("button", { name: "Salvar venda" }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0]).toMatchObject({ manual_discount_value: 0, manual_discount_reason: "", coupon_code: "" });
  });

  it("com a permissão envia manual_discount_value e motivo; o resumo vem da cotação oficial", async () => {
    session.user = { id: 9, role: "reception", permissions: ["sales.view", "sales.create", "sales.apply_discount"] };
    const user = userEvent.setup();
    await openSaleWithItems(user);

    await waitFor(() => expect(screen.getByTestId("summary-gross")).toHaveTextContent("149.9"));
    fireEvent.change(screen.getByLabelText("Desconto (R$)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Motivo do desconto"), { target: { value: "Cliente fidelidade" } });

    // 149,90 − 10,00 = 139,90, confirmado pela cotação (não pela soma da tela).
    await waitFor(() => expect(quoteCalls().at(-1)).toMatchObject({ manual_discount_value: 10, coupon_code: "" }));
    await waitFor(() => expect(screen.getByTestId("summary-net")).toHaveTextContent("139.9"));
    expect(screen.getByTestId("summary-manual")).toHaveTextContent("10");
    expect(screen.getByTestId("summary-discount")).toHaveTextContent("10");
    expect(screen.getByTestId("summary-max")).toHaveTextContent("149.9");
    expect(screen.getByText("Total conferido pelo sistema.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Salvar venda" }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0]).toMatchObject({
      manual_discount_value: 10,
      manual_discount_reason: "Cliente fidelidade",
      coupon_code: "",
      source: "interno",
    });
    expect(postCalls()[0].items).toHaveLength(2);
  });

  it("bloqueia desconto maior que o bruto sem chamar o POST", async () => {
    const user = userEvent.setup();
    await openSaleWithItems(user, ["Labret Cristal"]);
    fireEvent.change(screen.getByLabelText("Desconto (R$)"), { target: { value: "60" } });
    await user.click(screen.getByRole("button", { name: "Salvar venda" }));
    expect(await screen.findAllByText(/O desconto não pode ser maior que o valor bruto/)).not.toHaveLength(0);
    expect(postCalls()).toHaveLength(0);
  });
});

describe("cotação oficial da venda", () => {
  it("usa o cupom confirmado pela cotação, ignora promoções e nunca chama /catalog/price-quote", async () => {
    const user = userEvent.setup();
    await openSaleWithItems(user);
    await waitFor(() => expect(screen.getByTestId("summary-net")).toHaveTextContent("149.9"));

    await user.type(screen.getByLabelText("Cupom"), "bemvinda");
    // Cupom só digitado não vale e impede salvar.
    await user.click(screen.getByRole("button", { name: "Salvar venda" }));
    expect(screen.getAllByText(/Aplicar cupom” ou remova o cupom digitado/).length).toBeGreaterThan(0);
    expect(postCalls()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Aplicar cupom" }));
    await waitFor(() => expect(screen.getByTestId("summary-net")).toHaveTextContent("134.9"));
    expect(screen.getByTestId("summary-coupon")).toHaveTextContent("15");
    expect(screen.getByTestId("summary-discount")).toHaveTextContent("15");
    expect(screen.getByText(/Cupom BEMVINDA aplicado/)).toBeInTheDocument();
    expect(screen.getByText("R$ 134,90", { exact: false })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Salvar venda" }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0]).toMatchObject({ coupon_code: "BEMVINDA", manual_discount_value: 0 });
    expect(apiFetch.mock.calls.some(([path]) => path === "/catalog/price-quote")).toBe(false);
  });

  it("mostra o erro do cupom recusado pela cotação e não o aplica", async () => {
    installApi({ rejectCoupon: true });
    const user = userEvent.setup();
    await openSaleWithItems(user);
    await user.type(screen.getByLabelText("Cupom"), "VENCIDO");
    await user.click(screen.getByRole("button", { name: "Aplicar cupom" }));
    expect(await screen.findByText("Cupom expirado.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aplicar cupom" })).toBeInTheDocument();
    expect(screen.getByTestId("summary-coupon")).toHaveTextContent("0");
  });

  it("descarta a cotação velha ao editar itens e cota de novo", async () => {
    const user = userEvent.setup();
    await openSaleWithItems(user, ["Argola Titânio"]);
    await waitFor(() => expect(screen.getByTestId("summary-net")).toHaveTextContent("100"));

    await user.click(screen.getByRole("button", { name: /2\. Itens/i }));
    await addJewelry(user, "Labret Cristal");
    await user.click(screen.getByRole("button", { name: /3\. Pagamento/i }));
    await waitFor(() => expect(quoteCalls().at(-1).items).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId("summary-net")).toHaveTextContent("149.9"));
  });

  it("parcelas exigem a cotação oficial: erro da cotação impede salvar", async () => {
    apiFetch.mockImplementation(async (path, options = {}) => {
      if (path === "/sales-orders/quote") return json({ error: "Serviço de cotação indisponível." }, 500);
      if (path === "/sales-orders" && options.method === "POST") return json({ id: 1 }, 201);
      return json({});
    });
    const user = userEvent.setup();
    await openSaleWithItems(user, ["Argola Titânio"]);
    expect(await screen.findAllByText("Serviço de cotação indisponível.")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Desconto (R$)"), { target: { value: "5" } });
    await waitFor(() => expect(quoteCalls().at(-1)).toMatchObject({ manual_discount_value: 5 }));
    await screen.findAllByText("Serviço de cotação indisponível.");
    await user.click(screen.getByRole("button", { name: "Salvar venda" }));
    expect(postCalls()).toHaveLength(0);
  });
});

describe("nova tentativa da cotação", () => {
  it("“Tentar novamente” cota a mesma venda de novo e libera o salvamento", async () => {
    let fail = true;
    apiFetch.mockImplementation(async (path, options = {}) => {
      if (path === "/sales-orders/quote") {
        if (fail) return json({ error: "Falha temporária." }, 503);
        return json(quoteFromBody(JSON.parse(options.body)));
      }
      if (path === "/sales-orders" && options.method === "POST") return json({ id: 2 }, 201);
      return json({});
    });
    const user = userEvent.setup();
    await openSaleWithItems(user, ["Argola Titânio"]);
    await screen.findByRole("button", { name: "Tentar novamente" });
    fail = false;
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await screen.findByText("Total conferido pelo sistema.");
    await user.click(screen.getByRole("button", { name: "Salvar venda" }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
  });
});

describe("detalhe e devolução com desconto", () => {
  const order = {
    id: 41,
    full_name: "Maria",
    status: "concluida",
    source: "interno",
    order_type: "produto",
    stock_deducted: 1,
    paid_value: 139.9,
    receivable_mode: "paid",
    payment_method: "Pix",
    created_at: "2026-09-30 10:00:00",
    subtotal_value: 149.9,
    discount_value: 10,
    manual_discount_value: 10,
    manual_discount_reason: "Cliente fidelidade",
    total_value: 139.9,
    items: [
      { id: 501, item_name: "Argola Titânio", item_type: "produto", quantity: 1, unit_price: 100, discount_value: 6.67 },
      { id: 502, item_name: "Labret Cristal", item_type: "produto", quantity: 1, unit_price: 49.9, discount_value: 3.33 },
    ],
  };

  it("detalhe mostra bruto, desconto manual com motivo e líquido", async () => {
    fetched.orders = [order];
    apiFetch.mockImplementation(async (path) => (path === "/sales-orders/41" ? json({ ...order, receivables: [] }) : json({})));
    const user = userEvent.setup();
    render(<SalesWorkspace features={["basic_catalog"]} />);
    await user.click(screen.getByRole("button", { name: "Histórico" }));
    await user.click(screen.getAllByRole("button", { name: "Mais ações" })[0]);
    await user.click(await screen.findByRole("menuitem", { name: "Detalhes" }));
    const totals = await screen.findByLabelText("Valores da venda");
    expect(within(totals).getByText("R$ 149,90", { exact: false })).toBeInTheDocument();
    expect(within(totals).getByText("− R$ 10,00", { exact: false })).toBeInTheDocument();
    expect(within(totals).getByText("R$ 139,90", { exact: false })).toBeInTheDocument();
    expect(within(totals).getByText("Motivo: Cliente fidelidade")).toBeInTheDocument();
  });

  it("modal de devolução mostra o valor pelo líquido rateado", async () => {
    fetched.orders = [order];
    const user = userEvent.setup();
    render(<SalesWorkspace features={["basic_catalog"]} />);
    await user.click(screen.getByRole("button", { name: "Histórico" }));
    await user.click(screen.getAllByRole("button", { name: "Mais ações" })[0]);
    await user.click(await screen.findByRole("menuitem", { name: "Devolução / troca" }));
    const total = (await screen.findByText("Valor da devolução")).closest(".sale-return-total");
    // Devolvendo tudo: 93,33 + 46,57 = 139,90 (não o bruto de 149,90).
    expect(total).toHaveTextContent("R$ 139,90");
    const quantities = screen.getAllByLabelText("Quantidade");
    fireEvent.change(quantities[1], { target: { value: "0" } });
    await waitFor(() => expect(total).toHaveTextContent("R$ 93,33"));
  });
});

describe("matemática da venda em centavos", () => {
  it("rateia o desconto pelo maior resto quando o item não tem rateio gravado", () => {
    const allocation = saleItemDiscountCents({
      discount_value: 10,
      items: [{ unit_price: 100, quantity: 1, discount_value: 0 }, { unit_price: 49.9, quantity: 1, discount_value: 0 }],
    });
    expect(allocation).toEqual([667, 333]);
    expect(allocation.reduce((sum, value) => sum + value, 0)).toBe(1000);
  });

  it("usa o rateio gravado por item quando existe", () => {
    expect(saleItemDiscountCents({ discount_value: 10, items: [{ unit_price: 100, quantity: 1, discount_value: 6.67 }, { unit_price: 49.9, quantity: 1, discount_value: 3.33 }] })).toEqual([667, 333]);
  });

  it("devolução unidade a unidade soma exatamente o líquido do item", () => {
    const parts = [0, 1, 2].map((already) => saleReturnRefundCents(10001, 3, already, 1));
    expect(parts).toEqual([3334, 3333, 3334]);
    expect(parts.reduce((sum, value) => sum + value, 0)).toBe(10001);
    expect(saleReturnRefundCents(10001, 3, 3, 1)).toBe(0);
  });

  it("normaliza a cotação nos dois formatos sem contar promoção", () => {
    expect(normalizeSalesQuote({ subtotal_value: "149.90", discount_value: "10.00", manual_discount_value: "10.00", total_value: "139.90", promotion_discount: 20 }))
      .toMatchObject({ grossCents: 14990, discountCents: 1000, manualCents: 1000, couponCents: 0, netCents: 13990 });
    expect(normalizeSalesQuote({ totals: { grossTotal: 149.9, discountTotal: 25, netTotal: 124.9, couponDiscount: 15, manualDiscount: 10 } }))
      .toMatchObject({ grossCents: 14990, couponCents: 1500, manualCents: 1000, netCents: 12490 });
  });
});

describe("casos de borda da verificação", () => {
  function percentCouponApi() {
    // Cupom de 10% sobre o bruto: o valor do cupom muda quando os itens mudam.
    apiFetch.mockImplementation(async (path, options = {}) => {
      if (path === "/sales-orders/quote") {
        const body = JSON.parse(options.body);
        const gross = body.items.reduce((sum, item) => sum + cents(item.unit_price) * Number(item.quantity), 0);
        const coupon = body.coupon_code === "DEZ" ? Math.round(gross / 10) : 0;
        const manual = cents(body.manual_discount_value || 0);
        return json({
          subtotal_value: gross / 100,
          coupon_discount_value: coupon / 100,
          manual_discount_value: manual / 100,
          discount_value: (coupon + manual) / 100,
          total_value: (gross - coupon - manual) / 100,
          coupon: coupon ? { code: "DEZ" } : null,
        });
      }
      if (path === "/sales-orders" && options.method === "POST") return json({ id: 5 }, 201);
      return json({});
    });
  }

  it("a mensagem do cupom acompanha a cotação atual depois de editar os itens", async () => {
    percentCouponApi();
    const user = userEvent.setup();
    await openSaleWithItems(user, ["Argola Titânio"]);
    await user.type(screen.getByLabelText("Cupom"), "dez");
    await user.click(screen.getByRole("button", { name: "Aplicar cupom" }));
    expect(await screen.findByText(/Cupom DEZ aplicado: − R\$\s10,00/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /2\. Itens/i }));
    await addJewelry(user, "Labret Cristal");
    await user.click(screen.getByRole("button", { name: /3\. Pagamento/i }));
    // 10% de 149,90 = 14,99 — a mensagem antiga (10,00) não pode continuar.
    expect(await screen.findByText(/Cupom DEZ aplicado: − R\$\s14,99/)).toBeInTheDocument();
    expect(screen.queryByText(/Cupom DEZ aplicado: − R\$\s10,00/)).not.toBeInTheDocument();
  });

  it("trocar o WhatsApp com cupom aplicado cota de novo (limite de uso por cliente)", async () => {
    percentCouponApi();
    const user = userEvent.setup();
    await openSaleWithItems(user, ["Argola Titânio"]);
    await user.type(screen.getByLabelText("Cupom"), "dez");
    await user.click(screen.getByRole("button", { name: "Aplicar cupom" }));
    await screen.findByText(/Cupom DEZ aplicado/);

    await user.click(screen.getByRole("button", { name: /1\. Cliente/i }));
    const whatsapp = screen.getByRole("textbox", { name: "WhatsApp" });
    await user.clear(whatsapp);
    await user.type(whatsapp, "11888887777");
    await waitFor(() => expect(quoteCalls().at(-1)).toMatchObject({ coupon_code: "DEZ", whatsapp: "11888887777" }));
  });

  it("sem coupons.apply, um cupom digitado restaurado do rascunho não trava o salvamento", async () => {
    session.user = { id: 12, role: "reception", permissions: ["sales.view", "sales.create"] };
    localStorage.setItem("aura:form-draft:clinica-teste:12:sale-new", JSON.stringify({
      version: 1,
      schemaKey: "sale-v1",
      savedAt: new Date().toISOString(),
      data: {
        form: { full_name: "Maria", whatsapp: "11999990000", coupon_code: "VELHO", payment_method: "Pix", receivable_mode: "paid", installment_count: 1, status: "concluida" },
        line: {},
        items: [{ row_key: "r1", item_type: "produto", product_id: 1, product_variant_id: null, item_name: "Argola Titânio", quantity: 1, unit_price: 100, stock_key: "product:1" }],
        installments: [],
        automaticInstallments: true,
        appliedCouponCode: "VELHO",
      },
    }));
    const user = userEvent.setup();
    render(<SalesWorkspace features={["basic_catalog", "basic_finance"]} />);
    await user.click(screen.getByRole("button", { name: /Nova venda/i }));
    await user.click(await screen.findByRole("button", { name: "Restaurar" }));
    await user.click(screen.getByRole("button", { name: /3\. Pagamento/i }));
    expect(screen.getByLabelText("Cupom")).toBeDisabled();
    expect(screen.getByLabelText("Cupom")).toHaveValue("");
    await screen.findByText("Total conferido pelo sistema.");
    expect(quoteCalls().every((body) => body.coupon_code === "")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Salvar venda" }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0]).toMatchObject({ coupon_code: "" });
  });

  const soldOrder = {
    id: 51,
    full_name: "Ana",
    status: "concluida",
    source: "interno",
    order_type: "produto",
    stock_deducted: 1,
    paid_value: 300,
    receivable_mode: "paid",
    payment_method: "Pix",
    created_at: "2026-09-30 10:00:00",
    subtotal_value: 300,
    discount_value: 0,
    total_value: 300,
    items: [{ id: 601, item_name: "Argola Titânio", item_type: "produto", quantity: 3, unit_price: 100, discount_value: 0 }],
  };

  async function openReturnOf(user, name = "Ana") {
    const row = screen.getByText(name).closest("tr") || screen.getByText(name).closest("article") || document.body;
    await user.click(within(row).getAllByRole("button", { name: "Mais ações" })[0]);
    await user.click(await screen.findByRole("menuitem", { name: "Devolução / troca" }));
  }

  it("devolução sugere só o saldo devolvível e bloqueia quantidade acima dele", async () => {
    fetched.orders = [soldOrder];
    apiFetch.mockImplementation(async (path, options = {}) => {
      if (path === "/sales-orders/51/returns" && !options.method) return json([{ id: 1, items: [{ sales_order_item_id: 601, quantity: 2 }] }]);
      if (path === "/sales-orders/51/returns") return json({ id: 2 }, 201);
      return json({});
    });
    const user = userEvent.setup();
    render(<SalesWorkspace features={["basic_catalog"]} />);
    await user.click(screen.getByRole("button", { name: "Histórico" }));
    await openReturnOf(user);
    const quantity = screen.getByLabelText("Quantidade");
    await waitFor(() => expect(quantity).toHaveValue(1));
    expect(screen.getByText(/2 já devolvida/)).toBeInTheDocument();

    fireEvent.change(quantity, { target: { value: "3" } });
    expect(screen.getByText(/Máximo de 1 un\. ainda devolvível/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Motivo obrigatório"), { target: { value: "Troca" } });
    await user.click(screen.getByRole("button", { name: "Confirmar devolução" }));
    expect(await screen.findByText(/supera a quantidade ainda devolvível \(1\)/)).toBeInTheDocument();
    expect(apiFetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  });

  it("clique duplo em “Confirmar devolução” registra uma devolução só", async () => {
    fetched.orders = [soldOrder];
    let release;
    apiFetch.mockImplementation(async (path, options = {}) => {
      if (path === "/sales-orders/51/returns" && !options.method) return json([]);
      if (path === "/sales-orders/51/returns") {
        await new Promise((resolve) => { release = resolve; });
        return json({ id: 3 }, 201);
      }
      return json({});
    });
    const user = userEvent.setup();
    render(<SalesWorkspace features={["basic_catalog"]} />);
    await user.click(screen.getByRole("button", { name: "Histórico" }));
    await openReturnOf(user);
    fireEvent.change(screen.getByLabelText("Motivo obrigatório"), { target: { value: "Defeito" } });
    const confirm = screen.getByRole("button", { name: "Confirmar devolução" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("button", { name: "Registrando…" })).toBeDisabled());
    const posts = () => apiFetch.mock.calls.filter(([path, options]) => path === "/sales-orders/51/returns" && options?.method === "POST");
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0][1].body).items[0]).toMatchObject({ sales_order_item_id: 601, quantity: 3 });
    release();
    await waitFor(() => expect(screen.queryByText("Valor da devolução")).not.toBeInTheDocument());
  });

  it("histórico de devoluções que chega atrasado não sobrescreve a devolução de outra venda", async () => {
    const other = { ...soldOrder, id: 52, full_name: "Bia", items: [{ id: 701, item_name: "Labret Cristal", item_type: "produto", quantity: 2, unit_price: 49.9, discount_value: 0 }] };
    fetched.orders = [soldOrder, other];
    let releaseFirst;
    apiFetch.mockImplementation(async (path, options = {}) => {
      if (path === "/sales-orders/51/returns" && !options.method) {
        await new Promise((resolve) => { releaseFirst = resolve; });
        return json([{ id: 9, items: [{ sales_order_item_id: 601, quantity: 1 }] }]);
      }
      if (path === "/sales-orders/52/returns" && !options.method) return json([]);
      return json({});
    });
    const user = userEvent.setup();
    render(<SalesWorkspace features={["basic_catalog"]} />);
    await user.click(screen.getByRole("button", { name: "Histórico" }));
    await openReturnOf(user, "Ana");
    await user.click(screen.getByRole("button", { name: "Voltar" }));
    await openReturnOf(user, "Bia");
    await screen.findByText("Labret Cristal");
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("Labret Cristal")).toBeInTheDocument();
    expect(screen.queryByText(/já devolvida/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quantidade")).toHaveValue(2);
  });
});
