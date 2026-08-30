import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { ALL_PERMISSIONS, P } from "../config/permissions.js";
import { ROLE_PERMISSIONS } from "../config/roles.js";
import { recordAudit } from "../services/audit.js";

const router = Router();
const BASE_ROLES = new Set(["piercer", "reception", "finance"]);

function normalizeProfilePayload(body = {}, { partial = false } = {}) {
  const name = body.name == null ? undefined : String(body.name).trim();
  const description = body.description == null ? undefined : String(body.description).trim() || null;
  const baseRole = body.base_role == null ? undefined : String(body.base_role);
  const permissions = body.permissions == null || !Array.isArray(body.permissions)
    ? undefined
    : [...new Set(body.permissions.map(String))];
  if (!partial && !name) return { error: "Informe o nome do perfil." };
  if (name !== undefined && !name) return { error: "Informe o nome do perfil." };
  if (!partial && !baseRole) return { error: "Informe o perfil-base." };
  if (baseRole !== undefined && !BASE_ROLES.has(baseRole)) return { error: "Perfil-base inválido." };
  if (!partial && permissions === undefined) return { error: "Informe as permissões do perfil." };
  if (body.permissions != null && !Array.isArray(body.permissions)) return { error: "Lista de permissões inválida." };
  if (permissions !== undefined && permissions.some((item) => !ALL_PERMISSIONS.includes(item))) {
    return { error: "Lista de permissões inválida." };
  }
  return { name, description, baseRole, permissions };
}

async function profileById(db, id) {
  const profile = await db.get(
    `SELECT ap.*, u.name AS created_by_name,
            (SELECT COUNT(*) FROM users linked WHERE linked.access_profile_id = ap.id) AS users_count
       FROM access_profiles ap
       LEFT JOIN users u ON u.id = ap.created_by
      WHERE ap.id = ?`,
    [id]
  );
  if (!profile) return null;
  profile.permissions = (await db.all(
    "SELECT permission FROM access_profile_permissions WHERE profile_id = ? AND allowed = true ORDER BY permission",
    [id]
  )).map((row) => row.permission);
  return profile;
}

router.get("/api/access-profiles", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.USERS_PERMISSIONS)) return;
  const profiles = await db.all(
    `SELECT ap.*, COUNT(u.id)::integer AS users_count
       FROM access_profiles ap
       LEFT JOIN users u ON u.access_profile_id = ap.id
      GROUP BY ap.id
      ORDER BY ap.is_active DESC, ap.name`
  );
  const permissions = await db.all(
    "SELECT profile_id, permission FROM access_profile_permissions WHERE allowed = true ORDER BY permission"
  );
  res.json(profiles.map((profile) => ({
    ...profile,
    permissions: permissions.filter((row) => row.profile_id === profile.id).map((row) => row.permission)
  })));
}));

router.get("/api/access-profiles/:id", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.USERS_PERMISSIONS)) return;
  const profile = await profileById(db, req.params.id);
  if (!profile) return res.status(404).json({ error: "Perfil de acesso não encontrado." });
  res.json(profile);
}));

router.post("/api/access-profiles", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.USERS_PERMISSIONS)) return;
  const payload = normalizeProfilePayload(req.body);
  if (payload.error) return res.status(400).json({ error: payload.error });
  try {
    const created = await db.transaction(async (tx) => {
      const result = await tx.run(
        "INSERT INTO access_profiles (name, description, base_role, created_by) VALUES (?, ?, ?, ?) RETURNING id",
        [payload.name, payload.description, payload.baseRole, req.user.id]
      );
      for (const permission of payload.permissions) {
        await tx.run("INSERT INTO access_profile_permissions (profile_id, permission) VALUES (?, ?)", [result.returnedId, permission]);
      }
      const row = await profileById(tx, result.returnedId);
      await recordAudit(tx, { req, module: "users", action: "create", entityType: "access_profile", entityId: row.id, reason: "Criação de perfil de acesso", after: row });
      return row;
    });
    res.status(201).json(created);
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ error: "Já existe um perfil com esse nome." });
    throw error;
  }
}));

router.patch("/api/access-profiles/:id", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.USERS_PERMISSIONS)) return;
  const before = await profileById(db, req.params.id);
  if (!before) return res.status(404).json({ error: "Perfil de acesso não encontrado." });
  const payload = normalizeProfilePayload(req.body, { partial: true });
  if (payload.error) return res.status(400).json({ error: payload.error });
  const reason = String(req.body?.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "Informe o motivo da alteração." });
  try {
    const updated = await db.transaction(async (tx) => {
      await tx.run(
        `UPDATE access_profiles SET name = ?, description = ?, base_role = ?, updated_at = now() WHERE id = ?`,
        [payload.name ?? before.name, payload.description === undefined ? before.description : payload.description, payload.baseRole ?? before.base_role, before.id]
      );
      if (payload.permissions !== undefined) {
        await tx.run("DELETE FROM access_profile_permissions WHERE profile_id = ?", [before.id]);
        for (const permission of payload.permissions) {
          await tx.run("INSERT INTO access_profile_permissions (profile_id, permission) VALUES (?, ?)", [before.id, permission]);
        }
      }
      const row = await profileById(tx, before.id);
      await recordAudit(tx, { req, module: "users", action: "update", entityType: "access_profile", entityId: row.id, reason, before, after: row, severity: "warning" });
      return row;
    });
    res.json(updated);
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ error: "Já existe um perfil com esse nome." });
    throw error;
  }
}));

router.delete("/api/access-profiles/:id", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.USERS_PERMISSIONS)) return;
  const before = await profileById(db, req.params.id);
  if (!before) return res.status(404).json({ error: "Perfil de acesso não encontrado." });
  if (Number(before.users_count) > 0) return res.status(409).json({ error: "Desvincule os usuários antes de excluir este perfil." });
  const reason = String(req.body?.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "Informe o motivo da exclusão." });
  await db.transaction(async (tx) => {
    await tx.run("DELETE FROM access_profiles WHERE id = ?", [before.id]);
    await recordAudit(tx, { req, module: "users", action: "delete", entityType: "access_profile", entityId: before.id, reason, before, severity: "critical" });
  });
  res.json({ ok: true });
}));

router.get("/api/access-profile-templates", withDb(async (req, res) => {
  if (!authorizePermission(req, res, P.USERS_PERMISSIONS)) return;
  res.json({ roles: ROLE_PERMISSIONS });
}));

export default router;
