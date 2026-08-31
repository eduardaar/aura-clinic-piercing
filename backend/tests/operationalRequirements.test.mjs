import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeOperationalRequirements,
  prepareOperationalCompletion,
  resolveOperationalRequirements
} from "../src/services/operationalRequirements.js";

test("configuração vazia não bloqueia o atendimento básico", () => {
  const result = prepareOperationalCompletion({ requirements: null, appointment: {}, user: {} });
  assert.deepEqual(result.checklistSnapshot, []);
  assert.deepEqual(result.biosafetySnapshot, { enabled: false });
});

test("variação pode substituir o padrão da clínica", () => {
  const result = resolveOperationalRequirements({
    clinic: { checklist: [{ key: "clinic", label: "Clínica" }], biosafety: { enabled: true } },
    service: { checklist_config: null, biosafety_config: null },
    variation: { checklist_config: [{ key: "variation", label: "Variação", required: true }], biosafety_config: { enabled: false } }
  });
  assert.deepEqual(result.checklist.map((item) => item.key), ["variation"]);
  assert.equal(result.biosafety.enabled, false);
});

test("somente itens configurados como obrigatórios bloqueiam conclusão", () => {
  const requirements = { checklist: [{ key: "term", label: "Conferir termo", required: true }, { key: "photo", label: "Foto" }] };
  assert.throws(() => prepareOperationalCompletion({ requirements, checklist: [], appointment: {}, user: {} }), /Conferir termo/);
  const result = prepareOperationalCompletion({ requirements, checklist: [{ key: "term", completed: true }], appointment: {}, user: { id: 9 } });
  assert.equal(result.checklistSnapshot[0].completed_by_user_id, 9);
  assert.equal(result.checklistSnapshot[1].completed, false);
});

test("biossegurança valida só os campos escolhidos e preserva lote", () => {
  const requirements = { biosafety: { enabled: true, required_fields: ["material_lots", "sterilization_cycle"] } };
  assert.throws(() => prepareOperationalCompletion({ requirements, biosafety: {}, appointment: {}, user: {} }), /rastreabilidade/);
  const result = prepareOperationalCompletion({
    requirements,
    biosafety: { sterilization_cycle: "AUTO-42", material_lots: [{ batch_code: "AG-123", quantity: 2 }] },
    appointment: { professional_id: 7 },
    user: { id: 3 }
  });
  assert.equal(result.biosafetySnapshot.material_lots[0].batch_code, "AG-123");
  assert.equal(result.biosafetySnapshot.professional_id, 7);
});

test("múltiplos itens do agendamento são unidos sem perder obrigatoriedade", () => {
  const merged = mergeOperationalRequirements([
    { checklist: [{ key: "term", label: "Termo" }] },
    { checklist: [{ key: "term", label: "Termo", required: true }], biosafety: { enabled: true, required_fields: ["applied_jewelry"] } }
  ]);
  assert.equal(merged.checklist.length, 1);
  assert.equal(merged.checklist[0].required, true);
  assert.deepEqual(merged.biosafety.required_fields, ["applied_jewelry"]);
});
