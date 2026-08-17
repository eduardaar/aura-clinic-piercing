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
import { P, ALL_PERMISSIONS } from "../config/permissions.js";
import { ROLE_PERMISSIONS } from "../config/roles.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import { validatePermissionOverrides } from "../services/permissionService.js";

const router = Router();
const LAST_ADMIN_MESSAGE = "Não é possível remover o acesso do último administrador geral. Cadastre ou promova outro administrador antes de alterar esta conta.";

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
  name: "name",
  email: "email",
  role: "role",
  created_at: "created_at"
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
    clauses.push("role = ?");
    params.push(req.query.role);
  }
  if (req.query.search) {
    clauses.push("(name ILIKE ? OR email ILIKE ?)");
    params.push(...Array(2).fill(`%${req.query.search}%`));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: USER_SORTABLE,
    tieBreak: "id",
    defaultOrderBy: "ORDER BY name, id"
  });
  // Nunca devolve password_hash: a lista de colunas é fixa no servidor.
  const { rows, total } = await fetchPage(db, {
    select: "id, name, email, role, status, created_at",
    from: "users",
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
  const { name, email, password, role } = req.body;
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await db.run(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?) RETURNING id",
    [name.trim(), email.trim(), passwordHash, role]
  );
  const created = await db.get("SELECT id, name, email, role, status, created_at FROM users WHERE id = ?", [result.returnedId]);
  await db.run("INSERT INTO administrative_audit_logs (tenant_id, entity_type, entity_id, action, reason, user_id, snapshot) VALUES (?, 'user', ?, 'create', 'Cadastro administrativo', ?, ?)", [req.tenant.id, created.id, req.user.id, JSON.stringify(created)]);
  res.status(201).json(created);
}));

router.patch("/api/users/:id", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.USERS_EDIT)) return;
  // Valida tipos dos campos presentes; se vier password, exige mínimo de 12 caracteres.
  if (!validateBody(userUpdateSchema, req, res)) return;
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  const role = req.body.role || user.role;
  const continuityError = await assertAdminContinuity(db, user, role);
  if (continuityError) return res.status(409).json({ error: continuityError });
  // Só faz bcrypt hash quando o password vier no body (senão preserva o hash atual).
  const passwordHash = req.body.password ? await bcrypt.hash(req.body.password, 12) : user.password_hash;
  const status = req.body.status || user.status || "active";
  if (!["active", "inactive"].includes(status)) return res.status(400).json({ error: "Status de usuário inválido." });
  const invalidatesSessions = Boolean(req.body.password) || role !== user.role || status !== user.status;
  await db.run(
    `UPDATE users
        SET name = ?, email = ?, role = ?, status = ?, password_hash = ?,
            session_version = session_version + ?
      WHERE id = ?`,
    [
      req.body.name || user.name,
      req.body.email || user.email,
      role,
      status,
      passwordHash,
      invalidatesSessions ? 1 : 0,
      req.params.id
    ]
  );
  if (invalidatesSessions) {
    await db.run("UPDATE user_sessions SET revoked_at = now() WHERE user_id = ? AND revoked_at IS NULL", [user.id]);
  }
  const updated = await db.get("SELECT id, name, email, role, status, created_at FROM users WHERE id = ?", [req.params.id]);
  await db.run("INSERT INTO administrative_audit_logs (tenant_id, entity_type, entity_id, action, reason, user_id, snapshot) VALUES (?, 'user', ?, 'update', 'Alteração administrativa', ?, ?)", [req.tenant.id, updated.id, req.user.id, JSON.stringify({ target_user_id: updated.id, actor_user_id: req.user.id, before: { role: user.role, status: user.status }, after: updated })]);
  res.json(updated);
}));

router.delete("/api/users/:id", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.USERS_DELETE)) return;
  if (Number(req.params.id) === Number(req.user.id)) {
    return res.status(409).json({ error: "Você não pode apagar o próprio acesso." });
  }
  const target = await db.get("SELECT id, role FROM users WHERE id = ?", [req.params.id]);
  if (!target) return res.status(404).json({ error: "Usuário não encontrado." });
  if (target.role === "admin") {
    const continuityError = await assertAdminContinuity(db, target, "deleted");
    if (continuityError) return res.status(409).json({ error: continuityError });
  }
  await db.run("DELETE FROM users WHERE id = ?", [req.params.id]);
  // Liberou uma vaga na cota: o número medido há segundos ficou velho, e quem
  // apagou um usuário costuma cadastrar outro em seguida.
  invalidateUsageCache(req.tenant?.id);
  res.json({ ok: true });
}));

router.get("/api/permissions", withDb(async (req, res) => {
  if (!authorizePermission(req, res, P.USERS_PERMISSIONS)) return;
  res.json({ permissions: ALL_PERMISSIONS, roles: ROLE_PERMISSIONS });
}));

router.get("/api/users/:id/permissions", withDb(async (req, res, db) => {
  if (!authorizePermission(req, res, P.USERS_PERMISSIONS)) return;
  const user = await db.get("SELECT id, name, email, role, status FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  const overrides = await db.all("SELECT permission, allowed, created_at, updated_at FROM user_permissions WHERE user_id = ? ORDER BY permission", [user.id]);
  res.json({ user, role_permissions: ROLE_PERMISSIONS[user.role] || [], overrides });
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
    await tx.run("INSERT INTO administrative_audit_logs (tenant_id, entity_type, entity_id, action, reason, user_id, snapshot) VALUES (?, 'user_permissions', ?, 'replace', ?, ?, ?)", [req.tenant.id, target.id, reason, req.user.id, JSON.stringify({ target_user_id: target.id, actor_user_id: req.user.id, role_before: target.role, role_after: target.role, permissions_before: before, permissions_after: overrides })]);
  });
  res.json({ ok: true, overrides });
}));

export default router;
