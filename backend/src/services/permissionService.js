import { PERMISSION_SET } from "../config/permissions.js";
import { ROLE_PERMISSIONS } from "../config/roles.js";

export function hasPermission(user, permission) {
  if (!user || !PERMISSION_SET.has(permission)) return false;
  if (user.role === "admin") return true;
  const denied = new Set(user.denied_permissions || []);
  if (denied.has(permission)) return false;
  return new Set([...(ROLE_PERMISSIONS[user.role] || []), ...(user.granted_permissions || [])]).has(permission);
}

export async function hydrateUserPermissions(db, user) {
  const rows = await db.all("SELECT permission, allowed FROM user_permissions WHERE user_id = ?", [user.id]);
  return {
    ...user,
    granted_permissions: rows.filter((row) => row.allowed).map((row) => row.permission),
    denied_permissions: rows.filter((row) => !row.allowed).map((row) => row.permission)
  };
}

export function validatePermissionOverrides(items) {
  if (!Array.isArray(items)) return "Permissões devem ser uma lista.";
  for (const item of items) {
    if (!item || !PERMISSION_SET.has(item.permission) || typeof item.allowed !== "boolean") return "Permissão personalizada inválida.";
  }
  return "";
}
