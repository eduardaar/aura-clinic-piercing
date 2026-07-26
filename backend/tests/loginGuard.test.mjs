import { test, before, after } from "node:test";
import assert from "node:assert/strict";

// Testa a escalada do loginGuard direto no serviço (sem HTTP): 5 falhas
// bloqueiam por 15 min, o segundo bloqueio bane o IP na tabela, e o ban só
// sai por remoção manual.
//
// A suíte roda com DISABLE_RATE_LIMIT=true para não estourar os limites das
// outras rotas — o guard respeita a mesma flag, então desligamos aqui só
// durante estes casos.
const previousFlag = process.env.DISABLE_RATE_LIMIT;
process.env.DISABLE_RATE_LIMIT = "false";

const { checkAccess, registerFailure, registerSuccess, isBanned, __resetMemory } =
  await import("../src/services/loginGuard.js");
const { query } = await import("../src/database/connection.js");

const IP_A = "203.0.113.201";
const IP_B = "203.0.113.202";
const IP_C = "203.0.113.203";

async function limpar() {
  await query("DELETE FROM platform.blocked_ips WHERE ip = ANY($1)", [[IP_A, IP_B, IP_C]]);
  __resetMemory();
}

before(limpar);
after(async () => {
  await limpar();
  process.env.DISABLE_RATE_LIMIT = previousFlag;
});

test("IP novo entra sem obstáculo", async () => {
  const acesso = await checkAccess(IP_A);
  assert.equal(acesso.allowed, true);
});

test("4 falhas ainda deixam tentar; a 5ª bloqueia por 15 min", async () => {
  for (let i = 0; i < 4; i++) await registerFailure(IP_A);
  assert.equal((await checkAccess(IP_A)).allowed, true, "não deve bloquear antes da 5ª");

  await registerFailure(IP_A);
  const bloqueado = await checkAccess(IP_A);
  assert.equal(bloqueado.allowed, false);
  assert.equal(bloqueado.status, 429);
  assert.ok(bloqueado.retryAfterSeconds > 0, "deve informar Retry-After");
  assert.ok(bloqueado.retryAfterSeconds <= 15 * 60, "janela de no máximo 15 min");

  assert.equal(await isBanned(IP_A), false, "primeiro bloqueio é temporário, não ban");
});

test("segundo ciclo de 5 falhas bane o IP permanentemente", async () => {
  for (let i = 0; i < 5; i++) await registerFailure(IP_B);   // 1º bloqueio + strike 1
  assert.equal(await isBanned(IP_B), false, "um bloqueio não basta para banir");

  // Segundo ciclo (a contagem de falhas foi zerada pelo próprio bloqueio).
  for (let i = 0; i < 5; i++) await registerFailure(IP_B);   // 2º bloqueio + strike 2 → ban
  assert.equal(await isBanned(IP_B), true, "dois bloqueios devem banir");

  const acesso = await checkAccess(IP_B);
  assert.equal(acesso.allowed, false);
  assert.equal(acesso.status, 403);
  assert.equal(acesso.error, "Acesso bloqueado.", "mensagem não revela o critério");
});

test("o ban só sai por remoção manual na tabela", async () => {
  assert.equal(await isBanned(IP_B), true);
  await query("DELETE FROM platform.blocked_ips WHERE ip = $1", [IP_B]);
  assert.equal(await isBanned(IP_B), false, "após o DELETE o IP volta a entrar");
});

test("login bem-sucedido zera a contagem do IP", async () => {
  for (let i = 0; i < 4; i++) await registerFailure(IP_C);
  await registerSuccess(IP_C);
  // Com o contador zerado, 4 novas falhas continuam sem bloquear.
  for (let i = 0; i < 4; i++) await registerFailure(IP_C);
  assert.equal((await checkAccess(IP_C)).allowed, true);
});

test("a tabela registra o motivo e o número de bloqueios", async () => {
  for (let i = 0; i < 10; i++) await registerFailure(IP_C, { userAgent: "teste/1.0", email: "x@y.z" });
  const linha = await query("SELECT strikes, reason, user_agent FROM platform.blocked_ips WHERE ip = $1", [IP_C]);
  assert.equal(linha.rowCount, 1);
  assert.ok(linha.rows[0].strikes >= 2);
  assert.match(linha.rows[0].reason, /bloqueios/);
  assert.equal(linha.rows[0].user_agent, "teste/1.0");
});
