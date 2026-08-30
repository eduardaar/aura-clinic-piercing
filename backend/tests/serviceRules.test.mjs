import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCompletionServiceRules,
  resolveServiceRules,
  validateAppointmentTimingRules,
  validateClientServiceRules
} from "../src/services/serviceRules.js";

test("serviço sem configuração produz regras neutras e não bloqueia o básico", () => {
  const rules = resolveServiceRules({ id: 1, active_online_booking: 1 });
  assert.equal(rules.minimum_age_years, null);
  assert.equal(rules.requires_guardian, false);
  assert.equal(rules.requires_signed_term, false);
  assert.equal(rules.minimum_advance_minutes, 0);
  assert.deepEqual(rules.postcare_days, []);
  assert.equal(validateClientServiceRules({ rules: [rules], client: {}, appointmentDate: "2026-09-10" }), "");
});

test("termo obrigatório usa o snapshot e impede somente a conclusão sem assinatura", async () => {
  const missingTermDb = {
    async get(sql) {
      return sql.includes("service_rules_snapshot") ? { service_rules_snapshot: [{ requires_signed_term: true }] } : null;
    }
  };
  await assert.rejects(assertCompletionServiceRules(missingTermDb, 10), /termo digital assinado/i);
  const signedDb = {
    async get(sql) {
      return sql.includes("service_rules_snapshot") ? { service_rules_snapshot: [{ requires_signed_term: true }] } : { id: 22 };
    }
  };
  await assert.doesNotReject(assertCompletionServiceRules(signedDb, 10));
});

test("variação herda o serviço e sobrescreve somente exceções explícitas", () => {
  const rules = resolveServiceRules({
    id: 4,
    minimum_age_years: 16,
    requires_guardian: true,
    requires_signed_term: true,
    postcare_enabled: true,
    postcare_days: [7, 30],
    active_online_booking: 1
  }, {
    id: 9,
    minimum_age_years: 18,
    requires_guardian: null,
    requires_signed_term: false,
    postcare_enabled: null
  });
  assert.equal(rules.minimum_age_years, 18);
  assert.equal(rules.requires_guardian, true);
  assert.equal(rules.requires_signed_term, false);
  assert.deepEqual(rules.postcare_days, [7, 30]);
});

test("idade, responsável e antecedência só bloqueiam quando configurados", () => {
  const rules = [{ minimum_age_years: 16, requires_guardian: true, minimum_advance_minutes: 120 }];
  assert.match(validateClientServiceRules({ rules, client: { birth_date: "2012-01-01" }, appointmentDate: "2026-09-10", guardianProvided: true }), /idade mínima/i);
  assert.match(validateClientServiceRules({ rules: [{ minimum_age_years: null, requires_guardian: true }], client: { birth_date: "2010-01-01" }, appointmentDate: "2026-09-10" }), /responsável legal/i);
  assert.match(validateAppointmentTimingRules({ rules, appointmentDate: "2026-09-10", appointmentTime: "10:00", now: new Date("2026-09-10T09:00:00") }), /120 minutos/i);
  assert.equal(validateAppointmentTimingRules({ rules, appointmentDate: "2026-09-10", appointmentTime: "12:00", now: new Date("2026-09-10T09:00:00") }), "");
});
