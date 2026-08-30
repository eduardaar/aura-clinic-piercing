import { PERMISSION_SET } from "../config/permissions.js";
import { ROLE_PERMISSIONS } from "../config/roles.js";

export function hasPermission(user, permission) {
  if (!user || !PERMISSION_SET.has(permission)) return false;
  if (user.role === "admin") return true;
  const denied = new Set(user.denied_permissions || []);
  if (denied.has(permission)) return false;
  const basePermissions = Array.isArray(user.profile_permissions)
    ? user.profile_permissions
    : (ROLE_PERMISSIONS[user.role] || []);
  return new Set([...basePermissions, ...(user.granted_permissions || [])]).has(permission);
}

export async function hydrateUserPermissions(db, user) {
  const [rows, profile] = await Promise.all([
    db.all("SELECT permission, allowed FROM user_permissions WHERE user_id = ?", [user.id]),
    user.access_profile_id
      ? db.get("SELECT id, name, base_role FROM access_profiles WHERE id = ? AND is_active = true", [user.access_profile_id])
      : Promise.resolve(null)
  ]);
  const profilePermissions = profile
    ? (await db.all("SELECT permission FROM access_profile_permissions WHERE profile_id = ? AND allowed = true", [profile.id])).map((row) => row.permission)
    : null;
  return {
    ...user,
    access_profile: profile,
    profile_permissions: profilePermissions,
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
