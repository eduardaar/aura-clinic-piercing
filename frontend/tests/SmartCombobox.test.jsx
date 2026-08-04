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

  it("mostra identificação, preço e estoque e fecha ao selecionar", () => {
    const onChange = vi.fn();
    render(<SmartCombobox label="Joia" value="" onChange={onChange} options={[{ ...options[0], sale_value: 197.31, variation_name: "Prata 1,2 × 8 mm" }]} />);
    fireEvent.focus(screen.getByRole("combobox"));
    const option = screen.getByRole("option", { name: /Argola Coração/ });
    expect(option).toHaveTextContent("SKU: ARG-001");
    expect(option).toHaveTextContent("R$ 197,31");
    expect(option).toHaveTextContent("Estoque: 3 unidades");
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith("1");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it.each([
    ["imagem", (option) => option.querySelector("img")],
    ["nome", () => screen.getByText("Argola Coração")],
    ["informações", () => screen.getByText(/Argolas/)],
    ["preço", () => screen.getByText("R$ 197,31")],
    ["estoque", () => screen.getByText("Estoque: 3 unidades")],
    ["área do card", (option) => option]
  ])("seleciona imediatamente pelo pointerdown em %s", (_, targetFor) => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    render(<SmartCombobox label="Joia" value="" onChange={onChange} onSelect={onSelect} options={[{ ...options[0], photo_url: "https://example.test/jewel.jpg", sale_value: 197.31 }]} />);
    fireEvent.focus(screen.getByRole("combobox"));
    const option = screen.getByRole("option", { name: /Argola Coração/ });
    fireEvent.pointerDown(targetFor(option));
    expect(onChange).toHaveBeenCalledWith("1");
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 1, sku: "ARG-001" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("carrega progressivamente sem passar de 200 resultados", () => {
    const many = Array.from({ length: 230 }, (_, index) => ({ id: index + 1, name: `Joia ${index + 1}`, sku: `SKU-${index + 1}`, quantity: 1 }));
    render(<SmartCombobox label="Joia" value="" onChange={() => {}} options={many} />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option")).toHaveLength(40);
    for (let page = 0; page < 4; page += 1) fireEvent.click(screen.getByRole("button", { name: "Mostrar mais resultados" }));
    expect(screen.getAllByRole("option")).toHaveLength(200);
    expect(screen.queryByText("Joia 201")).not.toBeInTheDocument();
    expect(screen.getByText(/Refine a busca/)).toBeInTheDocument();
  });
});
