// Poder do super-admin sobre a conta (services/accountAdmin.js + rotas) e
// aplicação das cotas de plano (services/planLimits.js).
//
// Duas metades, de propósito:
//
//   - As AÇÕES são testadas por HTTP contra o servidor da suíte, porque é assim
//     que elas acontecem de verdade (token de plataforma, auditoria, cache
//     invalidado no processo do servidor).
//   - As COTAS são testadas em processo, chamando o serviço. Não existe plano
//     com limite configurado no seed — todo `limits` é `{}` — e o registro de
//     planos do servidor só é recarregado no boot. Para exercitar cota de
//     verdade, o teste cria um plano temporário com limites, recarrega o
//     registro DESTE processo e mede contra o schema real da clínica.
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

// Cotas do plano de teste. `appointments_month` e `storage_mb` ficam de fora do
// objeto: chave ausente = ILIMITADO, que é o caso que precisa nunca bloquear.
const QUOTA_LIMITS = { users: 1, clients: 1, jewelry_items: 0 };

const ctx = {
  platformToken: null,
  account: null, // clínica das ações do super-admin
  quota: null // clínica das cotas
};

async function novaClinica(prefixo, plano) {
  const sufixo = Math.floor(performance.now() * 1000) % 1000000;
  const slug = `${prefixo}-${sufixo}`;
  const email = `admin@${slug}.test`;
  const password = "SenhaForte123";
  const signup = await req("/signup", {
    method: "POST",
    body: { name: `Clinica ${slug}`, slug, admin_email: email, admin_password: password, plan_code: plano }
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
  ctx.account = await novaClinica("conta", "essencial");
  ctx.quota = await novaClinica("cota", "profissional");

  // Três clientes ANTES de qualquer cota: é o estado "clínica que cresceu no
  // plano grande" que depois vai ser rebaixada.
  const api = clinicApi(ctx.quota);
  for (const nome of ["Ana Cota", "Bruno Cota", "Carla Cota"]) {
    const criado = await api("/clients", {
      method: "POST",
      body: { full_name: nome, whatsapp: "11999990000" }
    });
    assert.equal(criado.status, 201, JSON.stringify(criado.json));
  }

  await query(
    `INSERT INTO platform.subscription_plans
       (code, name, price_cents, audience, trial_days, features, is_recommended, limits, is_active, sort_order)
     VALUES ($1, 'QA Cotas', 1000, 'Plano de teste automatizado', 7, $2::jsonb, false, $3::jsonb, false, 9999)
     ON CONFLICT (code) DO UPDATE SET limits = excluded.limits, is_active = false`,
    [QUOTA_PLAN, JSON.stringify(PLAN_FEATURES.profissional), JSON.stringify(QUOTA_LIMITS)]
  );
  // Registro de planos DESTE processo (o do servidor só recarrega no boot).
  await loadPlansFromDb();
  await query("UPDATE platform.tenant_subscriptions SET plan_code = $1 WHERE tenant_id = $2", [
    QUOTA_PLAN,
    ctx.quota.id
  ]);
  invalidateSubscriptionCache(ctx.quota.id);
  invalidateUsageCache(ctx.quota.id);
});

after(async () => {
  if (ctx.account?.id) await deleteTenant(ctx.platformToken, ctx.account.id, ctx.account.slug);
  // A clínica sai primeiro: a assinatura dela referencia o plano de teste por FK.
  if (ctx.quota?.id) await deleteTenant(ctx.platformToken, ctx.quota.id, ctx.quota.slug);
  await query("DELETE FROM platform.subscription_plans WHERE code = $1", [QUOTA_PLAN]);
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
  assert.equal(visao.json.plan.code, "essencial");
  assert.equal(visao.json.subscription.status, "trial_active");
  assert.ok(Array.isArray(visao.json.invoices));

  // Uma linha por cota do catálogo, todas ilimitadas nos planos de seed.
  const chaves = visao.json.usage.map((item) => item.key);
  assert.deepEqual(chaves, ["users", "clients", "appointments_month", "jewelry_items", "storage_mb"]);
  assert.ok(visao.json.usage.every((item) => item.unlimited === true));
  // Ilimitado não impede medir: a tela precisa mostrar o número mesmo assim.
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
  assert.equal(registro.detail.antes.plan_code, "essencial");
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

test("cancelar a assinatura não derruba a clínica (são decisões diferentes)", async () => {
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

  // E a clínica continua entrando e vendo o que tem.
  const clientes = await clinicApi(ctx.account)("/clients");
  assert.equal(clientes.status, 200, JSON.stringify(clientes.json));

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
