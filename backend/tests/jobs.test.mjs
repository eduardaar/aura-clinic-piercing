import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTenant, deleteTenant, platformLogin, req } from "./helpers.mjs";

const ctx = {};

before(async () => {
  ctx.platformToken = await platformLogin();
  Object.assign(ctx, await createTenant("jobs"));
  ctx.login = await (await import("./helpers.mjs")).loginTenant(ctx.slug, ctx.adminEmail, ctx.adminPassword);
});

after(async () => {
  if (ctx.tenant?.id) await deleteTenant(ctx.platformToken, ctx.tenant.id, ctx.slug);
});

function authed(path, options = {}) {
  return req(path, { ...options, token: ctx.login.token, tenant: ctx.slug });
}

test("exportação pesada entra na fila de forma idempotente", async () => {
  const key = `job-export-${Date.now()}`;
  const body = { type: "stock", format: "csv", filters: {} };
  const first = await authed("/jobs/report-exports", {
    method: "POST", body, headers: { "Idempotency-Key": key }
  });
  assert.equal(first.status, 202, JSON.stringify(first.json));
  assert.equal(first.json.replayed, false);
  assert.equal(first.json.job.type, "report_export");
  assert.equal(first.json.job.status, "queued");
  assert.match(first.json.job.id, /^[0-9a-f-]{36}$/i);

  const replay = await authed("/jobs/report-exports", {
    method: "POST", body, headers: { "Idempotency-Key": key }
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.json));
  assert.equal(replay.json.replayed, true);
  assert.equal(replay.json.job.id, first.json.job.id);

  const conflict = await authed("/jobs/report-exports", {
    method: "POST", body: { ...body, filters: { category: "argola" } }, headers: { "Idempotency-Key": key }
  });
  assert.equal(conflict.status, 409, JSON.stringify(conflict.json));

  const listed = await authed("/jobs?status=queued");
  assert.equal(listed.status, 200, JSON.stringify(listed.json));
  assert.ok(listed.json.items.some((job) => job.id === first.json.job.id));

  const metrics = await authed("/jobs/metrics");
  assert.equal(metrics.status, 200, JSON.stringify(metrics.json));
  assert.ok(metrics.json.by_status.queued >= 1);
  assert.ok(metrics.json.oldest_queued_ms >= 0);
});

test("fila exige chave de idempotência e não expõe métricas a recepção", async () => {
  const missing = await authed("/jobs/report-exports", {
    method: "POST", body: { type: "stock", format: "csv" }
  });
  assert.equal(missing.status, 400);

  const user = await authed("/users", {
    method: "POST", body: { name: "Recepção jobs", email: `reception.jobs.${Date.now()}@test.local`, password: "SenhaForte123", role: "reception" }
  });
  assert.equal(user.status, 201, JSON.stringify(user.json));
  const reception = await (await import("./helpers.mjs")).loginTenant(ctx.slug, user.json.email, "SenhaForte123");
  const denied = await req("/jobs/metrics", { token: reception.token, tenant: ctx.slug });
  assert.equal(denied.status, 403, JSON.stringify(denied.json));

  const listed = await req("/jobs", { token: reception.token, tenant: ctx.slug });
  assert.equal(listed.status, 200, JSON.stringify(listed.json));
  assert.equal(listed.json.items.length, 0, "recepção não deve ver jobs solicitados por outros papéis");
});
