// Poder do super-admin sobre a conta (services/accountAdmin.js + rotas) e
// aplicação das cotas de plano (services/planLimits.js).
//
// Duas metades, de propósito:
//
//   - As AÇÕES são testadas por HTTP contra o servidor da suíte, porque é assim
//     que elas acontecem de verdade (token de plataforma, auditoria, cache
//     invalidado no processo do servidor).
//   - As COTAS são testadas dos dois lados. Fora os plugins do Catalog Builder,
//     os planos de seed não possuem limites operacionais, então o arquivo cria
//     um plano temporário com limites e o aplica em DOIS registros: o deste processo,
//     por `loadPlansFromDb()`, para os testes que chamam o serviço direto; e o
//     do processo do SERVIDOR, pela rota do painel de planos, para os testes
//     que batem nas rotas guardadas por HTTP — que é como um limite passa a
//     valer na vida real.
//
// O que os testes de rota respondem, no fim, são duas perguntas: a criação para
// mesmo quando a cota estoura, e — a mais importante — plano sem limite
// operacional configurado continua criando tudo.
//
// O plano temporário nasce `is_active = false`: se este arquivo morrer no meio e
// a limpeza não rodar, ele ainda assim não aparece na vitrine nem no cadastro.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { query } from "../src/database/connection.js";
import { req, platformLogin, deleteTenant } from "./helpers.mjs";
import { PLAN_FEATURES, loadPlansFromDb } from "../src/services/plans.js";
import {
  checkLimit,
  invalidateUsageCache,
  measureTenantUsage,
  requireWithinLimit,
  tenantUsageReport
} from "../src/services/planLimits.js";
import { invalidateSubscriptionCache } from "../src/services/subscriptions.js";

const QUOTA_PLAN = "qa-cotas";
// Segundo plano de teste, com cota FOLGADA: é o único jeito de exercitar o
// cache de medição, que só é confiado abaixo de 90% do limite.
const SLACK_PLAN = "qa-cotas-folga";

// Cotas do plano de teste. `appointments_month` e `storage_mb` ficam de fora do
// objeto: chave ausente = ILIMITADO, que é o caso que precisa nunca bloquear.
const QUOTA_LIMITS = { users: 1, clients: 1, jewelry_items: 0 };

const ctx = {
  platformToken: null,
  account: null, // clínica das ações do super-admin
  quota: null, // clínica das cotas
  quotaProfessionalId: null,
  // Clínica de plano seed. O Profissional tem apenas a cota específica de
  // plugins do catálogo; ela prova que os guards operacionais não bloqueiam
  // criação de dados do dia a dia.
  free: null
};

async function novaClinica(prefixo, plano) {
  const sufixo = Math.floor(performance.now() * 1000) % 1000000;
  const slug = `${prefixo}-${sufixo}`;
  const email = `admin@${slug}.test`;
  const password = "SenhaForte123";
  const signup = await req("/signup", {
    method: "POST",
    body: { name: `Clinica ${slug}`, slug, admin_email: email, admin_password: password, plan_code: plano, legal_acceptances: { terms_of_use: 1, privacy_policy: 1 } }
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  return { slug, email, password, id: signup.json.tenant.id, token: signup.json.token };
}

function clinicApi(clinica) {
  return (path, opts = {}) => req(path, { token: clinica.token, tenant: clinica.slug, ...opts });
}

function platformApi(path, opts = {}) {
  return req(path, { token: ctx.platformToken, ...opts });
}

// Resposta de mentira no formato mínimo que os guards usam.
function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

before(async () => {
  ctx.platformToken = await platformLogin();
  ctx.account = await novaClinica("conta", "start");
  ctx.quota = await novaClinica("cota", "profissional");
  ctx.free = await novaClinica("livre", "profissional");

  // Três clientes ANTES de qualquer cota: é o estado "clínica que cresceu no
  // plano grande" que depois vai ser rebaixada.
  const api = clinicApi(ctx.quota);
  // Telefones distintos: a detecção de cliente duplicado casa por WhatsApp, e
  // três cadastros com o mesmo número passaram a ser recusados com 409.
  for (const [indice, nome] of ["Ana Cota", "Bruno Cota", "Carla Cota"].entries()) {
    const criado = await api("/clients", {
      method: "POST",
      body: { full_name: nome, whatsapp: `1199999000${indice}` }
    });
    assert.equal(criado.status, 201, JSON.stringify(criado.json));
  }
  // Profissional para o teste de agendamento sob cota. Profissional não é cota,
  // e este é criado antes de o limite valer de qualquer forma.
  const profissional = await api("/professionals", {
    method: "POST",
    body: { name: "Piercer Cota", specialty: "Body piercing" }
  });
  assert.equal(profissional.status, 201, JSON.stringify(profissional.json));
  ctx.quotaProfessionalId = profissional.json.id;

  await query(
    `INSERT INTO platform.subscription_plans
       (code, name, price_cents, audience, trial_days, features, is_recommended, limits, is_active, sort_order)
     VALUES ($1, 'QA Cotas', 1000, 'Plano de teste automatizado', 7, $2::jsonb, false, $3::jsonb, false, 9999)
     ON CONFLICT (code) DO UPDATE SET limits = excluded.limits, is_active = false`,
    [QUOTA_PLAN, JSON.stringify(PLAN_FEATURES.profissional), JSON.stringify(QUOTA_LIMITS)]
  );
  // Registro de planos DESTE processo (o do servidor só recarrega no boot).
  await loadPlansFromDb();

  // ...e o registro do SERVIDOR, que é quem responde às rotas guardadas. O PUT
  // do painel de planos é exatamente o caminho pelo qual um limite passa a valer
  // na vida real ("o sistema é inerte até alguém definir limites no painel"), e
  // é ele que chama loadPlansFromDb() lá dentro. Sem isto, os testes de cota via
  // HTTP passariam por acidente: o servidor nem saberia que o plano tem limite.
  const publicacao = await platformApi(`/platform/plans/${QUOTA_PLAN}`, {
    method: "PUT",
    body: { limits: QUOTA_LIMITS }
  });
  assert.equal(publicacao.status, 200, JSON.stringify(publicacao.json));

  // A troca pelo painel (e não por UPDATE direto) é o que invalida o cache de
  // assinatura DO SERVIDOR — sem ela o gating continuaria vendo o plano antigo
  // por até 30s.
  const troca = await platformApi(`/platform/accounts/${ctx.quota.id}/plan`, {
    method: "PATCH",
    body: { plan_code: QUOTA_PLAN, reason: "Suíte de cotas" }
  });
  assert.equal(troca.status, 200, JSON.stringify(troca.json));
  invalidateSubscriptionCache(ctx.quota.id);
  invalidateUsageCache(ctx.quota.id);
});

// Cada passo é isolado: um `after` que interrompe no primeiro erro deixa para
// trás clínica e plano de teste, e o FK entre eles derruba os ARQUIVOS SEGUINTES
// da suíte com falhas que não têm nada a ver com o que estão testando. Foi o que
// aconteceu em 04/08/2026 — cinco clínicas órfãs e o plano `qa-cotas` vivos no
// banco local produziram de 3 a 15 falhas variando por execução.
async function semQuebrar(rotulo, acao) {
  try {
    await acao();
  } catch (error) {
    console.warn(`[accountAdmin] limpeza de "${rotulo}" falhou: ${error.message}`);
  }
}

after(async () => {
  await semQuebrar("conta", () => ctx.account?.id && deleteTenant(ctx.platformToken, ctx.account.id, ctx.account.slug));
  await semQuebrar("clínica livre", () => ctx.free?.id && deleteTenant(ctx.platformToken, ctx.free.id, ctx.free.slug));
  // A clínica sai primeiro: a assinatura dela referencia o plano de teste por FK.
  await semQuebrar("clínica de cota", () => ctx.quota?.id && deleteTenant(ctx.platformToken, ctx.quota.id, ctx.quota.slug));
  // O plano de folga sai do banco ANTES do outro: a exclusão do `qa-cotas` pela
  // rota do painel recarrega o registro em memória do SERVIDOR, e é o que
  // garante que nenhum plano de teste sobreviva lá para o próximo arquivo.
  await semQuebrar("plano de folga", () => query("DELETE FROM platform.subscription_plans WHERE code = $1", [SLACK_PLAN]));
  await semQuebrar("plano de cota (painel)", () => platformApi(`/platform/plans/${QUOTA_PLAN}`, { method: "DELETE" }));
  // Varredura final: mata a assinatura que segura o plano por FK e só então o
  // plano. Sem isto, uma exclusão de clínica que falhou acima deixaria o plano
  // impossível de apagar, e ele contaminaria a próxima execução inteira.
  await semQuebrar("assinaturas do plano de cota", () =>
    query("DELETE FROM platform.tenant_subscriptions WHERE plan_code = $1", [QUOTA_PLAN])
  );
  await semQuebrar("plano de cota", () => query("DELETE FROM platform.subscription_plans WHERE code = $1", [QUOTA_PLAN]));
});

// ---------------------------------------------------------------------------
// Ações do super-admin
// ---------------------------------------------------------------------------

test("as rotas de conta exigem token de plataforma", async () => {
  const semToken = await req(`/platform/accounts/${ctx.account.id}`);
  assert.equal(semToken.status, 401);

  // Token de CLÍNICA não vale como token de plataforma.
  const comTokenDeClinica = await req(`/platform/accounts/${ctx.account.id}`, { token: ctx.account.token });
  assert.equal(comTokenDeClinica.status, 401);
});

test("visão da conta traz clínica, assinatura, plano, uso x cotas e faturas", async () => {
  const visao = await platformApi(`/platform/accounts/${ctx.account.id}`);
  assert.equal(visao.status, 200, JSON.stringify(visao.json));
  assert.equal(visao.json.tenant.id, ctx.account.id);
  assert.equal(visao.json.tenant.status, "ativo");
  assert.equal(visao.json.plan.code, "start");
  assert.equal(visao.json.subscription.status, "trial_active");
  assert.ok(Array.isArray(visao.json.invoices));

  // Uma linha por cota do catálogo; o Start expõe as cotas comerciais.
  const chaves = visao.json.usage.map((item) => item.key);
  assert.deepEqual(chaves, ["users", "clients", "appointments_month", "jewelry_items", "catalog_plugins", "storage_mb"]);
  assert.deepEqual(
    Object.fromEntries(visao.json.usage.map((item) => [item.key, item.limit])),
    { users: 1, clients: 300, appointments_month: 100, jewelry_items: 100, catalog_plugins: 0, storage_mb: 1024 }
  );
  assert.equal(visao.json.usage.find((item) => item.key === "users").used, 1);

  const inexistente = await platformApi("/platform/accounts/99999999");
  assert.equal(inexistente.status, 404);
});

test("troca de plano exige motivo e recusa plano inválido", async () => {
  const semMotivo = await platformApi(`/platform/accounts/${ctx.account.id}/plan`, {
    method: "PATCH",
    body: { plan_code: "profissional" }
  });
  assert.equal(semMotivo.status, 400, JSON.stringify(semMotivo.json));
  assert.equal(semMotivo.json.code, "motivo_obrigatorio");

  const planoRuim = await platformApi(`/platform/accounts/${ctx.account.id}/plan`, {
    method: "PATCH",
    body: { plan_code: "inexistente", reason: "teste" }
  });
  assert.equal(planoRuim.status, 400);
  assert.equal(planoRuim.json.code, "plano_invalido");
});

test("troca de plano vale na hora no gating e vai para a auditoria", async () => {
  const api = clinicApi(ctx.account);

  const antes = await api("/finance");
  assert.equal(antes.status, 403, JSON.stringify(antes.json));
  assert.equal(antes.json.code, "plan_upgrade_required");

  const troca = await platformApi(`/platform/accounts/${ctx.account.id}/plan`, {
    method: "PATCH",
    body: { plan_code: "profissional", reason: "Cliente pediu upgrade por telefone" }
  });
  assert.equal(troca.status, 200, JSON.stringify(troca.json));
  assert.equal(troca.json.plan_code, "profissional");
  // A troca NÃO ativa a assinatura: o trial continua sendo o que ele era.
  assert.equal(troca.json.subscription.status, "trial_active");

  // Sem esperar os 30s do cache de assinatura.
  const depois = await api("/finance");
  assert.equal(depois.status, 200, JSON.stringify(depois.json));

  const auditoria = await query(
    `SELECT action, actor_email, detail FROM platform.admin_audit
      WHERE target_type = 'tenant' AND target_id = $1 AND action = 'conta.plano_alterado'
      ORDER BY id DESC LIMIT 1`,
    [String(ctx.account.id)]
  );
  const registro = auditoria.rows[0];
  assert.ok(registro, "a troca de plano precisa estar registrada em platform.admin_audit");
  assert.equal(registro.detail.antes.plan_code, "start");
  assert.equal(registro.detail.depois.plan_code, "profissional");
  assert.equal(registro.detail.motivo, "Cliente pediu upgrade por telefone");
  assert.ok(registro.actor_email, "a auditoria precisa saber QUEM fez a troca");
});

test("suspender corta o acesso na hora; reativar devolve", async () => {
  const api = clinicApi(ctx.account);

  const suspensao = await platformApi(`/platform/accounts/${ctx.account.id}/suspend`, {
    method: "POST",
    body: { reason: "Chargeback em apuração" }
  });
  assert.equal(suspensao.status, 200, JSON.stringify(suspensao.json));
  assert.equal(suspensao.json.tenant.status, "suspenso");
  // Suspender é decisão de ACESSO; a cobrança no gateway não é tocada.
  assert.equal(suspensao.json.assinatura_no_gateway, "inalterada");

  // Cache de tenant é de 60s — se não fosse invalidado, isto ainda passaria.
  const bloqueado = await api("/clients");
  assert.equal(bloqueado.status, 403, JSON.stringify(bloqueado.json));
  assert.match(bloqueado.json.error, /suspensa/i);

  // O super-admin continua enxergando a conta suspensa (é onde ele conserta).
  const visao = await platformApi(`/platform/accounts/${ctx.account.id}`);
  assert.equal(visao.status, 200);
  assert.equal(visao.json.tenant.status, "suspenso");

  const volta = await platformApi(`/platform/accounts/${ctx.account.id}/reactivate`, {
    method: "POST",
    body: { reason: "Chargeback revertido" }
  });
  assert.equal(volta.status, 200, JSON.stringify(volta.json));
  const liberado = await api("/clients");
  assert.equal(liberado.status, 200, JSON.stringify(liberado.json));

  const auditoria = await query(
    `SELECT action FROM platform.admin_audit
      WHERE target_type = 'tenant' AND target_id = $1 AND action IN ('conta.suspensa', 'conta.reativada')`,
    [String(ctx.account.id)]
  );
  assert.equal(auditoria.rows.length, 2);
});

test("trial estendido empurra a data e destrava quem já tinha expirado", async () => {
  // Expira o trial na marra, que é o caso real de quem procura o suporte.
  await query(
    `UPDATE platform.tenant_subscriptions
        SET status = 'trial_expired', trial_ends_at = now() - INTERVAL '5 days'
      WHERE tenant_id = $1`,
    [ctx.account.id]
  );

  const extensao = await platformApi(`/platform/accounts/${ctx.account.id}/trial`, {
    method: "PATCH",
    body: { days: 10, reason: "Cliente ficou sem acesso durante a migração" }
  });
  assert.equal(extensao.status, 200, JSON.stringify(extensao.json));
  // Trial vencido volta a valer: estender prazo sem destravar o status não
  // liberaria nada.
  assert.equal(extensao.json.subscription.status, "trial_active");
  const fim = new Date(extensao.json.subscription.trial_ends_at).getTime();
  // Somou a partir de HOJE, e não sobre a data vencida (que daria 5 dias atrás).
  assert.ok(fim > Date.now() + 9 * 24 * 60 * 60 * 1000, `trial_ends_at ficou em ${extensao.json.subscription.trial_ends_at}`);

  const diasInvalidos = await platformApi(`/platform/accounts/${ctx.account.id}/trial`, {
    method: "PATCH",
    body: { days: 0, reason: "teste" }
  });
  assert.equal(diasInvalidos.status, 400);
  assert.equal(diasInvalidos.json.code, "dias_invalidos");
});

test("assinatura paga nunca é rebaixada para trial", async () => {
  const ativa = await platformApi(`/platform/accounts/${ctx.account.id}/subscription-status`, {
    method: "PATCH",
    body: { status: "active", reason: "Pagou por PIX fora do gateway" }
  });
  assert.equal(ativa.status, 200, JSON.stringify(ativa.json));
  assert.equal(ativa.json.subscription.status, "active");
  // Forçar 'active' com período vencido também empurra o vencimento.
  assert.ok(new Date(ativa.json.subscription.current_period_ends_at).getTime() > Date.now());

  const trial = await platformApi(`/platform/accounts/${ctx.account.id}/trial`, {
    method: "PATCH",
    body: { days: 5, mode: "restart", reason: "Engano do atendente" }
  });
  assert.equal(trial.status, 200, JSON.stringify(trial.json));
  assert.equal(trial.json.subscription.status, "active", "cliente pagante não pode virar trial");
});

test("forçar status inválido → 400; 'canceled' corta o gating e carimba a data", async () => {
  const invalido = await platformApi(`/platform/accounts/${ctx.account.id}/subscription-status`, {
    method: "PATCH",
    body: { status: "trial_active", reason: "teste" }
  });
  assert.equal(invalido.status, 400, JSON.stringify(invalido.json));
  assert.equal(invalido.json.code, "status_invalido");

  const cancelado = await platformApi(`/platform/accounts/${ctx.account.id}/subscription-status`, {
    method: "PATCH",
    body: { status: "canceled", reason: "Cliente encerrou o contrato" }
  });
  assert.equal(cancelado.status, 200, JSON.stringify(cancelado.json));
  assert.equal(cancelado.json.subscription.status, "canceled");
  assert.ok(cancelado.json.subscription.canceled_at);

  const gating = await clinicApi(ctx.account)("/finance");
  assert.equal(gating.status, 402, JSON.stringify(gating.json));
  assert.equal(gating.json.code, "subscription_inactive");
});

test("cancelar a assinatura preserva a clínica, mas bloqueia os módulos contratados", async () => {
  const cancelamento = await platformApi(`/platform/accounts/${ctx.account.id}/cancel-subscription`, {
    method: "POST",
    body: { reason: "Encerramento a pedido do cliente" }
  });
  assert.equal(cancelamento.status, 200, JSON.stringify(cancelamento.json));
  assert.equal(cancelamento.json.subscription.status, "canceled");
  // Sem assinatura no Asaas não há o que cancelar lá — e isso não é erro.
  assert.equal(cancelamento.json.gateway_canceled, false);
  assert.equal(cancelamento.json.gateway_error, null);

  const visao = await platformApi(`/platform/accounts/${ctx.account.id}`);
  assert.equal(visao.json.tenant.status, "ativo", "cancelar cobrança não pode suspender a conta");

  // A clínica continua cadastrada/ativa, mas a assinatura cancelada corta os
  // módulos contratados até a renovação. Suspender o tenant continua sendo uma
  // decisão administrativa distinta.
  const clientes = await clinicApi(ctx.account)("/clients");
  assert.equal(clientes.status, 402, JSON.stringify(clientes.json));
  assert.equal(clientes.json.code, "subscription_inactive");

  const auditoria = await query(
    `SELECT detail FROM platform.admin_audit
      WHERE target_type = 'tenant' AND target_id = $1 AND action = 'conta.assinatura_cancelada'
      ORDER BY id DESC LIMIT 1`,
    [String(ctx.account.id)]
  );
  assert.equal(auditoria.rows[0].detail.gateway_cancelado, false);
});

// ---------------------------------------------------------------------------
// Cotas
// ---------------------------------------------------------------------------

test("a medição conta o que existe no schema da clínica", async () => {
  invalidateUsageCache(ctx.quota.id);
  const uso = await measureTenantUsage(ctx.quota.id);
  assert.equal(uso.clients, 3);
  assert.equal(uso.users, 1);
  assert.equal(uso.jewelry_items, 0);
  assert.equal(typeof uso.appointments_month, "number");
  // storage_mb é aproximado, mas tem de ser um número (clínica vazia = 0).
  assert.equal(uso.storage_mb, 0);
});

test("cota ausente do plano (null) nunca bloqueia e nem mede", async () => {
  const resultado = await checkLimit(null, ctx.quota.id, "appointments_month");
  assert.equal(resultado.allowed, true);
  assert.equal(resultado.limit, null);
  assert.equal(resultado.used, null, "ilimitado não deve custar uma consulta ao schema da clínica");

  const semCota = await checkLimit(null, ctx.quota.id, "storage_mb");
  assert.equal(semCota.allowed, true);
  assert.equal(semCota.limit, null);
});

test("cota atingida → checkLimit nega e requireWithinLimit responde 409", async () => {
  // 3 clientes contra uma cota de 1.
  const clientes = await checkLimit(null, ctx.quota.id, "clients");
  assert.equal(clientes.allowed, false);
  assert.equal(clientes.used, 3);
  assert.equal(clientes.limit, 1);

  // Uso EXATAMENTE no teto também nega (1 usuário, cota 1).
  const usuarios = await checkLimit(null, ctx.quota.id, "users");
  assert.equal(usuarios.allowed, false);
  assert.equal(usuarios.used, 1);

  // Cota zero bloqueia mesmo com uso zero.
  const joias = await checkLimit(null, ctx.quota.id, "jewelry_items");
  assert.equal(joias.allowed, false);
  assert.equal(joias.used, 0);
  assert.equal(joias.limit, 0);

  const res = fakeRes();
  const liberado = await requireWithinLimit({ tenant: { id: ctx.quota.id } }, res, "clients");
  assert.equal(liberado, false);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "plan_limit_reached");
  assert.equal(res.body.limit, 1);
  assert.equal(res.body.used, 3);
  assert.match(res.body.error, /upgrade/i);
  // A mensagem precisa dizer que nada será removido — é a dúvida de quem lê.
  assert.match(res.body.error, /nada do que já existe será removido/i);
});

test("cota ilimitada passa pelo guard sem responder nada", async () => {
  const res = fakeRes();
  const liberado = await requireWithinLimit({ tenant: { id: ctx.quota.id } }, res, "appointments_month");
  assert.equal(liberado, true);
  assert.equal(res.statusCode, null, "guard liberado não pode ter escrito na resposta");
});

test("clínica ACIMA da cota continua lendo e editando o que já tem", async () => {
  const api = clinicApi(ctx.quota);

  // Continua enxergando os três clientes, e não só o primeiro.
  const lista = await api("/clients");
  assert.equal(lista.status, 200, JSON.stringify(lista.json));
  const itens = Array.isArray(lista.json) ? lista.json : lista.json.items;
  assert.equal(itens.length, 3, "cota NÃO pode esconder registro que já existe");

  // E continua editando.
  const alvo = itens[0];
  const edicao = await api(`/clients/${alvo.id}`, {
    method: "PATCH",
    body: { full_name: `${alvo.full_name} (editado)`, whatsapp: alvo.whatsapp, notes: "editado acima da cota" }
  });
  assert.equal(edicao.status, 200, JSON.stringify(edicao.json));
  assert.match(edicao.json.full_name, /editado/);

  // O relatório do painel avisa o excedente — sem apagar nem esconder nada.
  const relatorio = await tenantUsageReport(ctx.quota.id, QUOTA_PLAN);
  const linhaClientes = relatorio.find((item) => item.key === "clients");
  assert.equal(linhaClientes.over_limit, true);
  assert.equal(linhaClientes.used, 3);
  assert.equal(linhaClientes.limit, 1);
  const linhaAgenda = relatorio.find((item) => item.key === "appointments_month");
  assert.equal(linhaAgenda.unlimited, true);
  assert.equal(linhaAgenda.over_limit, false);
});

test("falha de medição LIBERA em vez de bloquear", async () => {
  const dbQuebrado = {
    async get() {
      throw new Error("banco fora do ar");
    }
  };
  const resultado = await checkLimit(dbQuebrado, ctx.quota.id, "clients");
  assert.equal(resultado.allowed, true, "bug de contagem nosso não pode trancar clínica pagante");
  assert.equal(resultado.used, null);
  assert.equal(resultado.limit, 1);

  const res = fakeRes();
  const liberado = await requireWithinLimit({ tenant: { id: ctx.quota.id } }, res, "clients", dbQuebrado);
  assert.equal(liberado, true);
  assert.equal(res.statusCode, null);
});

test("clínica sem assinatura não é bloqueada por cota nenhuma", async () => {
  const resultado = await checkLimit(null, 99999999, "clients");
  assert.equal(resultado.allowed, true);
  assert.equal(resultado.limit, null);
});

// ---------------------------------------------------------------------------
// Cotas nas rotas (guards ligados)
// ---------------------------------------------------------------------------

// As listagens respondem em página (`{ items, total }`) ou como array puro,
// conforme a query traga paginação ou não.
function itensDaLista(payload) {
  return Array.isArray(payload) ? payload : payload?.items || [];
}

function dataFutura(dias = 20) {
  const data = new Date();
  data.setDate(data.getDate() + dias);
  return data.toISOString().slice(0, 10);
}

// O TESTE MAIS IMPORTANTE DESTA ENTREGA.
//
// A cota de plugins do catálogo não pode afetar cadastros operacionais. Este
// teste percorre as quatro rotas guardadas num plano Profissional e exige 201.
test("cota de plugins não bloqueia as quatro rotas operacionais guardadas", async () => {
  const api = clinicApi(ctx.free);
  const sufixo = Math.floor(performance.now() * 1000) % 1000000;

  const usuario = await api("/users", {
    method: "POST",
    body: {
      name: "Recepção Livre",
      email: `recepcao-${sufixo}@${ctx.free.slug}.test`,
      password: "SenhaForte123",
      role: "reception"
    }
  });
  assert.equal(usuario.status, 201, JSON.stringify(usuario.json));

  const cliente = await api("/clients", {
    method: "POST",
    body: { full_name: "Cliente Livre", whatsapp: "11988880000" }
  });
  assert.equal(cliente.status, 201, JSON.stringify(cliente.json));

  const joia = await api("/jewelry", {
    method: "POST",
    body: { name: "Labret Livre QA", category: "Labret", material: "Titânio", color: "Prata", quantity: 5, sale_value: 70 }
  });
  assert.equal(joia.status, 201, JSON.stringify(joia.json));

  const profissional = await api("/professionals", {
    method: "POST",
    body: { name: "Piercer Livre", specialty: "Body piercing" }
  });
  assert.equal(profissional.status, 201, JSON.stringify(profissional.json));

  const agendamento = await api("/appointments", {
    method: "POST",
    body: {
      client_id: cliente.json.id,
      full_name: "Cliente Livre",
      whatsapp: "11988880000",
      professional_id: profissional.json.id,
      procedure: "Aplicação QA",
      piercing_region: "Orelha",
      appointment_date: dataFutura(),
      appointment_time: "10:00",
      total_value: 120
    }
  });
  assert.equal(agendamento.status, 201, JSON.stringify(agendamento.json));

  // Clientes e agenda permanecem livres no Profissional; equipe, estoque,
  // integrações e armazenamento seguem as cotas comerciais do plano.
  const relatorio = await tenantUsageReport(ctx.free.id, "profissional");
  assert.equal(relatorio.find((linha) => linha.key === "clients")?.unlimited, true);
  assert.equal(relatorio.find((linha) => linha.key === "appointments_month")?.unlimited, true);
  assert.equal(relatorio.find((linha) => linha.key === "users")?.limit, 3);
  assert.equal(relatorio.find((linha) => linha.key === "jewelry_items")?.limit, 500);
  assert.equal(relatorio.find((linha) => linha.key === "storage_mb")?.limit, 5120);
  assert.equal(relatorio.find((linha) => linha.key === "catalog_plugins")?.limit, 3);
});

test("com cota estourada, as rotas de criação param — e a mensagem diz o que fazer", async () => {
  const api = clinicApi(ctx.quota);
  const sufixo = Math.floor(performance.now() * 1000) % 1000000;

  const cliente = await api("/clients", {
    method: "POST",
    body: { full_name: "Cliente Excedente", whatsapp: "11977770000" }
  });
  assert.equal(cliente.status, 409, JSON.stringify(cliente.json));
  assert.equal(cliente.json.code, "plan_limit_reached");
  assert.equal(cliente.json.limit_key, "clients");
  assert.equal(cliente.json.limit, 1);
  assert.equal(cliente.json.used, 3);
  // Em português, dizendo QUAL limite acabou e o que fazer.
  assert.match(cliente.json.error, /limite de clientes cadastrados/i);
  assert.match(cliente.json.error, /administrador da clínica/i);
  assert.match(cliente.json.error, /upgrade/i);
  assert.match(cliente.json.error, /nada do que já existe será removido/i);
  // E sem vazar detalhe técnico (nome de coluna, código interno do plano, SQL).
  assert.doesNotMatch(cliente.json.error, /select|jewelry_inventory|plan_limit_reached|qa-cotas/i);

  const usuario = await api("/users", {
    method: "POST",
    body: { name: "Extra", email: `extra-${sufixo}@${ctx.quota.slug}.test`, password: "SenhaForte123", role: "reception" }
  });
  assert.equal(usuario.status, 409, JSON.stringify(usuario.json));
  assert.equal(usuario.json.limit_key, "users");

  const joia = await api("/jewelry", {
    method: "POST",
    body: { name: "Labret Excedente", category: "Labret", quantity: 1, sale_value: 50 }
  });
  assert.equal(joia.status, 409, JSON.stringify(joia.json));
  assert.equal(joia.json.limit_key, "jewelry_items");

  // 409 é recusa, não gravação parcial: nada entrou.
  const clientes = await api("/clients");
  assert.equal(itensDaLista(clientes.json).length, 3);
  const joias = await api("/jewelry");
  assert.equal(itensDaLista(joias.json).length, 0);
});

test("cota ausente do plano não trava a rota guardada: o agendamento segue criando", async () => {
  const api = clinicApi(ctx.quota);
  // `appointments_month` não está no QUOTA_LIMITS = ilimitado. A rota guardada
  // precisa continuar criando mesmo na clínica que já estourou outras cotas.
  const lista = await api("/clients");
  const clienteExistente = itensDaLista(lista.json)[0];

  const agendamento = await api("/appointments", {
    method: "POST",
    body: {
      client_id: clienteExistente.id,
      full_name: clienteExistente.full_name,
      whatsapp: clienteExistente.whatsapp,
      professional_id: ctx.quotaProfessionalId,
      procedure: "Aplicação sob cota",
      piercing_region: "Orelha",
      appointment_date: dataFutura(25),
      appointment_time: "11:00",
      total_value: 100
    }
  });
  assert.equal(agendamento.status, 201, JSON.stringify(agendamento.json));
});

// O gancho que as operações em massa (importação de joias, exclusão) chamam.
// Sem ele, um uso em massa deixaria a medição velha valendo por 15s — que é
// pouco, mas é justamente o que uma importação de centenas de joias produz.
//
// É um teste em processo: a rota HTTP invalidaria o cache do processo do
// SERVIDOR, que não é o mesmo deste arquivo. O que se verifica aqui é o
// contrato do serviço — confia no cache com folga, remede perto do teto, e
// esquece tudo quando alguém avisa que houve escrita em massa.
test("invalidateUsageCache descarta a medição; perto do teto o cache nem é usado", async () => {
  // Plano com FOLGA (100 clientes): só assim o cache chega a ser confiado — a
  // regra é ignorá-lo acima de 90% da cota.
  await query(
    `INSERT INTO platform.subscription_plans
       (code, name, price_cents, audience, trial_days, features, is_recommended, limits, is_active, sort_order)
     VALUES ($1, 'QA Cotas com folga', 1000, 'Plano de teste automatizado', 7, $2::jsonb, false, $3::jsonb, false, 9999)
     ON CONFLICT (code) DO UPDATE SET limits = excluded.limits, is_active = false`,
    [SLACK_PLAN, JSON.stringify(PLAN_FEATURES.profissional), JSON.stringify({ clients: 100 })]
  );
  await loadPlansFromDb();
  await query("UPDATE platform.tenant_subscriptions SET plan_code = $1 WHERE tenant_id = $2", [
    SLACK_PLAN,
    ctx.free.id
  ]);
  invalidateSubscriptionCache(ctx.free.id);
  invalidateUsageCache(ctx.free.id);

  // db de mentira que "conta" o número que eu mandar: é o jeito de saber se a
  // resposta veio do cache ou de uma medição nova.
  const contando = (total) => ({ async get() { return { total }; } });

  const primeira = await checkLimit(contando(5), ctx.free.id, "clients");
  assert.equal(primeira.used, 5);
  assert.equal(primeira.limit, 100);

  const doCache = await checkLimit(contando(60), ctx.free.id, "clients");
  assert.equal(doCache.used, 5, "com folga, uma medição de segundos atrás vale");

  invalidateUsageCache(ctx.free.id);
  const remedida = await checkLimit(contando(60), ctx.free.id, "clients");
  assert.equal(remedida.used, 60, "depois do uso em massa a medição precisa ser refeita");

  // Perto do teto (95 de 100) o cache deixa de ser confiado sozinho.
  invalidateUsageCache(ctx.free.id);
  await checkLimit(contando(95), ctx.free.id, "clients");
  const perigosa = await checkLimit(contando(200), ctx.free.id, "clients");
  assert.equal(perigosa.used, 200, "acima de 90% da cota a contagem é sempre fresca");
  assert.equal(perigosa.allowed, false);
});
