// Suporte: chamados entre as clínicas e a Monitence.
//
// O foco é o que dói se der errado. Aqui o dado é uma CONVERSA entre uma
// clínica e o fornecedor, guardada num schema compartilhado: o erro caro não é
// a tela feia, é a clínica A lendo o chamado da clínica B. Por isso a maior
// parte dos casos abaixo é isolamento, fronteira entre os dois tipos de token e
// vazamento de nota interna.
import test from "node:test";
import assert from "node:assert/strict";
import { req, platformLogin, createTenant, loginTenant, deleteTenant } from "./helpers.mjs";

// Espelha MAX_OPEN_TICKETS_PER_TENANT em services/support.js.
const MAX_OPEN_TICKETS = 10;

test("Suporte: chamados da clínica e caixa de entrada da plataforma", async (t) => {
  const platformToken = await platformLogin();
  const plt = { token: platformToken, platform: true };

  // Duas clínicas de verdade: o isolamento só é testável com um vizinho real.
  const clinicaA = await createTenant("supa");
  const clinicaB = await createTenant("supb");
  const sessaoA = await loginTenant(clinicaA.slug, clinicaA.adminEmail, clinicaA.adminPassword);
  const sessaoB = await loginTenant(clinicaB.slug, clinicaB.adminEmail, clinicaB.adminPassword);
  const comoA = { token: sessaoA.token, tenant: clinicaA.slug };
  const comoB = { token: sessaoB.token, tenant: clinicaB.slug };

  t.after(async () => {
    // Apagar o tenant leva os chamados junto (FK ON DELETE CASCADE).
    await deleteTenant(platformToken, clinicaA.tenant.id, clinicaA.slug);
    await deleteTenant(platformToken, clinicaB.tenant.id, clinicaB.slug);
  });

  // ---------------------------------------------------------------------------
  // Abertura
  // ---------------------------------------------------------------------------

  const abertura = await req("/support/tickets", {
    ...comoA,
    method: "POST",
    body: { subject: "Não consigo emitir cobrança", category: "problema", body: "O botão de cobrar não responde." }
  });

  await t.test("a clínica abre um chamado com a primeira mensagem", async () => {
    assert.equal(abertura.status, 201, JSON.stringify(abertura.json));
    assert.equal(abertura.json.subject, "Não consigo emitir cobrança");
    assert.equal(abertura.json.category, "problema");
    assert.equal(abertura.json.status, "aberto");
    // A prioridade é do suporte: mesmo que a clínica mande, ela nasce normal.
    assert.equal(abertura.json.priority, "normal");
    assert.equal(abertura.json.tenant_id, clinicaA.tenant.id);
    assert.equal(abertura.json.messages.length, 1);
    assert.equal(abertura.json.messages[0].author_side, "clinica");
  });

  const ticketA = abertura.json.id;

  await t.test("a prioridade não é escolhida pela clínica", async () => {
    const { json } = await req("/support/tickets", {
      ...comoA,
      method: "POST",
      body: { subject: "Tudo é urgente", body: "Mensagem", priority: "alta" }
    });
    // Se a clínica pudesse escolher, tudo seria "alta" e a fila do suporte
    // perderia a serventia.
    assert.equal(json.priority, "normal");
    await req(`/support/tickets/${json.id}/close`, { ...comoA, method: "POST" });
  });

  // ---------------------------------------------------------------------------
  // Isolamento entre clínicas — o ponto crítico
  // ---------------------------------------------------------------------------

  await t.test("a clínica B não lê o chamado da clínica A (404, não 403)", async () => {
    const { status, json } = await req(`/support/tickets/${ticketA}`, comoB);
    // 404 e não 403 de propósito: 403 confirmaria que aquele id existe.
    assert.equal(status, 404, JSON.stringify(json));
  });

  await t.test("a clínica B não responde no chamado da clínica A", async () => {
    const { status } = await req(`/support/tickets/${ticketA}/messages`, {
      ...comoB,
      method: "POST",
      body: { body: "Intrusão" }
    });
    assert.equal(status, 404);
  });

  await t.test("a clínica B não fecha o chamado da clínica A", async () => {
    const { status } = await req(`/support/tickets/${ticketA}/close`, { ...comoB, method: "POST" });
    assert.equal(status, 404);
    // E o chamado continua vivo do lado de A.
    const depois = await req(`/support/tickets/${ticketA}`, comoA);
    assert.equal(depois.json.status, "aberto");
  });

  await t.test("a listagem de cada clínica só traz os chamados dela", async () => {
    await req("/support/tickets", {
      ...comoB,
      method: "POST",
      body: { subject: "Dúvida da B", body: "Mensagem da clínica B." }
    });
    const listaA = await req("/support/tickets", comoA);
    const listaB = await req("/support/tickets", comoB);
    assert.ok(listaA.json.every((ticket) => ticket.tenant_id === clinicaA.tenant.id));
    assert.ok(listaB.json.every((ticket) => ticket.tenant_id === clinicaB.tenant.id));
    assert.ok(!listaB.json.some((ticket) => ticket.id === ticketA));
  });

  // ---------------------------------------------------------------------------
  // Fronteira entre os dois tipos de token
  // ---------------------------------------------------------------------------

  await t.test("token de plataforma não vale em rota de clínica", async () => {
    const { status } = await req("/support/tickets", { token: platformToken, tenant: clinicaA.slug });
    assert.equal(status, 401);
  });

  await t.test("token de clínica não vale na caixa de entrada do suporte", async () => {
    assert.equal((await req("/platform/support/tickets", comoA)).status, 401);
    assert.equal((await req(`/platform/support/tickets/${ticketA}`, comoA)).status, 401);
    assert.equal(
      (await req(`/platform/support/tickets/${ticketA}`, { ...comoA, method: "PATCH", body: { status: "fechado" } })).status,
      401
    );
    assert.equal((await req("/platform/support/open-count", comoA)).status, 401);
  });

  await t.test("sem token nenhuma das duas pontas responde", async () => {
    // O `tenant` vai junto de propósito: sem ele a requisição morre ANTES da
    // autenticação, em "informe a clínica" (400), e o teste passaria a medir a
    // resolução de tenant em vez da exigência de sessão — que é o que interessa
    // aqui. Numa máquina com DEFAULT_TENANT no .env isso fica invisível, porque
    // o tenant é resolvido sozinho; foi assim que passou local e falhou na CI.
    assert.equal((await req("/support/tickets", { tenant: clinicaA.slug })).status, 401);
    // A ponta da plataforma não tem tenant nenhum: ela não passa por withDb.
    assert.equal((await req("/platform/support/tickets")).status, 401);
  });

  await t.test("papel não-admin da clínica não acessa o suporte", async () => {
    // Falar com o fornecedor é ato do responsável pela clínica: a categoria
    // financeiro trata de assinatura e cobrança.
    const criado = await req("/users", {
      ...comoA,
      method: "POST",
      body: { name: "Recepção QA", email: `recepcao@${clinicaA.slug}.test`, password: "SenhaForte123", role: "reception" }
    });
    assert.equal(criado.status, 201, JSON.stringify(criado.json));
    const recepcao = await loginTenant(clinicaA.slug, `recepcao@${clinicaA.slug}.test`, "SenhaForte123");
    const comoRecepcao = { token: recepcao.token, tenant: clinicaA.slug };
    assert.equal((await req("/support/tickets", comoRecepcao)).status, 403);
    assert.equal(
      (await req("/support/tickets", { ...comoRecepcao, method: "POST", body: { subject: "x", body: "y" } })).status,
      403
    );
  });

  // ---------------------------------------------------------------------------
  // Conversa
  // ---------------------------------------------------------------------------

  await t.test("o suporte enxerga o chamado e responde", async () => {
    const detalhe = await req(`/platform/support/tickets/${ticketA}`, plt);
    assert.equal(detalhe.status, 200, JSON.stringify(detalhe.json));
    assert.equal(detalhe.json.tenant_slug, clinicaA.slug);

    const resposta = await req(`/platform/support/tickets/${ticketA}/messages`, {
      ...plt,
      method: "POST",
      body: { body: "Já estamos verificando." }
    });
    assert.equal(resposta.status, 201, JSON.stringify(resposta.json));
    // Responder move o chamado para "aguardando cliente" sozinho: sem isso o
    // suporte teria de mudar o status na mão a cada resposta.
    assert.equal(resposta.json.status, "aguardando_cliente");
    assert.ok(resposta.json.last_support_message_at);
  });

  await t.test("a clínica vê a resposta e responde de volta", async () => {
    const detalhe = await req(`/support/tickets/${ticketA}`, comoA);
    assert.equal(detalhe.json.messages.length, 2);
    assert.equal(detalhe.json.messages[1].author_side, "suporte");

    const resposta = await req(`/support/tickets/${ticketA}/messages`, {
      ...comoA,
      method: "POST",
      body: { body: "Continua acontecendo." }
    });
    assert.equal(resposta.status, 201, JSON.stringify(resposta.json));
    assert.equal(resposta.json.status, "aberto");
    assert.equal(resposta.json.messages.length, 3);
  });

  // ---------------------------------------------------------------------------
  // Nota interna: o vazamento que este recurso pode causar
  // ---------------------------------------------------------------------------

  await t.test("nota interna do suporte NUNCA aparece para a clínica", async () => {
    const nota = await req(`/platform/support/tickets/${ticketA}/messages`, {
      ...plt,
      method: "POST",
      body: { body: "Cliente já reclamou disso três vezes; checar o plano antes de responder.", internal_note: true }
    });
    assert.equal(nota.status, 201, JSON.stringify(nota.json));
    assert.ok(nota.json.messages.some((m) => m.internal_note === true), "o suporte precisa ver a própria nota");

    const detalhe = await req(`/support/tickets/${ticketA}`, comoA);
    const corpos = detalhe.json.messages.map((m) => m.body).join("\n");
    assert.ok(!corpos.includes("checar o plano"), "a nota interna vazou no detalhe da clínica");
    // Nem o campo pode existir na resposta da clínica: presente e falso, ele já
    // denunciaria que existe uma segunda camada de mensagens.
    assert.ok(detalhe.json.messages.every((m) => m.internal_note === undefined));
    assert.equal(detalhe.json.messages.length, 3);
  });

  await t.test("nota interna não marca o chamado como respondido", async () => {
    // A clínica não recebeu nada: dizer que recebeu faria o "aguardando
    // cliente" apontar para uma resposta que não existe.
    const detalhe = await req(`/support/tickets/${ticketA}`, comoA);
    assert.equal(detalhe.json.status, "aberto");
  });

  // ---------------------------------------------------------------------------
  // Status, prioridade e fechamento
  // ---------------------------------------------------------------------------

  await t.test("o suporte muda status e prioridade", async () => {
    const { status, json } = await req(`/platform/support/tickets/${ticketA}`, {
      ...plt,
      method: "PATCH",
      body: { status: "em_andamento", priority: "alta" }
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.status, "em_andamento");
    assert.equal(json.priority, "alta");
  });

  await t.test("o suporte recusa status e prioridade inventados", async () => {
    assert.equal(
      (await req(`/platform/support/tickets/${ticketA}`, { ...plt, method: "PATCH", body: { status: "arquivado" } })).status,
      400
    );
    assert.equal(
      (await req(`/platform/support/tickets/${ticketA}`, { ...plt, method: "PATCH", body: { priority: "urgentissima" } })).status,
      400
    );
  });

  await t.test("a clínica fecha o próprio chamado e não escreve mais nele", async () => {
    const fechado = await req(`/support/tickets/${ticketA}/close`, { ...comoA, method: "POST" });
    assert.equal(fechado.status, 200, JSON.stringify(fechado.json));
    assert.equal(fechado.json.status, "fechado");
    assert.ok(fechado.json.closed_at);

    const tentativa = await req(`/support/tickets/${ticketA}/messages`, {
      ...comoA,
      method: "POST",
      body: { body: "Mais uma coisa" }
    });
    assert.equal(tentativa.status, 409);
    // Fechar de novo também não: a segunda chamada não pode reabrir a data.
    assert.equal((await req(`/support/tickets/${ticketA}/close`, { ...comoA, method: "POST" })).status, 409);
  });

  await t.test("reabrir pelo painel limpa a data de fechamento", async () => {
    const { json } = await req(`/platform/support/tickets/${ticketA}`, {
      ...plt,
      method: "PATCH",
      body: { status: "em_andamento" }
    });
    assert.equal(json.status, "em_andamento");
    assert.equal(json.closed_at, null, "chamado reaberto não pode continuar com data de fechamento");
  });

  // ---------------------------------------------------------------------------
  // Caixa de entrada do suporte
  // ---------------------------------------------------------------------------

  await t.test("a caixa de entrada filtra por status, clínica e busca", async () => {
    const porTenant = await req(`/platform/support/tickets?tenant_id=${clinicaB.tenant.id}`, plt);
    assert.equal(porTenant.status, 200);
    assert.ok(porTenant.json.every((ticket) => ticket.tenant_id === clinicaB.tenant.id));

    const porStatus = await req("/platform/support/tickets?status=em_andamento", plt);
    assert.ok(porStatus.json.every((ticket) => ticket.status === "em_andamento"));

    const busca = await req("/platform/support/tickets?search=Dúvida da B", plt);
    assert.ok(busca.json.some((ticket) => ticket.subject === "Dúvida da B"));

    // O termo entra como parâmetro, não na SQL: um `%` digitado é texto.
    const suja = await req("/platform/support/tickets?search=%27%3B%20DROP%20TABLE", plt);
    assert.equal(suja.status, 200);
  });

  await t.test("a caixa de entrada pagina com o envelope da casa", async () => {
    const { status, json } = await req("/platform/support/tickets?limit=1&offset=0", plt);
    assert.equal(status, 200);
    assert.equal(json.limit, 1);
    assert.equal(json.items.length, 1);
    // `total` é o total filtrado, não o tamanho da página — é o que sustenta a
    // paginação no DataView.
    assert.ok(json.total >= 2);
  });

  await t.test("o contador de abertos alimenta o badge", async () => {
    const { status, json } = await req("/platform/support/open-count", plt);
    assert.equal(status, 200);
    assert.ok(Number.isInteger(json.open));
    assert.ok(json.open >= 1);
  });

  // ---------------------------------------------------------------------------
  // O que NÃO pode entrar
  // ---------------------------------------------------------------------------

  await t.test("recusa assunto e mensagem vazios", async () => {
    assert.equal(
      (await req("/support/tickets", { ...comoA, method: "POST", body: { subject: "   ", body: "texto" } })).status,
      400
    );
    assert.equal(
      (await req("/support/tickets", { ...comoA, method: "POST", body: { subject: "Assunto", body: "  " } })).status,
      400
    );
  });

  await t.test("recusa assunto e mensagem gigantes", async () => {
    // Sem teto, o campo vira depósito: um paste de log entraria inteiro no banco
    // e seria servido em toda abertura da caixa de entrada.
    assert.equal(
      (await req("/support/tickets", { ...comoA, method: "POST", body: { subject: "x".repeat(200), body: "ok" } })).status,
      400
    );
    assert.equal(
      (await req("/support/tickets", { ...comoA, method: "POST", body: { subject: "ok", body: "x".repeat(5000) } })).status,
      400
    );
  });

  await t.test("recusa categoria inventada", async () => {
    const { status } = await req("/support/tickets", {
      ...comoA,
      method: "POST",
      body: { subject: "Assunto", category: "reclamacao", body: "texto" }
    });
    assert.equal(status, 400);
  });

  await t.test("id não numérico devolve 404, não 500", async () => {
    assert.equal((await req("/support/tickets/abc", comoA)).status, 404);
    assert.equal((await req("/platform/support/tickets/abc", plt)).status, 404);
  });

  // ---------------------------------------------------------------------------
  // Guarda contra inundação
  // ---------------------------------------------------------------------------

  await t.test("teto de chamados em aberto por clínica", async () => {
    // Clínica dedicada: o teto conta o estoque em aberto e contaminaria os
    // outros casos se rodasse na clínica A.
    const clinicaC = await createTenant("supc");
    const sessaoC = await loginTenant(clinicaC.slug, clinicaC.adminEmail, clinicaC.adminPassword);
    const comoC = { token: sessaoC.token, tenant: clinicaC.slug };

    for (let i = 0; i < MAX_OPEN_TICKETS; i += 1) {
      const { status } = await req("/support/tickets", {
        ...comoC,
        method: "POST",
        body: { subject: `Chamado ${i}`, body: "Mensagem de teste." }
      });
      assert.equal(status, 201, `o chamado ${i} deveria caber no teto`);
    }

    const excedente = await req("/support/tickets", {
      ...comoC,
      method: "POST",
      body: { subject: "Um a mais", body: "Mensagem de teste." }
    });
    // 429 e não 400: o pedido está correto, o que acabou foi a fila.
    assert.equal(excedente.status, 429, JSON.stringify(excedente.json));

    // O teto é de ESTOQUE, não de frequência: fechar um chamado libera a vaga na
    // hora, sem esperar janela de tempo nenhuma.
    const lista = await req("/support/tickets", comoC);
    await req(`/support/tickets/${lista.json[0].id}/close`, { ...comoC, method: "POST" });
    const depois = await req("/support/tickets", {
      ...comoC,
      method: "POST",
      body: { subject: "Depois de liberar", body: "Mensagem de teste." }
    });
    assert.equal(depois.status, 201, JSON.stringify(depois.json));

    await deleteTenant(platformToken, clinicaC.tenant.id, clinicaC.slug);
  });
});
