// Cofre da senha SMTP global. O formato versionado e a rotação de chave seguem
// o mesmo princípio do cofre do Asaas: a chave nova cifra, mas a derivação
// legada de AUTH_SECRET continua capaz de abrir registros anteriores.
import crypto from "crypto";
import { AUTH_SECRET } from "../config/index.js";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
const derive = (secret) => crypto.scryptSync(secret, "aura-platform-smtp-vault", 32);

export const smtpVaultKeyConfigured = Boolean(process.env.SMTP_VAULT_KEY);
const keys = smtpVaultKeyConfigured
  ? [derive(process.env.SMTP_VAULT_KEY), derive(AUTH_SECRET)]
  : [derive(AUTH_SECRET)];

function tryDecrypt(raw) {
  const parts = String(raw || "").split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  for (let index = 0; index < keys.length; index += 1) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, keys[index], Buffer.from(parts[1], "base64url"));
      decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
      const value = Buffer.concat([
        decipher.update(Buffer.from(parts[3], "base64url")),
        decipher.final(),
      ]).toString("utf8");
      return { value, index };
    } catch {
      // Uma tag inválida significa chave errada ou conteúdo adulterado.
    }
  }
  return null;
}

export function encryptSmtpPassword(password) {
  const value = String(password || "");
  if (!value) return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, keys[0], iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptSmtpPassword(stored) {
  return tryDecrypt(stored)?.value || null;
}

export function smtpPasswordNeedsRewrap(stored) {
  const result = tryDecrypt(stored);
  return Boolean(result && result.index > 0);
}
