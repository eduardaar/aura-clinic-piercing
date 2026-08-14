// Agendamento público: o campo de CPF.
//
// O que este arquivo protege é a fronteira entre os dois caminhos do sinal:
//
//   clínica COM gateway  → o Asaas recusa criar o pagador sem CPF, então o
//                          campo é obrigatório e um documento inválido não pode
//                          sair da tela;
//   clínica SEM gateway  → o sinal é conferido na mão pelo WhatsApp, e exigir
//                          documento para agendar só afastaria cliente.
//
// Sem o campo (o estado anterior) toda clínica caía no caminho manual, mesmo
// tendo pago pela integração.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublicBooking, formatTaxId, taxIdError } from "../src/pages/PublicExperience";

const servico = { id: 1, name: "Piercing na orelha", description: "", duration_minutes: 40, base_price: 200, deposit_value: 50 };
const profissional = { id: 7, name: "Eduarda", specialty: "Body piercer", service_ids: [1] };

// A tela abre direto na etapa "Dados" quando a query string já traz o horário —
// é assim que o link do catálogo entra no formulário, e é o que evita ter de
// clicar pelas cinco etapas em cada teste.
function abrirNaEtapaDeDados() {
  window.history.replaceState({}, "", "/agendar?t=aura-clinic&service_id=1&professional_id=7&appointment_date=2026-09-10&appointment_time=10:00");
}

function mockApi({ gatewayEnabled }) {
  vi.stubGlobal("fetch", vi.fn((url) => {
    const endereco = String(url);
    if (endereco.includes("/booking/config")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          services: [servico],
          professionals: [profissional],
          payment: { gateway_enabled: gatewayEnabled, tax_id_required: gatewayEnabled },
          rules: { cancellation: "Avise com antecedência." }
        })
      });
    }
    if (endereco.includes("/booking/slots")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ slots: [{ time: "10:00" }] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
  }));
}

describe("PublicBooking · CPF", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    const storedValues = new Map();
    vi.stubGlobal("localStorage", {
      clear: () => storedValues.clear(),
      getItem: (key) => storedValues.get(String(key)) ?? null,
      removeItem: (key) => storedValues.delete(String(key)),
      setItem: (key, value) => storedValues.set(String(key), String(value))
    });
    localStorage.clear();
    abrirNaEtapaDeDados();
  });

  it("com gateway configurado, o CPF é obrigatório e trava o avanço", async () => {
    mockApi({ gatewayEnabled: true });
    const user = userEvent.setup();
    render(<PublicBooking />);

    const nome = await screen.findByLabelText("Nome");
    await user.type(nome, "Cliente Teste");
    await user.type(screen.getByLabelText("WhatsApp"), "11988887777");

    const resumo = screen.getByRole("button", { name: /Ver Resumo/i });
    // Nome e WhatsApp preenchidos, CPF vazio: antes isso já seguia adiante.
    expect(resumo).toBeDisabled();
    expect(screen.getByText(/obrigatório para emitir o link do sinal/i)).toBeInTheDocument();

    const cpf = screen.getByLabelText("CPF");
    await user.type(cpf, "11111111111");
    // Máscara aplicada e dígito verificador reprovado no mesmo passo.
    expect(cpf).toHaveValue("111.111.111-11");
    expect(screen.getByText(/CPF inválido/i)).toBeInTheDocument();
    expect(resumo).toBeDisabled();

    await user.clear(cpf);
    await user.type(cpf, "52998224725");
    expect(cpf).toHaveValue("529.982.247-25");
    expect(resumo).toBeEnabled();
  });

  it("sem gateway, o CPF é opcional e não impede agendar", async () => {
    mockApi({ gatewayEnabled: false });
    const user = userEvent.setup();
    render(<PublicBooking />);

    const nome = await screen.findByLabelText("Nome");
    await user.type(nome, "Cliente Teste");
    await user.type(screen.getByLabelText("WhatsApp"), "11988887777");

    expect(screen.getByLabelText("CPF (opcional)")).toBeInTheDocument();
    expect(screen.getByText(/Sem CPF o sinal não pode ser cobrado online/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ver Resumo/i })).toBeEnabled();
  });
});

describe("formatTaxId / taxIdError", () => {
  it("mascara CPF e CNPJ conforme o comprimento", () => {
    expect(formatTaxId("529")).toBe("529");
    expect(formatTaxId("52998224725")).toBe("529.982.247-25");
    expect(formatTaxId("11222333000181")).toBe("11.222.333/0001-81");
    // Lixo digitado não vira máscara torta, e o campo para de crescer no 14º dígito.
    expect(formatTaxId("abc529982247 25!!!999")).toBe("52.998.224/7259-99");
  });

  it("aceita CPF e CNPJ válidos e recusa o resto", () => {
    expect(taxIdError("529.982.247-25")).toBe("");
    expect(taxIdError("11.222.333/0001-81")).toBe("");
    expect(taxIdError("529.982.247-24")).toMatch(/CPF inválido/);
    expect(taxIdError("111.111.111-11")).toMatch(/CPF inválido/);
    expect(taxIdError("5299822472")).toMatch(/11 dígitos/);
    // Vazio só é erro quando a cobrança online depende dele.
    expect(taxIdError("")).toBe("");
    expect(taxIdError("", true)).toMatch(/Informe o CPF/);
  });
});
