import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
