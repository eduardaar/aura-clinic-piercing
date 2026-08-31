import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBrazilianPhone,
  formatPostalCode,
  formatSupplierTaxId,
  supplierFormErrors,
  supplierPayload,
  supplierToForm
} from "../src/lib/supplierFields.js";

test("máscaras de fornecedor seguem o padrão brasileiro", () => {
  assert.equal(formatSupplierTaxId("52998224725", "PF"), "529.982.247-25");
  assert.equal(formatSupplierTaxId("11222333000181", "PJ"), "11.222.333/0001-81");
  assert.equal(formatBrazilianPhone("+5511999998888"), "(11) 99999-8888");
  assert.equal(formatPostalCode("01310100"), "01310-100");
});

test("validação local recusa documento e contato inválidos", () => {
  const errors = supplierFormErrors({ name: "Fornecedor", person_type: "PJ", document: "11.111.111/1111-11", phone: "123", email: "invalido" });
  assert.deepEqual(errors.map(({ field }) => field), ["document", "phone", "email"]);
});

test("payload normaliza listas e edição reaplica máscaras", () => {
  const payload = supplierPayload({
    name: "  Titânio Brasil  ", person_type: "PJ", document: "11.222.333/0001-81",
    phone: "(11) 3333-4444", whatsapp: "(11) 99999-8888", postal_code: "01310-100",
    email: " VENDAS@EXEMPLO.COM ", categories: "Joias, Materiais, Joias", brands: "Marca A",
    certifications: "ASTM F-136", material_references: "Titânio", lot_references: "Lote",
    payment_days: "30", lead_time_days: "7", minimum_order_value: "250.50"
  });
  assert.equal(payload.name, "Titânio Brasil");
  assert.equal(payload.document, "11222333000181");
  assert.equal(payload.email, "vendas@exemplo.com");
  assert.deepEqual(payload.categories, ["Joias", "Materiais"]);
  assert.equal(payload.minimum_order_value, 250.5);
  const form = supplierToForm({ ...payload, is_active: 1 });
  assert.equal(form.document, "11.222.333/0001-81");
  assert.equal(form.categories, "Joias, Materiais");
});
