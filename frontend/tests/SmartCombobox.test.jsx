import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SmartCombobox } from "../src/components/common/SmartCombobox";
import { Modal } from "../src/components/common/Crud";
import userEvent from "@testing-library/user-event";

const options = [
  { id: 1, name: "Argola Coração", category: "Argolas", material: "Titânio", sku: "ARG-001", quantity: 3 },
  { id: 2, name: "Labret Azul", category: "Labrets", material: "Aço", sku: "LAB-002", quantity: 0 }
];

describe("SmartCombobox", () => {
  it("SKU exato encontra a joia correta e Enter imediato não seleciona o resultado anterior", () => {
    const onSelect = vi.fn();
    const products = [
      { id: 1, name: "Joia anterior", sku: "JOIA-001", quantity: 2 },
      { id: 2, name: "Joia correta", sku: "JOIA-002", quantity: 2 },
    ];
    render(<SmartCombobox label="Joia" value="" onChange={() => {}} onSelect={onSelect} options={products} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "joia-002" } });
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(products[1]);
  });

  it("código inexistente não retorna uma joia de SKU semelhante", () => {
    const onSelect = vi.fn();
    render(<SmartCombobox label="Joia" value="" onChange={() => {}} onSelect={onSelect} options={options} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "ARG-009" } });
    expect(screen.getByText("Nenhuma joia encontrada")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("busca pelo SKU da variação seleciona essa variação, mesmo que outra venha primeiro", () => {
    const onSelect = vi.fn();
    const product = {
      ...options[0],
      variants: [
        { id: 10, sku: "VAR-001", quantity: 2 },
        { id: 11, sku: "VAR-002", quantity: 3 },
      ],
    };
    render(<SmartCombobox label="Joia" value="" onChange={() => {}} onSelect={onSelect} options={[product]} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "VAR-002" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(product, product.variants[1]);
  });

  it("SKU de variação esgotada não permite reservar outra variação da mesma joia", () => {
    const onSelect = vi.fn();
    const product = {
      ...options[0],
      variants: [
        { id: 10, sku: "VAR-001", quantity: 2 },
        { id: 11, sku: "VAR-002", quantity: 0 },
      ],
    };
    render(<SmartCombobox label="Joia" value="" onChange={() => {}} onSelect={onSelect} options={[product]} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "VAR-002" } });
    expect(within(screen.getByRole("listbox")).getByRole("option")).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("filtros dentro do modal combinam categoria, material e estoque", async () => {
    render(
      <Modal open title="Agendamento" onClose={() => {}}>
        <SmartCombobox label="Joia" value="" onChange={() => {}} options={options} />
      </Modal>,
    );
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByLabelText("Categoria").closest("[role=dialog]")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Categoria"));
    await userEvent.click(await screen.findByRole("option", { name: "Labrets" }));
    await userEvent.click(screen.getByLabelText("Material"));
    await userEvent.click(await screen.findByRole("option", { name: "Aço" }));
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(1);
    await userEvent.click(screen.getByLabelText("Estoque"));
    await userEvent.click(await screen.findByRole("option", { name: "Com estoque" }));
    expect(screen.getByText("Nenhuma joia encontrada")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(2);
  });
  it("busca sem acento por múltiplos atributos e seleciona com teclado", () => {
    const onChange = vi.fn();
    render(<SmartCombobox label="Joia" value="" onChange={onChange} options={options} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "coracao titânio" } });
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
    ["informações", (option) => within(option).getByText(/Argolas/)],
    ["preço", () => screen.getByText("R$ 197,31")],
    ["estoque", () => screen.getByText("Estoque: 3 unidades")],
    ["área do card", (option) => option]
  ])("seleciona com um único clique em %s", (_, targetFor) => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    render(<SmartCombobox label="Joia" value="" onChange={onChange} onSelect={onSelect} options={[{ ...options[0], photo_url: "https://example.test/jewel.jpg", sale_value: 197.31 }]} />);
    fireEvent.focus(screen.getByRole("combobox"));
    const option = screen.getByRole("option", { name: /Argola Coração/ });
    fireEvent.click(targetFor(option));
    expect(onChange).toHaveBeenCalledWith("1");
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 1, sku: "ARG-001" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("carrega progressivamente sem passar de 200 resultados", () => {
    const many = Array.from({ length: 230 }, (_, index) => ({ id: index + 1, name: `Joia ${index + 1}`, sku: `SKU-${index + 1}`, quantity: 1 }));
    render(<SmartCombobox label="Joia" value="" onChange={() => {}} options={many} />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(40);
    for (let page = 0; page < 4; page += 1) fireEvent.click(screen.getByRole("button", { name: "Mostrar mais resultados" }));
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(200);
    expect(screen.queryByText("Joia 201")).not.toBeInTheDocument();
    expect(screen.getByText(/Refine a busca/)).toBeInTheDocument();
  });

  // O caso real do atendimento: o seletor vive dentro de um modal, mas a lista
  // é um portal no body. Tocar numa joia era lido como "clique fora" e fechava
  // o modal inteiro — e o toque nem chegava a selecionar.
  it("dentro de um modal, o clique na joia seleciona sem fechar o modal", async () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <Modal open title="Novo Agendamento" onClose={onClose}>
        <form><SmartCombobox label="Joia" value="" onChange={onChange} options={options} /></form>
      </Modal>
    );
    // O Radix só passa a ouvir cliques fora depois de um tick.
    await new Promise((resolve) => setTimeout(resolve, 10));
    fireEvent.focus(screen.getByRole("combobox"));
    const option = screen.getByRole("option", { name: /Argola Coração/ });
    expect(option.closest(".smart-combobox-list")).toHaveAttribute("data-modal-floating");
    fireEvent.pointerDown(option);
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith("1");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Novo Agendamento" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("a lista só fecha por toque fora dela e do campo", async () => {
    render(<SmartCombobox label="Joia" value="" onChange={() => {}} options={options} />);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.pointerDown(screen.getByRole("listbox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
