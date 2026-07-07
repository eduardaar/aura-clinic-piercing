// Log central de erros (backend + frontend). Gravação best-effort: NUNCA lança
// nem deixa o logging mascarar/derrubar a requisição original.
const LIMITS = { message: 2000, stack: 8000, url: 1000, method: 10, ua: 500, email: 200, level: 20, context: 8000 };

function clip(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > max ? text.slice(0, max) : text;
}

// Grava um erro na tabela central. `db` já está no schema do tenant da requisição.
export async function recordError(db, entry = {}) {
  try {
    const rawContext = entry.context;
    const context = rawContext == null
      ? null
      : clip(typeof rawContext === "string" ? rawContext : JSON.stringify(rawContext), LIMITS.context);
    await db.run(
      `INSERT INTO error_logs
        (source, level, message, stack, url, method, status_code, user_id, user_email, user_agent, context)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.source === "frontend" ? "frontend" : "backend",
        clip(entry.level || "error", LIMITS.level),
        clip(entry.message || "(sem mensagem)", LIMITS.message),
        clip(entry.stack, LIMITS.stack),
        clip(entry.url, LIMITS.url),
        clip(entry.method, LIMITS.method),
        Number.isFinite(Number(entry.status_code)) && entry.status_code != null ? Number(entry.status_code) : null,
        entry.user_id != null && Number.isFinite(Number(entry.user_id)) ? Number(entry.user_id) : null,
        clip(entry.user_email, LIMITS.email),
        clip(entry.user_agent, LIMITS.ua),
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
