import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";

const ctx = {};
const api = (path, options = {}) => req(path, { token: ctx.token, tenant: ctx.tenant?.slug, ...options });

before(async () => {
  ctx.platformToken = await platformLogin();
  ctx.tenant = await createTenant("qa-client-profile");
  ctx.token = (await loginTenant(ctx.tenant.slug, ctx.tenant.adminEmail, ctx.tenant.adminPassword)).token;
});

after(async () => {
  if (ctx.platformToken && ctx.tenant?.tenant?.id) {
    await deleteTenant(ctx.platformToken, ctx.tenant.tenant.id, ctx.tenant.slug);
  }
});

test("cadastro PT-BR normaliza dados, permite busca e alimenta o perfil 360", async () => {
  const created = await api("/clients", {
    method: "POST",
    body: {
      full_name: "  Maria   Aparecida de Souza ",
      social_name: "Maria",
      birth_date: "1992-09-12",
      cpf: "529.982.247-25",
      phone: "(11) 3333-4444",
      whatsapp: "+55 (11) 99999-8888",
      email: " MARIA@EXAMPLE.COM ",
      instagram: "Maria.Souza",
      preferred_contact: "email",
      postal_code: "01310-100",
      address_line: "Avenida Paulista",
      address_number: "1000",
      address_complement: "Sala 1",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "sp",
      notes: "Prefere contato no período da tarde.",
    },
  });

  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.full_name, "Maria Aparecida de Souza");
  assert.equal(created.json.whatsapp, "11999998888");
  assert.equal(created.json.email, "maria@example.com");
  assert.equal(created.json.cpf, "52998224725");
  assert.equal(created.json.postal_code, "01310100");
  assert.equal(created.json.state, "SP");

  const search = await api("/clients?search=529.982");
  assert.equal(search.status, 200, JSON.stringify(search.json));
  assert.ok(search.json.some((item) => item.id === created.json.id));

  const profile = await api(`/clients/${created.json.id}`);
  assert.equal(profile.status, 200, JSON.stringify(profile.json));
  assert.equal(profile.json.clinical_access, true);
  assert.deepEqual(profile.json.summary, {
    last_appointment: null,
    next_appointment: null,
    total_spent: 0,
    pending_amount: 0,
  });
  for (const field of ["history", "timeline", "terms", "followups", "medicalRecords"]) {
    assert.ok(Array.isArray(profile.json[field]), `${field} deve estar no perfil`);
  }
});

test("cadastro recusa dados brasileiros inválidos com erros por campo", async () => {
  const invalid = await api("/clients", {
    method: "POST",
    body: {
      full_name: "Cliente inválido",
      whatsapp: "123",
      birth_date: "2030-10-10",
      cpf: "111.111.111-11",
      email: "invalido",
      postal_code: "123",
      state: "XX",
    },
  });

  assert.equal(invalid.status, 400, JSON.stringify(invalid.json));
  assert.deepEqual(Object.keys(invalid.json.field_errors).sort(), [
    "birth_date",
    "cpf",
    "email",
    "postal_code",
    "state",
    "whatsapp",
  ]);
});
