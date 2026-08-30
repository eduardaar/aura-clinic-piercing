import test from "node:test";
import assert from "node:assert/strict";
import { buildResendPayload, buildSmtpMessage, isValidEmailAddress } from "../src/services/emailProvider.js";

test("provedor de e-mail aceita somente destinos minimamente válidos", () => {
  assert.equal(isValidEmailAddress("cliente@example.com"), true);
  assert.equal(isValidEmailAddress("cliente+agenda@example.com"), true);
  assert.equal(isValidEmailAddress("sem-arroba"), false);
  assert.equal(isValidEmailAddress("cliente@"), false);
});

test("payload do Resend não aceita assunto vazio e sempre usa lista de destinatários", () => {
  const payload = buildResendPayload({ to: "cliente@example.com", subject: "", text: "Confirmação" });
  assert.deepEqual(payload.to, ["cliente@example.com"]);
  assert.equal(payload.subject, "Mensagem da sua clínica");
  assert.equal(payload.text, "Confirmação");
});

test("mensagem SMTP usa remetente e reply-to configurados sem incluir credenciais", () => {
  const message = buildSmtpMessage({
    from_name: "Aura Clinic",
    from_email: "avisos@example.com",
    reply_to: "atendimento@example.com",
    username: "smtp-user",
    password: "segredo",
  }, { to: "cliente@example.com", subject: "Agendamento", text: "Confirmado" });

  assert.deepEqual(message.from, { name: "Aura Clinic", address: "avisos@example.com" });
  assert.equal(message.replyTo, "atendimento@example.com");
  assert.equal(message.to, "cliente@example.com");
  assert.equal(message.password, undefined);
  assert.equal(JSON.stringify(message).includes("segredo"), false);
});
