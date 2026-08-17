// Painel do super-admin sobre a CONTA de uma clínica.
//
// Vive em `/api/platform/accounts/...` e não em `/api/platform/tenants/...` de
// propósito: as rotas de tenant (routes/platform.js) são o CADASTRO — criar,
// listar, excluir, ligar/desligar. As daqui são a CONTA — plano, assinatura,
// trial, cotas. Separar os prefixos evita colisão com o que já existe e deixa
// óbvio, na própria URL, qual das duas coisas está sendo mexida.
//
// Nenhuma rota usa withDb: tudo mora no schema `platform`, e é o serviço que
// entra no schema da clínica (só para MEDIR uso).
import { Router } from "express";
import { requirePlatformAuth as requirePlatform } from "../middleware/auth.js";
import { isProduction } from "../config/index.js";
import { AsaasError } from "../services/asaas/client.js";
import {
  ACCOUNT_STATUSES,
  AccountAdminError,
  FORCEABLE_SUBSCRIPTION_STATUSES,
  accountOverview,
  adjustTrial,
  cancelAccountSubscription,
  changeAccountPlan,
  forceSubscriptionStatus,
  platformActor,
  resyncAccountSubscription,
  setAccountStatus
} from "../services/accountAdmin.js";
import { tenantUsageReport } from "../services/planLimits.js";
import { planByCode } from "../services/plans.js";

const router = Router();

// Valores aceitos, exportados para o painel montar os seletores sem duplicar as
// listas no frontend.
export const ACCOUNT_ADMIN_OPTIONS = {
  account_statuses: ACCOUNT_STATUSES,
  subscription_statuses: FORCEABLE_SUBSCRIPTION_STATUSES,
  trial_modes: ["extend", "restart"]
};

// Auth do painel de plataforma. Cópia local do helper de routes/platform.js (e
// não um import): sete linhas não justificam acoplar dois domínios. SEM bypass
// de dev, como lá — plataforma sempre exige login.
function handleAccountError(res, error) {
  if (error instanceof AccountAdminError) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code });
  }
  // Falha do gateway que escapou do best-effort: 5xx dele vira 502, porque
  // repetir a mesma requisição pode funcionar; 4xx vira 400.
  if (error instanceof AsaasError) {
    const status = error.status >= 500 || error.status === 0 ? 502 : 400;
    return res.status(status).json({ error: error.message, code: error.code || "gateway_error" });
  }
  console.error(`[accountAdmin] ${error?.message || error}`, error?.stack || "");
  return res.status(500).json({
    error: isProduction ? "Erro interno no servidor." : `Erro interno: ${error.message}`
  });
}

// Toda escrita daqui roda em nome de um super-admin identificado — é o `actor`
// que transforma a auditoria em resposta para "quem fez isso?".
function actorOf(req) {
  return platformActor(req.platformUser);
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

// Visão completa: clínica, assinatura, plano, uso x cotas e últimas faturas.
router.get("/api/platform/accounts/:id", requirePlatform, async (req, res) => {
  try {
    res.json(await accountOverview(req.params.id));
  } catch (error) {
    handleAccountError(res, error);
  }
});

// Só o uso x cotas. Existe separado porque é a parte CARA da visão completa
// (uma consulta por cota dentro do schema da clínica) e a única que o painel
// tem motivo para atualizar sozinha, logo depois de uma troca de plano.
router.get("/api/platform/accounts/:id/usage", requirePlatform, async (req, res) => {
  try {
    const overview = await accountOverview(req.params.id, { invoiceLimit: 0 });
    res.json({
      tenant_id: overview.tenant.id,
      plan_code: overview.plan.code,
      plan_name: overview.plan.name,
      usage: overview.usage
    });
  } catch (error) {
    handleAccountError(res, error);
  }
});

// Simulação de downgrade: o que ESTOURARIA se a clínica fosse para outro plano.
//
// Existe para a troca de plano ser uma decisão informada, e a resposta diz em
// letras o que o sistema faz nesse caso: o excedente CONTINUA visível e
// editável; o que trava é a criação de novos registros. Nenhum dado é apagado
// ou escondido por causa de cota — nunca.
router.get("/api/platform/accounts/:id/limits-preview", requirePlatform, async (req, res) => {
  try {
    const target = planByCode(req.query.plan_code);
    const overview = await accountOverview(req.params.id, { invoiceLimit: 0 });
    const usage = await tenantUsageReport(overview.tenant.id, target.code);
    res.json({
      tenant_id: overview.tenant.id,
      plano_atual: overview.plan.code,
      plano_simulado: target.code,
      usage,
      excedentes: usage.filter((item) => item.over_limit).map((item) => item.key),
      efeito:
        "Registros acima da cota continuam visíveis e editáveis pela clínica; o plano só impede criar novos."
    });
  } catch (error) {
    handleAccountError(res, error);
  }
});

// ---------------------------------------------------------------------------
// Ações (todas exigem motivo e vão para platform.admin_audit)
// ---------------------------------------------------------------------------

// Troca de plano imediata. NÃO mexe no status da assinatura — para liberar uma
// conta inadimplente use /subscription-status. Propaga o valor do plano novo
// para a recorrência no Asaas (best-effort: o resultado vem em `gateway`, e o
// que exigir ação do operador, em `warning`).
router.patch("/api/platform/accounts/:id/plan", requirePlatform, async (req, res) => {
  try {
    res.json(
      await changeAccountPlan(req.params.id, {
        planCode: req.body?.plan_code,
        reason: req.body?.reason,
        actor: await actorOf(req)
      })
    );
  } catch (error) {
    handleAccountError(res, error);
  }
});

// Reenvia ao Asaas o valor do plano vigente — o reprocesso do `warning` acima.
//
// POST e não PATCH porque não altera nenhum recurso NOSSO: só faz o gateway
// concordar com o que já está gravado aqui. É idempotente (a sincronização lê
// antes de escrever e nunca cria assinatura ou cobrança), então repetir o
// clique não duplica cobrança — não precisa de `Idempotency-Key`, que existe
// para o checkout, onde o replay criaria uma segunda recorrência.
router.post("/api/platform/accounts/:id/sync-subscription", requirePlatform, async (req, res) => {
  try {
    res.json(
      await resyncAccountSubscription(req.params.id, {
        reason: req.body?.reason,
        actor: await actorOf(req)
      })
    );
  } catch (error) {
    handleAccountError(res, error);
  }
});

// Suspender / reativar a conta (corte de acesso). Não toca no gateway.
async function applyAccountStatus(req, forcedStatus = null) {
  return setAccountStatus(req.params.id, {
    status: forcedStatus ?? req.body?.status,
    reason: req.body?.reason,
    actor: await actorOf(req)
  });
}

router.patch("/api/platform/accounts/:id/status", requirePlatform, async (req, res) => {
  try {
    res.json(await applyAccountStatus(req));
  } catch (error) {
    handleAccountError(res, error);
  }
});

// Atalhos explícitos: "suspender" e "reativar" são dois botões na tela, e mandar
// o status pelo corpo convida a errar o valor num deles.
router.post("/api/platform/accounts/:id/suspend", requirePlatform, async (req, res) => {
  try {
    res.json(await applyAccountStatus(req, "suspenso"));
  } catch (error) {
    handleAccountError(res, error);
  }
});

router.post("/api/platform/accounts/:id/reactivate", requirePlatform, async (req, res) => {
  try {
    res.json(await applyAccountStatus(req, "ativo"));
  } catch (error) {
    handleAccountError(res, error);
  }
});

// Trial: estender (default) ou reiniciar por N dias.
router.patch("/api/platform/accounts/:id/trial", requirePlatform, async (req, res) => {
  try {
    res.json(
      await adjustTrial(req.params.id, {
        days: req.body?.days,
        mode: req.body?.mode,
        reason: req.body?.reason,
        actor: await actorOf(req)
      })
    );
  } catch (error) {
    handleAccountError(res, error);
  }
});

// Válvula de escape: força o status da assinatura sem depender do webhook.
router.patch("/api/platform/accounts/:id/subscription-status", requirePlatform, async (req, res) => {
  try {
    res.json(
      await forceSubscriptionStatus(req.params.id, {
        status: req.body?.status,
        reason: req.body?.reason,
        actor: await actorOf(req)
      })
    );
  } catch (error) {
    handleAccountError(res, error);
  }
});

// Cancela a recorrência no Asaas (best-effort) e a assinatura daqui. Não corta
// o acesso: quem faz isso é /suspend, e são decisões diferentes.
router.post("/api/platform/accounts/:id/cancel-subscription", requirePlatform, async (req, res) => {
  try {
    res.json(
      await cancelAccountSubscription(req.params.id, {
        reason: req.body?.reason,
        actor: await actorOf(req)
      })
    );
  } catch (error) {
    handleAccountError(res, error);
  }
});

export default router;
