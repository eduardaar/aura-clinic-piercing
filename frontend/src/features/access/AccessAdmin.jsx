// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import { useState } from "react";
import { Button, Checkbox, Input, Select, StatusBadge } from "../../components/common/Ui";
import { Modal, CrudHeader, ConfirmDeleteModal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { asArray } from "../../lib/utils";
import { apiFetch, useFetch } from "../../lib/api";
import { defaultAccessUser } from "../../lib/defaultForms";
import { roleLabel } from "../../features/shared/helpers";
import "../../styles/agenda-admin-responsive.css";

const ROLE_OPTIONS = ["admin", "piercer", "reception", "finance"]
  .map((value) => ({ value, label: roleLabel(value) }));

export function AccessAdmin() {
  const { data, refresh } = useFetch("/users");
  const [form, setForm] = useState(defaultAccessUser());
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);
  const [permissionCatalog, setPermissionCatalog] = useState([]);
  const [rolePermissions, setRolePermissions] = useState([]);
  const [permissionOverrides, setPermissionOverrides] = useState({});
  const [permissionReason, setPermissionReason] = useState("");
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const users = asArray(data);
  const adminCount = users.filter((user) => user.role === "admin").length;
  const lastAdminMessage = "Não é possível remover o acesso do último administrador geral. Cadastre ou promova outro administrador antes de alterar esta conta.";

  function openNew() {
    setEditing(null);
    setForm(defaultAccessUser());
    setError("");
    setModalOpen(true);
  }

  async function openEdit(user) {
    setEditing(user);
    setForm({ name: user.name, email: user.email, role: user.role, status: user.status || "active", password: "" });
    setError("");
    setPermissionReason("");
    setModalOpen(true);
    const [catalogResponse, userResponse] = await Promise.all([apiFetch("/permissions"), apiFetch(`/users/${user.id}/permissions`)]);
    const catalog = await catalogResponse.json().catch(() => ({}));
    const permissions = await userResponse.json().catch(() => ({}));
    if (!catalogResponse.ok || !userResponse.ok) return setError(catalog.error || permissions.error || "Não foi possível carregar as permissões.");
    setPermissionCatalog(catalog.permissions || []);
    setRolePermissions(permissions.role_permissions || []);
    setPermissionOverrides(Object.fromEntries((permissions.overrides || []).map((item) => [item.permission, item.allowed])));
  }

  function isProtectedLastAdmin(user = editing) {
    return Boolean(user?.role === "admin" && adminCount <= 1);
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    if (isProtectedLastAdmin() && form.role !== "admin") {
      setError(lastAdminMessage);
      return;
    }
    const response = await apiFetch(`/users${editing ? `/${editing.id}` : ""}`, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível salvar o usuário.");
    if (editing && permissionReason) {
      const permissionResponse = await apiFetch(`/users/${editing.id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: permissionReason, overrides: Object.entries(permissionOverrides).map(([permission, allowed]) => ({ permission, allowed })) })
      });
      if (!permissionResponse.ok) return setError((await permissionResponse.json()).error || "Não foi possível salvar as permissões.");
    }
    setForm(defaultAccessUser());
    setEditing(null);
    setModalOpen(false);
    refresh();
  }

  async function remove(user) {
    if (isProtectedLastAdmin(user)) {
      setError(lastAdminMessage);
      return;
    }
    await apiFetch(`/users/${user.id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <section className="stack">
      <div className="panel">
        <CrudHeader
          title="Usuários"
          subtitle="Níveis administrativos e acessos da equipe"
          actionLabel="Novo usuário"
          onAction={openNew}
        />
        <DataView
          rows={users}
          defaultSort={{ key: "name", dir: "asc" }}
          searchPlaceholder="Buscar por nome, e-mail ou nível"
          filters={[
            { key: "role", label: "Nível de acesso", type: "select", options: ROLE_OPTIONS },
          ]}
          columns={[
            { key: "name", label: "Nome" },
            { key: "email", label: "E-mail" },
            { key: "role", label: "Nível", value: (user) => roleLabel(user.role), render: (user) => <StatusBadge status={roleLabel(user.role)} /> },
          ]}
          actions={(user) => (
            <RowActions
              actions={[
                { label: "Editar", onClick: () => openEdit(user), primary: true },
                { label: "Excluir", onClick: () => setDeleting({ message: `Remover o acesso de ${user.name}?`, run: () => remove(user) }), danger: true, disabled: isProtectedLastAdmin(user) },
              ]}
            />
          )}
          empty="Nenhum usuário cadastrado ainda."
        />
      </div>

      <Modal
        open={modalOpen}
        title={editing ? "Editar acesso" : "Novo acesso"}
        subtitle="Níveis administrativos"
        onClose={() => setModalOpen(false)}
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" form="access-user-form" variant="primary">{editing ? "Salvar alterações" : "Criar usuário"}</Button>
          </>
        )}
      >
        <form id="access-user-form" onSubmit={save}>
          <div className="form-grid">
            <Input label="Nome" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
            <Input label="E-mail" value={form.email} onChange={(value) => setForm({ ...form, email: value })} required />
            <Input type="password" label={editing ? "Nova senha (opcional)" : "Senha"} value={form.password} onChange={(value) => setForm({ ...form, password: value })} required={!editing} />
            <Select label="Nível de acesso" value={form.role} onChange={(value) => setForm({ ...form, role: value })}>
              <option value="admin">Administrador Geral</option>
              <option value="piercer" disabled={isProtectedLastAdmin()}>Body Piercer</option>
              <option value="reception" disabled={isProtectedLastAdmin()}>Recepção</option>
              <option value="finance" disabled={isProtectedLastAdmin()}>Financeiro</option>
            </Select>
            {editing && <Select label="Status" value={form.status || "active"} onChange={(value) => setForm({ ...form, status: value })}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </Select>}
          </div>
          {editing && permissionCatalog.length > 0 && <div className="stack">
            <h3>Permissões</h3>
            <p>Sem personalização, vale o padrão do cargo. Alterações individuais ficam auditadas.</p>
            <div className="permission-grid">
              {permissionCatalog.map((permission) => {
                const custom = Object.hasOwn(permissionOverrides, permission);
                const effective = custom ? permissionOverrides[permission] : rolePermissions.includes("*") || rolePermissions.includes(permission);
                return <Checkbox key={permission} className="checkbox-row" checked={effective} disabled={form.role === "admin"} onChange={(checked) => setPermissionOverrides({ ...permissionOverrides, [permission]: checked })} label={<span>{permission} <small>{custom ? (permissionOverrides[permission] ? "· personalizada" : "· bloqueada") : "· padrão do cargo"}</small></span>} />;
              })}
            </div>
            <Button type="button" variant="secondary" onClick={() => setPermissionOverrides({})}>Restaurar permissões padrão do cargo</Button>
            <Input label="Motivo da alteração de permissões" value={permissionReason} onChange={setPermissionReason} />
          </div>}
          {isProtectedLastAdmin() && <span className="form-error">{lastAdminMessage}</span>}
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>

      <ConfirmDeleteModal
        open={!!deleting}
        message={deleting?.message}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { await deleting.run(); setDeleting(null); }}
      />
    </section>
  );
}
