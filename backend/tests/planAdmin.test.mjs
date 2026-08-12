// CRUD de planos do painel de plataforma.
//
// O foco é o que dói se der errado: plano é o que define preço cobrado e acesso
// concedido. Por isso os testes se concentram em (a) autorização, (b) o que NÃO
// pode entrar num plano, (c) exclusão de plano com assinante e (d) a edição
// valendo IMEDIATAMENTE para o gating, sem reiniciar o servidor — se o registro
// em memória não recarregar, a clínica continua com o plano antigo e ninguém
// percebe até o próximo deploy.
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { req, platformLogin, createTenant, loginTenant, deleteTenant } from "./helpers.mjs";

// Um único ponto onde o teste fala com o banco direto, e por um motivo só:
// nenhuma rota grava `asaas_subscription_id` sem um gateway de verdade do outro
// lado, e sem esse campo a propagação de preço nunca teria o que contar.
async function comBanco(sql, params) {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
  });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

const CODIGO = `qa-plano-${Math.floor(performance.now() * 1000) % 1000000}`;

test("Planos: CRUD do painel de plataforma", async (t) => {
  const platformToken = await platformLogin();
  const plt = { token: platformToken, platform: true };

  const inicial = await req("/platform/plans", plt);
  assert.equal(inicial.status, 200, JSON.stringify(inicial.json));
  const ordemOriginal = [...inicial.json.plans]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((plano) => plano.code);

  t.after(async () => {
    // Não deixa plano de teste para trás: ele apareceria na vitrine pública.
    await req(`/platform/plans/${CODIGO}`, { ...plt, method: "DELETE" });
    await req("/platform/plans/order", { ...plt, method: "PATCH", body: { codes: ordemOriginal } });
  });

  // -------------------------------------------------------------------------
  // Autorização
  // -------------------------------------------------------------------------

  await t.test("todas as rotas exigem token de plataforma", async () => {
    assert.equal((await req("/platform/plans")).status, 401);
    assert.equal((await req("/platform/plans", { method: "POST", body: { code: "x" } })).status, 401);
    assert.equal((await req("/platform/plans/premium", { method: "PUT", body: { name: "x" } })).status, 401);
    assert.equal((await req("/platform/plans/premium", { method: "DELETE" })).status, 401);
    assert.equal((await req("/platform/plans/premium/usage")).status, 401);
    assert.equal(
      (await req("/platform/plans/premium/active", { method: "PATCH", body: { is_active: false } })).status,
      401
    );
  });

  await t.test("admin de clínica não mexe nos planos da plataforma", async () => {
    // Se passasse, uma clínica poderia zerar o próprio preço e liberar todas as
    // features para si mesma.
    const clinica = await createTenant("plan");
    const { token } = await loginTenant(clinica.slug, clinica.adminEmail, clinica.adminPassword);
    assert.equal((await req("/platform/plans", { token, tenant: clinica.slug })).status, 401);
    await deleteTenant(platformToken, clinica.tenant.id, clinica.slug);
  });

  // -------------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------------

  await t.test("a listagem traz os catálogos para a tela montar as caixinhas", async () => {
    const { json } = await req("/platform/plans", plt);
    assert.ok(json.plans.length >= 4);
    assert.ok(!json.plans.some((plano) => plano.code === "essencial"));
    assert.ok(json.feature_catalog.length > 10, "sem o catálogo o painel teria de hardcodar as features");
    assert.ok(json.feature_catalog.every((item) => item.key && item.label && item.group));
    assert.ok(json.limit_catalog.length >= 1);
    assert.ok(json.limit_catalog.every((item) => item.key && item.label));
    // A contagem vem junto: a tela decide com ela se mostra o botão de excluir.
    assert.ok(json.plans.every((plano) => typeof plano.subscribers === "number"));
  });

  // -------------------------------------------------------------------------
  // Criação e validação
  // -------------------------------------------------------------------------

  await t.test("cria um plano", async () => {
    const { status, json } = await req("/platform/plans", {
      ...plt,
      method: "POST",
      body: {
        code: CODIGO,
        name: "Plano QA",
        price_cents: 4990,
        audience: "Testes automatizados",
        trial_days: 10,
        features: ["clients", "agenda", "basic_reports"],
        limits: { users: 3, clients: "", storage_mb: 500 }
      }
    });
    assert.equal(status, 201, JSON.stringify(json));
    assert.equal(json.plan.code, CODIGO);
    assert.equal(json.plan.price_cents, 4990);
    assert.equal(json.plan.trial_days, 10);
    assert.deepEqual(json.plan.features.sort(), ["agenda", "basic_reports", "clients"]);
    // Campo vazio = ILIMITADO, e ilimitado é a AUSÊNCIA da chave. Virar zero
    // bloquearia a clínica em tudo naquela cota.
    assert.equal(json.plan.limits.users, 3);
    assert.equal(json.plan.limits.storage_mb, 500);
    assert.ok(!("clients" in json.plan.limits));
    assert.equal(json.plan.is_active, true);
  });

  await t.test("o plano criado já vale para o resto do sistema, sem reiniciar", async () => {
    // /api/plans lê o registro em memória. Se o plano novo não estiver lá, a
    // criação não recarregou o registro e o gating segue com a grade antiga.
    const { json } = await req("/plans");
    assert.ok(json.plans.some((plano) => plano.code === CODIGO), "registro em memória não recarregou");
  });

  await t.test("recusa código fora do padrão", async () => {
    for (const code of ["QA Plano", "1plano", "com espaço", "a", "x".repeat(40), ""]) {
      const { status } = await req("/platform/plans", {
        ...plt,
        method: "POST",
        body: { code, name: "x", price_cents: 100 }
      });
      assert.equal(status, 400, `deveria recusar o código ${JSON.stringify(code)}`);
    }
  });

  await t.test("recusa código repetido", async () => {
    const { status, json } = await req("/platform/plans", {
      ...plt,
      method: "POST",
      body: { code: CODIGO, name: "Outro", price_cents: 100 }
    });
    assert.equal(status, 409, JSON.stringify(json));
  });

  await t.test("recusa feature inexistente DIZENDO qual é", async () => {
    // Ignorar em silêncio seria pior: o super-admin sairia da tela convencido de
    // ter liberado um recurso que não existe e não protege rota nenhuma.
    const { status, json } = await req("/platform/plans", {
      ...plt,
      method: "POST",
      body: { code: `${CODIGO}-2`, name: "x", price_cents: 100, features: ["clients", "voar_alto"] }
    });
    assert.equal(status, 400, JSON.stringify(json));
    assert.match(json.error, /voar_alto/);
    assert.deepEqual(json.features_invalidas, ["voar_alto"]);
  });

  await t.test("recusa limite inexistente e limite inválido", async () => {
    const desconhecido = await req("/platform/plans", {
      ...plt,
      method: "POST",
      body: { code: `${CODIGO}-3`, name: "x", price_cents: 100, limits: { galaxias: 4 } }
    });
    assert.equal(desconhecido.status, 400);
    assert.match(desconhecido.json.error, /galaxias/);

    const negativo = await req("/platform/plans", {
      ...plt,
      method: "POST",
      body: { code: `${CODIGO}-4`, name: "x", price_cents: 100, limits: { users: -1 } }
    });
    assert.equal(negativo.status, 400);
  });

  await t.test("recusa preço e teste grátis inválidos", async () => {
    // "69.90" em campo de CENTAVOS é erro de unidade: aceitar arredondando
    // cobraria R$ 0,69 de todo mundo.
    for (const price_cents of ["69.90", -1, 12.5, "abc", null]) {
      const { status } = await req("/platform/plans", {
        ...plt,
        method: "POST",
        body: { code: `${CODIGO}-p`, name: "x", price_cents }
      });
      assert.equal(status, 400, `deveria recusar price_cents=${JSON.stringify(price_cents)}`);
    }
    for (const trial_days of [-1, 91, 3.5]) {
      const { status } = await req("/platform/plans", {
        ...plt,
        method: "POST",
        body: { code: `${CODIGO}-t`, name: "x", price_cents: 100, trial_days }
      });
      assert.equal(status, 400, `deveria recusar trial_days=${trial_days}`);
    }
  });

  // -------------------------------------------------------------------------
  // Edição
  // -------------------------------------------------------------------------

  await t.test("edita features e o efeito é imediato no registro", async () => {
    const { status, json } = await req(`/platform/plans/${CODIGO}`, {
      ...plt,
      method: "PUT",
      body: { name: "Plano QA editado", features: ["clients", "agenda", "online_booking"] }
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.ok(json.plan.features.includes("online_booking"));

    const publico = await req("/plans");
    const plano = publico.json.plans.find((item) => item.code === CODIGO);
    // Este é o teste que importa: sem loadPlansFromDb() ao fim da escrita, a
    // clínica continuaria sem `online_booking` até o próximo boot.
    assert.ok(plano.features.includes("online_booking"), "o registro em memória não refletiu a edição");
    assert.equal(plano.name, "Plano QA editado");
  });

  await t.test("PUT parcial não apaga o que não veio", async () => {
    const antes = (await req("/platform/plans", plt)).json.plans.find((p) => p.code === CODIGO);
    await req(`/platform/plans/${CODIGO}`, { ...plt, method: "PUT", body: { audience: "Só o público" } });
    const depois = (await req("/platform/plans", plt)).json.plans.find((p) => p.code === CODIGO);
    assert.deepEqual(depois.features, antes.features);
    assert.deepEqual(depois.limits, antes.limits);
    assert.equal(depois.price_cents, antes.price_cents);
  });

  await t.test("não deixa trocar o código do plano", async () => {
    // O código é a FK das assinaturas: renomeá-lo deixaria clínicas apontando
    // para um plano inexistente.
    const { status } = await req(`/platform/plans/${CODIGO}`, {
      ...plt,
      method: "PUT",
      body: { code: "outro-codigo" }
    });
    assert.equal(status, 400);
  });

  await t.test("plano inexistente responde 404", async () => {
    assert.equal((await req("/platform/plans/nao-existe", { ...plt, method: "PUT", body: { name: "x" } })).status, 404);
    assert.equal((await req("/platform/plans/nao-existe/usage", plt)).status, 404);
    assert.equal((await req("/platform/plans/nao-existe", { ...plt, method: "DELETE" })).status, 404);
  });

  await t.test("sem assinante, mudar o preço não exige confirmação", async () => {
    const { status, json } = await req(`/platform/plans/${CODIGO}`, {
      ...plt,
      method: "PUT",
      body: { price_cents: 5990 }
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.plan.price_cents, 5990);
    assert.equal(json.propagacao.total, 0, "ninguém assina o plano, nada a propagar");
  });

  // -------------------------------------------------------------------------
  // Com assinante: preço, desativação e exclusão
  // -------------------------------------------------------------------------

  await t.test("plano com assinante: uso, preço e exclusão", async (sub) => {
    const clinica = await createTenant("plan");
    // A clínica nasce no plano padrão; muda para o plano de teste assinando-o.
    const assinatura = await req(`/platform/tenants/${clinica.tenant.id}/plan`, {
      ...plt,
      method: "PATCH",
      body: { plan_code: CODIGO }
    });

    sub.after(async () => {
      await deleteTenant(platformToken, clinica.tenant.id, clinica.slug);
    });

    if (assinatura.status !== 200) {
      // A rota de troca de plano é de outro arquivo; se ela mudar de forma, o
      // teste não deve mentir dizendo que passou.
      assert.fail(`não foi possível colocar a clínica no plano de teste: ${assinatura.status} ${JSON.stringify(assinatura.json)}`);
    }

    await sub.test("usage conta a clínica e desaconselha excluir", async () => {
      const { status, json } = await req(`/platform/plans/${CODIGO}/usage`, plt);
      assert.equal(status, 200, JSON.stringify(json));
      assert.ok(json.total >= 1);
      assert.equal(json.pode_excluir, false);
      assert.ok(json.clinicas.some((item) => item.slug === clinica.slug));
    });

    await sub.test("mudar o preço exige confirmação explícita", async () => {
      const { status, json } = await req(`/platform/plans/${CODIGO}`, {
        ...plt,
        method: "PUT",
        body: { price_cents: 19990 }
      });
      assert.equal(status, 409, JSON.stringify(json));
      assert.equal(json.code, "confirmacao_de_preco_necessaria");
      // A tela precisa dos números para montar o diálogo sem outra requisição.
      assert.ok(json.subscribers >= 1);
      assert.equal(json.price_cents_novo, 19990);

      const inalterado = (await req("/platform/plans", plt)).json.plans.find((p) => p.code === CODIGO);
      assert.equal(inalterado.price_cents, 5990, "o preço não pode mudar sem confirmação");
    });

    await sub.test("com confirmação, o preço muda e a propagação é relatada", async () => {
      const { status, json } = await req(`/platform/plans/${CODIGO}`, {
        ...plt,
        method: "PUT",
        body: { price_cents: 7990, confirm_price_change: true }
      });
      assert.equal(status, 200, JSON.stringify(json));
      assert.equal(json.plan.price_cents, 7990);
      // O super-admin precisa saber quantas assinaturas pegaram o valor novo.
      assert.ok(json.propagacao);
      assert.equal(typeof json.propagacao.atualizadas, "number");
      assert.equal(typeof json.propagacao.falhas, "number");
    });

    await sub.test("a propagação enxerga a assinatura que existe no gateway", async () => {
      await comBanco(
        "UPDATE platform.tenant_subscriptions SET asaas_subscription_id = $1 WHERE tenant_id = $2",
        [`sub_qa_${clinica.tenant.id}`, clinica.tenant.id]
      );
      const { status, json } = await req(`/platform/plans/${CODIGO}`, {
        ...plt,
        method: "PUT",
        body: { price_cents: 8990, confirm_price_change: true }
      });
      assert.equal(status, 200, JSON.stringify(json));
      assert.equal(json.propagacao.total, 1, "a assinatura ativa no gateway tem de entrar na conta");
      // Sem gateway configurado ela é "ignorada"; com gateway, "atualizada" ou
      // "falha" — nos três casos o total tem de fechar, senão o super-admin não
      // consegue saber quantas clínicas ficaram com o preço velho.
      assert.equal(
        json.propagacao.atualizadas + json.propagacao.falhas + json.propagacao.ignoradas,
        json.propagacao.total
      );
      // E o preço muda de qualquer forma: o banco é a fonte da verdade, e uma
      // falha no gateway não pode travar a edição do plano.
      assert.equal(json.plan.price_cents, 8990);

      await comBanco(
        "UPDATE platform.tenant_subscriptions SET asaas_subscription_id = NULL WHERE tenant_id = $1",
        [clinica.tenant.id]
      );
    });

    await sub.test("excluir plano com assinante é proibido, e o erro diz quantos", async () => {
      const { status, json } = await req(`/platform/plans/${CODIGO}`, { ...plt, method: "DELETE" });
      assert.equal(status, 409, JSON.stringify(json));
      assert.equal(json.code, "plano_com_assinantes");
      assert.match(json.error, /clínica/i);
      assert.match(json.error, /[Dd]esativ/, "o erro tem de sugerir a saída segura");

      // E o plano continua lá: perder o plano de uma clínica pagante seria pior
      // que recusar a exclusão.
      const ainda = (await req("/platform/plans", plt)).json.plans.find((p) => p.code === CODIGO);
      assert.ok(ainda);
    });

    await sub.test("desativar esconde da vitrine mas preserva quem assina", async () => {
      const { status, json } = await req(`/platform/plans/${CODIGO}/active`, {
        ...plt,
        method: "PATCH",
        body: { is_active: false }
      });
      assert.equal(status, 200, JSON.stringify(json));
      assert.equal(json.plan.is_active, false);
      assert.ok(json.uso.total >= 1, "quem assina continua contando");

      // O painel continua enxergando (senão não haveria como reativar) — e é
      // por aqui que se confirma o registro em memória, não pela vitrine.
      const noPainel = (await req("/platform/plans", plt)).json.plans.find((p) => p.code === CODIGO);
      assert.equal(noPainel.is_active, false);
      // O ponto que importa: desativar não pode tirar as features de quem já
      // paga por elas. O plano continua completo no registro.
      assert.ok(
        Array.isArray(noPainel.features) && noPainel.features.length > 0,
        "o plano perdeu as features e a clínica que o assina ficaria sem acesso"
      );

      // E some da VITRINE pública: é isso que dá sentido a desativar. Antes o
      // plano sumia do painel mas continuava sendo oferecido a quem chegava
      // pela landing, e alguém assinaria um plano tirado de linha.
      const naVitrine = (await req("/plans")).json.plans.find((p) => p.code === CODIGO);
      assert.equal(naVitrine, undefined, "plano desativado não pode aparecer na vitrine pública");

      await req(`/platform/plans/${CODIGO}/active`, { ...plt, method: "PATCH", body: { is_active: true } });
    });

    await sub.test("active exige um booleano de verdade", async () => {
      const { status } = await req(`/platform/plans/${CODIGO}/active`, { ...plt, method: "PATCH", body: {} });
      assert.equal(status, 400);
    });
  });

  await t.test("sem assinante, o plano pode ser excluído", async () => {
    // A clínica do bloco anterior já foi removida no after.
    const uso = await req(`/platform/plans/${CODIGO}/usage`, plt);
    assert.equal(uso.json.total, 0, JSON.stringify(uso.json));

    const { status, json } = await req(`/platform/plans/${CODIGO}`, { ...plt, method: "DELETE" });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal((await req(`/platform/plans/${CODIGO}/usage`, plt)).status, 404);
    // E some do registro em memória — senão continuaria concedendo features a
    // quem consultasse pelo código.
    assert.ok(!(await req("/plans")).json.plans.some((p) => p.code === CODIGO));
  });

  // -------------------------------------------------------------------------
  // Ordem da vitrine
  // -------------------------------------------------------------------------

  await t.test("reordena a vitrine", async () => {
    const invertida = [...ordemOriginal].reverse();
    const { status, json } = await req("/platform/plans/order", {
      ...plt,
      method: "PATCH",
      body: { codes: invertida }
    });
    assert.equal(status, 200, JSON.stringify(json));
    const aplicada = [...json.plans].sort((a, b) => a.sort_order - b.sort_order).map((p) => p.code);
    assert.deepEqual(aplicada, invertida);

    const publico = (await req("/plans")).json.plans.map((p) => p.code);
    assert.deepEqual(publico, invertida, "a vitrine pública tem de seguir a ordem do painel");
  });

  await t.test("recusa ordem incompleta ou com plano desconhecido", async () => {
    assert.equal(
      (await req("/platform/plans/order", { ...plt, method: "PATCH", body: { codes: [] } })).status,
      400
    );
    // Lista parcial deixaria os planos de fora intercalados em ordem antiga.
    const parcial = await req("/platform/plans/order", {
      ...plt,
      method: "PATCH",
      body: { codes: [ordemOriginal[0]] }
    });
    assert.equal(parcial.status, 400, JSON.stringify(parcial.json));
    assert.equal(
      (await req("/platform/plans/order", { ...plt, method: "PATCH", body: { codes: ["nao-existe"] } })).status,
      404
    );
    assert.equal(
      (await req("/platform/plans/order", {
        ...plt,
        method: "PATCH",
        body: { codes: [ordemOriginal[0], ordemOriginal[0]] }
      })).status,
      400
    );
  });
});
