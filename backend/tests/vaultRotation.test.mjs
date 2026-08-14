// O cofre precisa sobreviver à introdução do ASAAS_VAULT_KEY.
//
// O cenário real: a clínica salva a chave do Asaas quando a variável ainda não
// existe (o cofre deriva do AUTH_SECRET). Depois a variável é definida. Antes
// desta garantia, isso tornava o cofre ilegível — sem aviso, e o erro só
// aparecia na primeira cobrança.
//
// Cada caso roda em SUBPROCESSO porque a chave é derivada uma vez no boot do
// módulo: mudar process.env depois do import não teria efeito nenhum, e o teste
// passaria por acidente.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const AUTH = "segredo-de-sessao-para-teste";
const VAULT = "chave-dedicada-do-cofre-para-teste";

// Só a última linha: o dotenvx escreve um banner no stdout ao carregar o .env,
// e ele viria grudado no valor.
function runNode(code, env) {
  const saida = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    env: { ...process.env, AUTH_SECRET: AUTH, NODE_ENV: "test", ...env },
    encoding: "utf8"
  });
  const linhas = saida.split("\n").map((l) => l.trim()).filter(Boolean);
  return linhas[linhas.length - 1] || "";
}

const CIFRA = `
  const { encryptSecret } = await import("./src/services/asaas/vault.js");
  process.stdout.write(encryptSecret("$aact_chave_secreta_da_clinica"));
`;

const DECIFRA = (guardado) => `
  const { decryptSecret, needsRewrap } = await import("./src/services/asaas/vault.js");
  process.stdout.write(JSON.stringify({
    valor: decryptSecret(${JSON.stringify(guardado)}),
    precisaRegravar: needsRewrap(${JSON.stringify(guardado)})
  }));
`;

test("cofre do Asaas: introduzir ASAAS_VAULT_KEY não torna ilegível o que já estava salvo", async (t) => {
  // A clínica salva a chave ANTES de existir ASAAS_VAULT_KEY.
  const guardadoAntes = runNode(CIFRA, { ASAAS_VAULT_KEY: "" });
  assert.match(guardadoAntes, /^v1:/);

  await t.test("depois de definir a chave, o segredo antigo continua legível", () => {
    const depois = JSON.parse(runNode(DECIFRA(guardadoAntes), { ASAAS_VAULT_KEY: VAULT }));
    assert.equal(depois.valor, "$aact_chave_secreta_da_clinica");
    // E fica marcado para ser regravado com a chave corrente.
    assert.equal(depois.precisaRegravar, true);
  });

  await t.test("o que é salvo já com a chave nova não pede regravação", () => {
    const guardadoDepois = runNode(CIFRA, { ASAAS_VAULT_KEY: VAULT });
    const lido = JSON.parse(runNode(DECIFRA(guardadoDepois), { ASAAS_VAULT_KEY: VAULT }));
    assert.equal(lido.valor, "$aact_chave_secreta_da_clinica");
    assert.equal(lido.precisaRegravar, false);
  });

  await t.test("uma chave de cofre ERRADA não decifra — a garantia não virou buraco", () => {
    const guardadoDepois = runNode(CIFRA, { ASAAS_VAULT_KEY: VAULT });
    const lido = JSON.parse(
      runNode(DECIFRA(guardadoDepois), { ASAAS_VAULT_KEY: "chave-de-outra-pessoa" })
    );
    assert.equal(lido.valor, null);
    assert.equal(lido.precisaRegravar, false);
  });

  await t.test("sem ASAAS_VAULT_KEY, o comportamento antigo segue idêntico", () => {
    const lido = JSON.parse(runNode(DECIFRA(guardadoAntes), { ASAAS_VAULT_KEY: "" }));
    assert.equal(lido.valor, "$aact_chave_secreta_da_clinica");
    assert.equal(lido.precisaRegravar, false);
  });
});
