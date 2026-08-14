// Sessões de clínica: access token curto assinado + refresh token opaco em
// cookie HttpOnly. O refresh é rotacionado a cada uso e só seu hash é salvo.
import crypto from "crypto";

export const ACCESS_TOKEN_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_COOKIE = "aura_refresh";

export function newRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

export function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: REFRESH_TOKEN_MS
  };
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
}

export function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions());
}

export function readCookie(req, name) {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return ""; }
  }
  return "";
}

export async function createClinicSession(db, user, req) {
  const id = crypto.randomUUID();
  const refreshToken = newRefreshToken();
  await db.run(
    `INSERT INTO user_sessions
      (id, user_id, session_version, refresh_token_hash, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, now() + interval '30 days', ?, ?)`,
    [id, user.id, Number(user.session_version || 1), hashRefreshToken(refreshToken), req.ip || req.socket?.remoteAddress || null, req.get("user-agent") || null]
  );
  return { id, refreshToken };
}

export async function rotateClinicSession(db, refreshToken, req) {
  const hash = hashRefreshToken(refreshToken);
  const session = await db.get(
    `SELECT s.id, s.user_id, s.session_version, u.id AS uid, u.name, u.email, u.role,
            u.session_version AS current_session_version
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.refresh_token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > now()
        AND u.status = 'active'`,
    [hash]
  );
  if (!session || Number(session.session_version) !== Number(session.current_session_version)) return null;
  const nextRefreshToken = newRefreshToken();
  const result = await db.run(
    `UPDATE user_sessions
        SET refresh_token_hash = ?, last_used_at = now(), ip_address = ?, user_agent = ?
      WHERE id = ? AND refresh_token_hash = ? AND revoked_at IS NULL`,
    [hashRefreshToken(nextRefreshToken), req.ip || req.socket?.remoteAddress || null, req.get("user-agent") || null, session.id, hash]
  );
  if (!result.changes) return null; // duas renovações simultâneas: uma só vence.
  return {
    sessionId: session.id,
    refreshToken: nextRefreshToken,
    user: { id: session.uid, name: session.name, email: session.email, role: session.role, session_version: session.current_session_version }
  };
}

export async function activeClinicSession(db, sessionId, userId, sessionVersion) {
  if (!sessionId) return false;
  const session = await db.get(
    `SELECT id FROM user_sessions
      WHERE id = ? AND user_id = ? AND session_version = ?
        AND revoked_at IS NULL AND expires_at > now()`,
    [sessionId, userId, sessionVersion]
  );
  return Boolean(session);
}

export async function revokeClinicSession(db, sessionId, userId) {
  const result = await db.run(
    "UPDATE user_sessions SET revoked_at = now() WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    [sessionId, userId]
  );
  return result.changes > 0;
}
