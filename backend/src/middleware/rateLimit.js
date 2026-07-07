// Rate limits da API. Reutiliza express-rate-limit.
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Permite desligar o rate limit apenas na suíte de testes automatizados (muitas
// requisições do mesmo IP em paralelo). NUNCA definir isso em produção.
const disabled = process.env.DISABLE_RATE_LIMIT === "true";
const skip = () => disabled;

// Chave do limite = IP real do cliente. Atrás do Cloudflare, o cabeçalho
// CF-Connecting-IP carrega o IP verdadeiro (o CF o sobrescreve; o cliente não
// consegue forjá-lo). Fora do Cloudflare, cai para req.ip (derivado do
// trust proxy). ipKeyGenerator normaliza IPv6 (/56) para não vazar buckets.
function clientKey(req) {
  const cf = req.headers["cf-connecting-ip"];
  const ip = (Array.isArray(cf) ? cf[0] : cf) || req.ip || "";
  return ipKeyGenerator(ip);
}

// Rate limit do login: protege contra brute-force (10 tentativas / 15 min por IP).
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  skip,
  message: { error: "Muitas tentativas de login. Tente novamente em alguns minutos." }
});

// Rate limit global leve para toda a API (/api): 300 req/min por IP.
// Camada de proteção adicional ao limite estrito do /login. Resposta em JSON.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  skip,
  message: { error: "Muitas requisições. Aguarde alguns instantes e tente novamente." }
});
