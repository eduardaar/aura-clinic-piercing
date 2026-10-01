import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChemicalIndicatorHistory, ChemicalIndicatorPanel } from "../src/features/agenda/ChemicalIndicatorPanel";
import { apiFetch } from "../src/lib/api";
import { localDateValue } from "../src/lib/utils";

vi.mock("../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal()),
  apiFetch: vi.fn(),
}));

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const appointment = { id: 10, status: "em_atendimento", procedure: "Hélix", updated_at: "2026-09-30T12:00:00Z" };

const procedures = [
  { id: 11, procedure_name: "Hélix", body_region: "Orelha esquerda", jewelry_name: "Argola titânio" },
  { id: 12, procedure_name: "Septo", body_region: "Nariz", jewelry_name: null },
];

const indicators = [
  {
    id: 1,
    appointment_item_id: 11,
    procedure_name: "Hélix",
    body_region: "Orelha esquerda",
    jewelry_name: "Argola titânio",
    indicator_type: "Classe 4 — multiparâmetro",
    indicator_brand: "Cristófoli",
    indicator_lot: "L123",
    indicator_date: "2026-09-29",
    identification: "Ciclo 42",
    result: "aprovado",
    photo_url: "/api/private-files/abc.webp",
    created_by_name: "Ana Piercer",
    created_at: "2026-09-30T13:00:00Z",
    status: "ativo",
  },
  {
    id: 2,
    appointment_item_id: 11,
    procedure_name: "Hélix",
    indicator_lot: "L999",
    result: "nao_informado",
    created_by_name: "Ana Piercer",
    created_at: "2026-09-30T12:30:00Z",
    status: "anulado",
    voided: true,
    voided_at: "2026-09-30T12:40:00Z",
    voided_by_name: "Bia Admin",
    void_reason: "Lote digitado errado",
  },
];

function routeApi(overrides = {}) {
  apiFetch.mockImplementation(async (path, options = {}) => {
    const method = options.method || "GET";
    const key = `${method} ${path}`;
    if (overrides[key]) return overrides[key](options);
    if (key === "GET /appointments/10/chemical-indicators") return jsonResponse({ procedures, indicators });
    if (method === "POST" && path === "/appointments/10/chemical-indicators") return jsonResponse({ indicator: { id: 3 } }, 201);
    if (method === "POST" && path.endsWith("/void")) return jsonResponse({ indicator: { id: 1, status: "anulado" } });
    return jsonResponse({}, 404);
  });
}

function postCalls(predicate = () => true) {
  return apiFetch.mock.calls.filter(([path, options]) => options?.method === "POST" && predicate(path));
}

describe("ChemicalIndicatorPanel", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    localStorage.clear();
  });

  it("lista os indicadores agrupados por procedimento do atendimento", async () => {
    routeApi();
    render(<ChemicalIndicatorPanel appointment={appointment} canEdit />);

    const helix = await screen.findByRole("article", { name: "Procedimento Hélix · Orelha esquerda" });
    expect(apiFetch).toHaveBeenCalledWith("/appointments/10/chemical-indicators");
    expect(within(helix).getByText("Joia: Argola titânio")).toBeInTheDocument();
    expect(within(helix).getByText("Classe 4 — multiparâmetro")).toBeInTheDocument();
    expect(within(helix).getByText("Cristófoli")).toBeInTheDocument();
    expect(within(helix).getByText("L123")).toBeInTheDocument();
    expect(within(helix).getByText("29/09/2026")).toBeInTheDocument();
    expect(within(helix).getByText("Ciclo 42")).toBeInTheDocument();
    expect(within(helix).getByText("Aprovado")).toBeInTheDocument();
    expect(within(helix).getAllByText(/Registrado por Ana Piercer em/)).toHaveLength(2);
    expect(within(helix).getByRole("button", { name: "Ampliar foto da etiqueta do indicador" })).toBeInTheDocument();
    // Anulado continua visível, com quem anulou e o motivo, e sem nova anulação.
    expect(within(helix).getByText("Anulado")).toBeInTheDocument();
    expect(within(helix).getByText(/Anulado por Bia Admin .*Motivo: Lote digitado errado/)).toBeInTheDocument();
    expect(within(helix).getAllByRole("button", { name: /^Anular indicador/ })).toHaveLength(1);

    const septo = screen.getByRole("article", { name: "Procedimento Septo · Nariz" });
    expect(within(septo).getByText("Sem joia vinculada")).toBeInTheDocument();
    expect(within(septo).getByText("Nenhum indicador registrado para este procedimento.")).toBeInTheDocument();
    expect(within(septo).getByRole("button", { name: "Registrar indicador" })).toBeInTheDocument();
  });

  it("envia o registro como multipart com o item do procedimento, os campos e a foto", async () => {
    const user = userEvent.setup();
    routeApi();
    render(<ChemicalIndicatorPanel appointment={appointment} canEdit />);

    const septo = await screen.findByRole("article", { name: "Procedimento Septo · Nariz" });
    await user.click(within(septo).getByRole("button", { name: "Registrar indicador" }));
    const dialog = await screen.findByRole("dialog", { name: "Registrar indicador químico" });

    expect(within(dialog).getByLabelText("Data")).toHaveValue(localDateValue(new Date()));
    await user.click(within(dialog).getByRole("combobox", { name: "Tipo do indicador" }));
    await user.click(await screen.findByRole("option", { name: "Classe 5 — integrador" }));
    await user.type(within(dialog).getByLabelText("Marca"), "Cristófoli");
    await user.type(within(dialog).getByLabelText("Lote"), "LT-77");
    await user.type(within(dialog).getByLabelText("Identificação/ciclo"), "Ciclo 0142");
    await user.click(within(dialog).getByRole("combobox", { name: "Resultado" }));
    await user.click(await screen.findByRole("option", { name: "Aprovado" }));
    await user.type(within(dialog).getByLabelText("Observações"), "Etiqueta virou");
    const photoInput = within(dialog).getByLabelText(/^Foto da etiqueta/);
    expect(photoInput).toHaveAttribute("accept", "image/*");
    expect(photoInput).toHaveAttribute("capture", "environment");
    const photo = new File(["fake"], "etiqueta.jpg", { type: "image/jpeg" });
    await user.upload(photoInput, photo);

    await user.click(within(dialog).getByRole("button", { name: "Registrar indicador" }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const [path, options] = postCalls()[0];
    expect(path).toBe("/appointments/10/chemical-indicators");
    expect(options.body).toBeInstanceOf(FormData);
    const body = options.body;
    expect(body.get("appointment_item_id")).toBe("12");
    expect(body.get("procedure_name")).toBeNull();
    expect(body.get("indicator_type")).toBe("Classe 5 — integrador");
    expect(body.get("indicator_brand")).toBe("Cristófoli");
    expect(body.get("indicator_lot")).toBe("LT-77");
    expect(body.get("indicator_date")).toBe(localDateValue(new Date()));
    expect(body.get("identification")).toBe("Ciclo 0142");
    expect(body.get("result")).toBe("aprovado");
    expect(body.get("notes")).toBe("Etiqueta virou");
    expect(body.get("photo")).toBeInstanceOf(File);
    expect(body.get("photo").name).toBe("etiqueta.jpg");

    expect(await screen.findByText("Indicador químico registrado.")).toBeInTheDocument();
    // Recarrega a lista depois do registro.
    expect(apiFetch.mock.calls.filter(([p, o]) => p === "/appointments/10/chemical-indicators" && !o?.method)).toHaveLength(2);
  });

  it("usa \"Outro\" com texto livre como tipo", async () => {
    const user = userEvent.setup();
    routeApi();
    render(<ChemicalIndicatorPanel appointment={appointment} canEdit />);
    const septo = await screen.findByRole("article", { name: "Procedimento Septo · Nariz" });
    await user.click(within(septo).getByRole("button", { name: "Registrar indicador" }));
    const dialog = await screen.findByRole("dialog", { name: "Registrar indicador químico" });

    await user.click(within(dialog).getByRole("combobox", { name: "Tipo do indicador" }));
    await user.click(await screen.findByRole("option", { name: "Outro" }));
    await user.type(within(dialog).getByLabelText("Qual tipo?"), "Classe 2 — Bowie-Dick");
    await user.click(within(dialog).getByRole("button", { name: "Registrar indicador" }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0][1].body.get("indicator_type")).toBe("Classe 2 — Bowie-Dick");
  });

  it("exige ao menos um dado do indicador antes de enviar", async () => {
    const user = userEvent.setup();
    routeApi();
    render(<ChemicalIndicatorPanel appointment={appointment} canEdit />);
    const helix = await screen.findByRole("article", { name: "Procedimento Hélix · Orelha esquerda" });
    await user.click(within(helix).getByRole("button", { name: "Registrar indicador" }));
    const dialog = await screen.findByRole("dialog", { name: "Registrar indicador químico" });

    // Marca, data, resultado e observações sozinhos não identificam a etiqueta.
    await user.type(within(dialog).getByLabelText("Marca"), "Cristófoli");
    await user.click(within(dialog).getByRole("button", { name: "Registrar indicador" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Informe ao menos o tipo, o lote, a identificação/ciclo ou a foto da etiqueta.",
    );
    expect(postCalls()).toHaveLength(0);
  });

  it("mostra o erro devolvido pela API no registro", async () => {
    const user = userEvent.setup();
    routeApi({
      "POST /appointments/10/chemical-indicators": () => jsonResponse({ error: "Atendimento cancelado." }, 409),
    });
    render(<ChemicalIndicatorPanel appointment={appointment} canEdit />);
    const helix = await screen.findByRole("article", { name: "Procedimento Hélix · Orelha esquerda" });
    await user.click(within(helix).getByRole("button", { name: "Registrar indicador" }));
    const dialog = await screen.findByRole("dialog", { name: "Registrar indicador químico" });
    await user.type(within(dialog).getByLabelText("Lote"), "L1");
    await user.click(within(dialog).getByRole("button", { name: "Registrar indicador" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Atendimento cancelado.");
  });

  it("anulação exige motivo e envia o motivo informado", async () => {
    const user = userEvent.setup();
    routeApi();
    render(<ChemicalIndicatorPanel appointment={appointment} canEdit />);
    await screen.findByRole("article", { name: "Procedimento Hélix · Orelha esquerda" });

    await user.click(screen.getByRole("button", { name: "Anular indicador L123" }));
    const dialog = await screen.findByRole("dialog", { name: "Anular indicador químico" });
    const confirm = within(dialog).getByRole("button", { name: "Anular indicador" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Motivo da anulação"), "   ");
    expect(confirm).toBeDisabled();
    expect(postCalls()).toHaveLength(0);

    await user.clear(within(dialog).getByLabelText("Motivo da anulação"));
    await user.type(within(dialog).getByLabelText("Motivo da anulação"), "Foto de outra etiqueta");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const [path, options] = postCalls()[0];
    expect(path).toBe("/appointments/10/chemical-indicators/1/void");
    expect(JSON.parse(options.body)).toEqual({ reason: "Foto de outra etiqueta" });
    expect(await screen.findByText("Indicador anulado. O registro continua no histórico.")).toBeInTheDocument();
  });

  it("sem permissão de edição fica somente leitura", async () => {
    routeApi();
    render(<ChemicalIndicatorPanel appointment={appointment} canEdit={false} />);

    const helix = await screen.findByRole("article", { name: "Procedimento Hélix · Orelha esquerda" });
    expect(within(helix).getByText("L123")).toBeInTheDocument();
    expect(screen.getByText(/Somente leitura: registrar ou anular indicadores exige/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar indicador" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Anular/ })).not.toBeInTheDocument();
  });

  it("atendimento cancelado não oferece novo registro", async () => {
    routeApi();
    render(<ChemicalIndicatorPanel appointment={{ ...appointment, status: "cancelado" }} canEdit />);
    await screen.findByRole("article", { name: "Procedimento Hélix · Orelha esquerda" });
    expect(screen.getByText(/Atendimento cancelado: os indicadores ficam disponíveis apenas para consulta/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar indicador" })).not.toBeInTheDocument();
  });

  it("agendamento sem itens registra pelo nome do procedimento", async () => {
    const user = userEvent.setup();
    routeApi({
      "GET /appointments/10/chemical-indicators": () => jsonResponse({ procedures: [], indicators: [] }),
    });
    render(<ChemicalIndicatorPanel appointment={{ ...appointment, procedure: "Lóbulo", piercing_region: "Orelha" }} canEdit />);
    const card = await screen.findByRole("article", { name: "Procedimento Lóbulo · Orelha" });
    await user.click(within(card).getByRole("button", { name: "Registrar indicador" }));
    const dialog = await screen.findByRole("dialog", { name: "Registrar indicador químico" });
    await user.type(within(dialog).getByLabelText("Identificação/ciclo"), "Ciclo 9");
    await user.click(within(dialog).getByRole("button", { name: "Registrar indicador" }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const body = postCalls()[0][1].body;
    expect(body.get("appointment_item_id")).toBeNull();
    expect(body.get("procedure_name")).toBe("Lóbulo");
  });

  it("no formato real da API (appointment_item_id), agendamento legado não duplica o procedimento", async () => {
    // A API devolve o procedimento legado com `appointment_item_id: null` e o
    // indicador dele também sem item: os dois precisam cair no MESMO card.
    routeApi({
      "GET /appointments/10/chemical-indicators": () => jsonResponse({
        appointment: { id: 10, status: "agendado", appointment_date: "2026-09-30" },
        procedures: [{ appointment_item_id: null, procedure_name: "Lóbulo", body_region: "Orelha", jewelry_name: null }],
        indicators: [{
          id: 5, appointment_item_id: null, procedure_name: "Lóbulo", body_region: "Orelha",
          indicator_lot: "LEG-1", result: "aprovado", status: "ativo", is_voided: false, has_photo: false, photo_url: null,
        }],
      }),
    });
    render(<ChemicalIndicatorPanel appointment={{ ...appointment, procedure: "Lóbulo", piercing_region: "Orelha" }} canEdit />);
    const card = await screen.findByRole("article", { name: "Procedimento Lóbulo · Orelha" });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(within(card).getByText("LEG-1")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Registrar indicador" })).toBeInTheDocument();
    expect(screen.queryByText(/registrado antes de uma alteração/)).not.toBeInTheDocument();
  });

  it("lê variação da joia, anulação por is_voided e foto restrita como a API devolve", async () => {
    routeApi({
      "GET /appointments/10/chemical-indicators": () => jsonResponse({
        procedures: [{ appointment_item_id: 21, procedure_name: "Hélix", body_region: "Orelha", jewelry_name: "Argola", jewelry_variation_name: "8 mm" }],
        indicators: [{
          id: 9, appointment_item_id: 21, procedure_name: "Hélix", body_region: "Orelha", indicator_lot: "RST-1",
          result: "aprovado", status: "anulado", is_voided: true, void_reason: "Errado", has_photo: true, photo_url: null, photo_filename: null,
        }],
      }),
    });
    render(<ChemicalIndicatorPanel appointment={appointment} canEdit />);
    const card = await screen.findByRole("article", { name: "Procedimento Hélix · Orelha" });
    expect(within(card).getByText("Joia: Argola (8 mm)")).toBeInTheDocument();
    expect(within(card).getByText("Anulado")).toBeInTheDocument();
    expect(within(card).getByText("Foto registrada (visível para quem acessa arquivos clínicos).")).toBeInTheDocument();
    expect(within(card).queryByText("Sem foto da etiqueta.")).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /^Anular indicador/ })).not.toBeInTheDocument();
  });

  it.each(["nao_compareceu", "recusado", "remarcado"])("atendimento %s fica somente leitura (o backend recusa com 409)", async (status) => {
    routeApi();
    render(<ChemicalIndicatorPanel appointment={{ ...appointment, status }} canEdit />);
    await screen.findByRole("article", { name: "Procedimento Hélix · Orelha esquerda" });
    expect(screen.getByText(/os indicadores ficam disponíveis apenas para consulta/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar indicador" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Anular/ })).not.toBeInTheDocument();
  });

  it("não envia data do indicador no futuro", async () => {
    const user = userEvent.setup();
    routeApi();
    render(<ChemicalIndicatorPanel appointment={appointment} canEdit />);
    const helix = await screen.findByRole("article", { name: "Procedimento Hélix · Orelha esquerda" });
    await user.click(within(helix).getByRole("button", { name: "Registrar indicador" }));
    const dialog = await screen.findByRole("dialog", { name: "Registrar indicador químico" });
    const dateInput = within(dialog).getByLabelText("Data");
    const today = localDateValue(new Date());
    expect(dateInput).toHaveAttribute("max", today);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    fireEvent.change(dateInput, { target: { value: localDateValue(tomorrow) } });
    await user.type(within(dialog).getByLabelText("Lote"), "L1");
    await user.click(within(dialog).getByRole("button", { name: "Registrar indicador" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("A data do indicador não pode ser futura.");
    expect(postCalls()).toHaveLength(0);
  });

  it("mostra estado de erro com nova tentativa", async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce(jsonResponse({ error: "Sem acesso aos dados clínicos." }, 403));
    render(<ChemicalIndicatorPanel appointment={appointment} canEdit />);
    expect(await screen.findByText("Sem acesso aos dados clínicos.")).toBeInTheDocument();
    routeApi();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByRole("article", { name: "Procedimento Hélix · Orelha esquerda" })).toBeInTheDocument();
  });
});

describe("ChemicalIndicatorHistory", () => {
  beforeEach(() => apiFetch.mockReset());

  it("renderiza Cliente → Data → Procedimento → Joia → Indicador → Foto → Lote/identificação, do mais recente", async () => {
    apiFetch.mockImplementation(async (path) => {
      if (path === "/clients/5/chemical-indicators") {
        return jsonResponse({
          client: { id: 5, full_name: "Maria Aparecida" },
          indicators: [
            {
              id: 7,
              appointment_id: 90,
              appointment_date: "2026-08-10",
              procedure_name: "Lóbulo",
              body_region: "Orelha direita",
              jewelry_name: "Labret aço",
              indicator_type: "Classe 1 — indicador de processo",
              indicator_lot: "OLD-1",
              result: "aprovado",
              status: "ativo",
            },
            {
              id: 8,
              appointment_id: 91,
              appointment_date: "2026-09-29",
              appointment_item_id: 11,
              procedure_name: "Hélix",
              body_region: "Orelha esquerda",
              jewelry_name: "Argola titânio",
              indicator_type: "Classe 4 — multiparâmetro",
              indicator_brand: "Cristófoli",
              indicator_lot: "L123",
              identification: "Ciclo 42",
              result: "reprovado",
              photo_url: "/api/private-files/abc.webp",
              status: "ativo",
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    const { container } = render(<ChemicalIndicatorHistory clientId={5} />);

    expect(await screen.findByText("Maria Aparecida")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/clients/5/chemical-indicators");
    const content = container.textContent;
    const order = [
      "Maria Aparecida",
      "29/09/2026",
      "Hélix · Orelha esquerda",
      "Argola titânio",
      "Classe 4 — multiparâmetro · Cristófoli",
      "Ver foto",
      "Lote L123 · Ciclo 42",
      "10/08/2026",
      "Lóbulo · Orelha direita",
      "Labret aço",
      "Classe 1 — indicador de processo",
      "Sem foto",
      "Lote OLD-1",
    ];
    const positions = order.map((fragment) => content.indexOf(fragment));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(screen.getByText("Reprovado")).toBeInTheDocument();
    // Somente leitura.
    expect(screen.queryByRole("button", { name: /Registrar|Anular/ })).not.toBeInTheDocument();
  });

  it("pelo atendimento usa a rota do agendamento e mostra o vazio", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ procedures, indicators: [] }));
    render(<ChemicalIndicatorHistory appointmentId={10} compact />);
    expect(await screen.findByText("Nenhum indicador químico registrado.")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/appointments/10/chemical-indicators");
  });

  it("pela rota do atendimento agrupa pela data do agendamento devolvida em appointment", async () => {
    apiFetch.mockResolvedValue(jsonResponse({
      appointment: { id: 10, status: "atendido", appointment_date: "2026-09-28" },
      procedures: [{ appointment_item_id: 11, procedure_name: "Hélix" }],
      indicators: [{ id: 1, appointment_item_id: 11, procedure_name: "Hélix", indicator_lot: "L5", indicator_date: "2026-09-20", status: "ativo", has_photo: true, photo_url: null }],
    }));
    render(<ChemicalIndicatorHistory appointmentId={10} compact />);
    expect(await screen.findByRole("heading", { name: "28/09/2026" })).toBeInTheDocument();
    expect(screen.getByText("Foto registrada (visível para quem acessa arquivos clínicos).")).toBeInTheDocument();
  });

  it("mostra o erro da API", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ error: "Sem permissão." }, 403));
    render(<ChemicalIndicatorHistory clientId={5} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem permissão.");
  });
});
