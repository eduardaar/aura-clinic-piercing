// Painel de planos do super-admin: criar, editar, ativar/desativar, reordenar
// e excluir os planos vendidos pela plataforma.
//
// Como as demais rotas de plataforma, NÃO passam por `withDb`: o super-admin
// não pertence a nenhuma clínica e os planos vivem no schema `platform`, que é
// global.
//
// Todas exigem token de plataforma — sem exceção. Um endpoint de plano aberto
// (mesmo só de leitura, mesmo "só para a tela montar as caixinhas") entregaria
// a grade de preços e o mapa de features de graça, e uma escrita aberta deixaria
// qualquer um zerar o preço de todo mundo. A vitrine pública continua sendo
// servida por `GET /api/plans`, que mostra só o necessário.
import { Router } from "express";
import { verifyPlatformToken } from "../middleware/auth.js";
import { isProduction } from "../config/index.js";
import {
  CATALOGOS,
  PlanAdminError,
  atualizarPlano,
  criarPlano,
  definirPlanoAtivo,
  excluirPlano,
  listarPlanosDoPainel,
  reordenarPlanos,
  usoDoPlano
} from "../services/planAdmin.js";

const router = Router();

function requirePlatform(req, res, next) {
  const decoded = verifyPlatformToken(req);
  if (!decoded) {
    return res.status(401).json({ error: "Sessão de plataforma inválida ou expirada." });
  }
  req.platformUser = decoded;
  next();
}

// `code` e `details` vão junto do erro porque a tela precisa REAGIR a ele, não
// só exibi-lo: "confirmacao_de_preco_necessaria" vira um diálogo com os números
// do reajuste, "plano_com_assinantes" vira a oferta de desativar.
function handlePlanError(res, error) {
  if (error instanceof PlanAdminError) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      ...(error.details || {})
    });
  }
  console.error(`[planAdmin] ${error?.message || error}`);
  return res.status(500).json({
    error: isProduction ? "Erro interno no servidor." : `Erro interno: ${error.message}`
  });
}

function actor(req) {
  return { actorId: req.platformUser?.sub ?? null };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

// TODOS os planos, inclusive os desativados (sem eles no painel não haveria
// como reativar um), com os catálogos de features e limites junto: a tela monta
// as caixinhas a partir do que o servidor manda, e nada do que existe de
// verdade fica hardcoded no frontend.
router.get("/api/platform/plans", requirePlatform, async (_req, res) => {
  try {
    const { planos, alertas } = await listarPlanosDoPainel();
    res.json({
      plans: planos,
      feature_catalog: CATALOGOS.feature_catalog,
      limit_catalog: CATALOGOS.limit_catalog,
      alertas
    });
  } catch (error) {
    handlePlanError(res, error);
  }
});

// Quem usa o plano. A tela consulta ANTES de oferecer excluir/desativar: é a
// diferença entre "excluir" e "409 explicando que não dá" depois do clique.
router.get("/api/platform/plans/:code/usage", requirePlatform, async (req, res) => {
  try {
    res.json(await usoDoPlano(req.params.code));
  } catch (error) {
    handlePlanError(res, error);
  }
});

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

router.post("/api/platform/plans", requirePlatform, async (req, res) => {
  try {
    const { plan, alertas } = await criarPlano(req.body || {}, actor(req));
    res.status(201).json({ plan, alertas });
  } catch (error) {
    handlePlanError(res, error);
  }
});

// Reordenação em lote — declarada ANTES de "/:code" para o Express não tentar
// casar "order" como código de plano numa rota PATCH futura.
router.patch("/api/platform/plans/order", requirePlatform, async (req, res) => {
  try {
    const { planos, alertas } = await reordenarPlanos(req.body?.codes ?? req.body?.plans, actor(req));
    res.json({ plans: planos, alertas });
  } catch (error) {
    handlePlanError(res, error);
  }
});

// Edição. Quando `price_cents` muda e existem assinantes, exige
// `confirm_price_change: true` no corpo e devolve em `propagacao` quantas
// assinaturas do Asaas pegaram o valor novo — e quais não pegaram.
router.put("/api/platform/plans/:code", requirePlatform, async (req, res) => {
  try {
    const { plan, propagacao, alertas } = await atualizarPlano(req.params.code, req.body || {}, actor(req));
    res.json({ plan, propagacao, alertas });
  } catch (error) {
    handlePlanError(res, error);
  }
});

router.patch("/api/platform/plans/:code/active", requirePlatform, async (req, res) => {
  try {
    const ativo = req.body?.is_active ?? req.body?.active;
    const { plan, uso } = await definirPlanoAtivo(req.params.code, ativo, actor(req));
    res.json({ plan, uso });
  } catch (error) {
    handlePlanError(res, error);
  }
});

router.delete("/api/platform/plans/:code", requirePlatform, async (req, res) => {
  try {
    res.json(await excluirPlano(req.params.code, actor(req)));
  } catch (error) {
    handlePlanError(res, error);
  }
});

export default router;
