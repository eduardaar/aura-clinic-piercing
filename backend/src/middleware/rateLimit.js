// Rate limits da API. Reutiliza express-rate-limit.
import rateLimit from "express-rate-limit";

// Rate limit do login: protege contra brute-force (10 tentativas / 15 min por IP).
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login. Tente novamente em alguns minutos." }
});

// Rate limit global leve para toda a API (/api): 300 req/min por IP.
// Camada de proteção adicional ao limite estrito do /login. Resposta em JSON.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisições. Aguarde alguns instantes e tente novamente." }
});
