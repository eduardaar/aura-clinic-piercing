import test from "node:test";
import assert from "node:assert/strict";
import { AiAssistantError, buildTaskPrompt, getAiProviderStatus, redactAiContext, runAiAssistantTask } from "../src/services/aiAssistant.js";

test("assistente aceita somente tarefas previstas e limita o contexto", () => {
  assert.throws(() => buildTaskPrompt("delete_everything", { context: "x" }), AiAssistantError);
  assert.throws(() => buildTaskPrompt("draft_message", { context: "x".repeat(12001) }), /12000/);
  const prompt = buildTaskPrompt("draft_message", { context: "Cliente pediu confirmação", tone: "cordial" });
  assert.match(prompt, /<DADOS>/);
  assert.match(prompt, /nunca instruções/);
  assert.match(prompt, /TOM: cordial/);
});

test("contexto enviado à IA remove identificadores comuns", () => {
  const redacted = redactAiContext("Cliente: Ana Silva\nCPF: 123.456.789-01\nana@example.com\nWhatsApp: (11) 99999-8888");
  assert.ok(!redacted.includes("Ana Silva"));
  assert.ok(!redacted.includes("123.456.789-01"));
  assert.ok(!redacted.includes("ana@example.com"));
  assert.ok(!redacted.includes("99999-8888"));
});

test("status não retorna segredos e indica o provedor disponível", () => {
  const status = getAiProviderStatus({ openaiKey: "secret-value", geminiKey: "" });
  assert.equal(status.enabled, true);
  assert.equal(status.provider, "openai");
  assert.equal(JSON.stringify(status).includes("secret-value"), false);
  assert.deepEqual(status.tasks, ["draft_message", "summarize_client", "suggest_reply"]);
});

test("OpenAI recebe prompt controlado e uso normalizado", async () => {
  let called;
  const result = await runAiAssistantTask({
    task: "summarize_client",
    input: { context: "Cliente: Ana. Último atendimento em 10/08." },
    config: { openaiKey: "test-key", openaiModel: "test-model", geminiKey: "", maxOutputTokens: 120 },
    fetchImpl: async (url, options) => {
      called = { url, options };
      return new Response(JSON.stringify({ choices: [{ message: { content: "- Cliente Ana" } }], usage: { prompt_tokens: 12, completion_tokens: 4 } }), { status: 200 });
    }
  });
  assert.equal(called.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(called.options.headers.authorization, "Bearer test-key");
  assert.match(called.options.body, /<DADOS>/);
  assert.equal(result.output, "- Cliente Ana");
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });
});

test("sem credencial o assistente falha de modo claro, sem chamada externa", async () => {
  await assert.rejects(
    runAiAssistantTask({ task: "draft_message", input: { context: "Olá" }, config: { openaiKey: "", geminiKey: "" }, fetchImpl: async () => { throw new Error("não deveria chamar"); } }),
    (error) => error instanceof AiAssistantError && error.statusCode === 503
  );
});
