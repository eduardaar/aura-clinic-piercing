import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailAdmin } from "../src/features/platform/EmailAdmin";

const SETTINGS = {
  smtp: {
    provider: "smtp",
    configured: true,
    enabled: true,
    host: "smtp.example.com",
    port: 587,
    secure: false,
    require_tls: true,
    username: "avisos@example.com",
    password_configured: true,
    from_name: "Aura Clinic",
    from_email: "avisos@example.com",
    reply_to: "atendimento@example.com",
    updated_at: "2026-08-30T12:00:00.000Z",
    credential_error: false,
  },
  active: { provider: "smtp", configured: true, enabled: true, from: "avisos@example.com" },
};

function response(payload, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
  });
}

describe("configuração SMTP da plataforma", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("carrega os dados sem devolver a senha e preserva a credencial ao salvar em branco", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response(SETTINGS))
      .mockImplementationOnce(() => response(SETTINGS));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<EmailAdmin token="platform-token" onUnauthorized={vi.fn()} />);

    const password = await screen.findByLabelText("Nova senha (deixe vazio para manter)");
    expect(password).toHaveValue("");
    expect(screen.getByText("Senha armazenada e criptografada")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Salvar configuração" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, options] = fetchMock.mock.calls[1];
    const body = JSON.parse(options.body);
    expect(body.password).toBe("");
    expect(body.port).toBe(587);
    expect(options.headers.Authorization).toBe("Bearer platform-token");
    expect(await screen.findByText("Configuração SMTP salva com segurança.")).toBeInTheDocument();
  });

  it("permite verificar a conexão salva sem habilitar envio de teste externo no carregamento", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response(SETTINGS))
      .mockImplementationOnce(() => response({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<EmailAdmin token="platform-token" onUnauthorized={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Verificar conexão" }));

    expect(await screen.findByText("Conexão, TLS e autenticação SMTP validados.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toContain("/platform/email-settings/verify");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
  });
});
