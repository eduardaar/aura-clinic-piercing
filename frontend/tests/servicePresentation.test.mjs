import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookingDepositTotal,
  editableInfoSections,
  formatDuration,
  publicInfoSections,
  serializeInfoSections,
  serviceCardSummary,
  serviceRequirementFacts
} from "../src/lib/servicePresentation.js";

test("resumo do cartão prefere a descrição curta e resume a completa sem cortar palavra", () => {
  assert.equal(serviceCardSummary({ short_description: "  Curta.  ", description: "Longa" }), "Curta.");
  const description = "Primeira frase do procedimento. Segunda frase com mais detalhes do atendimento. " + "Terceira frase muito longa ".repeat(10);
  assert.equal(serviceCardSummary({ description }), "Primeira frase do procedimento. Segunda frase com mais detalhes do atendimento.");
  const noSentence = "palavra ".repeat(40).trim();
  const summary = serviceCardSummary({ description: noSentence });
  assert.ok(summary.length <= 161, summary);
  assert.ok(summary.endsWith("palavra…"), summary);
  assert.equal(serviceCardSummary({}), "");
});

test("seções públicas seguem a ordem do cadastro, usam as colunas e omitem vazias", () => {
  const service = {
    pre_service_notes: "Venha alimentado.",
    aftercare_instructions: "Limpe com soro.",
    public_info_sections: JSON.stringify([
      { key: "aftercare" },
      { key: "warranty", body: "30 dias." },
      { key: "rules", body: "   " },
      { key: "custom", title: "Resultado", body: "Varia." },
      { key: "desconhecida", body: "x" }
    ])
  };
  assert.deepEqual(publicInfoSections(service).map((section) => [section.key, section.title, section.body]), [
    ["aftercare", "Cuidados após o atendimento", "Limpe com soro."],
    ["warranty", "Garantia", "30 dias."],
    ["custom", "Resultado", "Varia."],
    ["pre_service", "Antes do atendimento", "Venha alimentado."]
  ]);
  // Sem seções gravadas, os textos já existentes continuam aparecendo.
  assert.deepEqual(publicInfoSections({ aftercare_instructions: "Soro." }).map((section) => section.key), ["aftercare"]);
  assert.deepEqual(serializeInfoSections(editableInfoSections(service)), [
    { key: "aftercare" },
    { key: "warranty", body: "30 dias." },
    { key: "rules", body: "" },
    { key: "custom", title: "Resultado", body: "Varia." },
    { key: "pre_service" }
  ]);
});

test("requisitos só aparecem quando se aplicam ao serviço", () => {
  assert.deepEqual(serviceRequirementFacts({ minimum_age_years: null, requires_guardian: false }), []);
  const facts = serviceRequirementFacts({ minimum_age_years: 16, requires_guardian: 1, requires_evaluation: true, requires_signed_term: "1", return_after_days: 30, postcare_enabled: true, postcare_days: "[7,15]" });
  assert.deepEqual(facts.map((fact) => fact.key), ["age", "guardian", "evaluation", "term", "return", "postcare"]);
  assert.equal(facts.find((fact) => fact.key === "postcare").value, "Contato da equipe em 7, 15 dias");
});

test("sinal soma os serviços e respeita o total, como o backend", () => {
  assert.equal(bookingDepositTotal([{ deposit_value: "40.00" }, { deposit_value: "0" }, {}], 180), 40);
  assert.equal(bookingDepositTotal([{ deposit_value: 50 }, { deposit_value: 50 }], 60), 60);
  assert.equal(bookingDepositTotal([]), 0);
});

test("duração legível", () => {
  assert.equal(formatDuration(45), "45 min");
  assert.equal(formatDuration(60), "1 h");
  assert.equal(formatDuration(95), "1 h 35 min");
  assert.equal(formatDuration(0), "");
});
