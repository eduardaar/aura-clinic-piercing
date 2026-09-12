import test from "node:test";
import assert from "node:assert/strict";
import { P, ALL_PERMISSIONS } from "../src/config/permissions.js";
import { ROLE_PERMISSIONS } from "../src/config/roles.js";
import { effectivePermissions, hasPermission, validatePermissionOverrides } from "../src/services/permissionService.js";
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

// Cargo → permissões padrão → exceções opcionais. Escolher "Financeiro" tem de
// bastar para a pessoa enxergar a área inteira; ninguém marca caixinha para
// ligar o que o cargo já define.
test("RBAC: Financeiro cobre a área inteira pelo cargo, sem exceções manuais", () => {
  const esperadas = [
    P.DASHBOARD_VIEW, P.DASHBOARD_FINANCIAL, P.FINANCE_VIEW, P.FINANCE_CREATE, P.FINANCE_EXPENSES, P.FINANCE_REFUND,
    P.CASH_VIEW, P.CASH_RECEIVE_PAYMENT, P.APPOINTMENTS_VIEW, P.SALES_VIEW, P.SALES_CANCEL, P.INVENTORY_VIEW,
    P.INVENTORY_VIEW_COST, P.REPORTS_VIEW_FINANCIAL, P.REPORTS_VIEW_ALL, P.COUPONS_VIEW, P.SETTINGS_VIEW, P.AUDIT_VIEW
  ];
  for (const permission of esperadas) assert.equal(hasPermission({ role: "finance" }, permission), true, permission);
  // Fora da área: continua exigindo exceção explícita.
  for (const permission of [P.USERS_PERMISSIONS, P.ANAMNESIS_EDIT, P.SETTINGS_EDIT, P.APPOINTMENTS_FINALIZE, P.CLINICAL_FILES_VIEW]) {
    assert.equal(hasPermission({ role: "finance" }, permission), false, permission);
  }
});

test("RBAC: effectivePermissions resolve cargo ou perfil mais exceções, e é o que vai ao frontend", () => {
  assert.deepEqual(effectivePermissions({ role: "admin" }), ["*"]);
  const finance = effectivePermissions({ role: "finance", granted_permissions: [P.USERS_VIEW], denied_permissions: [P.FINANCE_REFUND] });
  assert.ok(finance.includes(P.USERS_VIEW), "concessão individual entra");
  assert.ok(!finance.includes(P.FINANCE_REFUND), "bloqueio individual sai");
  assert.ok(finance.includes(P.FINANCE_VIEW), "padrão do cargo permanece");
  // Perfil de acesso substitui a base do cargo por completo.
  assert.deepEqual(effectivePermissions({ role: "reception", profile_permissions: [P.FINANCE_VIEW] }), [P.FINANCE_VIEW]);
  // Chave desconhecida nunca chega ao frontend — e nunca derruba o login.
  assert.equal(effectivePermissions({ role: "finance", granted_permissions: ["unknown.action"] }).includes("unknown.action"), false);
  assert.deepEqual(effectivePermissions(null), []);
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
