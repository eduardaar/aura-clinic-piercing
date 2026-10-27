// Agendamento público: cartões compactos na escolha do serviço e informações
// completas, específicas de cada serviço, na etapa final.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicBooking } from "../src/pages/PublicExperience";

const longDescription =
  "Aplicação de piercing auricular com joia em titânio inclusa e protocolo asséptico completo. " +
  "O procedimento começa com a avaliação da anatomia, segue com a marcação do ponto e termina com as orientações de cuidado. " +
  "Garantia de trinta dias para a joia, sem cobertura para perda ou mau uso.";

const lobulo = {
  id: 1, name: "Perfuração de lóbulo", category: "Piercing", description: longDescription, short_description: "",
  image_url: "https://cdn.exemplo.test/lobulo.webp", image_alt: "Orelha com piercing no lóbulo",
  duration_minutes: 45, price: "120.00", deposit_value: "40.00", minimum_age_years: 12, requires_guardian: true,
  requires_signed_term: true, requires_acknowledgement: true, return_after_days: 30,
  pre_service_notes: "Venha alimentado.", aftercare_instructions: "Limpe com soro duas vezes ao dia.",
  public_info_sections: [{ key: "warranty", body: "Troca da joia em até 30 dias." }, { key: "aftercare" }]
};
const anodizacao = {
  id: 2, name: "Anodização de joias", category: "Personalização", description: "Coloração por processo eletroquímico.",
  short_description: "Personalização da cor de joias de titânio, sem tinta.", image_url: "", image_alt: "",
  duration_minutes: 20, price: "60.00", deposit_value: "0.00", minimum_age_years: null, requires_guardian: false,
  requires_signed_term: false, requires_acknowledgement: false, public_info_sections: [{ key: "rules", body: "Somente joias de titânio." }]
};
const profissional = { id: 7, name: "Eduarda", specialty: "Body piercer", service_ids: [1, 2] };

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function mockApi({ logo = "" } = {}) {
  const requests = [];
  vi.stubGlobal("fetch", vi.fn((url, options = {}) => {
    const address = String(url);
    requests.push({ address, options });
    const json = (body, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) });
    if (address.includes("/booking/config")) {
      return json({ services: [lobulo, anodizacao], professionals: [profissional], payment: { gateway_enabled: false }, rules: { cancellation: "Avise com antecedência.", payment: "O sinal reserva o horário após conferência manual." } });
    }
    if (address.includes("/booking/dates")) return json({ dates: [today()] });
    if (address.includes("/booking/slots")) return json({ slots: [{ time: "10:00" }] });
    if (address.includes("/booking/requests")) return json({ id: 99, appointment_date: today(), appointment_time: "10:00", deposit_value: 40, remaining_value: 140, payment_instructions: "Envie o comprovante." });
    if (address.includes("/catalog")) return json({ items: [], theme: { brand_name: "Aura", slogan: "Studio & Clinic", logo_url: logo }, whatsapp_phone: "11999990000" });
    return json({});
  }));
  return requests;
}

async function goToSummary(user, cards) {
  for (const name of cards) await user.click(await screen.findByRole("button", { name: new RegExp(name) }));
  await user.click(screen.getByRole("button", { name: /^Continuar/ }));
  await user.click(await screen.findByRole("button", { name: /Eduarda/ }));
  const dateButtons = await screen.findAllByRole("button", { name: new RegExp(String(new Date().getFullYear())) });
  await user.click(dateButtons[0]);
  await user.click(await screen.findByRole("button", { name: "10:00" }));
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await user.type(await screen.findByLabelText("Nome"), "Cliente Teste");
  await user.type(screen.getByLabelText("WhatsApp"), "11988887777");
  const birthDate = screen.queryByLabelText("Data de nascimento");
  if (birthDate) await user.type(birthDate, "1990-01-01");
  await user.click(screen.getByRole("button", { name: "Ver resumo" }));
  await screen.findByRole("heading", { name: "Resumo da solicitação" });
}

describe("PublicBooking · apresentação dos serviços", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    const storedValues = new Map();
    vi.stubGlobal("localStorage", {
      clear: () => storedValues.clear(),
      getItem: (key) => storedValues.get(String(key)) ?? null,
      removeItem: (key) => storedValues.delete(String(key)),
      setItem: (key, value) => storedValues.set(String(key), String(value))
    });
    window.history.replaceState({}, "", "/agendar?t=aura-clinic");
  });

  it("mostra cartões compactos, com imagem própria ou padrão e textos em caixa de frase", async () => {
    mockApi({ logo: "https://cdn.exemplo.test/logo.png" });
    render(<PublicBooking />);

    const lobuloCard = await screen.findByRole("button", { name: /Perfuração de lóbulo/ });
    // Sem descrição curta, o cartão usa um resumo da descrição completa.
    const summary = lobuloCard.querySelector(".service-card-summary").textContent;
    expect(summary.length).toBeLessThanOrEqual(161);
    expect(summary).not.toContain("Garantia de trinta dias");
    expect(within(lobuloCard).getByRole("img", { name: "Orelha com piercing no lóbulo" })).toHaveAttribute("src", "https://cdn.exemplo.test/lobulo.webp");
    expect(lobuloCard).toHaveTextContent("R$ 120");
    expect(lobuloCard).toHaveTextContent("45 min");
    // Regras e garantia não aparecem no cartão.
    expect(lobuloCard).not.toHaveTextContent("Troca da joia");

    const anodizacaoCard = screen.getByRole("button", { name: /Anodização de joias/ });
    expect(within(anodizacaoCard).getByRole("img", { name: "Imagem padrão de Anodização de joias" })).toBeInTheDocument();
    expect(anodizacaoCard).toHaveTextContent("Personalização da cor de joias de titânio, sem tinta.");

    expect(await screen.findByRole("img", { name: "Logo Aura" })).toHaveAttribute("src", "https://cdn.exemplo.test/logo.png");
    expect(screen.getByRole("heading", { name: "Reserve seu horário" })).toBeInTheDocument();
    expect(screen.getByText(/Escolha o serviço, profissional, data e horário disponível/)).toBeInTheDocument();
  });

  it("seleciona vários serviços sem depender só da cor", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<PublicBooking />);
    const card = await screen.findByRole("button", { name: /Perfuração de lóbulo/ });
    expect(card).toHaveAttribute("aria-pressed", "false");
    await user.click(card);
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(card).toHaveTextContent("Selecionado");
    await user.click(screen.getByRole("button", { name: /Anodização de joias/ }));
    expect(screen.getByText(/2 serviços selecionados · R\$ 180/)).toBeInTheDocument();
    // Sem logo cadastrada, a marca usa a inicial.
    expect(screen.queryByRole("img", { name: /Logo/ })).not.toBeInTheDocument();
  });

  it("filtra serviços pela busca e pela contagem exibida", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<PublicBooking />);
    await screen.findByRole("button", { name: /Perfuração de lóbulo/ });
    await user.type(screen.getByLabelText("Pesquisar serviço"), "anodiza");
    expect(screen.queryByRole("button", { name: /Perfuração de lóbulo/ })).not.toBeInTheDocument();
    expect(screen.getByText("Exibindo 1 serviço")).toBeInTheDocument();
  });

  it("na etapa final mostra as informações de cada serviço sem misturar e exige a ciência marcada", async () => {
    const requests = mockApi();
    const user = userEvent.setup();
    render(<PublicBooking />);
    await goToSummary(user, ["Perfuração de lóbulo", "Anodização de joias"]);

    // Resumo: sinal somado como no backend (40 + 0), total e situação manual.
    expect(screen.getByText("Horário sujeito à confirmação")).toBeInTheDocument();
    expect(screen.getByText(/R\$ 40,00 · Pix, com envio do comprovante/)).toBeInTheDocument();
    expect(screen.getAllByText("R$ 180,00").length).toBeGreaterThan(0);

    // Informações completas: o primeiro serviço abre expandido; o segundo, recolhido.
    const lobuloInfo = screen.getByRole("button", { name: /Perfuração de lóbulo.*Leitura obrigatória/ });
    expect(lobuloInfo).toHaveAttribute("aria-expanded", "true");
    const lobuloRegion = screen.getByRole("region", { name: /Perfuração de lóbulo/ });
    expect(within(lobuloRegion).getByText("Troca da joia em até 30 dias.")).toBeInTheDocument();
    expect(within(lobuloRegion).getByText("Limpe com soro duas vezes ao dia.")).toBeInTheDocument();
    expect(within(lobuloRegion).getByText("Venha alimentado.")).toBeInTheDocument();
    expect(within(lobuloRegion).getByText("12 anos")).toBeInTheDocument();
    expect(within(lobuloRegion).queryByText("Somente joias de titânio.")).not.toBeInTheDocument();

    const anodizacaoInfo = screen.getByRole("button", { name: /Anodização de joias/ });
    await user.click(anodizacaoInfo);
    const anodizacaoRegion = screen.getByRole("region", { name: /Anodização de joias/ });
    expect(within(anodizacaoRegion).getByText("Somente joias de titânio.")).toBeInTheDocument();
    expect(within(anodizacaoRegion).queryByText("Troca da joia em até 30 dias.")).not.toBeInTheDocument();
    // Anodização não exige responsável só porque outro serviço exige.
    expect(within(anodizacaoRegion).queryByText(/responsável legal/)).not.toBeInTheDocument();

    // Termo formal continua separado da confirmação de leitura.
    expect(screen.getByText(/A confirmação de leitura não substitui esse termo/)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Confirmar solicitação" });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /Li e estou ciente das informações de Perfuração de lóbulo/ }));
    expect(submit).toBeEnabled();
    await user.click(submit);

    const sent = requests.find((request) => request.address.includes("/booking/requests"));
    const body = sent.options.body;
    expect(JSON.parse(body.get("acknowledged_service_ids"))).toEqual([1]);
    expect(JSON.parse(body.get("items")).filter((item) => item.item_type === "service").map((item) => item.service_id)).toEqual([1, 2]);
    expect(await screen.findByRole("heading", { name: "Recebemos sua solicitação" })).toBeInTheDocument();
  });

  it("volta às etapas anteriores sem perder os dados preenchidos", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<PublicBooking />);
    await goToSummary(user, ["Anodização de joias"]);
    await user.click(screen.getByRole("button", { name: /Voltar/ }));
    expect(await screen.findByLabelText("Nome")).toHaveValue("Cliente Teste");
    expect(screen.getByLabelText("WhatsApp")).toHaveValue("11988887777");
  });
});
