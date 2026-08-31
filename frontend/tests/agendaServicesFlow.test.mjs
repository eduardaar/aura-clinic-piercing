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

test("procedimentos formam um catálogo único de tipos de atendimento", () => {
  assert.match(services, /Procedimentos e tipos de atendimento/);
  assert.match(services, /Cadastro único do procedimento/);
  assert.match(services, /Profissionais habilitados/);
  assert.match(services, /Materiais previstos/);
  assert.match(services, /Joias compatíveis/);
  assert.doesNotMatch(agenda, /tab === "servicos"/);
});
