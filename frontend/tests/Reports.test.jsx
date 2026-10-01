import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Reports } from "../src/features/reports/Reports";
import { useFetch } from "../src/lib/api";
import { currency } from "../src/features/shared/helpers";

const brl = (value) => currency.format(value).replace(/\s/g, " ");

vi.mock("../src/lib/api", () => ({
  downloadApiFile: vi.fn(),
  useFetch: vi.fn(() => ({ data: null, loading: true, error: "" }))
}));

const COMMISSIONS = {
  type: "commissions", label: "Comissões", category: "Gestão e auditoria", pagination: "server",
  filters: [{ key: "from", label: "De", type: "date" }, { key: "to", label: "Até", type: "date" }, { key: "service_id", label: "Serviço", type: "service" }],
  columns: [{ key: "reference_date", label: "Data", kind: "date" }, { key: "item", label: "Item" }, { key: "commission_amount", label: "Comissão", kind: "money" }]
};
const ADJUSTMENTS = {
  type: "value_adjustments", label: "Ajustes de valor", category: "Financeiro", pagination: "server", filters: [],
  columns: [{ key: "created_at_local", label: "Data/hora", kind: "datetime" }, { key: "adjustment_type", label: "Tipo", kind: "enum" }, { key: "status", label: "Situação", kind: "status" }]
};
const PROFESSIONALS = {
  type: "professionals", label: "Desempenho por profissional", category: "Gestão e auditoria", filters: [],
  columns: [{ key: "professional", label: "Profissional" }, { key: "revenue", label: "Faturamento líquido", kind: "money" }, { key: "commission", label: "Comissão", kind: "money" }]
};

function mockFetch(catalog, reports) {
  useFetch.mockImplementation((path) => {
    if (path === "/reports") return { data: { reports: catalog }, loading: false, error: "" };
    if (path === "/professionals") return { data: [], loading: false, error: "" };
    if (path === "/services") return { data: [{ id: 2, name: "Hélix" }], loading: false, error: "" };
    if (path?.startsWith("/reports/")) {
      const type = path.slice("/reports/".length).split("?")[0];
      return { data: reports[type], loading: false, error: "" };
    }
    return { data: null, loading: false, error: "" };
  });
}

beforeEach(() => {
  useFetch.mockReset();
});

describe("Central de relatórios", () => {
  it("usa as colunas devolvidas pelo servidor e mostra os totais do período", async () => {
    mockFetch([COMMISSIONS], {
      commissions: {
        rows: [{ id: 1, reference_date: "2026-09-30", item: "Perfuração de hélix", commission_amount: 40.47 }],
        columns: COMMISSIONS.columns, total_rows: 1,
        summary: { gross: 149.9, discount: 10, adjustment: -5, base: 134.9, commission: 40.47 }
      }
    });
    render(<Reports />);
    expect(await screen.findByText("Perfuração de hélix")).toBeTruthy();
    expect(screen.getAllByText(brl(40.47)).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Totais do período")).toBeTruthy();
    expect(screen.getByText("Base (líquido)")).toBeTruthy();
    // Filtro por serviço só busca a lista de serviços quando o relatório pede.
    expect(useFetch.mock.calls.some(([path]) => path === "/services")).toBe(true);
  });

  it("formata data/hora e traduz tipo e situação dos ajustes", async () => {
    mockFetch([ADJUSTMENTS], {
      value_adjustments: { rows: [{ id: 5, created_at_local: "2026-09-30 21:45", adjustment_type: "abatimento", status: "anulado" }], columns: ADJUSTMENTS.columns, total_rows: 1 }
    });
    render(<Reports />);
    expect(await screen.findByText("30/09/2026 21:45")).toBeTruthy();
    expect(screen.getByText("Abatimento")).toBeTruthy();
    expect(screen.getByText("Anulado")).toBeTruthy();
  });

  it("não mostra coluna de comissão que o servidor retirou para o usuário", async () => {
    const withoutCommission = PROFESSIONALS.columns.filter((column) => column.key !== "commission");
    mockFetch([PROFESSIONALS], {
      professionals: { rows: [{ id: 1, professional: "Ana", revenue: 100 }], columns: withoutCommission, total_rows: 1 }
    });
    render(<Reports />);
    expect(await screen.findByText("Ana")).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: /Comissão/ })).toBeNull();
    expect(useFetch.mock.calls.some(([path]) => path === "/services")).toBe(false);
  });
});
