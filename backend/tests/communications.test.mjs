import test from "node:test";
import assert from "node:assert/strict";
import { renderTemplate, TEMPLATE_VARIABLES } from "../src/services/communications.js";

test("modelos substituem apenas variáveis permitidas e preservam desconhecidas", () => {
  const result = renderTemplate(
    "Olá {{cliente}}, atendimento com {{profissional}}. {{variavel_invalida}}",
    { cliente: "Ana", profissional: "Bia", variavel_invalida: "não deve entrar" }
  );
  assert.equal(result, "Olá Ana, atendimento com Bia. {{variavel_invalida}}");
});

test("todas as variáveis oficiais podem ser renderizadas sem valores indefinidos", () => {
  const body = TEMPLATE_VARIABLES.map((key) => `{{${key}}}`).join("|");
  const variables = Object.fromEntries(TEMPLATE_VARIABLES.map((key) => [key, key.toUpperCase()]));
  const result = renderTemplate(body, variables);
  assert.equal(result, TEMPLATE_VARIABLES.map((key) => key.toUpperCase()).join("|"));
  assert.equal(result.includes("undefined"), false);
});
