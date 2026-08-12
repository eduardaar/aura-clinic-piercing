import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMUNICATION_CREDIT_PRODUCTS,
  PLAN_MONTHLY_COMMUNICATION_CREDITS,
  communicationCreditProduct,
  communicationPeriod
} from "../src/services/communicationCredits.js";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";

test("carteira define franquias separadas para os três planos", () => {
  assert.deepEqual(Object.keys(PLAN_MONTHLY_COMMUNICATION_CREDITS), ["start", "profissional", "studio"]);
  assert.equal(PLAN_MONTHLY_COMMUNICATION_CREDITS.start.whatsapp, 0);
  assert.ok(PLAN_MONTHLY_COMMUNICATION_CREDITS.profissional.whatsapp > 0);
  assert.ok(PLAN_MONTHLY_COMMUNICATION_CREDITS.studio.whatsapp > PLAN_MONTHLY_COMMUNICATION_CREDITS.profissional.whatsapp);
  assert.ok(PLAN_MONTHLY_COMMUNICATION_CREDITS.studio.ai > PLAN_MONTHLY_COMMUNICATION_CREDITS.profissional.ai);
});

test("produtos extras são definidos pelo servidor e não aceitam chave desconhecida", () => {
  assert.ok(COMMUNICATION_CREDIT_PRODUCTS.every((product) => product.credits > 0 && product.price_cents >= 0));
  assert.equal(communicationCreditProduct("whatsapp_100")?.channel, "whatsapp");
  assert.equal(communicationCreditProduct("forjado"), null);
});

test("competência mensal usa UTC para não duplicar franquia na virada de fuso", () => {
  assert.equal(communicationPeriod(new Date("2026-08-01T00:00:00.000Z")), "2026-08");
});

test("API expõe saldo e cria intenção de compra sem creditar a carteira", async (t) => {
  const tenant = await createTenant("credit");
  const login = await loginTenant(tenant.slug, tenant.adminEmail, tenant.adminPassword);
  const platformToken = await platformLogin();
  t.after(() => deleteTenant(platformToken, tenant.tenant.id, tenant.slug));

  const before = await req("/communication-credits", { token: login.token, tenant: tenant.slug });
  assert.equal(before.status, 200);
  assert.equal(before.json.balance.plan_code, "profissional");
  assert.equal(before.json.balance.available.whatsapp, 100);
  assert.ok(before.json.history.some((entry) => entry.entry_type === "monthly_grant" && entry.channel === "whatsapp"));

  const purchase = await req("/communication-credits/purchase", {
    method: "POST", token: login.token, tenant: tenant.slug, body: { product_key: "whatsapp_100" }
  });
  assert.equal(purchase.status, 201);
  assert.equal(purchase.json.intent.status, "pending");
  assert.equal(purchase.json.intent.credits, 100);

  const after = await req("/communication-credits", { token: login.token, tenant: tenant.slug });
  assert.equal(after.status, 200);
  assert.equal(after.json.balance.available.whatsapp, 100);
});
