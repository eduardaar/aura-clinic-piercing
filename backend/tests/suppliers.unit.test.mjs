import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSupplierInput, SupplierValidationError } from "../src/services/suppliers.js";

test("fornecedor normaliza documento, contatos e listas", () => {
  const supplier = normalizeSupplierInput({
    name: "  Titânio Brasil  ", person_type: "PJ", document: "11.222.333/0001-81",
    phone: "(11) 3333-4444", whatsapp: "(11) 99999-8888", email: " VENDAS@EXEMPLO.COM ",
    website: "@titanio.brasil", postal_code: "01310-100", state: "sp",
    categories: "Joias, Materiais, Joias", brands: ["Marca A", "Marca A"],
    payment_days: "30", lead_time_days: 7, minimum_order_value: "250,50"
  });
  assert.equal(supplier.name, "Titânio Brasil");
  assert.equal(supplier.document, "11222333000181");
  assert.equal(supplier.whatsapp, "+5511999998888");
  assert.equal(supplier.email, "vendas@exemplo.com");
  assert.equal(supplier.website, "https://instagram.com/titanio.brasil");
  assert.equal(supplier.postal_code, "01310100");
  assert.equal(supplier.state, "SP");
  assert.deepEqual(supplier.categories, ["Joias", "Materiais"]);
  assert.equal(supplier.minimum_order_value, 250.5);
});

test("fornecedor valida tipo fiscal, telefone, CEP e UF", () => {
  assert.throws(() => normalizeSupplierInput({ name: "PF errada", person_type: "PF", document: "11222333000181" }), SupplierValidationError);
  assert.throws(() => normalizeSupplierInput({ name: "Telefone errado", phone: "123" }), /Telefone/);
  assert.throws(() => normalizeSupplierInput({ name: "CEP errado", postal_code: "123" }), /CEP/);
  assert.throws(() => normalizeSupplierInput({ name: "UF errada", state: "XX" }), /UF/);
});

test("edição parcial preserva os campos atuais", () => {
  const current = normalizeSupplierInput({
    name: "Fornecedor atual", person_type: "PF", document: "52998224725",
    categories: ["Joias"], lead_time_days: 5, is_active: true
  });
  const updated = normalizeSupplierInput({ phone: "1133334444", is_active: false }, current);
  assert.equal(updated.document, "52998224725");
  assert.deepEqual(updated.categories, ["Joias"]);
  assert.equal(updated.lead_time_days, 5);
  assert.equal(updated.is_active, false);
});
