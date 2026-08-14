// TOTP RFC 6238 sem dependência adicional. O segredo nunca sai do banco em
// claro: é cifrado com uma chave derivada de AUTH_SECRET e só é usado para
// comparar o código de seis dígitos apresentado no login.
import crypto from "crypto";
import { AUTH_SECRET } from "../config/index.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;
const TOTP_WINDOW = 1; // tolera um intervalo para cada lado por relógio impreciso.

function encryptionKey() {
  return crypto.createHash("sha256").update(`aura-totp:${AUTH_SECRET}`).digest();
}

export function generateTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input) {
  const source = String(input || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of source) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function codeForCounter(secret, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret, code, now = Date.now()) {
  const candidate = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(candidate) || !secret) return false;
  const counter = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    const expected = codeForCounter(secret, counter + offset);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))) return true;
  }
  return false;
}

export function encryptTotpSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptTotpSecret(value) {
  try {
    const [version, ivRaw, tagRaw, encryptedRaw] = String(value || "").split(".");
    if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function otpauthUri({ secret, email, issuer = "Aura Clinic" }) {
  const label = `${issuer}:${email}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
}
