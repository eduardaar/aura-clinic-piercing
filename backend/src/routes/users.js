// Rotas de gestão de usuários (administrativo).
import { Router } from "express";
import bcrypt from "bcryptjs";
import { withDb } from "../middleware/withDb.js";
import { createToken, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { userCreateSchema, userUpdateSchema } from "../schemas/index.js";
import { parsePaging, fetchPage, pageResponse } from "../services/pagination.js";
import { invalidateUsageCache, requireWithinLimit } from "../services/planLimits.js";
import { createClinicSession, setRefreshCookie } from "../services/sessions.js";

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
  if (newPassword && newPassword.length < 8) {
    return res.status(400).json({ error: "A nova senha deve ter pelo menos 8 caracteres." });
  }
  if (newPassword && !(await bcrypt.compare(currentPassword, current.password_hash))) {
    return res.status(400).json({ error: "A senha atual não confere." });
  }
  const passwordHash = newPassword ? await bcrypt.hash(newPassword, 10) : current.password_hash;
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
  if (!requireRole(req, res, ["admin"])) return;
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
    select: "id, name, email, role, created_at",
    from: "users",
    where,
    params,
    orderBy: paging.orderBy,
    paging
  });
  res.json(pageResponse(rows, total, paging));
}));

router.post("/api/users", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  // Valida presença/tipo dos campos e exige senha com no mínimo 8 caracteres.
  if (!validateBody(userCreateSchema, req, res)) return;
  // Cota do plano. Depois da validação (payload torto é 400, não 409) e antes do
  // bcrypt, que é a parte cara deste handler. Plano sem cota de usuários não
  // custa nem uma consulta: o guard sai antes de medir.
  if (!(await requireWithinLimit(req, res, "users", db))) return;
  const { name, email, password, role } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await db.run(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?) RETURNING id",
    [name.trim(), email.trim(), passwordHash, role]
  );
  res.status(201).json(await db.get("SELECT id, name, email, role, created_at FROM users WHERE id = ?", [result.returnedId]));
}));

router.patch("/api/users/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
  // Valida tipos dos campos presentes; se vier password, exige mínimo de 8 caracteres.
  if (!validateBody(userUpdateSchema, req, res)) return;
  const user = await db.get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  const role = req.body.role || user.role;
  const continuityError = await assertAdminContinuity(db, user, role);
  if (continuityError) return res.status(409).json({ error: continuityError });
  // Só faz bcrypt hash quando o password vier no body (senão preserva o hash atual).
  const passwordHash = req.body.password ? await bcrypt.hash(req.body.password, 10) : user.password_hash;
  const invalidatesSessions = Boolean(req.body.password) || role !== user.role;
  await db.run(
    `UPDATE users
        SET name = ?, email = ?, role = ?, password_hash = ?,
            session_version = session_version + ?
      WHERE id = ?`,
    [
      req.body.name || user.name,
      req.body.email || user.email,
      role,
      passwordHash,
      invalidatesSessions ? 1 : 0,
      req.params.id
    ]
  );
  if (invalidatesSessions) {
    await db.run("UPDATE user_sessions SET revoked_at = now() WHERE user_id = ? AND revoked_at IS NULL", [user.id]);
  }
  res.json(await db.get("SELECT id, name, email, role, created_at FROM users WHERE id = ?", [req.params.id]));
}));

router.delete("/api/users/:id", withDb(async (req, res, db) => {
  if (!requireRole(req, res, ["admin"])) return;
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

export default router;
