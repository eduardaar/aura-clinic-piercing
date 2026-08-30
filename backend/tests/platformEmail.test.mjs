import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { query } from "../src/database/connection.js";
import { platformLogin, req } from "./helpers.mjs";

let token = "";

function platformRequest(path, options = {}) {
  return req(path, { ...options, token, platform: true });
}

before(async () => {
  token = await platformLogin();
  await query("DELETE FROM platform.smtp_settings WHERE id = 1");
});

after(async () => {
  await query("DELETE FROM platform.smtp_settings WHERE id = 1");
});

test("configuração SMTP exige autenticação de plataforma", async () => {
  assert.equal((await req("/platform/email-settings")).status, 401);
  assert.equal((await req("/platform/email-settings", { method: "PUT", body: {} })).status, 401);
});

test("configuração SMTP valida entrada, cifra a senha e nunca a devolve", async () => {
  const invalid = await platformRequest("/platform/email-settings", {
    method: "PUT",
    body: { host: "https://smtp.example.com", port: 587, from_email: "invalido" },
  });
  assert.equal(invalid.status, 400, JSON.stringify(invalid.json));

  const password = "senha-smtp-qa-123";
  const saved = await platformRequest("/platform/email-settings", {
    method: "PUT",
    body: {
      host: "smtp.example.com",
      port: 587,
      secure: false,
      require_tls: true,
      username: "avisos@example.com",
      password,
      from_name: "Aura QA",
      from_email: "avisos@example.com",
      reply_to: "atendimento@example.com",
      enabled: true,
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.smtp.configured, true);
  assert.equal(saved.json.smtp.password_configured, true);
  assert.equal(saved.json.smtp.password, undefined);
  assert.equal(saved.json.smtp.password_encrypted, undefined);
  assert.equal(JSON.stringify(saved.json).includes(password), false);

  const stored = await query("SELECT password_encrypted FROM platform.smtp_settings WHERE id = 1");
  assert.equal(stored.rows.length, 1);
  assert.match(stored.rows[0].password_encrypted, /^v1:/);
  assert.equal(stored.rows[0].password_encrypted.includes(password), false);

  const loaded = await platformRequest("/platform/email-settings");
  assert.equal(loaded.status, 200, JSON.stringify(loaded.json));
  assert.equal(loaded.json.smtp.password_configured, true);
  assert.equal(JSON.stringify(loaded.json).includes(password), false);
});

test("senha vazia preserva a credencial SMTP já armazenada", async () => {
  const beforeUpdate = await query("SELECT password_encrypted FROM platform.smtp_settings WHERE id = 1");
  const encrypted = beforeUpdate.rows[0].password_encrypted;

  const updated = await platformRequest("/platform/email-settings", {
    method: "PUT",
    body: {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      require_tls: true,
      username: "avisos@example.com",
      password: "",
      from_name: "Aura Atualizada",
      from_email: "avisos@example.com",
      reply_to: "",
      enabled: false,
    },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.smtp.secure, true);
  assert.equal(updated.json.smtp.require_tls, false);
  assert.equal(updated.json.smtp.password_configured, true);

  const afterUpdate = await query("SELECT password_encrypted FROM platform.smtp_settings WHERE id = 1");
  assert.equal(afterUpdate.rows[0].password_encrypted, encrypted);
});

test("verificação e teste respondem como erro de configuração quando não há SMTP salvo", async () => {
  const removed = await platformRequest("/platform/email-settings", { method: "DELETE" });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));

  const verify = await platformRequest("/platform/email-settings/verify", { method: "POST" });
  assert.equal(verify.status, 400, JSON.stringify(verify.json));
  assert.equal(verify.json.code, "smtp_settings_invalid");

  const send = await platformRequest("/platform/email-settings/test", {
    method: "POST",
    body: { to: "cliente@example.com" },
  });
  assert.equal(send.status, 400, JSON.stringify(send.json));
  assert.equal(send.json.code, "smtp_settings_invalid");
});
