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

// Lista fechada do que o usuário pode fazer, já resolvida: cargo (ou perfil de
// acesso) + concessões − bloqueios. Vai no login e no refresh para o frontend
// montar menu e ações; assim a regra "Cargo → permissões padrão → ajustes
// individuais" vive só aqui, e não numa cópia da tabela de cargos. Admin
// recebe "*", o mesmo curinga que ROLE_PERMISSIONS usa.
export function effectivePermissions(user) {
  if (!user) return [];
  if (user.role === "admin") return ["*"];
  const denied = new Set(user.denied_permissions || []);
  const base = Array.isArray(user.profile_permissions) ? user.profile_permissions : (ROLE_PERMISSIONS[user.role] || []);
  return [...new Set([...base, ...(user.granted_permissions || [])])]
    .filter((permission) => PERMISSION_SET.has(permission) && !denied.has(permission))
    .sort();
}

export async function hydrateUserPermissions(db, user) {
  const rows = await db.all("SELECT permission, allowed FROM user_permissions WHERE user_id = ?", [user.id]);
  const profile = user.access_profile_id
    ? await db.get("SELECT id, name, base_role FROM access_profiles WHERE id = ? AND is_active = true", [user.access_profile_id])
    : null;
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
