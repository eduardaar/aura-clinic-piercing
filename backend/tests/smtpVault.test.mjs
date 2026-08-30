import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptSmtpPassword,
  encryptSmtpPassword,
  smtpPasswordNeedsRewrap,
} from "../src/services/smtpVault.js";

test("cofre SMTP cifra com conteúdo autenticado e não grava a senha em claro", () => {
  const password = "senha-super-secreta-123";
  const encrypted = encryptSmtpPassword(password);

  assert.match(encrypted, /^v1:/);
  assert.equal(encrypted.includes(password), false);
  assert.equal(decryptSmtpPassword(encrypted), password);
  assert.equal(smtpPasswordNeedsRewrap(encrypted), false);
});

test("cofre SMTP recusa conteúdo adulterado", () => {
  const encrypted = encryptSmtpPassword("senha-original");
  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;
  assert.equal(decryptSmtpPassword(tampered), null);
});
