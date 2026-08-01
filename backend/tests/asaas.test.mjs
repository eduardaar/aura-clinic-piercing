// Integração com o Asaas: cofre de credenciais e webhook.
//
// O foco destes testes é a SEGURANÇA e a IDEMPOTÊNCIA, porque é onde os erros
// custam dinheiro de verdade:
//   - o webhook é uma rota pública que marca cobrança como paga;
//   - o cofre guarda a chave que redireciona o faturamento da clínica;
//   - o Asaas entrega o mesmo evento mais de uma vez, por desenho.
import test from "node:test";
import assert from "node:assert/strict";
import { req, createTenant, loginTenant, platformLogin, deleteTenant } from "./helpers.mjs";

// Corpo de webhook no formato que o Asaas realmente posta.
function webhookBody({ eventId, event = "PAYMENT_CONFIRMED", paymentId = "pay_teste_1" }) {
  return {
    id: eventId,
    event,
    payment: {
      id: paymentId,
      status: "CONFIRMED",
      value: 149.9,
      netValue: 145.2,
      billingType: "PIX",
      dueDate: "2026-08-10",
      paymentDate: "2026-08-05",
      externalReference: "intent:1",
      invoiceUrl: "https://sandbox.asaas.com/i/pay_teste_1"
    }
  };
}

function eventId(prefix = "evt") {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

test("Asaas: cofre de credenciais e webhook", async (t) => {
  const platformToken = await platformLogin();
  const clinic = await createTenant("asaas");
  const { token } = await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword);

  t.after(async () => {
    await deleteTenant(platformToken, clinic.tenant.id, clinic.slug);
  });

  // -------------------------------------------------------------------------
  // Cofre
  // -------------------------------------------------------------------------

  await t.test("começa desconfigurado e informa a URL de webhook", async () => {
    const { status, json } = await req("/integrations/asaas", { token, tenant: clinic.slug });
    assert.equal(status, 200);
    assert.equal(json.configured, false);
    assert.equal(json.enabled, false);
    // Sem essa URL a clínica não tem o que cadastrar no painel do Asaas.
    assert.ok(json.webhook_url.endsWith(`/api/webhooks/asaas/${clinic.slug}`), json.webhook_url);
  });

  await t.test("recusa token de webhook curto", async () => {
    const { status, json } = await req("/integrations/asaas", {
      method: "PUT",
      token,
      tenant: clinic.slug,
      body: { webhook_token: "curto" }
    });
    // Token curto é adivinhável, e ele é o ÚNICO segredo que protege uma rota
    // pública capaz de marcar cobrança como paga.
    assert.equal(status, 400, JSON.stringify(json));
  });

  await t.test("não deixa ativar a cobrança sem chave cadastrada", async () => {
    const { status } = await req("/integrations/asaas", {
      method: "PUT",
      token,
      tenant: clinic.slug,
      body: { enabled: true }
    });
    assert.equal(status, 400);
  });

  let generatedToken = null;

  await t.test("gera o token de webhook e o devolve UMA única vez", async () => {
    const { status, json } = await req("/integrations/asaas/webhook-token", {
      method: "POST",
      token,
      tenant: clinic.slug
    });
    assert.equal(status, 200);
    assert.ok(json.webhook_token && json.webhook_token.length >= 32, "token forte esperado");
    assert.equal(json.webhook_configured, true);
    generatedToken = json.webhook_token;

    // A partir daqui o valor não pode mais aparecer em lugar nenhum.
    const depois = await req("/integrations/asaas", { token, tenant: clinic.slug });
    assert.equal(depois.json.webhook_token, undefined);
    assert.equal(depois.json.webhook_configured, true);
  });

  await t.test("nunca devolve segredo, nem cifrado", async () => {
    await req("/integrations/asaas", {
      method: "PUT",
      token,
      tenant: clinic.slug,
      body: { api_key: "$aact_chave_falsa_de_teste_1234567890", environment: "sandbox" }
    });
    const { json } = await req("/integrations/asaas", { token, tenant: clinic.slug });
    const corpo = JSON.stringify(json);
    assert.equal(json.secret_encrypted, undefined);
    assert.equal(json.webhook_token_encrypted, undefined);
    assert.ok(!corpo.includes("aact_chave_falsa"), "a chave vazou na resposta");
    assert.ok(!corpo.includes(generatedToken), "o token de webhook vazou na resposta");
    // A máscara existe para a tela confirmar QUAL chave está salva.
    assert.ok(json.secret_hint?.startsWith("••••"));
    assert.equal(json.configured, true);
  });

  await t.test("chave em branco não apaga a chave salva", async () => {
    // A tela manda só o que mudou; um PUT de ambiente não pode derrubar a chave.
    const { json } = await req("/integrations/asaas", {
      method: "PUT",
      token,
      tenant: clinic.slug,
      body: { environment: "sandbox" }
    });
    assert.equal(json.configured, true);
    assert.ok(json.secret_hint);
  });

  await t.test("só admin acessa o cofre", async () => {
    // Nem `finance`: quem troca esta chave redireciona o faturamento da clínica.
    const criacao = await req("/users", {
      method: "POST",
      token,
      tenant: clinic.slug,
      body: {
        name: "Financeiro QA",
        email: `fin-${clinic.slug}@teste.com`,
        password: "SenhaForte123",
        role: "finance"
      }
    });
    assert.ok([200, 201].includes(criacao.status), JSON.stringify(criacao.json));

    const finance = await loginTenant(clinic.slug, `fin-${clinic.slug}@teste.com`, "SenhaForte123");
    const leitura = await req("/integrations/asaas", {
      token: finance.token,
      tenant: clinic.slug
    });
    assert.equal(leitura.status, 403);

    const escrita = await req("/integrations/asaas", {
      method: "PUT",
      token: finance.token,
      tenant: clinic.slug,
      body: { api_key: "tentativa-de-troca" }
    });
    assert.equal(escrita.status, 403);
  });

  await t.test("exige sessão", async () => {
    const { status } = await req("/integrations/asaas", { tenant: clinic.slug });
    assert.equal(status, 401);
  });

  // -------------------------------------------------------------------------
  // Webhook — autenticidade
  // -------------------------------------------------------------------------

  await t.test("rejeita webhook sem token", async () => {
    const { status } = await req(`/webhooks/asaas/${clinic.slug}`, {
      method: "POST",
      body: webhookBody({ eventId: eventId() })
    });
    assert.equal(status, 401);
  });

  await t.test("rejeita webhook com token errado", async () => {
    const { status } = await req(`/webhooks/asaas/${clinic.slug}`, {
      method: "POST",
      headers: { "asaas-access-token": "token-errado-porem-longo-o-suficiente" },
      body: webhookBody({ eventId: eventId() })
    });
    assert.equal(status, 401);
  });

  await t.test("rejeita webhook com prefixo correto do token", async () => {
    // Guarda contra comparação não-constante: um `===` vazaria o token
    // caractere a caractere pelo tempo de resposta.
    const { status } = await req(`/webhooks/asaas/${clinic.slug}`, {
      method: "POST",
      headers: { "asaas-access-token": generatedToken.slice(0, -1) },
      body: webhookBody({ eventId: eventId() })
    });
    assert.equal(status, 401);
  });

  await t.test("clínica inexistente responde 200, não erro", async () => {
    // 200 de propósito: o Asaas REENTREGA em qualquer não-2xx e, após falhas
    // consecutivas, PAUSA a fila de webhooks da conta inteira. Um slug errado
    // nunca vai passar a existir por reentrega.
    const { status, json } = await req("/webhooks/asaas/clinica-que-nao-existe", {
      method: "POST",
      headers: { "asaas-access-token": generatedToken },
      body: webhookBody({ eventId: eventId() })
    });
    assert.equal(status, 200);
    assert.equal(json.ignored, "clinica-desconhecida");
  });

  await t.test("webhook da plataforma sem integração configurada é rejeitado", async () => {
    // Fail-closed: sem token configurado do nosso lado a rota fica DESLIGADA,
    // e não aberta. O servidor de teste sobe sem ASAAS_API_KEY.
    const { status } = await req("/webhooks/asaas", {
      method: "POST",
      headers: { "asaas-access-token": "qualquer-coisa" },
      body: webhookBody({ eventId: eventId() })
    });
    assert.equal(status, 401);
  });

  // -------------------------------------------------------------------------
  // Webhook — idempotência e tolerância
  // -------------------------------------------------------------------------

  await t.test("aceita token válido e é idempotente na reentrega", async () => {
    const id = eventId();
    const body = webhookBody({ eventId: id, paymentId: `pay_${id}` });

    const primeira = await req(`/webhooks/asaas/${clinic.slug}`, {
      method: "POST",
      headers: { "asaas-access-token": generatedToken },
      body
    });
    assert.equal(primeira.status, 200, JSON.stringify(primeira.json));
    assert.notEqual(primeira.json.duplicate, true);

    // O Asaas reentrega o MESMO evento — é o caminho normal, não a exceção.
    const segunda = await req(`/webhooks/asaas/${clinic.slug}`, {
      method: "POST",
      headers: { "asaas-access-token": generatedToken },
      body
    });
    assert.equal(segunda.status, 200);
    assert.equal(segunda.json.duplicate, true);
  });

  await t.test("cobrança desconhecida não vira erro", async () => {
    // Uma cobrança criada direto no painel do Asaas gera webhook aqui. Se isso
    // respondesse 404/500, o Asaas reentregaria em laço até pausar a fila.
    const { status, json } = await req(`/webhooks/asaas/${clinic.slug}`, {
      method: "POST",
      headers: { "asaas-access-token": generatedToken },
      body: webhookBody({ eventId: eventId(), paymentId: "pay_criado_no_painel" })
    });
    assert.equal(status, 200);
    assert.equal(json.applied, false);
  });

  await t.test("evento não tratado é ignorado sem erro", async () => {
    const { status, json } = await req(`/webhooks/asaas/${clinic.slug}`, {
      method: "POST",
      headers: { "asaas-access-token": generatedToken },
      body: webhookBody({ eventId: eventId(), event: "PAYMENT_ANTICIPATED" })
    });
    assert.equal(status, 200);
    assert.equal(json.ignored, "PAYMENT_ANTICIPATED");
  });

  await t.test("corpo sem payment.id é ignorado sem erro", async () => {
    const { status, json } = await req(`/webhooks/asaas/${clinic.slug}`, {
      method: "POST",
      headers: { "asaas-access-token": generatedToken },
      body: { id: eventId(), event: "PAYMENT_CONFIRMED", payment: {} }
    });
    assert.equal(status, 200);
    assert.equal(json.ignored, "sem-payment-id");
  });

  // -------------------------------------------------------------------------
  // Isolamento entre clínicas
  // -------------------------------------------------------------------------

  await t.test("token de uma clínica não vale para outra", async () => {
    const outra = await createTenant("asaas2");
    const sessao = await loginTenant(outra.slug, outra.adminEmail, outra.adminPassword);
    const tokenOutra = await req("/integrations/asaas/webhook-token", {
      method: "POST",
      token: sessao.token,
      tenant: outra.slug
    });
    assert.equal(tokenOutra.status, 200);

    // O token da segunda clínica não pode confirmar cobrança na primeira.
    const cruzado = await req(`/webhooks/asaas/${clinic.slug}`, {
      method: "POST",
      headers: { "asaas-access-token": tokenOutra.json.webhook_token },
      body: webhookBody({ eventId: eventId() })
    });
    assert.equal(cruzado.status, 401);

    await deleteTenant(platformToken, outra.tenant.id, outra.slug);
  });

  await t.test("remover credencial exige confirmação explícita", async () => {
    const semConfirmar = await req("/integrations/asaas", {
      method: "DELETE",
      token,
      tenant: clinic.slug,
      body: {}
    });
    assert.equal(semConfirmar.status, 400);

    const confirmado = await req("/integrations/asaas", {
      method: "DELETE",
      token,
      tenant: clinic.slug,
      body: { confirm: true }
    });
    assert.equal(confirmado.status, 200);
    assert.equal(confirmado.json.configured, false);
  });

  await t.test("sem credencial, o webhook volta a ser rejeitado", async () => {
    // Fail-closed de novo: apagar a credencial não pode deixar a rota aberta.
    const { status } = await req(`/webhooks/asaas/${clinic.slug}`, {
      method: "POST",
      headers: { "asaas-access-token": generatedToken },
      body: webhookBody({ eventId: eventId() })
    });
    assert.equal(status, 401);
  });
});
