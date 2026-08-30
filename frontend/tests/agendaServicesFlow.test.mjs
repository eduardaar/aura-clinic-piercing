import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const agenda = readFileSync(new URL("../src/features/agenda/Agenda.jsx", import.meta.url), "utf8");
const services = readFileSync(new URL("../src/features/services/Services.jsx", import.meta.url), "utf8");

test("atendimento operacional nasce e permanece na Agenda", () => {
  assert.match(agenda, /\/service-executions\?limit=/);
  assert.match(agenda, /Atendimentos realizados/);
  assert.match(agenda, /clinical_notes: clinicalNotes/);
  assert.doesNotMatch(services, /\/appointments\?status=atendido/);
  assert.doesNotMatch(services, /Serviços realizados/);
});

test("serviços formam um catálogo único com variações opcionais", () => {
  assert.match(services, /Catálogo de serviços/);
  assert.match(services, /Variações clínicas/);
  assert.match(services, /Este serviço não precisa de variações/);
  assert.doesNotMatch(agenda, /tab === "servicos"/);
});
