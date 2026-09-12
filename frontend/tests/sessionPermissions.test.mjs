import assert from "node:assert/strict";
import test from "node:test";
import { can, canAccessPage } from "../src/lib/permissions.js";

// O backend devolve no login a lista já resolvida (cargo ou perfil + exceções).
// Quando ela existe, o frontend não consulta mais a tabela local de cargos.
test("lista resolvida pelo backend vence a tabela local de cargos", () => {
  const user = { role: "reception", permissions: ["finance.view", "clients.view"] };
  assert.equal(can(user, "finance.view"), true, "perfil personalizado liberou o financeiro");
  assert.equal(can(user, "appointments.create"), false, "padrão da recepção, mas fora do perfil");
  assert.equal(canAccessPage(user, "receivables"), true);
  assert.equal(canAccessPage(user, "agenda"), false);
});

test("curinga do administrador e sessão antiga sem lista caem no cargo", () => {
  assert.equal(can({ role: "finance", permissions: ["*"] }, "users.permissions"), true);
  assert.equal(can({ role: "finance" }, "reports.view_all"), true);
  assert.equal(can({ role: "finance" }, "coupons.view"), true);
  assert.equal(can({ role: "finance", denied_permissions: ["coupons.view"] }, "coupons.view"), false);
  assert.equal(can({ role: "reception", granted_permissions: ["finance.view"] }, "finance.view"), true);
});

test("Financeiro enxerga a área inteira só pelo cargo", () => {
  const paginas = ["dashboard", "receivables", "payables", "purchases", "suppliers", "sales", "inventory", "reports", "audit", "settings", "agenda", "client-center"];
  for (const page of paginas) assert.equal(canAccessPage("finance", page), true, page);
  assert.equal(canAccessPage("finance", "admin"), false, "usuários e permissões seguem restritos");
  assert.equal(canAccessPage("finance", "terms"), false, "termos clínicos seguem restritos");
});
