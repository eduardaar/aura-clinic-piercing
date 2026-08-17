import test from "node:test";
import assert from "node:assert/strict";
import { P, ALL_PERMISSIONS } from "../src/config/permissions.js";
import { ROLE_PERMISSIONS } from "../src/config/roles.js";
import { hasPermission, validatePermissionOverrides } from "../src/services/permissionService.js";
import { redactInventoryCosts } from "../src/services/inventory.js";

test("RBAC: administrador possui acesso total", () => {
  for (const permission of ALL_PERMISSIONS) assert.equal(hasPermission({ role: "admin" }, permission), true, permission);
});

test("RBAC: bloqueio individual prevalece sobre o cargo", () => {
  assert.equal(hasPermission({ role: "piercer", denied_permissions: [P.APPOINTMENTS_FINALIZE] }, P.APPOINTMENTS_FINALIZE), false);
});

test("RBAC: concessão individual amplia o cargo", () => {
  assert.equal(hasPermission({ role: "reception", granted_permissions: [P.CASH_CLOSE] }, P.CASH_CLOSE), true);
});

test("RBAC: perfis respeitam fronteiras clínicas e financeiras", () => {
  assert.equal(hasPermission({ role: "piercer" }, P.APPOINTMENTS_FINALIZE), true);
  assert.equal(hasPermission({ role: "piercer" }, P.FINANCE_EDIT), false);
  assert.equal(hasPermission({ role: "reception" }, P.APPOINTMENTS_FINALIZE), false);
  assert.equal(hasPermission({ role: "finance" }, P.ANAMNESIS_EDIT), false);
  assert.equal(hasPermission({ role: "finance" }, P.FINANCE_REFUND), true);
});

test("RBAC: catálogo não contém permissões desconhecidas nos papéis", () => {
  for (const permissions of Object.values(ROLE_PERMISSIONS)) {
    for (const permission of permissions) assert.ok(permission === "*" || ALL_PERMISSIONS.includes(permission), permission);
  }
  assert.equal(validatePermissionOverrides([{ permission: "unknown.action", allowed: true }]), "Permissão personalizada inválida.");
});

test("RBAC: dados de custo são removidos inclusive das variações", () => {
  const [safe] = redactInventoryCosts([{
    id: 1, name: "Joia", sale_value: 100, cost_value: 25, total_cost_cents: 2500,
    variants: [{ id: 2, sale_value: 100, cost_value: 20, purchase_cost_cents: 2000 }]
  }]);
  assert.equal(safe.sale_value, 100);
  assert.equal(safe.cost_value, undefined);
  assert.equal(safe.total_cost_cents, undefined);
  assert.equal(safe.variants[0].sale_value, 100);
  assert.equal(safe.variants[0].cost_value, undefined);
  assert.equal(safe.variants[0].purchase_cost_cents, undefined);
});
