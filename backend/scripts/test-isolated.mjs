// Executa a suíte em um banco descartável, sem migrar a base de trabalho.
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.dirname(backend);
dotenv.config({ path: path.join(backend, ".env"), quiet: true });
dotenv.config({ path: path.join(root, ".env"), quiet: true });

async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("A suíte isolada exige um PostgreSQL local (localhost, 127.0.0.1 ou ::1).");
  }
  const name = `aura_qa_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  await admin.connect();
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = `/${name}`;
    const env = {
      ...process.env,
      DATABASE_URL: url.toString(), DATABASE_SSL: "false", NODE_ENV: "test",
      TEST_PORT: process.env.AURA_TEST_PORT || "4299", REDIS_URL: "",
      SKIP_DATABASE_BOOTSTRAP: "false",
      AUTH_SECRET: "aura-isolated-tests-local-only-secret-20261103"
    };
    for (const key of Object.keys(env)) {
      if (/^(R2_|ASAAS_|RESEND_|SMTP_|OPENAI_|GEMINI_|WHATSAPP_|EMAIL_)/.test(key)) env[key] = "";
    }
    const output = path.join(root, "outputs", "test-runs");
    mkdirSync(output, { recursive: true });
    const log = path.join(output, `${name}.log`);
    const fd = openSync(log, "w");
    console.log(`Banco temporário: ${name}\nLog: ${log}`);
    let code;
    try {
      const child = spawn(process.execPath, ["tests/run-suite.mjs", ...process.argv.slice(2)], {
        cwd: backend, env, stdio: ["ignore", fd, fd]
      });
      code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
    } finally {
      closeSync(fd);
    }
    console.log(readFileSync(log, "utf8").slice(-6000));
    process.exitCode = Number.isInteger(code) ? code : 1;
  } finally {
    try {
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
