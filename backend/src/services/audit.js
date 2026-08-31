const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(password|senha|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|cvv|card[_-]?number|smtp[_-]?pass)/i;

function sanitizeValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => sanitizeValue(entry, depth + 1, seen));
  return Object.fromEntries(
    Object.entries(value).slice(0, 200).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : sanitizeValue(entry, depth + 1, seen)
    ])
  );
}

function requestContext(req) {
  if (!req) return {};
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.headers?.["user-agent"] || null,
    requestId: req.headers?.["x-request-id"] || null
  };
}

export async function recordAudit(db, {
  req,
  actor = req?.user,
  module,
  action,
  entityType,
  entityId = null,
  reason = null,
  before = null,
  after = null,
  metadata = null,
  severity = "info"
}) {
  if (!module || !action || !entityType) throw new Error("Evento de auditoria incompleto.");
  const context = requestContext(req);
  await db.run(
    `INSERT INTO audit_events (
      actor_user_id, actor_name, actor_email, actor_role,
      module, action, entity_type, entity_id, reason,
      before_data, after_data, metadata, severity,
      ip_address, user_agent, request_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actor?.id ?? null, actor?.name ?? null, actor?.email ?? null, actor?.role ?? null,
      module, action, entityType, entityId == null ? null : String(entityId), reason || null,
      before == null ? null : sanitizeValue(before),
      after == null ? null : sanitizeValue(after),
      metadata == null ? null : sanitizeValue(metadata),
      severity,
      context.ipAddress, context.userAgent, context.requestId
    ]
  );
}

export { sanitizeValue as sanitizeAuditData };
