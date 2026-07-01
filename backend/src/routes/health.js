// Rotas de saúde da aplicação e do banco de dados.
import { Router } from "express";
import { testConnection } from "../database/connection.js";

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

    res.status(500).json({
      ok: false,
      database: "error",
      message: error?.message || String(error),
      code: error?.code || null,
      detail: error?.detail || null,
    });
  }
});

router.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "Aura Clinic", timestamp: new Date().toISOString() });
});

export default router;
