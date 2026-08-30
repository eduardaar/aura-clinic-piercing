import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClientData } from "../src/services/clientData.js";

test("normaliza cadastro brasileiro de cliente sem apagar canais independentes", () => {
  const result = normalizeClientData({
    full_name: "  Maria   de Souza ",
    social_name: " Maria ",
    phone: "(11) 3333-4444",
    whatsapp: "+55 (11) 99999-8888",
    email: " MARIA@EXAMPLE.COM ",
    cpf: "529.982.247-25",
    instagram: "Maria.Souza",
    preferred_contact: "email",
    postal_code: "01310-100",
    state: "sp",
  });

  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(
    {
      full_name: result.data.full_name,
      phone: result.data.phone,
      whatsapp: result.data.whatsapp,
      email: result.data.email,
      cpf: result.data.cpf,
      instagram: result.data.instagram,
      postal_code: result.data.postal_code,
      state: result.data.state,
    },
    {
      full_name: "Maria de Souza",
      phone: "1133334444",
      whatsapp: "11999998888",
      email: "maria@example.com",
      cpf: "52998224725",
      instagram: "@maria.souza",
      postal_code: "01310100",
      state: "SP",
    },
  );
});

test("rejeita CPF, telefone, CEP, e-mail, data e UF inválidos", () => {
  const result = normalizeClientData({
    full_name: "Cliente",
    whatsapp: "123",
    phone: "456",
    email: "email-invalido",
    cpf: "111.111.111-11",
    birth_date: "2026-02-31",
    postal_code: "123",
    state: "XX",
  });

  assert.equal(result.valid, false);
  assert.deepEqual(Object.keys(result.errors).sort(), [
    "birth_date",
    "cpf",
    "email",
    "phone",
    "postal_code",
    "state",
    "whatsapp",
  ]);
});

test("edição parcial preserva WhatsApp mesmo quando altera apenas o telefone", () => {
  const result = normalizeClientData(
    { phone: "(21) 2222-3333" },
    { full_name: "Cliente", whatsapp: "11999998888", preferred_contact: "whatsapp" },
  );
  assert.equal(result.valid, true);
  assert.equal(result.data.phone, "2122223333");
  assert.equal(result.data.whatsapp, "11999998888");
});
