import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { req, platformLogin, deleteTenant } from "./helpers.mjs";

const ctx = {};

before(async () => {
  ctx.platformToken = await platformLogin();
  const suffix = `${Date.now()}`.slice(-8);
  ctx.slug = `perf-${suffix}`;
  const signup = await req("/signup", {
    method: "POST",
    body: {
      name: `Clínica Performance ${suffix}`,
      slug: ctx.slug,
      admin_email: `admin@${ctx.slug}.test`,
      admin_password: "SenhaForte123",
      plan_code: "studio"
    }
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  ctx.tenantId = signup.json.tenant.id;
  ctx.token = signup.json.token;
});

after(async () => {
  if (ctx.tenantId) await deleteTenant(ctx.platformToken, ctx.tenantId, ctx.slug);
});

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

async function measure(path, iterations = 15) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    const response = await req(path, { token: ctx.token, tenant: ctx.slug });
    samples.push(performance.now() - started);
    assert.equal(response.status, 200, `${path}: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return {
    p50_ms: Number(percentile(samples, 0.5).toFixed(2)),
    p95_ms: Number(percentile(samples, 0.95).toFixed(2))
  };
}

test("APIs principais mantêm latência local mensurável", async (t) => {
  const results = {
    catalog: await measure("/catalog"),
    dashboard: await measure("/dashboard?days=30"),
    inventory_search: await measure("/jewelry?search=titânio"),
    reports: await measure("/reports/stock")
  };
  t.diagnostic(`PERFORMANCE ${JSON.stringify(results)}`);
  for (const value of Object.values(results)) {
    assert.ok(value.p95_ms < 1500, `p95 local acima de 1500 ms: ${JSON.stringify(results)}`);
  }
});
