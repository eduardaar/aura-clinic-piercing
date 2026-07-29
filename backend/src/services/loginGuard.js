import Redis from "ioredis";
import { query } from "../database/connection.js";

/**
 * Proteção do login de plataforma contra força bruta, em duas camadas.
 *
 * Camada 1 — Redis (efêmera): conta as falhas por IP numa janela de 15 min.
 *   Ao chegar em 5 falhas, o IP fica bloqueado por 15 min e ganha um "strike".
 *
 * Camada 2 — Postgres (permanente): ao acumular 2 strikes, o IP entra em
 *   `platform.blocked_ips` e não sai mais sozinho. O desbloqueio é manual e
 *   deliberado:
 *
 *     DELETE FROM platform.blocked_ips WHERE ip = '203.0.113.9';
 *
 * Se o Redis estiver indisponível, a camada 1 cai para contadores em memória
 * do próprio processo. Fica mais fraca (não é compartilhada entre réplicas e
 * zera no restart), mas o login continua protegido e — o que mais importa —
 * continua funcionando. Falhar fechado aqui derrubaria o acesso ao painel
 * junto com o Redis.
 */

const WINDOW_MS = 15 * 60 * 1000;      // janela de contagem de falhas
const MAX_FAILS = 5;                    // falhas que disparam o bloqueio temporário
const STRIKES_TO_BAN = 2;               // bloqueios temporários que viram ban permanente
const STRIKE_TTL_MS = 24 * 60 * 60 * 1000; // strikes expiram em 24h de bom comportamento

const KEY_FAIL = (ip) => `plat:fail:${ip}`;
const KEY_BLOCK = (ip) => `plat:block:${ip}`;
const KEY_STRIKE = (ip) => `plat:strike:${ip}`;

// Mesma válvula usada pelo rate limit: a suíte de testes dispara centenas de
// requisições do mesmo IP. NUNCA definir isso em produção.
const disabled = () => process.env.DISABLE_RATE_LIMIT === "true";

let redis = null;
let redisDown = false;

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    // Sem fila offline: se o Redis cair, queremos o erro na hora para usar o
    // fallback, e não requisições penduradas segurando o login.
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 500, 5000)
  });
  redis.on("error", (error) => {
    if (!redisDown) {
      redisDown = true;
      console.warn(`[loginGuard] Redis indisponível (${error.message}); usando contadores em memória.`);
    }
  });
  redis.on("ready", () => {
    redisDown = false;
    console.log("[loginGuard] Redis conectado.");
  });
  redis.connect().catch(() => { /* o handler de erro acima já avisou */ });
}

// Fallback em memória, com a mesma semântica do Redis.
const memory = new Map();   // chave -> { value, expiresAt }

function memGet(key) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

function memIncr(key, ttlMs) {
  const current = Number(memGet(key) || 0) + 1;
  memory.set(key, { value: current, expiresAt: Date.now() + ttlMs });
  return current;
}

function memSet(key, value, ttlMs) {
  memory.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// Evita que o Map cresça sem limite num processo de vida longa.
function memSweep() {
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
}
const sweeper = setInterval(memSweep, 60_000);
sweeper.unref?.();

const useRedis = () => Boolean(redis) && !redisDown;

async function incr(key, ttlMs) {
  if (useRedis()) {
    try {
      const value = await redis.incr(key);
      if (value === 1) await redis.pexpire(key, ttlMs);
      return value;
    } catch {
      redisDown = true;
    }
  }
  return memIncr(key, ttlMs);
}

async function getTtl(key) {
  if (useRedis()) {
    try {
      const ttl = await redis.pttl(key);
      return ttl > 0 ? ttl : 0;
    } catch {
      redisDown = true;
    }
  }
  const entry = memory.get(key);
  return entry ? Math.max(0, entry.expiresAt - Date.now()) : 0;
}

async function setWithTtl(key, value, ttlMs) {
  if (useRedis()) {
    try {
      await redis.set(key, String(value), "PX", ttlMs);
      return;
    } catch {
      redisDown = true;
    }
  }
  memSet(key, value, ttlMs);
}

async function del(...keys) {
  if (useRedis()) {
    try {
      await redis.del(...keys);
    } catch {
      redisDown = true;
    }
  }
  for (const key of keys) memory.delete(key);
}

/** O IP está banido permanentemente? Consulta a tabela do Postgres. */
export async function isBanned(ip) {
  if (!ip) return false;
  try {
    const result = await query("SELECT 1 FROM platform.blocked_ips WHERE ip = $1", [ip]);
    return result.rowCount > 0;
  } catch (error) {
    // Tabela ausente (schema desatualizado) ou banco fora: não é motivo para
    // barrar o login legítimo — a camada do Redis continua valendo.
    console.warn(`[loginGuard] Falha ao consultar blocked_ips: ${error.message}`);
    return false;
  }
}

async function ban(ip, { strikes, userAgent, email }) {
  try {
    await query(
      `INSERT INTO platform.blocked_ips (ip, reason, strikes, user_agent, last_email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ip) DO UPDATE SET
         strikes = excluded.strikes,
         reason = excluded.reason,
         user_agent = excluded.user_agent,
         last_email = excluded.last_email,
         blocked_at = NOW()`,
      [ip, `${strikes} bloqueios por excesso de tentativas de login`, strikes, userAgent || null, email || null]
    );
    console.warn(`[loginGuard] IP ${ip} banido permanentemente após ${strikes} bloqueios.`);
  } catch (error) {
    console.error(`[loginGuard] Não foi possível banir o IP ${ip}: ${error.message}`);
  }
}

/**
 * Chamar ANTES de validar a senha.
 * @returns {{allowed: true} | {allowed: false, status: number, error: string, retryAfterSeconds?: number}}
 */
export async function checkAccess(ip) {
  if (disabled() || !ip) return { allowed: true };

  if (await isBanned(ip)) {
    // Mensagem deliberadamente vaga: não confirma que existe algo atrás nem
    // explica o critério do bloqueio.
    return { allowed: false, status: 403, error: "Acesso bloqueado." };
  }

  const blockTtl = await getTtl(KEY_BLOCK(ip));
  if (blockTtl > 0) {
    return {
      allowed: false,
      status: 429,
      error: "Muitas tentativas. Tente novamente mais tarde.",
      retryAfterSeconds: Math.ceil(blockTtl / 1000)
    };
  }

  return { allowed: true };
}

/**
 * Chamar quando a senha estiver ERRADA. Escala o bloqueio quando necessário.
 */
export async function registerFailure(ip, { userAgent, email } = {}) {
  if (disabled() || !ip) return;

  const fails = await incr(KEY_FAIL(ip), WINDOW_MS);
  if (fails < MAX_FAILS) return;

  // Atingiu o limite da janela: bloqueia por 15 min e anota o strike.
  await setWithTtl(KEY_BLOCK(ip), "1", WINDOW_MS);
  await del(KEY_FAIL(ip));
  const strikes = await incr(KEY_STRIKE(ip), STRIKE_TTL_MS);

  console.warn(`[loginGuard] IP ${ip} bloqueado por 15 min (strike ${strikes}/${STRIKES_TO_BAN}).`);

  if (strikes >= STRIKES_TO_BAN) {
    await ban(ip, { strikes, userAgent, email });
  }
}

/** Chamar quando o login for BEM-SUCEDIDO: zera a contagem daquele IP. */
export async function registerSuccess(ip) {
  if (!ip) return;
  await del(KEY_FAIL(ip), KEY_BLOCK(ip), KEY_STRIKE(ip));
}

/** Só para os testes: limpa o estado em memória entre casos. */
export function __resetMemory() {
  memory.clear();
}
