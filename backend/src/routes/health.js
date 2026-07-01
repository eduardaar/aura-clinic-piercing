// Rotas de saúde da aplicação e do banco de dados.
import { Router } from "express";
import { testConnection } from "../database/connection.js";
import { isProduction } from "../config/index.js";

const router = Router();

router.get("/api/health/db", async (_req, res) => {
  try {
    await testConnection();

    res.json({
      ok: true,
      database: "connected",
    });
  } catch (error) {
    console.error("DB health error:", error);

    // Em produção não expomos mensagem/código/detalhe do erro (evita vazamento).
    const body = { ok: false, database: "error" };
    if (!isProduction) {
      body.message = error?.message || String(error);
      body.code = error?.code || null;
      body.detail = error?.detail || null;
    } else {
      body.message = "Erro interno no servidor.";
    }
    res.status(500).json(body);
  }
});

router.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "Aura Clinic", timestamp: new Date().toISOString() });
});

export default router;
