// Testes de comportamento do DataView — a base das ~20 listagens do sistema.
//
// A regra aqui é consultar por papel e texto acessível (o que o usuário vê e o
// leitor de tela anuncia), nunca por classe CSS: o teste tem que sobreviver a
// uma remarcação do componente e quebrar quando o comportamento muda.
//
// Cada teste monta os próprios dados. Nenhum depende de ordem.
//
// Sem `import React`: o plugin do Vite usa o runtime automático de JSX.
import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataView } from "../src/components/common/DataView.jsx";

// ---------------------------------------------------------------- utilidades

// 30 clientes numerados: "Cliente 01" … "Cliente 30".
function clientes(quantidade = 30) {
  return Array.from({ length: quantidade }, (_, i) => ({
    id: i + 1,
    nome: `Cliente ${String(i + 1).padStart(2, "0")}`,
  }));
}

const COLUNA_NOME = [{ key: "nome", label: "Nome" }];

// Conteúdo da primeira célula de cada linha do corpo da tabela.
function celulasDaPrimeiraColuna() {
  const [, ...linhas] = screen.getAllByRole("row"); // [0] é o cabeçalho
  return linhas.map((linha) => linha.cells[0].textContent);
}

function cabecalho(nome) {
  return screen.getByRole("columnheader", { name: new RegExp(nome) });
}

const botaoAnterior = () => screen.getByRole("button", { name: "Página anterior" });
const botaoProxima = () => screen.getByRole("button", { name: "Próxima página" });

// Select agora usa Radix: o usuário abre o combobox e escolhe a opção visível,
// em vez de operar um <select> nativo que já não existe no DOM.
async function selecionar(user, campo, opcao) {
  await user.click(screen.getByRole("combobox", { name: campo }));
  await user.click(screen.getByRole("option", { name: opcao }));
}

async function aplicarFiltro(user, campo, opcao) {
  await user.click(screen.getByRole("button", { name: /Filtros/ }));
  await selecionar(user, campo, opcao);
  await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));
}

// ---------------------------------------------------------------- paginação

describe("paginação", () => {
  test("mostra só a primeira página e o intervalo correto", () => {
    render(<DataView columns={COLUNA_NOME} rows={clientes(30)} defaultPageSize={25} />);

    expect(celulasDaPrimeiraColuna()).toHaveLength(25);
    expect(screen.getByText("Cliente 01")).toBeInTheDocument();
    expect(screen.getByText("Cliente 25")).toBeInTheDocument();
    expect(screen.queryByText("Cliente 26")).not.toBeInTheDocument();
    expect(screen.getByText("1–25 de 30")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  test("avançar mostra as linhas restantes e atualiza o intervalo", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={clientes(30)} defaultPageSize={25} />);

    await user.click(botaoProxima());

    expect(celulasDaPrimeiraColuna()).toEqual(["Cliente 26", "Cliente 27", "Cliente 28", "Cliente 29", "Cliente 30"]);
    expect(screen.getByText("26–30 de 30")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  test("anterior fica desabilitado na primeira página e próxima na última", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={clientes(30)} defaultPageSize={25} />);

    expect(botaoAnterior()).toBeDisabled();
    expect(botaoProxima()).toBeEnabled();

    await user.click(botaoProxima());

    expect(botaoAnterior()).toBeEnabled();
    expect(botaoProxima()).toBeDisabled();
  });

  test("voltar de página funciona e devolve o intervalo inicial", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={clientes(30)} defaultPageSize={25} />);

    await user.click(botaoProxima());
    await user.click(botaoAnterior());

    expect(screen.getByText("1–25 de 30")).toBeInTheDocument();
    expect(screen.getByText("Cliente 01")).toBeInTheDocument();
  });

  test("trocar o tamanho da página recalcula o contador e volta para a página 1", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={clientes(30)} defaultPageSize={25} />);

    // Sai da página 1 de propósito: a troca de tamanho tem que trazer de volta.
    await user.click(botaoProxima());
    expect(screen.getByText("2 / 2")).toBeInTheDocument();

    await selecionar(user, "Por página", "10");

    expect(screen.getByText("1–10 de 30")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(celulasDaPrimeiraColuna()).toHaveLength(10);
    expect(screen.getByText("Cliente 01")).toBeInTheDocument();
  });

  test("com paginated=false mostra tudo e não desenha o rodapé de páginas", () => {
    render(<DataView columns={COLUNA_NOME} rows={clientes(30)} paginated={false} />);

    expect(celulasDaPrimeiraColuna()).toHaveLength(30);
    expect(screen.queryByRole("button", { name: "Próxima página" })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- busca

describe("busca", () => {
  const procedimentos = [
    { id: 1, nome: "Cicatrização acelerada" },
    { id: 2, nome: "Troca de joia" },
    { id: 3, nome: "ana paula" },
    { id: 4, nome: "ANALGESIA tópica" },
  ];

  test("ignora acento: 'cicatrizacao' encontra 'Cicatrização'", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={procedimentos} />);

    await user.type(screen.getByRole("searchbox"), "cicatrizacao");

    expect(celulasDaPrimeiraColuna()).toEqual(["Cicatrização acelerada"]);
  });

  test("ignora caixa: 'ANA' encontra 'ana' e 'ANALGESIA'", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={procedimentos} />);

    await user.type(screen.getByRole("searchbox"), "ANA");

    expect(celulasDaPrimeiraColuna()).toEqual(["ana paula", "ANALGESIA tópica"]);
  });

  test("não busca em coluna marcada com searchable: false", async () => {
    const user = userEvent.setup();
    const colunas = [
      { key: "nome", label: "Nome" },
      { key: "obs", label: "Observação", searchable: false },
    ];
    const linhas = [
      { id: 1, nome: "Bruna", obs: "segredo" },
      { id: 2, nome: "Carlos", obs: "outro" },
    ];
    render(<DataView columns={colunas} rows={linhas} emptyFiltered="Nada com esse filtro." />);

    await user.type(screen.getByRole("searchbox"), "segredo");

    expect(screen.getByText("Nada com esse filtro.")).toBeInTheDocument();
  });

  test("buscar volta para a página 1 mesmo quando o resultado ainda tem 2 páginas", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={clientes(30)} defaultPageSize={25} />);

    await user.click(botaoProxima());
    expect(screen.getByText("2 / 2")).toBeInTheDocument();

    // "Cliente" casa com as 30 linhas: o total de páginas continua 2, então o
    // clamp de página não salva ninguém — quem tem que resetar é o useEffect.
    await user.type(screen.getByRole("searchbox"), "Cliente");

    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText("1–25 de 30")).toBeInTheDocument();
    expect(screen.getByText("Cliente 01")).toBeInTheDocument();
  });

  test("buscar na página 2 não deixa o usuário numa página vazia", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={clientes(30)} defaultPageSize={25} />);

    await user.click(botaoProxima());
    await user.type(screen.getByRole("searchbox"), "Cliente 0");

    // 9 resultados (01…09) numa página só — e todos visíveis.
    expect(celulasDaPrimeiraColuna()).toHaveLength(9);
    expect(screen.getByText("1–9 de 9")).toBeInTheDocument();
  });

  test("o botão de limpar busca zera o campo e devolve a lista inteira", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={procedimentos} />);

    await user.type(screen.getByRole("searchbox"), "ana");
    expect(celulasDaPrimeiraColuna()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Limpar busca" }));

    expect(celulasDaPrimeiraColuna()).toHaveLength(4);
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
});

// ---------------------------------------------------------------- ordenação

describe("ordenação", () => {
  const desordenados = [
    { id: 1, nome: "Carla" },
    { id: 2, nome: "Ana" },
    { id: 3, nome: "Bruno" },
  ];

  test("clicar na coluna alterna asc → desc → sem ordenação", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={desordenados} />);
    const botao = screen.getByRole("button", { name: /Nome/ });

    await user.click(botao);
    expect(celulasDaPrimeiraColuna()).toEqual(["Ana", "Bruno", "Carla"]);

    await user.click(botao);
    expect(celulasDaPrimeiraColuna()).toEqual(["Carla", "Bruno", "Ana"]);

    await user.click(botao);
    expect(celulasDaPrimeiraColuna()).toEqual(["Carla", "Ana", "Bruno"]); // ordem original
  });

  test("o aria-sort do cabeçalho acompanha o ciclo de ordenação", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={desordenados} />);
    const botao = screen.getByRole("button", { name: /Nome/ });

    expect(cabecalho("Nome")).not.toHaveAttribute("aria-sort");

    await user.click(botao);
    expect(cabecalho("Nome")).toHaveAttribute("aria-sort", "ascending");

    await user.click(botao);
    expect(cabecalho("Nome")).toHaveAttribute("aria-sort", "descending");

    await user.click(botao);
    expect(cabecalho("Nome")).not.toHaveAttribute("aria-sort");
  });

  test("ordena número por grandeza, não como texto", async () => {
    const user = userEvent.setup();
    const colunas = [{ key: "qtd", label: "Quantidade" }];
    const linhas = [
      { id: 1, qtd: 10 },
      { id: 2, qtd: 100 },
      { id: 3, qtd: 2 },
    ];
    render(<DataView columns={colunas} rows={linhas} />);

    await user.click(screen.getByRole("button", { name: /Quantidade/ }));

    // Como texto sairia 10, 100, 2 — o que já quebrou relatório de estoque.
    expect(celulasDaPrimeiraColuna()).toEqual(["2", "10", "100"]);
  });

  test("ordena número guardado como string por grandeza", async () => {
    const user = userEvent.setup();
    const colunas = [{ key: "valor", label: "Valor" }];
    const linhas = [
      { id: 1, valor: "10" },
      { id: 2, valor: "100" },
      { id: 3, valor: "2" },
    ];
    render(<DataView columns={colunas} rows={linhas} />);

    await user.click(screen.getByRole("button", { name: /Valor/ }));

    expect(celulasDaPrimeiraColuna()).toEqual(["2", "10", "100"]);
  });

  test("valores vazios vão para o fim da ordenação", async () => {
    const user = userEvent.setup();
    const linhas = [
      { id: 1, nome: "" },
      { id: 2, nome: "Bruno" },
      { id: 3, nome: "Ana" },
    ];
    render(<DataView columns={COLUNA_NOME} rows={linhas} />);

    await user.click(screen.getByRole("button", { name: /Nome/ }));

    expect(celulasDaPrimeiraColuna()).toEqual(["Ana", "Bruno", ""]);
  });

  test("defaultSort já entra ordenado e anuncia o aria-sort", () => {
    render(<DataView columns={COLUNA_NOME} rows={desordenados} defaultSort={{ key: "nome", dir: "desc" }} />);

    expect(celulasDaPrimeiraColuna()).toEqual(["Carla", "Bruno", "Ana"]);
    expect(cabecalho("Nome")).toHaveAttribute("aria-sort", "descending");
  });

  test("coluna com sortable: false não vira botão nem ordena", async () => {
    const user = userEvent.setup();
    const colunas = [{ key: "nome", label: "Nome", sortable: false }];
    render(<DataView columns={colunas} rows={desordenados} />);

    expect(screen.queryByRole("button", { name: /Nome/ })).not.toBeInTheDocument();

    await user.click(cabecalho("Nome"));

    expect(celulasDaPrimeiraColuna()).toEqual(["Carla", "Ana", "Bruno"]);
    expect(cabecalho("Nome")).not.toHaveAttribute("aria-sort");
  });
});

// ---------------------------------------------------------------- value(row)

describe("value(row) quando render devolve JSX", () => {
  // A pegadinha da API: `render` pode devolver JSX, então busca e ordenação
  // precisam de `value(row)`. Sem ele o componente cairia em row[key] — aqui
  // inexistente — e nada seria encontrado.
  const colunas = [
    {
      key: "resumo",
      label: "Resumo",
      value: (row) => `${row.procedimento} · ${row.cliente}`,
      render: (row) => (
        <span>
          <strong>{row.procedimento}</strong> — {row.cliente}
        </span>
      ),
    },
  ];
  const linhas = [
    { id: 1, procedimento: "Cicatrização", cliente: "Ana" },
    { id: 2, procedimento: "Troca de joia", cliente: "Bruno" },
  ];

  test("a busca usa o value(row), não o JSX renderizado", async () => {
    const user = userEvent.setup();
    render(<DataView columns={colunas} rows={linhas} />);

    // Sem acento e em caixa baixa, batendo no texto derivado por value().
    await user.type(screen.getByRole("searchbox"), "cicatrizacao");

    const linhasVisiveis = screen.getAllByRole("row").slice(1);
    expect(linhasVisiveis).toHaveLength(1);
    expect(within(linhasVisiveis[0]).getByText("Cicatrização")).toBeInTheDocument();
  });

  test("a ordenação usa o value(row) e não '[object Object]'", async () => {
    const user = userEvent.setup();
    render(<DataView columns={colunas} rows={linhas} />);

    await user.click(screen.getByRole("button", { name: /Resumo/ }));
    expect(celulasDaPrimeiraColuna()).toEqual(["Cicatrização — Ana", "Troca de joia — Bruno"]);

    await user.click(screen.getByRole("button", { name: /Resumo/ }));
    expect(celulasDaPrimeiraColuna()).toEqual(["Troca de joia — Bruno", "Cicatrização — Ana"]);
  });

  test("value(row) numérico ordena por grandeza mesmo com render formatado", async () => {
    const user = userEvent.setup();
    const colunasValor = [
      {
        key: "total",
        label: "Total",
        value: (row) => row.centavos,
        render: (row) => <em>R$ {(row.centavos / 100).toFixed(2)}</em>,
      },
    ];
    const vendas = [
      { id: 1, centavos: 1000 },
      { id: 2, centavos: 10000 },
      { id: 3, centavos: 200 },
    ];
    render(<DataView columns={colunasValor} rows={vendas} />);

    await user.click(screen.getByRole("button", { name: /Total/ }));

    expect(celulasDaPrimeiraColuna()).toEqual(["R$ 2.00", "R$ 10.00", "R$ 100.00"]);
  });
});

// ---------------------------------------------------------------- filtros

describe("filtros", () => {
  const linhas = [
    { id: 1, nome: "Ana", status: "ativo" },
    { id: 2, nome: "Bruno", status: "inativo" },
    { id: 3, nome: "Carla", status: "ativo" },
  ];
  const filtros = [
    {
      key: "status",
      label: "Situação",
      type: "select",
      options: [
        { value: "ativo", label: "Ativo" },
        { value: "inativo", label: "Inativo" },
      ],
      match: (row, value) => row.status === value,
    },
  ];

  test("o filtro com match(row, value) reduz o conjunto", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={linhas} filters={filtros} />);

    await aplicarFiltro(user, "Situação", "Inativo");

    expect(celulasDaPrimeiraColuna()).toEqual(["Bruno"]);
  });

  test("o contador de filtros ativos aparece no botão de Filtros", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={linhas} filters={filtros} />);

    const alternar = screen.getByRole("button", { name: /Filtros/ });
    expect(alternar).toHaveAccessibleName("Filtros");

    await user.click(alternar);
    await selecionar(user, "Situação", "Ativo");
    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));

    expect(screen.getByRole("button", { name: /Filtros/ })).toHaveAccessibleName("Filtros 1");
  });

  test("'Limpar filtros' restaura a lista e some com o contador", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={linhas} filters={filtros} />);

    await aplicarFiltro(user, "Situação", "Inativo");
    expect(celulasDaPrimeiraColuna()).toEqual(["Bruno"]);

    await user.click(screen.getByRole("button", { name: "Limpar filtros" }));

    expect(celulasDaPrimeiraColuna()).toEqual(["Ana", "Bruno", "Carla"]);
    expect(screen.getByRole("button", { name: /Filtros/ })).toHaveAccessibleName("Filtros");
  });

  test("'Limpar filtros' preserva a busca", async () => {
    const user = userEvent.setup();
    render(<DataView columns={COLUNA_NOME} rows={linhas} filters={filtros} />);

    await user.type(screen.getByRole("searchbox"), "ana");
    await aplicarFiltro(user, "Situação", "Inativo");
    await user.click(screen.getByRole("button", { name: "Limpar filtros" }));

    expect(screen.getByRole("searchbox")).toHaveValue("ana");
    expect(celulasDaPrimeiraColuna()).toHaveLength(1);
  });

  test("sem match declarado, o filtro compara row[key] ignorando acento e caixa", async () => {
    const user = userEvent.setup();
    const filtroSimples = [{ key: "status", label: "Situação", type: "select", options: ["Ativo", "Inativo"] }];
    const cadastros = [
      { id: 1, nome: "Ana", status: "ativo" },
      { id: 2, nome: "Bruno", status: "Inativo" },
    ];
    render(<DataView columns={COLUNA_NOME} rows={cadastros} filters={filtroSimples} />);

    await aplicarFiltro(user, "Situação", "Ativo");

    expect(celulasDaPrimeiraColuna()).toEqual(["Ana"]);
  });

  test("filtrar volta para a página 1", async () => {
    const user = userEvent.setup();
    const muitos = clientes(30).map((c, i) => ({ ...c, status: i % 2 ? "inativo" : "ativo" }));
    render(<DataView columns={COLUNA_NOME} rows={muitos} filters={filtros} defaultPageSize={10} />);

    await user.click(botaoProxima());
    await user.click(botaoProxima());
    expect(screen.getByText("3 / 3")).toBeInTheDocument();

    await aplicarFiltro(user, "Situação", "Ativo");

    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText("1–10 de 15")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- estados

describe("estados de carregando, erro e vazio", () => {
  test("loading mostra o aviso de carregando e não a tabela", () => {
    render(<DataView columns={COLUNA_NOME} rows={[]} loading />);

    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("erro mostra a mensagem em role=alert e esconde a tabela", () => {
    render(<DataView columns={COLUNA_NOME} rows={clientes(3)} error="Falha ao carregar clientes." />);

    expect(screen.getByRole("alert")).toHaveTextContent("Falha ao carregar clientes.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("Cliente 01")).not.toBeInTheDocument();
  });

  test("erro tem prioridade sobre loading", () => {
    render(<DataView columns={COLUNA_NOME} rows={[]} loading error="Deu ruim." />);

    expect(screen.getByRole("alert")).toHaveTextContent("Deu ruim.");
    expect(screen.queryByText("Carregando…")).not.toBeInTheDocument();
  });

  test("lista vazia sem busca mostra a mensagem 'empty'", () => {
    render(
      <DataView
        columns={COLUNA_NOME}
        rows={[]}
        empty="Nenhum cliente cadastrado."
        emptyFiltered="Nenhum cliente corresponde aos filtros."
      />,
    );

    expect(screen.getByText("Nenhum cliente cadastrado.")).toBeInTheDocument();
    expect(screen.queryByText("Nenhum cliente corresponde aos filtros.")).not.toBeInTheDocument();
  });

  test("lista vazia por causa da busca mostra a mensagem 'emptyFiltered'", async () => {
    const user = userEvent.setup();
    render(
      <DataView
        columns={COLUNA_NOME}
        rows={clientes(3)}
        empty="Nenhum cliente cadastrado."
        emptyFiltered="Nenhum cliente corresponde aos filtros."
      />,
    );

    await user.type(screen.getByRole("searchbox"), "zzz");

    expect(screen.getByText("Nenhum cliente corresponde aos filtros.")).toBeInTheDocument();
    expect(screen.queryByText("Nenhum cliente cadastrado.")).not.toBeInTheDocument();
  });

  test("lista vazia por causa do filtro mostra a mensagem 'emptyFiltered'", async () => {
    const user = userEvent.setup();
    const filtros = [
      {
        key: "status",
        label: "Situação",
        type: "select",
        options: ["ativo", "inativo"],
        match: (row, value) => row.status === value,
      },
    ];
    render(
      <DataView
        columns={COLUNA_NOME}
        rows={[{ id: 1, nome: "Ana", status: "ativo" }]}
        filters={filtros}
        empty="Nenhum cliente cadastrado."
        emptyFiltered="Nenhum cliente corresponde aos filtros."
      />,
    );

    await aplicarFiltro(user, "Situação", "inativo");

    expect(screen.getByText("Nenhum cliente corresponde aos filtros.")).toBeInTheDocument();
    expect(screen.queryByText("Nenhum cliente cadastrado.")).not.toBeInTheDocument();
  });

  test("lista vazia não desenha o rodapé de paginação", () => {
    render(<DataView columns={COLUNA_NOME} rows={[]} />);

    expect(screen.queryByRole("button", { name: "Próxima página" })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- modo server

describe("modo server", () => {
  const colunas = [{ key: "nome", label: "Nome" }];
  const paginaVindaDoServidor = [
    { id: 26, nome: "Zulmira" },
    { id: 27, nome: "Adriana" },
    { id: 28, nome: "Marcos" },
  ];

  test("não filtra em memória: repassa a busca e mantém as linhas recebidas", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <DataView
        mode="server"
        columns={colunas}
        rows={paginaVindaDoServidor}
        total={57}
        search="zzz-nao-casa-com-nada"
        onSearchChange={onSearchChange}
      />,
    );

    // Em modo client isso teria zerado a lista.
    expect(celulasDaPrimeiraColuna()).toEqual(["Zulmira", "Adriana", "Marcos"]);

    await user.type(screen.getByRole("searchbox"), "a");
    expect(onSearchChange).toHaveBeenCalledWith("zzz-nao-casa-com-nadaa");
  });

  test("não ordena em memória: só notifica o onSortChange", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    render(
      <DataView
        mode="server"
        columns={colunas}
        rows={paginaVindaDoServidor}
        total={57}
        sort={null}
        onSortChange={onSortChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Nome/ }));

    expect(onSortChange).toHaveBeenCalledWith({ key: "nome", dir: "asc" });
    // A ordem na tela é a que o servidor mandou — nada foi reordenado aqui.
    expect(celulasDaPrimeiraColuna()).toEqual(["Zulmira", "Adriana", "Marcos"]);
  });

  test("usa o total recebido para o intervalo e o número de páginas", () => {
    render(
      <DataView
        mode="server"
        columns={colunas}
        rows={paginaVindaDoServidor}
        total={57}
        page={2}
        pageSize={25}
        onPageChange={() => {}}
      />,
    );

    expect(screen.getByText("26–50 de 57")).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  test("os botões de página avisam a tela em vez de paginar sozinhos", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <DataView
        mode="server"
        columns={colunas}
        rows={paginaVindaDoServidor}
        total={57}
        page={2}
        pageSize={25}
        onPageChange={onPageChange}
      />,
    );

    await user.click(botaoProxima());
    expect(onPageChange).toHaveBeenCalledWith(3);

    await user.click(botaoAnterior());
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  test("na última página do servidor o botão de próxima fica desabilitado", () => {
    render(
      <DataView
        mode="server"
        columns={colunas}
        rows={paginaVindaDoServidor}
        total={53}
        page={3}
        pageSize={25}
        onPageChange={() => {}}
      />,
    );

    expect(screen.getByText("51–53 de 53")).toBeInTheDocument();
    expect(botaoProxima()).toBeDisabled();
    expect(botaoAnterior()).toBeEnabled();
  });

  test("o filtro controlado pela tela não é aplicado em memória", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    const filtros = [
      {
        key: "status",
        label: "Situação",
        type: "select",
        options: ["ativo"],
        match: () => false, // se rodasse em memória, zeraria a lista
      },
    ];
    render(
      <DataView
        mode="server"
        columns={colunas}
        rows={paginaVindaDoServidor}
        total={3}
        filters={filtros}
        filterValues={{ status: "ativo" }}
        onFilterChange={onFilterChange}
      />,
    );

    expect(celulasDaPrimeiraColuna()).toHaveLength(3);

    await aplicarFiltro(user, "Situação", "Todos");

    expect(onFilterChange).toHaveBeenCalledWith({ status: "" });
  });
});

// ---------------------------------------------------------------- acessibilidade e marcação

describe("acessibilidade e estrutura", () => {
  test("os botões de página têm aria-label", () => {
    render(<DataView columns={COLUNA_NOME} rows={clientes(30)} />);

    expect(botaoAnterior()).toHaveAttribute("aria-label", "Página anterior");
    expect(botaoProxima()).toHaveAttribute("aria-label", "Próxima página");
  });

  test("o campo de busca tem nome acessível vindo do placeholder", () => {
    render(<DataView columns={COLUNA_NOME} rows={clientes(3)} searchPlaceholder="Buscar cliente…" />);

    expect(screen.getByRole("searchbox")).toHaveAccessibleName("Buscar cliente…");
  });

  test("caption e coluna de ações entram na tabela", () => {
    render(
      <DataView
        columns={COLUNA_NOME}
        rows={clientes(2)}
        caption="Clientes cadastrados"
        actions={(row) => <button type="button">Editar {row.nome}</button>}
      />,
    );

    expect(screen.getByRole("table", { name: "Clientes cadastrados" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar Cliente 01" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
  });

  test("com searchable=false e sem filtros a barra de ferramentas some", () => {
    render(<DataView columns={COLUNA_NOME} rows={clientes(3)} searchable={false} />);

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Filtros/ })).not.toBeInTheDocument();
  });

  test("o conteúdo extra da toolbar é renderizado", () => {
    render(<DataView columns={COLUNA_NOME} rows={clientes(3)} toolbar={<button type="button">Novo cliente</button>} />);

    expect(screen.getByRole("button", { name: "Novo cliente" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Regressões de três defeitos achados por sondagem depois da primeira rodada de
// testes. Os três passavam despercebidos porque só aparecem em borda.
// ---------------------------------------------------------------------------

describe("regressões", () => {
  test("chave em filterValues que não está declarada em filters é ignorada", async () => {
    render(
      <DataView
        columns={COLUNA_NOME}
        rows={[]}
        filters={[{ key: "status", label: "Status", type: "select", options: ["ativo"] }]}
        filterValues={{ fantasma: "x" }}
        empty="Você ainda não possui clientes cadastrados."
        emptyFiltered="Nenhum registro corresponde aos filtros aplicados."
      />,
    );

    // Antes: o contador acendia ("Filtros 1"), o botão de limpar aparecia e a
    // mensagem culpava um filtro que não existia.
    expect(screen.getByText("Você ainda não possui clientes cadastrados.")).toBeInTheDocument();
    expect(screen.queryByText("Nenhum registro corresponde aos filtros aplicados.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filtros/ })).toHaveTextContent(/^Filtros$/);
  });

  test("modo server sem linhas não mostra estado vazio e paginação ao mesmo tempo", () => {
    render(
      <DataView
        mode="server"
        columns={COLUNA_NOME}
        rows={[]}
        total={57}
        page={2}
        empty="Nenhum registro encontrado."
      />,
    );

    expect(screen.getByText("Nenhum registro encontrado.")).toBeInTheDocument();
    // Antes: "26–50 de 57" aparecia logo abaixo da mensagem de lista vazia.
    expect(screen.queryByText(/de 57/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Próxima página" })).not.toBeInTheDocument();
  });

  test("coluna que mistura número e texto ordena de forma estável e total", async () => {
    const usuario = userEvent.setup();
    render(
      <DataView
        columns={[{ key: "codigo", label: "Código" }]}
        rows={[
          { id: 1, codigo: 9 },
          { id: 2, codigo: 10 },
          { id: 3, codigo: "1a" },
        ]}
        paginated={false}
      />,
    );

    await usuario.click(screen.getByRole("button", { name: /Código/ }));

    // Com o comparador decidido par a par, o resultado era 9, 10, "1a" — uma
    // ordem não-transitiva (9<10, 10<"1a", mas 9>"1a"), cujo resultado final
    // dependia do algoritmo de sort do motor. Com a coluna inteira tratada como
    // texto, a ordem é a lexicográfica e é sempre a mesma.
    expect(celulasDaPrimeiraColuna()).toEqual(["10", "1a", "9"]);
  });

  test("coluna toda numérica continua ordenando por grandeza", async () => {
    const usuario = userEvent.setup();
    render(
      <DataView
        columns={[{ key: "codigo", label: "Código" }]}
        rows={[
          { id: 1, codigo: 9 },
          { id: 2, codigo: 10 },
          { id: 3, codigo: 100 },
        ]}
        paginated={false}
      />,
    );

    await usuario.click(screen.getByRole("button", { name: /Código/ }));
    expect(celulasDaPrimeiraColuna()).toEqual(["9", "10", "100"]);
  });
});
