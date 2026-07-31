import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SmartCombobox } from "../src/components/common/SmartCombobox";

const options = [
  { id: 1, name: "Argola Coração", category: "Argolas", material: "Titânio", sku: "ARG-001", quantity: 3 },
  { id: 2, name: "Labret Azul", category: "Labrets", material: "Aço", sku: "LAB-002", quantity: 0 }
];

describe("SmartCombobox", () => {
  it("busca sem acento por múltiplos atributos e seleciona com teclado", () => {
    const onChange = vi.fn();
    render(<SmartCombobox label="Joia" value="" onChange={onChange} options={options} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "coracao titanio" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("1");
  });

  it("exibe produto esgotado desabilitado", () => {
    render(<SmartCombobox label="Joia" value="" onChange={() => {}} options={options} />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /Labret Azul/ })).toBeDisabled();
  });
});
