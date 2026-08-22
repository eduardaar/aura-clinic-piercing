import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppointmentQuickModal } from "../src/features/agenda/Agenda";

describe("ações financeiras da agenda por plano", () => {
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
});
