import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { InstallmentGrid } from "../src/components/common/InstallmentGrid";

function GridHarness() {
  const [installments, setInstallments] = useState([]);
  const [automatic, setAutomatic] = useState(true);
  return (
    <InstallmentGrid
      total={100}
      count={3}
      firstDueDate="2026-01-31"
      paymentMethod="Pix"
      installments={installments}
      onChange={setInstallments}
      automatic={automatic}
      onAutomaticChange={setAutomatic}
    />
  );
}

describe("InstallmentGrid", () => {
  it("gera parcelas e aponta divergência depois de uma edição manual", async () => {
    const user = userEvent.setup();
    render(<GridHarness />);

    await waitFor(() => expect(screen.getAllByLabelText("Vencimento")).toHaveLength(3));
    expect(screen.getAllByLabelText("Vencimento").map((field) => field.value)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);

    const firstAmount = screen.getAllByLabelText("Valor")[0];
    await user.clear(firstAmount);
    await user.type(firstAmount, "33.35");

    expect(screen.getByRole("switch", { name: "Distribuição automática" })).not.toBeChecked();
    expect(screen.getByText("R$ 0,01")).toBeInTheDocument();
    expect(screen.getByText(/Revise as parcelas/)).toBeInTheDocument();
  });
});
