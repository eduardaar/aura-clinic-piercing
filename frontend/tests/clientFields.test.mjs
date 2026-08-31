import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBrazilianPhone,
  formatCep,
  formatCpf,
  normalizeEmailInput,
  normalizeInstagramInput,
  validateClientForm,
} from "../src/lib/clientFields.js";

test("aplica máscaras PT-BR sem misturar os canais", () => {
  assert.equal(formatBrazilianPhone("5511999998888"), "(11) 99999-8888");
  assert.equal(formatBrazilianPhone("1133334444"), "(11) 3333-4444");
  assert.equal(formatCpf("52998224725"), "529.982.247-25");
  assert.equal(formatCep("01310100"), "01310-100");
  assert.equal(normalizeEmailInput(" CLIENTE@EXAMPLE.COM "), "cliente@example.com");
  assert.equal(normalizeInstagramInput(" cliente teste "), "@clienteteste");
});

test("valida os campos obrigatórios e CPF antes do envio", () => {
  const valid = validateClientForm({
    full_name: "Maria",
    birth_date: "1990-05-10",
    whatsapp: "(11) 99999-8888",
    phone: "",
    email: "maria@example.com",
    cpf: "529.982.247-25",
    postal_code: "01310-100",
  });
  assert.deepEqual(valid, {});

  const invalid = validateClientForm({ full_name: "", birth_date: "", whatsapp: "11", cpf: "111.111.111-11" });
  assert.deepEqual(Object.keys(invalid).sort(), ["birth_date", "cpf", "full_name", "whatsapp"]);
});
