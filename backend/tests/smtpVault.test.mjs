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
  // Adultera um caractere NO MEIO do conteúdo cifrado. Trocar só o último
  // caractere do base64 nem sempre muda os bytes decodificados (os bits finais
  // são descartados), e o teste passava ou falhava conforme a sorte da cifra.
  const index = [...encrypted].findIndex((char, position) => position > 8 && /[A-Za-z0-9]/.test(char));
  const replacement = encrypted[index] === "A" ? "B" : "A";
  const tampered = `${encrypted.slice(0, index)}${replacement}${encrypted.slice(index + 1)}`;
  assert.equal(decryptSmtpPassword(tampered), null);
});
