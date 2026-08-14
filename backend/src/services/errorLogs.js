// Log central de erros (backend + frontend). Gravação best-effort: NUNCA lança
// nem deixa o logging mascarar/derrubar a requisição original.
const LIMITS = { message: 2000, stack: 8000, url: 1000, method: 10, ua: 500, email: 200, level: 20, context: 8000 };

function clip(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > max ? text.slice(0, max) : text;
}

const SECRET_KEY = /^(authorization|password|senha|token|access_token|refresh_token|api_key|secret|cvv|ccv|card_number|numero_cartao)$/i;

function redactText(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL_REDACTED]")
    // CPF/CNPJ, telefone e PAN: sequências longas, mesmo com pontuação/espaço.
    .replace(/(?<!\d)(?:\d[ .()\/-]?){10,18}\d(?!\d)/g, "[NUMBER_REDACTED]");
}

function sanitizeValue(value, depth = 0) {
  if (depth > 5) return "[DEPTH_LIMIT]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).slice(0, 100).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? "[REDACTED]" : sanitizeValue(item, depth + 1)
      ])
    );
  }
  return typeof value === "string" ? redactText(value) : value;
}

/** Remove credenciais e identificadores comuns da telemetria enviada pelo navegador. */
export function sanitizeFrontendTelemetry(entry = {}) {
  return {
    ...entry,
    message: redactText(entry.message),
    stack: entry.stack == null ? null : redactText(entry.stack),
    url: entry.url == null ? null : redactText(entry.url),
    context: sanitizeValue(entry.context),
    // Nunca confiar no e-mail informado por uma rota pública.
    user_email: null
  };
}

// Grava um erro na tabela central. `db` já está no schema do tenant da requisição.
export async function recordError(db, entry = {}) {
  try {
    const safeEntry = entry.source === "frontend" ? sanitizeFrontendTelemetry(entry) : entry;
    const rawContext = safeEntry.context;
    const context = rawContext == null
      ? null
      : clip(typeof rawContext === "string" ? rawContext : JSON.stringify(rawContext), LIMITS.context);
    await db.run(
      `INSERT INTO error_logs
        (source, level, message, stack, url, method, status_code, user_id, user_email, user_agent, context)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        safeEntry.source === "frontend" ? "frontend" : "backend",
        clip(safeEntry.level || "error", LIMITS.level),
        clip(safeEntry.message || "(sem mensagem)", LIMITS.message),
        clip(safeEntry.stack, LIMITS.stack),
        clip(safeEntry.url, LIMITS.url),
        clip(safeEntry.method, LIMITS.method),
        Number.isFinite(Number(safeEntry.status_code)) && safeEntry.status_code != null ? Number(safeEntry.status_code) : null,
        safeEntry.user_id != null && Number.isFinite(Number(safeEntry.user_id)) ? Number(safeEntry.user_id) : null,
        clip(safeEntry.user_email, LIMITS.email),
        clip(safeEntry.user_agent, LIMITS.ua),
        context
      ]
    );
  } catch (err) {
    // Best-effort: apenas registra no stdout, sem propagar.
    console.error("[error-logs] falha ao gravar erro:", err?.message || err);
  }
}

// Lista os erros mais recentes (uso admin), com filtros opcionais.
export async function listErrorLogs(db, { source, resolved, limit } = {}) {
  const where = [];
  const params = [];
  if (source === "backend" || source === "frontend") {
    where.push("source = ?");
    params.push(source);
  }
  if (resolved === true || resolved === false) {
    where.push("resolved = ?");
    params.push(resolved);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const max = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const items = await db.all(
    `SELECT * FROM error_logs ${clause} ORDER BY created_at DESC, id DESC LIMIT ${max}`,
    params
  );
  const totals = await db.get(
    "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE resolved = FALSE) AS unresolved FROM error_logs"
  );
  return {
    items,
    total: Number(totals?.total || 0),
    unresolved: Number(totals?.unresolved || 0)
  };
}
