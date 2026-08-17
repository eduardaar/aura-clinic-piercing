// Painel financeiro da plataforma (super-admin).
//
// Camada de ANÁLISE sobre `platform.tenant_invoices`. A listagem bruta das
// faturas e a conciliação manual continuam em `routes/billing.js`
// (`GET /api/platform/invoices`, `POST /api/platform/invoices/:id/sync`); aqui
// nada é criado nem alterado — todas as rotas são somente leitura.
//
// Como as de landing e support, estas rotas NÃO passam por `withDb`: o
// super-admin não pertence a clínica nenhuma e os dados vivem no schema
// `platform`, que é global.
import { Router } from "express";
import { requirePlatformAuth as requirePlatform } from "../middleware/auth.js";
import { isProduction } from "../config/index.js";
import { pageResponse, parsePaging } from "../services/pagination.js";
import {
  PlatformFinanceError,
  listarInadimplencia,
  listarVencimentosProximos,
  receitaPorPlano,
  resumoFinanceiro,
  serieMensal
} from "../services/platformFinance.js";

const router = Router();

// Cópia local do guarda de plataforma, como em routes/landing.js e
// routes/billing.js: são domínios diferentes e um não deve depender do outro por
// causa de sete linhas. Sem bypass de dev.
function handleFinanceError(res, error) {
  if (error instanceof PlatformFinanceError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(`[platformFinance] ${error?.message || error}`);
  return res.status(500).json({
    error: isProduction ? "Erro interno no servidor." : `Erro interno: ${error.message}`
  });
}

// `data_base` (AAAA-MM-DD) é opcional em todas as rotas e vale a mesma coisa em
// todas: "calcule o painel como se hoje fosse este dia". Existe porque
// fechamento financeiro se confere olhando para trás — e porque, sem ela,
// qualquer verificação automática dependeria do dia em que roda.
function dataBase(req) {
  return req.query?.data_base;
}

// Os números que abrem a tela.
router.get("/api/platform/finance/summary", requirePlatform, async (req, res) => {
  try {
    res.json(await resumoFinanceiro({ dataBase: dataBase(req) }));
  } catch (error) {
    handleFinanceError(res, error);
  }
});

// Quem cobrar: clínicas com fatura vencida, da mais atrasada para a menos.
router.get("/api/platform/finance/overdue", requirePlatform, async (req, res) => {
  try {
    const paging = parsePaging(req.query, { defaultLimit: 50, maxLimit: 200 });
    const page = await listarInadimplencia({
      dataBase: dataBase(req),
      limit: paging.limit,
      offset: paging.offset
    });
    // Envelope padrão da casa: array puro quando o cliente não pede página.
    res.json(pageResponse(page.items, page.total, paging));
  } catch (error) {
    handleFinanceError(res, error);
  }
});

// O que vence nos próximos N dias (`?dias=7`).
router.get("/api/platform/finance/upcoming", requirePlatform, async (req, res) => {
  try {
    const paging = parsePaging(req.query, { defaultLimit: 50, maxLimit: 200 });
    const page = await listarVencimentosProximos({
      dataBase: dataBase(req),
      dias: req.query?.dias,
      limit: paging.limit,
      offset: paging.offset
    });
    // Aqui o envelope é sempre objeto, mesmo sem paginação: o total EM DINHEIRO
    // da janela é o número principal da tela e não caberia num array puro.
    res.json({
      items: page.items,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      dias: page.dias,
      valor_total: page.valor_total,
      valor_total_centavos: page.valor_total_centavos
    });
  } catch (error) {
    handleFinanceError(res, error);
  }
});

// Série para o gráfico: receita por mês nos últimos N meses (`?meses=12`).
router.get("/api/platform/finance/monthly", requirePlatform, async (req, res) => {
  try {
    res.json(await serieMensal({ dataBase: dataBase(req), meses: req.query?.meses }));
  } catch (error) {
    handleFinanceError(res, error);
  }
});

// Quanto cada plano representa.
router.get("/api/platform/finance/by-plan", requirePlatform, async (req, res) => {
  try {
    res.json(await receitaPorPlano({ dataBase: dataBase(req) }));
  } catch (error) {
    handleFinanceError(res, error);
  }
});

export default router;
