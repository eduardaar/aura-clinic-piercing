import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FinancialSummary } from "../src/components/common/Ui";

describe("FinancialSummary", () => {
  it("exibe os totais oficiais sem somar o sinal ao líquido", () => {
    render(<FinancialSummary summary={{ grossTotal: 149.9, discountTotal: 22.48, netTotal: 127.42, depositPaid: 25, otherPayments: 0, totalPaid: 25, outstandingBalance: 102.42, paymentStatus: "parcial" }} />);
    expect(screen.getByText("R$ 127,42")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 25,00")).toHaveLength(2);
    expect(screen.getAllByText("R$ 102,42")).toHaveLength(2);
    expect(screen.getByText("Parcial")).toBeInTheDocument();
  });

  it("mostra cupom uma única vez no detalhamento e composição discreta", () => {
    render(<FinancialSummary summary={{ grossTotal: 1250.9, discountTotal: 125.09, netTotal: 1125.81, depositPaid: 0, otherPayments: 0, totalPaid: 0, outstandingBalance: 1125.81, paymentStatus: "pendente", couponCode: "EDUARDA", couponPercent: 10, serviceSubtotal: 900, productSubtotal: 350.9 }} />);
    expect(screen.getByText("EDUARDA")).toBeInTheDocument();
    expect(screen.getByText("Cupom aplicado com sucesso.")).toBeInTheDocument();
    expect(screen.getByText("Ver composição do valor bruto")).toBeInTheDocument();
    expect(screen.getByText("R$ 1.250,90")).toBeInTheDocument();
  });

  it("identifica pagamento excedente com texto além da cor", () => {
    render(<FinancialSummary summary={{ grossTotal: 100, discountTotal: 0, netTotal: 100, depositPaid: 25, otherPayments: 85, totalPaid: 110, outstandingBalance: 0, overpaymentAmount: 10, paymentStatus: "excedente" }} />);
    expect(screen.getByText("Excedente", { selector: ".status-badge" })).toBeInTheDocument();
    expect(screen.getByText("R$ 10,00")).toBeInTheDocument();
  });
});

describe("FinancialSummary — equação, status e ajustes", () => {
  it("traduz os status do cálculo oficial (liquidado e nao_pago)", () => {
    const { unmount } = render(<FinancialSummary summary={{ grossTotal: 100, netTotal: 100, totalPaid: 100, paymentStatus: "liquidado" }} />);
    expect(screen.getByText("Quitado", { selector: ".status-badge" })).toHaveClass("tone-ok");
    unmount();
    render(<FinancialSummary summary={{ grossTotal: 100, netTotal: 100, outstandingBalance: 100, paymentStatus: "nao_pago" }} />);
    expect(screen.getByText("Não pago", { selector: ".status-badge" })).toBeInTheDocument();
  });

  it("monta a equação Bruto − Descontos = Líquido − Pago = Restante, sem sinal de soma no pago", () => {
    render(<FinancialSummary summary={{ grossTotal: 149.9, discountTotal: 10, netTotal: 139.9, depositPaid: 50, totalPaid: 50, outstandingBalance: 89.9, paymentStatus: "parcial" }} />);
    const flow = screen.getByRole("group", { name: /Composição do valor/ });
    const labels = within(flow).getAllByRole("article").map((card) => card.querySelector(".financial-flow__label")?.textContent);
    expect(labels).toEqual(["Valor bruto", "−Descontos", "=Valor líquido", "−Total pago", "=Valor restante"]);
    expect(flow).not.toHaveTextContent("+");
    expect(screen.getByText("R$ 139,90")).toBeInTheDocument();
    expect(screen.getByText("− R$ 10,00")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 89,90")).toHaveLength(2);
    expect(screen.getByText("Saldo final")).toBeInTheDocument();
    // Sem `adjustmentTotal` (vendas e telas antigas) o card de ajustes não aparece.
    expect(screen.queryByText("Ajustes")).not.toBeInTheDocument();
  });

  it("mostra ajustes assinados entre o desconto e o líquido", () => {
    const { unmount } = render(<FinancialSummary summary={{ grossTotal: 149.9, discountTotal: 10, adjustmentTotal: 20, netTotal: 159.9, outstandingBalance: 159.9 }} />);
    const flow = screen.getByRole("group", { name: /mais ou menos ajustes/ });
    const labels = within(flow).getAllByRole("article").map((card) => card.querySelector(".financial-flow__label")?.textContent);
    expect(labels).toEqual(["Valor bruto", "−Descontos", "±Ajustes", "=Valor líquido", "−Total pago", "=Valor restante"]);
    expect(screen.getByText("+ R$ 20,00")).toBeInTheDocument();
    unmount();

    render(<FinancialSummary summary={{ grossTotal: 100, adjustment_total: -5.5, netTotal: 94.5, outstandingBalance: 94.5 }} />);
    expect(screen.getByText("− R$ 5,50")).toBeInTheDocument();
  });

  it("detalha cupom e desconto manual quando o resumo traz as duas parcelas", () => {
    render(<FinancialSummary summary={{ grossTotal: 200, discountTotal: 30, couponDiscount: 20, manualDiscount: 10, couponCode: "VIP20", netTotal: 170, outstandingBalance: 170 }} />);
    const breakdown = screen.getByRole("list", { name: "Detalhamento do desconto" });
    expect(within(breakdown).getByText("Cupom VIP20")).toBeInTheDocument();
    expect(within(breakdown).getByText("Desconto manual")).toBeInTheDocument();
    expect(within(breakdown).getByText("− R$ 10,00")).toBeInTheDocument();
    expect(screen.getByText("− R$ 30,00")).toBeInTheDocument();
    // O aviso do cupom usa só a parcela do cupom, não o desconto total.
    expect(screen.getByText(/Desconto de R\$ 20,00 aplicado/)).toBeInTheDocument();
  });

  it("sem onDiscountChange o desconto continua somente leitura", () => {
    render(<FinancialSummary discountEditable summary={{ grossTotal: 100, discountTotal: 0, netTotal: 100 }} />);
    expect(screen.queryByLabelText("Desconto (R$)")).not.toBeInTheDocument();
  });
});

describe("FinancialSummary — desconto editável", () => {
  function EditableHarness({ onChange = () => {}, onReason = () => {}, coupon = 0, discountMax }) {
    const [manual, setManual] = React.useState(0);
    const [reason, setReason] = React.useState("");
    const gross = 149.9;
    const discount = Math.min(gross, coupon + manual);
    return (
      <FinancialSummary
        summary={{ grossTotal: gross, couponDiscount: coupon, manualDiscount: manual, discountTotal: discount, netTotal: Math.round((gross - discount) * 100) / 100, outstandingBalance: 0 }}
        discountEditable
        discountMax={discountMax}
        onDiscountChange={(value) => { setManual(value); onChange(value); }}
        discountReason={reason}
        onDiscountReasonChange={(text) => { setReason(text); onReason(text); }}
      />
    );
  }

  it("aceita o desconto em R$ e recalcula a partir do valor informado", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EditableHarness onChange={onChange} />);

    const field = screen.getByLabelText("Desconto (R$)");
    await user.type(field, "10");
    expect(onChange).toHaveBeenLastCalledWith(10);
    expect(field).toHaveValue(10);
    expect(screen.getByText("− R$ 10,00")).toBeInTheDocument();
    expect(screen.getByText("R$ 139,90")).toBeInTheDocument();
  });

  it("converte o atalho % em reais sobre bruto − cupom, arredondado a centavos", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EditableHarness onChange={onChange} coupon={9.9} />);

    await user.type(screen.getByLabelText("Atalho %"), "10");
    // (149,90 − 9,90) × 10% = 14,00
    expect(onChange).toHaveBeenLastCalledWith(14);
    expect(screen.getByLabelText("Desconto (R$)")).toHaveValue(14);
  });

  it("sinaliza desconto acima do teto sem esconder o valor digitado", async () => {
    const user = userEvent.setup();
    render(<EditableHarness />);

    const field = screen.getByLabelText("Desconto (R$)");
    await user.type(field, "200");
    expect(screen.getByRole("alert")).toHaveTextContent("O desconto não pode ser maior que R$ 149,90.");
    expect(field).toHaveAttribute("aria-invalid", "true");

    await user.clear(field);
    await user.type(field, "20");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(field).not.toHaveAttribute("aria-invalid");
  });

  it("respeita o teto explícito e repassa o motivo", async () => {
    const user = userEvent.setup();
    const onReason = vi.fn();
    render(<EditableHarness discountMax={50} onReason={onReason} />);

    await user.type(screen.getByLabelText("Desconto (R$)"), "60");
    expect(screen.getByRole("alert")).toHaveTextContent("R$ 50,00");
    await user.type(screen.getByLabelText("Motivo do desconto (opcional)"), "Cortesia");
    expect(onReason).toHaveBeenLastCalledWith("Cortesia");
  });

  it("reescreve o campo quando o valor muda por fora (ex.: rascunho descartado) e mantém o digitado no eco", async () => {
    const user = userEvent.setup();
    function ResetHarness() {
      const [manual, setManual] = React.useState(0);
      return (
        <>
          <FinancialSummary
            summary={{ grossTotal: 100, couponDiscount: 0, manualDiscount: manual, discountTotal: manual, netTotal: 100 - manual }}
            discountEditable
            onDiscountChange={setManual}
          />
          <button type="button" onClick={() => setManual(0)}>Descartar</button>
          <button type="button" onClick={() => setManual(12.5)}>Carregar gravado</button>
        </>
      );
    }
    render(<ResetHarness />);
    const field = screen.getByLabelText("Desconto (R$)");
    await user.type(field, "7.5");
    expect(field).toHaveValue(7.5);
    await user.click(screen.getByRole("button", { name: "Descartar" }));
    expect(field).toHaveValue(null);
    await user.click(screen.getByRole("button", { name: "Carregar gravado" }));
    expect(field).toHaveValue(12.5);
  });

  it("mantém o valor digitado acima do teto quando o pai devolve o manual já limitado", async () => {
    const user = userEvent.setup();
    function ClampHarness() {
      const [requested, setRequested] = React.useState(0);
      const applied = Math.min(requested, 100);
      return <FinancialSummary summary={{ grossTotal: 100, couponDiscount: 0, manualDiscount: applied, discountTotal: applied, netTotal: 100 - applied }} discountEditable onDiscountChange={setRequested} />;
    }
    render(<ClampHarness />);
    const field = screen.getByLabelText("Desconto (R$)");
    await user.type(field, "150");
    expect(field).toHaveValue(150);
    expect(screen.getByRole("alert")).toHaveTextContent("R$ 100,00");
  });

  it("somente leitura mostra o motivo gravado do desconto manual", () => {
    render(<FinancialSummary summary={{ grossTotal: 100, couponDiscount: 0, manualDiscount: 10, discountTotal: 10, netTotal: 90 }} discountReason="Cliente recorrente" />);
    expect(screen.getByText("Desconto manual")).toBeInTheDocument();
    expect(screen.getByText("Motivo: Cliente recorrente")).toBeInTheDocument();
    expect(screen.queryByLabelText("Desconto (R$)")).not.toBeInTheDocument();
  });
});
