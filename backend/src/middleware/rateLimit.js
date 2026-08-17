// Rate limits da API. Reutiliza express-rate-limit.
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Permite desligar o rate limit apenas na suíte de testes automatizados (muitas
// requisições do mesmo IP em paralelo). NUNCA definir isso em produção.
const disabled = process.env.DISABLE_RATE_LIMIT === "true"
  && process.env.ALLOW_INSECURE_TEST_ENV === "true";
const skip = () => disabled;

// Chave do limite = IP calculado pelo Express a partir da cadeia de proxies
// CONFIÁVEIS. Nunca lemos CF-Connecting-IP diretamente: se a origem ficar
// acessível fora do Cloudflare, o cliente controla esse header e poderia trocar
// de bucket a cada requisição. `trust proxy` é a única fonte de confiança.
// ipKeyGenerator normaliza IPv6 (/56) para não vazar buckets.
export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "";
}

function clientKey(req) {
  return ipKeyGenerator(clientIp(req));
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

// Telemetria pública não pode virar um endpoint de escrita ilimitada. Este
// middleware roda antes de `withDb` resolver o tenant; portanto a chave usa só
// o IP confiável. Incluir X-Tenant permitiria ao atacante variar um header
// controlado por ele para escapar do limite.
export const publicErrorLogLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  skip,
  message: { error: "Muitos registros de erro. Aguarde um instante." }
});

// Rate limit dos webhooks de gateway: 600 req/min por IP.
//
// Limite PRÓPRIO, e generoso, por um motivo concreto: o Asaas entrega de um
// punhado de IPs fixos, então todas as clínicas caem no mesmo bucket. Sob o
// limite global (300/min) uma rajada de fechamento de mês devolveria 429 — e
// 429 não é 2xx, o que faz o Asaas reentregar e, após falhas consecutivas,
// PAUSAR a fila de webhooks da conta. O limite existe só como teto contra
// inundação; a autenticidade quem garante é o token.
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  skip,
  message: { error: "Muitas requisições." }
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
