// Wrapper padrão de todos os handlers:
// - injeta o adaptador `db` (Postgres com interface estilo SQLite);
// - normaliza o corpo das respostas (paliativo de encoding via normalizeDbValue);
// - aplica autenticação quando a rota exige;
// - captura erros e devolve 500 padronizado.
import { getDb } from "../db/sqliteCompat.js";
import { normalizeDbValue } from "../text-normalizer.js";
import { requiresAuth, authenticateRequest } from "./auth.js";
import { isProduction } from "../config/index.js";

export const withDb = (handler) => async (req, res) => {
  const db = await getDb();
  const originalJson = res.json.bind(res);
  res.json = (payload) => originalJson(normalizeDbValue(payload));
  try {
    if (requiresAuth(req)) {
      const user = await authenticateRequest(req, db);
      if (!user) return res.status(401).json({ error: "Sessão inválida ou expirada." });
      req.user = user;
    }
    await handler(req, res, db);
  } catch (error) {
    console.error(error);
    // Em produção nunca expomos detalhes do erro ao cliente (evita vazamento de
    // stack/SQL/mensagens internas). Em dev mantemos o detalhe para diagnóstico.
    res.status(500).json({
      error: isProduction ? "Erro interno no servidor." : `Erro interno: ${error.message}`
    });
  }
};
