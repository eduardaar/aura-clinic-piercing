// Rotas de gestão de usuários (administrativo).
import { Router } from "express";
import bcrypt from "bcryptjs";
import { withDb } from "../middleware/withDb.js";
import { createToken } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { userCreateSchema, userUpdateSchema } from "../schemas/index.js";
import { parsePaging, fetchPage, pageResponse } from "../services/pagination.js";
import { invalidateUsageCache, requireWithinLimit } from "../services/planLimits.js";
import { createClinicSession, setRefreshCookie } from "../services/sessions.js";
import { P, ALL_PERMISSIONS, PERMISSION_CATALOG } from "../config/permissions.js";
import { ROLE_PERMISSIONS } from "../config/roles.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { validatePermissionOverrides } from "../services/permissionService.js";
import { recordAudit } from "../services/audit.js";

const router = Router();
const LAST_ADMIN_MESSAGE = "Não é possível remover o acesso do último administrador geral. Cadastre ou promova outro administrador antes de alterar esta conta.";

const USER_PUBLIC_SELECT = `
  u.id, u.name, u.email, u.role, u.status, u.created_at,
  u.access_profile_id, ap.name AS access_profile_name,
  u.professional_id, p.name AS professional_name`;

async function getPublicUser(db, id) {
  return db.get(
    `SELECT ${USER_PUBLIC_SELECT}
       FROM users u
       LEFT JOIN access_profiles ap ON ap.id = u.access_profile_id
       LEFT JOIN professionals p ON p.id = u.professional_id
      WHERE u.id = ?`,
    [id]
  );
}

async function resolveAccessLinks(db, body, current = {}) {
  const accessProfileId = Object.hasOwn(body, "access_profile_id") ? body.access_profile_id : current.access_profile_id;
  const professionalId = Object.hasOwn(body, "professional_id") ? body.professional_id : current.professional_id;
  let profile = null;
  if (accessProfileId != null) {
    profile = await db.get("SELECT id, name, base_role FROM access_profiles WHERE id = ? AND is_active = true", [accessProfileId]);
    if (!profile) return { error: "Perfil de acesso não encontrado ou inativo." };
  }
  if (professionalId != null) {
    const professional = await db.get("SELECT id FROM professionals WHERE id = ?", [professionalId]);
    if (!professional) return { error: "Profissional vinculado não encontrado." };
  }
  return {
    accessProfileId: accessProfileId ?? null,
    professionalId: professionalId ?? null,
    role: profile?.base_role || body.role || current.role,
    profile
  };
}

// Preferências pessoais não passam pelo CRUD administrativo: qualquer pessoa
// autenticada pode atualizar o próprio nome/e-mail e trocar a senha, mas nunca
// o próprio papel. A senha atual é exigida só quando a nova senha foi enviada.
router.patch("/api/account/profile", withDb(async (req, res, db) => {
  const current = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!current) return res.status(401).json({ error: "Sessão inválida ou expirada." });
  const name = String(req.body?.name ?? current.name).trim();
  const email = String(req.body?.email ?? current.email).trim().toLowerCase();
  const newPassword = String(req.body?.new_password || "");
  const currentPassword = String(req.body?.current_password || "");
  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: "Informe nome e e-mail válidos." });
  }
  if (newPassword && newPassword.length < 12) {
    return res.status(400).json({ error: "A nova senha deve ter pelo menos 12 caracteres." });
  }
  if (newPassword && !(await bcrypt.compare(currentPassword, current.password_hash))) {
    return res.status(400).json({ error: "A senha atual não confere." });
  }
  const passwordHash = newPassword ? await bcrypt.hash(newPassword, 12) : current.password_hash;
  try {
    await db.run(
      `UPDATE users
          SET name = ?, email = ?, password_hash = ?,
              session_version = session_version + ?
        WHERE id = ?`,
      [name, email, passwordHash, newPassword ? 1 : 0, current.id]
    );
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ error: "Este e-mail já está em uso nesta clínica." });
    throw error;
  }
  const user = await db.get(
    "SELECT id, name, email, role, session_version FROM users WHERE id = ?",
    [current.id]
  );
  let token;
  if (newPassword) {
    await db.run("UPDATE user_sessions SET revoked_at = now() WHERE user_id = ? AND revoked_at IS NULL", [current.id]);
    const session = await createClinicSession(db, user, req);
    setRefreshCookie(res, session.refreshToken);
    token = createToken(user, req.tenant, { sessionId: session.id });
  }
  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    // Mantém a sessão atual viva com uma credencial já na nova versão; todas as
    // outras abas/dispositivos continuam revogados.
    ...(token ? { token } : {})
  });
}));

// Whitelist de ordenação: a query escolhe a CHAVE, o servidor define a coluna.
const USER_SORTABLE = {
  name: "u.name",
  email: "u.email",
  role: "u.role",
  created_at: "u.created_at"
};

async function assertAdminContinuity(db, targetUser, nextRole) {
  if (targetUser.role !== "admin" || nextRole === "admin") return null;
  const admins = await db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
  if (Number(admins?.count || 0) <= 1) return LAST_ADMIN_MESSAGE;
  return null;
}

router.get("/api/users", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.USERS_VIEW)) return;
  const clauses = [];
  const params = [];
  if (req.query.role) {
    clauses.push("u.role = ?");
    params.push(req.query.role);
  }
  if (req.query.search) {
    clauses.push("(u.name ILIKE ? OR u.email ILIKE ?)");
    params.push(...Array(2).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: USER_SORTABLE,
    tieBreak: "u.id",
    defaultOrderBy: "ORDER BY u.name, u.id"
  });
  // Nunca devolve password_hash: a lista de colunas é fixa no servidor.
  const { rows, total } = await fetchPage(db, {
    select: USER_PUBLIC_SELECT,
    from: "users u LEFT JOIN access_profiles ap ON ap.id = u.access_profile_id LEFT JOIN professionals p ON p.id = u.professional_id",
    where,
    params,
    orderBy: paging.orderBy,
    paging
  });
  res.json(pageResponse(rows, total, paging));
}));

router.post("/api/users", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.USERS_CREATE)) return;
  // Valida presença/tipo dos campos e exige senha com no mínimo 12 caracteres.
  if (!validateBody(userCreateSchema, req, res)) return;
  // Cota do plano. Depois da validação (payload torto é 400, não 409) e antes do
  // bcrypt, que é a parte cara deste handler. Plano sem cota de usuários não
  // custa nem uma consulta: o guard sai antes de medir.
  if (!(await requireWithinLimit(req, res, "users", db))) return;
  const { name, email, password } = req.body;
  const links = await resolveAccessLinks(db, req.body);
  if (links.error) return res.status(400).json({ error: links.error });
  const overrideError = validatePermissionOverrides(req.body.permission_overrides || []);
  if (overrideError) return res.status(400).json({ error: overrideError });
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const created = await db.transaction(async (tx) => {
      const result = await tx.run(
        `INSERT INTO users (name, email, password_hash, role, access_profile_id, professional_id)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        [name.trim(), email.trim().toLowerCase(), passwordHash, links.role, links.accessProfileId, links.professionalId]
      );
      for (const item of req.body.permission_overrides || []) {
        await tx.run(
          "INSERT INTO user_permissions (user_id, permission, allowed, created_by) VALUES (?, ?, ?, ?)",
          [result.returnedId, item.permission, item.allowed, req.user.id]
        );
      }
      const row = await getPublicUser(tx, result.returnedId);
      await recordAudit(tx, {
        req, module: "users", action: "create", entityType: "user", entityId: row.id,
        reason: String(req.body?.reason || "Cadastro administrativo"),
        after: { ...row, permission_overrides: req.body.permission_overrides || [] }
      });
      return row;
    });
    res.status(201).json(created);
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ error: "Este e-mail já está em uso nesta clínica." });
    throw error;
  }
}));

router.patch("/api/users/:id", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.USERS_EDIT)) return;
  // Valida tipos dos campos presentes; se vier password, exige mínimo de 12 caracteres.
  if (!validateBody(userUpdateSchema, req, res)) return;
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  const links = await resolveAccessLinks(db, req.body, user);
  if (links.error) return res.status(400).json({ error: links.error });
  const role = links.role;
  const continuityError = await assertAdminContinuity(db, user, role);
  if (continuityError) return res.status(409).json({ error: continuityError });
  // Só faz bcrypt hash quando o password vier no body (senão preserva o hash atual).
  const passwordHash = req.body.password ? await bcrypt.hash(req.body.password, 12) : user.password_hash;
  const status = req.body.status || user.status || "active";
  if (!["active", "inactive"].includes(status)) return res.status(400).json({ error: "Status de usuário inválido." });
  const invalidatesSessions = Boolean(req.body.password) || role !== user.role || status !== user.status
    || Number(links.accessProfileId || 0) !== Number(user.access_profile_id || 0);
  try {
    const updated = await db.transaction(async (tx) => {
      await tx.run(
        `UPDATE users
            SET name = ?, email = ?, role = ?, status = ?, password_hash = ?,
                access_profile_id = ?, professional_id = ?,
                session_version = session_version + ?
          WHERE id = ?`,
        [
          req.body.name || user.name,
          String(req.body.email || user.email).trim().toLowerCase(),
          role, status, passwordHash, links.accessProfileId, links.professionalId,
          invalidatesSessions ? 1 : 0, req.params.id
        ]
      );
      if (invalidatesSessions) {
        await tx.run("UPDATE user_sessions SET revoked_at = now() WHERE user_id = ? AND revoked_at IS NULL", [user.id]);
      }
      const row = await getPublicUser(tx, user.id);
      await recordAudit(tx, {
        req, module: "users", action: "update", entityType: "user", entityId: row.id,
        reason: String(req.body?.reason || "Alteração administrativa"),
        before: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, access_profile_id: user.access_profile_id, professional_id: user.professional_id },
        after: row, severity: "warning"
      });
      return row;
    });
    res.json(updated);
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ error: "Este e-mail já está em uso nesta clínica." });
    throw error;
  }
}));

router.delete("/api/users/:id", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.USERS_DELETE)) return;
  if (Number(req.params.id) === Number(req.user.id)) {
    return res.status(409).json({ error: "Você não pode apagar o próprio acesso." });
  }
  const target = await getPublicUser(db, req.params.id);
  if (!target) return res.status(404).json({ error: "Usuário não encontrado." });
  if (target.role === "admin") {
    const continuityError = await assertAdminContinuity(db, target, "deleted");
    if (continuityError) return res.status(409).json({ error: continuityError });
  }
  const reason = String(req.body?.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "Informe o motivo da exclusão." });
  await db.transaction(async (tx) => {
    await tx.run("DELETE FROM users WHERE id = ?", [req.params.id]);
    await recordAudit(tx, {
      req, module: "users", action: "delete", entityType: "user", entityId: target.id,
      reason, before: target, severity: "critical"
    });
  });
  // Liberou uma vaga na cota: o número medido há segundos ficou velho, e quem
  // apagou um usuário costuma cadastrar outro em seguida.
  invalidateUsageCache(req.tenant?.id);
  res.json({ ok: true });
}));

router.get("/api/permissions", withDb(async (req, res) => {
  if (!authorizePermission(req, res, P.USERS_PERMISSIONS)) return;
  res.json({ permissions: ALL_PERMISSIONS, catalog: PERMISSION_CATALOG, roles: ROLE_PERMISSIONS });
}));

router.get("/api/users/:id/permissions", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.USERS_PERMISSIONS)) return;
  const user = await getPublicUser(db, req.params.id);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  const overrides = await db.all("SELECT permission, allowed, created_at, updated_at FROM user_permissions WHERE user_id = ? ORDER BY permission", [user.id]);
  const profilePermissions = user.access_profile_id
    ? (await db.all("SELECT permission FROM access_profile_permissions WHERE profile_id = ? AND allowed = true ORDER BY permission", [user.access_profile_id])).map((row) => row.permission)
    : null;
  res.json({
    user,
    role_permissions: ROLE_PERMISSIONS[user.role] || [],
    profile_permissions: profilePermissions,
    effective_base: profilePermissions || ROLE_PERMISSIONS[user.role] || [],
    overrides
  });
}));

router.put("/api/users/:id/permissions", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.USERS_PERMISSIONS)) return;
  const target = await db.get("SELECT id, role FROM users WHERE id = ?", [req.params.id]);
  if (!target) return res.status(404).json({ error: "Usuário não encontrado." });
  const overrides = req.body?.overrides ?? [];
  const validationError = validatePermissionOverrides(overrides);
  if (validationError) return res.status(400).json({ error: validationError });
  if (target.role === "admin" && overrides.some((item) => !item.allowed)) return res.status(400).json({ error: "O Administrador Geral sempre possui acesso total." });
  const reason = String(req.body?.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "Informe o motivo da alteração de permissões." });
  const before = await db.all("SELECT permission, allowed FROM user_permissions WHERE user_id = ? ORDER BY permission", [target.id]);
  await db.transaction(async (tx) => {
    await tx.run("DELETE FROM user_permissions WHERE user_id = ?", [target.id]);
    for (const item of overrides) {
      await tx.run("INSERT INTO user_permissions (user_id, permission, allowed, created_by) VALUES (?, ?, ?, ?)", [target.id, item.permission, item.allowed, req.user.id]);
    }
    await recordAudit(tx, {
      req, module: "users", action: "replace_permissions", entityType: "user", entityId: target.id,
      reason, before: { permissions: before }, after: { permissions: overrides }, severity: "critical"
    });
  });
  res.json({ ok: true, overrides });
}));

export default router;
