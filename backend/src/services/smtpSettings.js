import nodemailer from "nodemailer";
import { EMAIL_TIMEOUT_MS } from "../config/index.js";
import { query } from "../database/connection.js";
import {
  decryptSmtpPassword,
  encryptSmtpPassword,
  smtpPasswordNeedsRewrap,
} from "./smtpVault.js";

export class SmtpSettingsError extends Error {
  constructor(message, statusCode = 400, code = "smtp_settings_invalid") {
    super(message);
    this.name = "SmtpSettingsError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

let cached = null;
let cachedAt = 0;
const CACHE_MS = 30_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeHost(value) {
  const host = cleanText(value, 255).toLowerCase();
  if (!host || /[\s/:]/.test(host) || !/^[a-z0-9.-]+$/.test(host)) {
    throw new SmtpSettingsError("Informe somente o host SMTP, sem protocolo ou caminho.");
  }
  return host;
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SmtpSettingsError("A porta SMTP deve ser um número entre 1 e 65535.");
  }
  return port;
}

function validateOptionalEmail(value, label) {
  const email = cleanText(value, 320).toLowerCase();
  if (email && !EMAIL_PATTERN.test(email)) throw new SmtpSettingsError(`${label} inválido.`);
  return email;
}

async function readRow({ fresh = false } = {}) {
  if (!fresh && cachedAt + CACHE_MS > Date.now()) return cached;
  const result = await query("SELECT * FROM platform.smtp_settings WHERE id = 1");
  cached = result.rows[0] || null;
  cachedAt = Date.now();
  return cached;
}

function decryptRow(row) {
  if (!row) return null;
  const password = decryptSmtpPassword(row.password_encrypted);
  if (row.username && !password) return { ...row, password: null, credential_error: true };
  return { ...row, password, credential_error: false };
}

function publicSettings(row) {
  const decoded = decryptRow(row);
  return {
    provider: "smtp",
    configured: Boolean(decoded?.host && decoded?.from_email && (!decoded.username || decoded.password)),
    enabled: Boolean(decoded?.enabled && !decoded?.credential_error),
    host: decoded?.host || "",
    port: Number(decoded?.port || 587),
    secure: Boolean(decoded?.secure),
    require_tls: decoded ? Boolean(decoded.require_tls) : true,
    username: decoded?.username || "",
    password_configured: Boolean(decoded?.password),
    from_name: decoded?.from_name || "",
    from_email: decoded?.from_email || "",
    reply_to: decoded?.reply_to || "",
    updated_at: decoded?.updated_at || null,
    credential_error: Boolean(decoded?.credential_error),
  };
}

export async function smtpSettingsStatus() {
  return publicSettings(await readRow());
}

export async function smtpSettingsForDelivery({ requireEnabled = true } = {}) {
  const decoded = decryptRow(await readRow());
  if (!decoded || (requireEnabled && !decoded.enabled)) return null;
  if (!decoded.host || !decoded.from_email || (decoded.username && !decoded.password)) return null;
  return decoded;
}

export async function saveSmtpSettings(input, platformUserId) {
  const current = await readRow({ fresh: true });
  const host = normalizeHost(input.host);
  const port = normalizePort(input.port);
  const username = cleanText(input.username, 320);
  const fromEmail = validateOptionalEmail(input.from_email, "E-mail do remetente");
  if (!fromEmail) throw new SmtpSettingsError("Informe o e-mail do remetente.");
  const replyTo = validateOptionalEmail(input.reply_to, "E-mail de resposta");
  const fromName = cleanText(input.from_name, 160);
  const enabled = input.enabled === true;
  const secure = input.secure === true;
  const requireTls = secure ? false : input.require_tls !== false;
  const passwordWasSent = typeof input.password === "string" && input.password.length > 0;

  let passwordEncrypted = current?.password_encrypted || null;
  if (!username) {
    passwordEncrypted = null;
  } else if (passwordWasSent) {
    if (input.password.length > 1024) throw new SmtpSettingsError("A senha SMTP é longa demais.");
    passwordEncrypted = encryptSmtpPassword(input.password);
  } else if (!current?.password_encrypted || username !== current.username) {
    throw new SmtpSettingsError("Informe a senha SMTP para este usuário.");
  }

  const result = await query(
    `INSERT INTO platform.smtp_settings
      (id, host, port, secure, require_tls, username, password_encrypted, from_name, from_email, reply_to, enabled, updated_by, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     ON CONFLICT (id) DO UPDATE SET
       host=EXCLUDED.host, port=EXCLUDED.port, secure=EXCLUDED.secure,
       require_tls=EXCLUDED.require_tls, username=EXCLUDED.username,
       password_encrypted=EXCLUDED.password_encrypted, from_name=EXCLUDED.from_name,
       from_email=EXCLUDED.from_email, reply_to=EXCLUDED.reply_to,
       enabled=EXCLUDED.enabled, updated_by=EXCLUDED.updated_by, updated_at=now()
     RETURNING *`,
    [host, port, secure, requireTls, username || null, passwordEncrypted, fromName || null, fromEmail, replyTo || null, enabled, platformUserId],
  );
  cached = result.rows[0];
  cachedAt = Date.now();
  return publicSettings(cached);
}

export async function clearSmtpSettings() {
  await query("DELETE FROM platform.smtp_settings WHERE id = 1");
  cached = null;
  cachedAt = Date.now();
  return publicSettings(null);
}

export function createSmtpTransport(settings, options = {}) {
  return nodemailer.createTransport({
    host: settings.host,
    port: Number(settings.port),
    secure: Boolean(settings.secure),
    requireTLS: Boolean(settings.require_tls),
    ...(settings.username ? { auth: { user: settings.username, pass: settings.password } } : {}),
    pool: options.pool === true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: EMAIL_TIMEOUT_MS,
    greetingTimeout: EMAIL_TIMEOUT_MS,
    socketTimeout: EMAIL_TIMEOUT_MS,
  });
}

export function safeSmtpError(error) {
  const code = String(error?.code || "").toUpperCase();
  if (code === "EAUTH") return new SmtpSettingsError("O servidor recusou o usuário ou a senha SMTP.", 422, "smtp_auth_failed");
  if (["ETIMEDOUT", "ESOCKET", "ECONNECTION", "EDNS"].includes(code)) {
    return new SmtpSettingsError("Não foi possível conectar ao servidor SMTP. Revise host, porta e TLS.", 422, "smtp_connection_failed");
  }
  return new SmtpSettingsError("O servidor SMTP recusou a operação. Revise a configuração e o remetente.", 422, "smtp_rejected");
}

export async function verifyStoredSmtpConnection({ transportFactory = createSmtpTransport } = {}) {
  const settings = await smtpSettingsForDelivery({ requireEnabled: false });
  if (!settings) throw new SmtpSettingsError("Salve uma configuração SMTP completa antes de verificar.");
  const transporter = transportFactory(settings);
  try {
    await transporter.verify();
    return { ok: true };
  } catch (error) {
    throw safeSmtpError(error);
  } finally {
    transporter.close?.();
  }
}

export async function rewrapSmtpPasswordIfNeeded() {
  const row = await readRow({ fresh: true });
  if (!row?.password_encrypted || !smtpPasswordNeedsRewrap(row.password_encrypted)) return false;
  const password = decryptSmtpPassword(row.password_encrypted);
  if (!password) return false;
  await query("UPDATE platform.smtp_settings SET password_encrypted = $1, updated_at = now() WHERE id = 1", [encryptSmtpPassword(password)]);
  cachedAt = 0;
  return true;
}
