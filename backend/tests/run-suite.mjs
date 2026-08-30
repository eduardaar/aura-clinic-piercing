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
import dotenv from "dotenv";

// O backend aceita o .env na raiz do monorepo, mas o processo de testes era
// iniciado dentro de backend/. Testes que abrem uma conexão direta herdavam
// DATABASE_URL vazio e falhavam em SCRAM, embora o servidor tivesse carregado
// a mesma configuração alguns instantes depois.
dotenv.config();
dotenv.config({ path: path.join(process.cwd(), "../.env") });

const PORT = process.env.TEST_PORT || 4199;
const target = process.argv[2];
const runnerPlatformEmail = `qa.runner.${process.pid}@aura.local`;
const runnerPlatformPassword = `AuraRunner-${process.pid}-4495`;
const env = {
  ...process.env,
  NODE_ENV: "production",
  ALLOW_INSECURE_TEST_ENV: "true",
  CORS_ORIGIN: `http://localhost:${PORT}`,
  // Banco descartável da suíte: única exceção explícita ao bloqueio de
  // bootstrap global usado pelo deploy real.
  RUN_DATABASE_MIGRATIONS: "true",
  // Não herdar esta flag do .env local: o runner usa NODE_ENV=production para
  // exercitar autenticação real, e migrations incrementais no boot são
  // deliberadamente proibidas nesse ambiente.
  RUN_MIGRATIONS_ON_BOOT: "false",
  ALLOW_LEGACY_GLOBAL_BOOTSTRAP: "true",
  PORT: String(PORT),
  AUTH_SECRET: process.env.AUTH_SECRET || "aura-test-secret-only-for-isolated-suite-2026",
  // O usuário efêmero correspondente é criado após o healthcheck e removido
  // no encerramento. Assim a suíte não depende da senha da instalação local.
  PLATFORM_ADMIN_EMAIL: runnerPlatformEmail,
  PLATFORM_ADMIN_PASSWORD: runnerPlatformPassword,
  ALLOW_PUBLIC_SIGNUP: "true",
  // A suíte faz muitas requisições/logins do mesmo IP em paralelo; desliga o
  // rate limit SÓ no servidor de teste (nunca em produção).
  DISABLE_RATE_LIMIT: "true",
};

const server = spawn(process.execPath, ["src/index.js"], { env, stdio: ["ignore", "inherit", "inherit"] });
let testDatabase = null;
let shuttingDown = false;

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

async function preparePlatformUser() {
  const [{ default: bcrypt }, database] = await Promise.all([
    import("bcryptjs"),
    import("../src/database/connection.js"),
  ]);
  const passwordHash = await bcrypt.hash(runnerPlatformPassword, 10);
  await database.query(`
    INSERT INTO platform.platform_users (name, email, password_hash, role, session_version, mfa_enabled)
    VALUES ($1, $2, $3, 'superadmin', 1, false)
    ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='superadmin',
      session_version=platform.platform_users.session_version+1, mfa_enabled=false, mfa_totp_secret_encrypted=NULL
  `, ["QA Runner", runnerPlatformEmail, passwordHash]);
  testDatabase = database;
}

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { server.kill("SIGTERM"); } catch { /* já morreu */ }
  if (testDatabase) {
    await testDatabase.query("DELETE FROM platform.platform_users WHERE email=$1", [runnerPlatformEmail]).catch(() => {});
    await testDatabase.pool.end().catch(() => {});
  }
  process.exit(code ?? 1);
}

const ok = await waitForHealth();
if (!ok) {
  console.error("Servidor de teste não subiu em tempo hábil.");
  await shutdown(1);
}
await preparePlatformUser();

const testTargets = target
  ? [target]
  : fs.readdirSync(path.join(process.cwd(), "tests"))
    .filter((file) => file.endsWith(".test.mjs"))
    .map((file) => path.join("tests", file));

const tests = spawn(process.execPath, ["--test", "--test-force-exit", "--test-concurrency=1", ...testTargets], {
  env: { ...env, TEST_API_URL: `http://localhost:${PORT}/api` },
  stdio: ["ignore", "inherit", "inherit"],
});
tests.on("exit", (code) => { void shutdown(code ?? 1); });

process.on("SIGINT", () => { void shutdown(130); });
process.on("SIGTERM", () => { void shutdown(143); });
