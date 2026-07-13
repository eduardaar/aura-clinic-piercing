// Runner dos testes de endpoint:
// 1) sobe um servidor em NODE_ENV=production numa porta dedicada (auth real);
// 2) espera o /api/health responder;
// 3) roda os testes (node --test) com TEST_API_URL apontando para esse servidor;
// 4) derruba o servidor e propaga o código de saída.
//
// Uso:
//   node tests/run-suite.mjs                 → roda todos os tests/*.test.mjs
//   node tests/run-suite.mjs tests/flow.test.mjs   → roda um arquivo só
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";

const PORT = process.env.TEST_PORT || 4199;
const target = process.argv[2];
const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(PORT),
  // Garante superadmin previsível nos testes, sem depender do que estiver no .env.
  PLATFORM_ADMIN_EMAIL: process.env.PLATFORM_ADMIN_EMAIL || "superadmin@aura.local",
  PLATFORM_ADMIN_PASSWORD: process.env.PLATFORM_ADMIN_PASSWORD || "superadmin123",
  ALLOW_PUBLIC_SIGNUP: "true",
  // A suíte faz muitas requisições/logins do mesmo IP em paralelo; desliga o
  // rate limit SÓ no servidor de teste (nunca em produção).
  DISABLE_RATE_LIMIT: "true",
};

const server = spawn("node", ["src/index.js"], { env, stdio: ["ignore", "inherit", "inherit"] });

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/health`);
      if (res.ok) return true;
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function shutdown(code) {
  try { server.kill("SIGTERM"); } catch { /* já morreu */ }
  process.exit(code ?? 1);
}

const ok = await waitForHealth();
if (!ok) {
  console.error("Servidor de teste não subiu em tempo hábil.");
  shutdown(1);
}

const testTargets = target
  ? [target]
  : fs.readdirSync(path.join(process.cwd(), "tests"))
    .filter((file) => file.endsWith(".test.mjs"))
    .map((file) => path.join("tests", file));

const tests = spawn("node", ["--test", "--test-concurrency=1", ...testTargets], {
  env: { ...env, TEST_API_URL: `http://localhost:${PORT}/api` },
  stdio: ["ignore", "inherit", "inherit"],
});
tests.on("exit", (code) => shutdown(code ?? 1));

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
