// Propagação do plano para a assinatura recorrente no Asaas (pendência 19).
//
// O que dói se der errado é sempre a mesma coisa: a clínica muda de plano, o
// acesso muda na hora e a COBRANÇA não — uma clínica promovida continua pagando
// o plano barato até alguém conferir a fatura.
//
// Duas metades, pelo mesmo motivo de accountAdmin.test.mjs:
//
//   - O caminho de SUCESSO é testado EM PROCESSO, com um cliente do Asaas de
//     mentira injetado no serviço. O servidor da suíte sobe sem `ASAAS_API_KEY`
//     (é o que a pendência 24 registra), então por HTTP só dá para exercitar o
//     caminho de gateway indisponível — e é justamente o sucesso que precisa
//     ser provado aqui: que o valor certo, em REAIS, chega à assinatura certa.
//   - As ROTAS são testadas por HTTP, porque autorização e formato da resposta
//     são o contrato que a tela do super-admin consome.
//
// Nenhuma chamada real ao gateway acontece em lugar nenhum deste arquivo.
import test from "node:test";
import assert from "node:assert/strict";
import { query } from "../src/database/connection.js";
import { req, platformLogin, createTenant, deleteTenant } from "./helpers.mjs";
import { planByCode } from "../src/services/plans.js";
import { changeAccountPlan, resyncAccountSubscription } from "../src/services/accountAdmin.js";
import { AsaasError } from "../src/services/asaas/client.js";

// Ator da auditoria. `id: null` porque o super-admin real vem do token; o que
// importa aqui é a linha existir com o detalhe do gateway dentro.
const ATOR = { id: null, email: "qa-sync@aura.local" };

/**
 * Cliente do Asaas de mentira, no formato mínimo que a propagação usa.
 *
 * @param {{ valorRemoto?: number|null, lerFalha?: boolean, escreverFalha?: Error }} opcoes
 *   `valorRemoto` é o valor que a assinatura tem HOJE no gateway — é ele que
 *   decide entre "já sincronizado" e "atualizado". O objeto guarda as chamadas
 *   recebidas: sem isso não dá para afirmar que a escrita NÃO aconteceu, que é
 *   metade do que faz esta operação ser idempotente.
 */
function gatewayFalso({ valorRemoto = null, lerFalha = false, escreverFalha = null } = {}) {
  const chamadas = { get: [], update: [] };
  let valor = valorRemoto;
  return {
    chamadas,
    get valorAtual() {
      return valor;
    },
    async getSubscription(id) {
      chamadas.get.push(id);
      if (lerFalha) throw new AsaasError("[platform] gateway fora do ar na leitura", { status: 503 });
      return { id, value: valor };
    },
    async updateSubscription(id, body) {
      chamadas.update.push({ id, ...body });
      if (escreverFalha) throw escreverFalha;
      valor = body.value;
      return { id, value: body.value };
    }
  };
}

async function assinaturaDoBanco(tenantId) {
  const result = await query(
    `SELECT s.plan_code, s.status, s.asaas_subscription_id, t.plan AS tenant_plan
       FROM platform.tenant_subscriptions s
       JOIN platform.tenants t ON t.id = s.tenant_id
      WHERE s.tenant_id = $1`,
    [tenantId]
  );
  return result.rows[0];
}

async function ultimaAuditoria(tenantId, action) {
  const result = await query(
    `SELECT detail FROM platform.admin_audit
      WHERE target_type = 'tenant' AND target_id = $1 AND action = $2
      ORDER BY id DESC LIMIT 1`,
    [String(tenantId), action]
  );
  return result.rows[0]?.detail || null;
}

test("Assinatura: o plano novo chega à recorrência do Asaas", async (t) => {
  const platformToken = await platformLogin();
  const clinica = await createTenant("sync");
  const tenantId = clinica.tenant.id;
  const idNoGateway = `sub_qa_${tenantId}`;

  t.after(async () => {
    await deleteTenant(platformToken, tenantId, clinica.slug);
  });

  // Nenhuma rota grava `asaas_subscription_id` sem um gateway de verdade do
  // outro lado — é o mesmo motivo pelo qual planAdmin.test.mjs escreve direto no
  // banco para poder testar a propagação de preço.
  await query("UPDATE platform.tenant_subscriptions SET asaas_subscription_id = $1 WHERE tenant_id = $2", [
    idNoGateway,
    tenantId
  ]);

  const profissional = planByCode("profissional");
  const studio = planByCode("studio");

  await t.test("troca de plano reajusta a assinatura — em REAIS, com as pendentes junto", async () => {
    const gateway = gatewayFalso({ valorRemoto: profissional.price_cents / 100 });

    const resultado = await changeAccountPlan(tenantId, {
      planCode: "studio",
      reason: "Upgrade contratado por telefone",
      actor: ATOR,
      gateway
    });

    assert.equal(resultado.plan_code, "studio");
    assert.equal(resultado.gateway.status, "atualizado");
    // O erro clássico da integração: mandar centavos. 14990 viraria R$ 14.990.
    assert.equal(resultado.gateway.valor_no_gateway, studio.price_cents / 100);
    assert.equal(resultado.gateway.valor_anterior, profissional.price_cents / 100);
    // Sucesso NÃO vira aviso vermelho: o que aconteceu vai em `detalhe`.
    assert.equal(resultado.warning, null);
    assert.match(resultado.gateway.detalhe, /reajustada/i);

    assert.equal(gateway.chamadas.update.length, 1, "uma única escrita no gateway");
    const escrita = gateway.chamadas.update[0];
    assert.equal(escrita.id, idNoGateway, "a assinatura reajustada tem de ser a DESTA clínica");
    assert.equal(escrita.value, studio.price_cents / 100);
    // Sem isto, a fatura já emitida do mês continua com o preço velho.
    assert.equal(escrita.updatePendingPayments, true);

    const linha = await assinaturaDoBanco(tenantId);
    assert.equal(linha.plan_code, "studio");
    assert.equal(linha.tenant_plan, "studio", "as duas colunas de plano contam a mesma história");

    const auditoria = await ultimaAuditoria(tenantId, "conta.plano_propagado_no_gateway");
    assert.ok(auditoria, "a tentativa de propagação precisa estar na auditoria");
    assert.equal(auditoria.gateway.status, "atualizado");
    assert.equal(auditoria.de, "profissional");
    assert.equal(auditoria.para, "studio");
  });

  await t.test("reenviar o ajuste é idempotente: a segunda chamada não escreve nada", async () => {
    // O gateway já está no valor certo depois do teste anterior.
    const gateway = gatewayFalso({ valorRemoto: studio.price_cents / 100 });

    const primeiro = await resyncAccountSubscription(tenantId, { actor: ATOR, gateway });
    assert.equal(primeiro.gateway.status, "ja_sincronizado");
    assert.equal(primeiro.warning, null);
    assert.equal(
      gateway.chamadas.update.length,
      0,
      "reenviar o que já está certo não pode gerar escrita (nem cobrança) no gateway"
    );

    const segundo = await resyncAccountSubscription(tenantId, { actor: ATOR, gateway });
    assert.equal(segundo.gateway.status, "ja_sincronizado");
    assert.equal(gateway.chamadas.update.length, 0);

    const auditoria = await ultimaAuditoria(tenantId, "conta.assinatura_ressincronizada");
    assert.ok(auditoria, "o reprocesso também vai para a auditoria");
    assert.equal(auditoria.gateway.status, "ja_sincronizado");
  });

  await t.test("leitura que falha não impede o reajuste", async () => {
    // A leitura é conveniência (é dela que sai o "de X para Y"); quem resolve o
    // problema é a escrita. Perder o GET não pode deixar a clínica cobrada
    // errado.
    const gateway = gatewayFalso({ valorRemoto: studio.price_cents / 100, lerFalha: true });

    const resultado = await changeAccountPlan(tenantId, {
      planCode: "profissional",
      reason: "Downgrade a pedido da clínica",
      actor: ATOR,
      gateway
    });

    assert.equal(resultado.gateway.status, "atualizado");
    assert.equal(resultado.gateway.valor_anterior, null, "sem leitura, não há 'valor anterior' a afirmar");
    assert.equal(gateway.chamadas.update.length, 1);
    assert.equal(gateway.chamadas.update[0].value, profissional.price_cents / 100);
  });

  await t.test("falha do gateway NÃO desfaz a troca, e o aviso diz o que fazer", async () => {
    const gateway = gatewayFalso({
      valorRemoto: profissional.price_cents / 100,
      escreverFalha: new AsaasError("[platform] Falha de rede ao chamar o gateway", {
        status: 504,
        code: "network_error",
        retryable: true
      })
    });

    const resultado = await changeAccountPlan(tenantId, {
      planCode: "studio",
      reason: "Upgrade com o gateway fora do ar",
      actor: ATOR,
      gateway
    });

    assert.equal(resultado.gateway.status, "falhou");
    assert.ok(resultado.gateway.erro, "o motivo da falha precisa viajar para a tela e para a auditoria");
    assert.ok(resultado.warning, "gateway que falhou é dinheiro pendurado: TEM de virar aviso");
    assert.match(resultado.warning, /Reenviar ajuste ao Asaas/i, "o aviso precisa apontar a saída");

    // O acesso já mudou e continua mudado: reverter o plano por causa do
    // gateway tiraria da clínica o que ela acabou de contratar.
    const linha = await assinaturaDoBanco(tenantId);
    assert.equal(linha.plan_code, "studio");
    assert.equal(linha.tenant_plan, "studio");

    const auditoria = await ultimaAuditoria(tenantId, "conta.plano_propagado_no_gateway");
    assert.equal(auditoria.gateway.status, "falhou");
    assert.ok(auditoria.gateway.erro);
  });

  await t.test("o reprocesso conserta o que a falha deixou para trás", async () => {
    const gateway = gatewayFalso({ valorRemoto: profissional.price_cents / 100 });

    const resultado = await resyncAccountSubscription(tenantId, {
      reason: "Reenvio após queda do gateway",
      actor: ATOR,
      gateway
    });

    assert.equal(resultado.gateway.status, "atualizado");
    assert.equal(resultado.warning, null);
    assert.equal(gateway.chamadas.update.length, 1);
    assert.equal(gateway.chamadas.update[0].value, studio.price_cents / 100);
    assert.equal(gateway.valorAtual, studio.price_cents / 100, "o gateway passou a cobrar o plano vigente");
  });

  await t.test("assinatura cancelada não é reajustada — recobrar seria pior", async () => {
    await query("UPDATE platform.tenant_subscriptions SET status = 'canceled' WHERE tenant_id = $1", [tenantId]);
    const gateway = gatewayFalso({ valorRemoto: profissional.price_cents / 100 });

    const resultado = await resyncAccountSubscription(tenantId, { actor: ATOR, gateway });
    assert.equal(resultado.gateway.status, "assinatura_cancelada");
    assert.equal(gateway.chamadas.update.length, 0);
    assert.ok(resultado.warning, "recorrência que pode ter sobrado viva no gateway precisa de aviso");

    await query("UPDATE platform.tenant_subscriptions SET status = 'trial_active' WHERE tenant_id = $1", [tenantId]);
  });

  // -------------------------------------------------------------------------
  // Rotas
  // -------------------------------------------------------------------------

  await t.test("a rota de reprocesso exige token de plataforma", async () => {
    const semToken = await req(`/platform/accounts/${tenantId}/sync-subscription`, { method: "POST" });
    assert.equal(semToken.status, 401);
  });

  await t.test("sem credencial da plataforma, a rota diz isso — e não finge sucesso", async () => {
    // O servidor da suíte sobe sem ASAAS_API_KEY: é o caminho real de um
    // ambiente sem gateway, e ele não pode responder 500 nem "atualizado".
    const { status, json } = await req(`/platform/accounts/${tenantId}/sync-subscription`, {
      method: "POST",
      token: platformToken,
      body: { reason: "Conferência do painel" }
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.gateway.status, "gateway_indisponivel");
    assert.equal(json.gateway.asaas_subscription_id, idNoGateway);
    assert.ok(json.warning, "sem gateway a cobrança fica no valor antigo: isso é aviso");
  });

  await t.test("clínica sem recorrência no gateway não é tratada como falha", async () => {
    await query("UPDATE platform.tenant_subscriptions SET asaas_subscription_id = NULL WHERE tenant_id = $1", [
      tenantId
    ]);

    const { status, json } = await req(`/platform/accounts/${tenantId}/plan`, {
      method: "PATCH",
      token: platformToken,
      body: { plan_code: "start", reason: "Clínica ainda não assinou" }
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.gateway.status, "sem_assinatura");
    // Nada a reajustar não é pendência: virar alerta vermelho em toda troca de
    // plano de clínica sem assinatura treinaria o operador a ignorar o bloco.
    assert.equal(json.warning, null);
    assert.match(json.gateway.detalhe, /não tem assinatura recorrente/i);
  });

  await t.test("a rota antiga de troca de plano também propaga", async () => {
    // `PATCH /platform/tenants/:id/plan` continua sendo a rota de ativar/renovar
    // do painel de clínicas. Se ela não propagasse, o buraco continuaria aberto
    // por outro caminho.
    await query("UPDATE platform.tenant_subscriptions SET asaas_subscription_id = $1 WHERE tenant_id = $2", [
      idNoGateway,
      tenantId
    ]);

    const { status, json } = await req(`/platform/tenants/${tenantId}/plan`, {
      method: "PATCH",
      token: platformToken,
      body: { plan_code: "profissional" }
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.plan, "profissional");
    assert.equal(json.status, "active");
    assert.equal(json.gateway.status, "gateway_indisponivel");
    assert.ok(json.warning);
  });
});
