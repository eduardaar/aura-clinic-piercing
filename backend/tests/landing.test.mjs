// Conteúdo editável da landing.
//
// O foco é o que dói se der errado: a página pública é a porta de entrada de
// quem vai assinar, e o editor escreve direto no que todo visitante enxerga.
// Por isso os testes cobrem principalmente autorização e o que NÃO pode entrar.
import test from "node:test";
import assert from "node:assert/strict";
import { req, platformLogin, createTenant, loginTenant, deleteTenant } from "./helpers.mjs";

const KEYS = ["hero", "features", "about", "carousel", "plans", "showcase_links", "closing"];

test("Landing: conteúdo público e editor da plataforma", async (t) => {
  const platformToken = await platformLogin();
  const plt = { token: platformToken, platform: true };

  // Guarda o estado inicial para devolver tudo como estava no fim.
  const inicial = await req("/platform/landing", plt);
  assert.equal(inicial.status, 200, JSON.stringify(inicial.json));
  const original = inicial.json.sections;

  t.after(async () => {
    for (const s of original) {
      await req(`/platform/landing/sections/${s.section_key}`, {
        ...plt,
        method: "PUT",
        body: { content: s.content, enabled: s.enabled }
      });
    }
    await req("/platform/landing/order", {
      ...plt,
      method: "PATCH",
      body: { keys: [...original].sort((a, b) => a.sort_order - b.sort_order).map((s) => s.section_key) }
    });
  });

  // -------------------------------------------------------------------------
  // Leitura pública
  // -------------------------------------------------------------------------

  await t.test("a rota pública dispensa sessão e vem ordenada", async () => {
    const { status, json } = await req("/landing");
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.sections));
    const ordem = json.sections.map((s) => s.sort_order);
    assert.deepEqual(ordem, [...ordem].sort((a, b) => a - b), "deve vir ordenada pelo servidor");
  });

  await t.test("a rota pública só devolve bloco ligado", async () => {
    const { json } = await req("/landing");
    assert.ok(json.sections.every((s) => s.enabled), "bloco desligado não pode vazar para a página");
    // O carrossel nasce desligado de propósito: ele não existe na página hoje e
    // ligá-lo sozinho num deploy mudaria a landing sem ninguém ter pedido.
    assert.ok(!json.sections.some((s) => s.section_key === "carousel"));
  });

  await t.test("a semente tem os seis blocos, com o conteúdo de hoje", async () => {
    const chaves = original.map((s) => s.section_key).sort();
    assert.deepEqual(chaves, [...KEYS].sort());
    const hero = original.find((s) => s.section_key === "hero");
    assert.equal(hero.content.title, "Gestão premium para quem vive da perfuração.");
    const features = original.find((s) => s.section_key === "features");
    assert.equal(features.content.items.length, 4);
  });

  // -------------------------------------------------------------------------
  // Autorização
  // -------------------------------------------------------------------------

  await t.test("o editor exige token de plataforma", async () => {
    assert.equal((await req("/platform/landing")).status, 401);
    assert.equal(
      (await req("/platform/landing/sections/hero", { method: "PUT", body: { content: {} } })).status,
      401
    );
    assert.equal(
      (await req("/platform/landing/order", { method: "PATCH", body: { keys: KEYS } })).status,
      401
    );
  });

  await t.test("admin de clínica não edita a landing da plataforma", async () => {
    // O token de clínica e o de plataforma são domínios de segurança distintos:
    // uma clínica não pode reescrever a página de marketing de todo mundo.
    const clinic = await createTenant("land");
    const { token } = await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword);
    const { status } = await req("/platform/landing", { token, tenant: clinic.slug });
    assert.equal(status, 401);
    await deleteTenant(platformToken, clinic.tenant.id, clinic.slug);
  });

  // -------------------------------------------------------------------------
  // Escrita
  // -------------------------------------------------------------------------

  await t.test("edita um bloco e o efeito aparece na página pública", async () => {
    const salvo = await req("/platform/landing/sections/hero", {
      ...plt,
      method: "PUT",
      body: { content: { ...original.find((s) => s.section_key === "hero").content, title: "Título de teste" } }
    });
    assert.equal(salvo.status, 200, JSON.stringify(salvo.json));
    assert.equal(salvo.json.content.title, "Título de teste");

    const publico = await req("/landing");
    const hero = publico.json.sections.find((s) => s.section_key === "hero");
    // Se isto falhar, o cache não está sendo invalidado na escrita e o
    // super-admin editaria sem ver o resultado.
    assert.equal(hero.content.title, "Título de teste");
  });

  await t.test("desligar um bloco o remove da página pública", async () => {
    await req("/platform/landing/sections/showcase_links", {
      ...plt,
      method: "PUT",
      body: { enabled: false }
    });
    const publico = await req("/landing");
    assert.ok(!publico.json.sections.some((s) => s.section_key === "showcase_links"));

    // E o painel continua enxergando, senão não haveria como religar.
    const painel = await req("/platform/landing", plt);
    const bloco = painel.json.sections.find((s) => s.section_key === "showcase_links");
    assert.equal(bloco.enabled, false);
  });

  await t.test("salvar só o interruptor não apaga o conteúdo", async () => {
    // A tela salva um bloco por vez; um PUT parcial não pode zerar o resto.
    const antes = (await req("/platform/landing", plt)).json.sections.find((s) => s.section_key === "closing");
    await req("/platform/landing/sections/closing", { ...plt, method: "PUT", body: { enabled: true } });
    const depois = (await req("/platform/landing", plt)).json.sections.find((s) => s.section_key === "closing");
    assert.deepEqual(depois.content, antes.content);
  });

  await t.test("reordena", async () => {
    const nova = ["closing", "hero", "features", "about", "carousel", "plans", "showcase_links"];
    const { status, json } = await req("/platform/landing/order", {
      ...plt,
      method: "PATCH",
      body: { keys: nova }
    });
    assert.equal(status, 200, JSON.stringify(json));
    const ordenado = [...json.sections].sort((a, b) => a.sort_order - b.sort_order).map((s) => s.section_key);
    assert.deepEqual(ordenado, nova);
  });

  // -------------------------------------------------------------------------
  // O que NÃO pode entrar
  // -------------------------------------------------------------------------

  await t.test("recusa endereço javascript: (XSS armazenado)", async () => {
    // Esse valor iria para o href de um <a> na página pública: seria XSS
    // disparado em todo visitante da landing.
    const { status, json } = await req("/platform/landing/sections/hero", {
      ...plt,
      method: "PUT",
      body: { content: { title: "x", primary_href: "javascript:alert(1)" } }
    });
    assert.equal(status, 400, JSON.stringify(json));
    assert.match(json.error, /não permitido/i);
  });

  await t.test("recusa javascript: escondido dentro de lista", async () => {
    const { status } = await req("/platform/landing/sections/features", {
      ...plt,
      method: "PUT",
      body: { content: { title: "x", items: [{ title: "a", image: "  JavaScript:alert(1)" }] } }
    });
    // Precisa varrer objetos e arrays aninhados, não só o primeiro nível — e
    // ignorar espaço e caixa, que é como o filtro ingênuo costuma ser burlado.
    assert.equal(status, 400);
  });

  await t.test("recusa bloco desconhecido", async () => {
    const { status } = await req("/platform/landing/sections/inventado", {
      ...plt,
      method: "PUT",
      body: { content: { title: "x" } }
    });
    assert.equal(status, 404);
  });

  await t.test("recusa reordenação inválida", async () => {
    assert.equal(
      (await req("/platform/landing/order", { ...plt, method: "PATCH", body: { keys: [] } })).status,
      400
    );
    assert.equal(
      (await req("/platform/landing/order", { ...plt, method: "PATCH", body: { keys: ["hero", "hero"] } })).status,
      400
    );
    assert.equal(
      (await req("/platform/landing/order", { ...plt, method: "PATCH", body: { keys: ["nao_existe"] } })).status,
      404
    );
  });

  await t.test("recusa conteúdo grande demais", async () => {
    // Guarda contra imagem colada em base64 no campo de texto: entraria no
    // banco e seria servida a cada visita da landing.
    const { status } = await req("/platform/landing/sections/hero", {
      ...plt,
      method: "PUT",
      body: { content: { title: "x".repeat(70 * 1024) } }
    });
    assert.equal(status, 400);
  });

  // -------------------------------------------------------------------------
  // Upload de imagem
  // -------------------------------------------------------------------------

  await t.test("upload de imagem exige token de plataforma", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("x")], { type: "image/png" }), "a.png");
    const { status } = await req("/platform/landing/uploads", { method: "POST", body: form });
    assert.equal(status, 401);
  });

  await t.test("aceita imagem e devolve URL servível", async () => {
    // PNG mínimo de 1x1 — o multer filtra por tipo, então precisa ser real.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const form = new FormData();
    form.append("file", new Blob([png], { type: "image/png" }), "landing.png");
    const { status, json } = await req("/platform/landing/uploads", { ...plt, method: "POST", body: form });
    assert.equal(status, 201, JSON.stringify(json));
    // Dois formatos válidos, um por modo de armazenamento: em disco, caminho sob
    // /uploads sem componente de diretório (é o que impede apontar para fora da
    // pasta servida); em R2, a URL absoluta do CDN. A suíte roda em modo disco.
    assert.match(json.url, /^(?:\/uploads\/[^/]+|https:\/\/[^/]+\/.+)$/);
  });

  await t.test("recusa arquivo que não é imagem", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("#!/bin/sh\nrm -rf /")], { type: "text/x-sh" }), "x.sh");
    const { status } = await req("/platform/landing/uploads", { ...plt, method: "POST", body: form });
    assert.notEqual(status, 201);
  });

  await t.test("recusa conteúdo que não é objeto", async () => {
    const { status } = await req("/platform/landing/sections/hero", {
      ...plt,
      method: "PUT",
      body: { content: "só um texto" }
    });
    assert.equal(status, 400);
  });
});
