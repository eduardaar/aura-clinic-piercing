import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppointmentQuickModal } from "../src/features/agenda/Agenda";

// Os painéis de ajustes e de indicador químico têm testes próprios e buscam
// dados na API; aqui interessa só o gate de plano da conferência financeira.
const adjustmentProps = vi.hoisted(() => ({ last: /** @type {Record<string, any> | null} */ (null) }));
vi.mock("../src/features/agenda/AppointmentValueAdjustments", () => ({
  AppointmentValueAdjustments: (props) => { adjustmentProps.last = props; return null; }
}));
vi.mock("../src/features/agenda/ChemicalIndicatorPanel", () => ({ ChemicalIndicatorPanel: () => null, ChemicalIndicatorHistory: () => null }));

describe("ações financeiras da agenda por plano", () => {
  // "Revisar e finalizar" exige `appointments.finalize`; a sessão de admin isola o gate de PLANO.
  beforeEach(() => localStorage.setItem("aura-session", JSON.stringify({ user: { id: 1, role: "admin" } })));

  it("mantém o fechamento pago no Start e sinaliza o saldo pendente bloqueado", async () => {
    const user = userEvent.setup();
    render(
      <AppointmentQuickModal
        appointment={{
          id: 10,
          full_name: "Cliente Teste",
          status: "confirmado",
          appointment_date: "2026-08-22",
          appointment_time: "10:00",
          total_value: 100,
          remaining_value: 100,
          remaining_payment_method: "Pix"
        }}
        options={{ jewelry: [] }}
        services={[]}
        procedures={[]}
        features={["basic_catalog"]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );

    expect(screen.getByRole("note")).toHaveTextContent("No Start, o atendimento pode ser finalizado com pagamentos recebidos.");
    const statusFields = screen.getAllByRole("combobox", { name: "Status" });
    await user.click(statusFields.at(-1));
    const pendingOption = await screen.findByRole("option", { name: /Pendente.*Profissional/i });
    expect(pendingOption).toHaveAttribute("data-disabled");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Revisar e finalizar" })).toBeEnabled();
  });

  it("atendimento finalizado sem Financeiro básico não libera ajuste de valor", () => {
    const appointment = { id: 11, full_name: "Cliente Teste", status: "atendido", appointment_date: "2026-08-22", appointment_time: "10:00", total_value: 100, remaining_value: 0 };
    const props = { options: { jewelry: [] }, services: [], procedures: [], onClose: () => {}, onSaved: () => {} };
    const { rerender } = render(<AppointmentQuickModal appointment={appointment} features={["basic_catalog"]} {...props} />);
    expect(adjustmentProps.last?.canEdit).toBe(false);
    expect(adjustmentProps.last?.lockedReason).toMatch(/Financeiro básico/);

    rerender(<AppointmentQuickModal appointment={{ ...appointment }} features={["basic_catalog", "basic_finance"]} {...props} />);
    expect(adjustmentProps.last?.canEdit).toBe(true);
    expect(adjustmentProps.last?.lockedReason).toBe("");
  });
});
