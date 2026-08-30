import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Input, Select, StatusBadge, Tabs, Textarea } from "../../components/common/Ui";
import { CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { asArray } from "../../lib/utils";
import { apiFetch, useFetch } from "../../lib/api";
import { roleLabel } from "../../features/shared/helpers";
import "./access-admin.css";

const ROLE_OPTIONS = ["admin", "piercer", "reception", "finance"]
  .map((value) => ({ value, label: roleLabel(value) }));
const PROFILE_ROLE_OPTIONS = ROLE_OPTIONS.filter(({ value }) => value !== "admin");
const LAST_ADMIN_MESSAGE = "Não é possível remover o acesso do último administrador geral. Cadastre ou promova outro administrador antes de alterar esta conta.";

const emptyUser = () => ({
  name: "", email: "", password: "", role: "reception", status: "active",
  access_profile_id: "", professional_id: "", reason: ""
});
const emptyProfile = () => ({ name: "", description: "", base_role: "reception", permissions: [], reason: "" });
const listItems = (payload) => asArray(payload?.items).length ? asArray(payload.items) : asArray(payload);
const serializeOverrides = (overrides) => JSON.stringify(Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right)));

async function requestJson(path, options) {
  const response = await apiFetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
  return payload;
}

function PermissionEditor({ catalog, basePermissions, overrides, onChange, disabled = false }) {
  const groups = useMemo(() => Object.entries(catalog.reduce((result, permission) => {
    if (!result[permission.module_label]) result[permission.module_label] = [];
    result[permission.module_label].push(permission);
    return result;
  }, {})), [catalog]);
  const baseAllows = (key) => basePermissions.includes("*") || basePermissions.includes(key);

  function toggle(key, checked) {
    const next = { ...overrides };
    if (checked === baseAllows(key)) delete next[key];
    else next[key] = checked;
    onChange(next);
  }

  if (!catalog.length) return <p className="access-muted">O catálogo de permissões ainda não foi carregado.</p>;
  return (
    <div className="access-permission-groups">
      {groups.map(([group, permissions]) => (
        <fieldset className="access-permission-group" key={group}>
          <legend>{group}</legend>
          <div className="permission-grid">
            {permissions.map((permission) => {
              const custom = Object.hasOwn(overrides, permission.key);
              const checked = custom ? overrides[permission.key] : baseAllows(permission.key);
              return (
                <Checkbox
                  key={permission.key}
                  className="checkbox-row"
                  checked={checked}
                  disabled={disabled}
                  onChange={(value) => toggle(permission.key, value)}
                  label={(
                    <span className="access-permission-label">
                      <strong>{permission.label}</strong>
                      <small>
                        {custom ? (checked ? "Exceção: permitido" : "Exceção: bloqueado") : "Padrão do perfil"}
                        {permission.risk === "high" ? " · ação sensível" : ""}
                      </small>
                    </span>
                  )}
                />
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function DeleteReasonModal({ target, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!target) {
      setReason("");
      setConfirmation("");
      setError("");
      setBusy(false);
    }
  }, [target]);
  const ready = reason.trim().length >= 5 && confirmation.trim().toUpperCase() === "SIM";

  async function confirm() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (caught) {
      setError(caught.message || "Não foi possível excluir.");
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(target)}
      size="sm"
      title={target?.title || "Confirmar exclusão"}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="danger" onClick={confirm} disabled={!ready || busy}>{busy ? "Excluindo…" : "Excluir"}</Button>
        </>
      )}
    >
      <p>{target?.message}</p>
      <Textarea label="Motivo da exclusão" value={reason} onChange={setReason} rows={3} required />
      <Input label={<>Digite <strong>SIM</strong> para confirmar</>} value={confirmation} onChange={setConfirmation} autoComplete="off" />
      {error && <span className="form-error">{error}</span>}
    </Modal>
  );
}

export function AccessAdmin() {
  const usersQuery = useFetch("/users?limit=100");
  const profilesQuery = useFetch("/access-profiles");
  const catalogQuery = useFetch("/permissions");
  const professionalsQuery = useFetch("/professionals?limit=100&status=active");
  const users = listItems(usersQuery.data);
  const profiles = listItems(profilesQuery.data);
  const professionals = listItems(professionalsQuery.data);
  const catalog = asArray(catalogQuery.data?.catalog);
  const rolePermissions = catalogQuery.data?.roles || {};
  const adminCount = users.filter((user) => user.role === "admin").length;

  const [tab, setTab] = useState("users");
  const [userForm, setUserForm] = useState(emptyUser());
  const [editingUser, setEditingUser] = useState(null);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [permissionOverrides, setPermissionOverrides] = useState({});
  const [initialOverrides, setInitialOverrides] = useState("[]");
  const [profileForm, setProfileForm] = useState(emptyProfile());
  const [editingProfile, setEditingProfile] = useState(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!usersQuery.data) return <Loading />;
  if (usersQuery.data.error) return <ApiError message={usersQuery.data.error} />;

  const selectedUserProfile = profiles.find((profile) => String(profile.id) === String(userForm.access_profile_id));
  const userBasePermissions = selectedUserProfile?.permissions || rolePermissions[userForm.role] || [];
  const overridesDirty = serializeOverrides(permissionOverrides) !== initialOverrides;

  function protectedLastAdmin(user = editingUser) {
    return Boolean(user?.role === "admin" && adminCount <= 1);
  }

  function openNewUser() {
    setEditingUser(null);
    setUserForm(emptyUser());
    setPermissionOverrides({});
    setInitialOverrides("[]");
    setError("");
    setUserModalOpen(true);
  }

  async function openEditUser(user) {
    setEditingUser(user);
    setUserForm({
      name: user.name, email: user.email, password: "", role: user.role,
      status: user.status || "active", access_profile_id: user.access_profile_id || "",
      professional_id: user.professional_id || "", reason: ""
    });
    setPermissionOverrides({});
    setError("");
    setUserModalOpen(true);
    try {
      const permissions = await requestJson(`/users/${user.id}/permissions`);
      const next = Object.fromEntries(asArray(permissions.overrides).map((item) => [item.permission, item.allowed]));
      setPermissionOverrides(next);
      setInitialOverrides(serializeOverrides(next));
    } catch (caught) {
      setError(caught.message);
    }
  }

  async function saveUser(event) {
    event.preventDefault();
    setError("");
    if (protectedLastAdmin() && userForm.role !== "admin") return setError(LAST_ADMIN_MESSAGE);
    if (editingUser && !userForm.reason.trim()) return setError("Informe o motivo da alteração.");
    setBusy(true);
    try {
      const body = {
        ...userForm,
        access_profile_id: userForm.access_profile_id || null,
        professional_id: userForm.professional_id || null,
        ...(userForm.password ? {} : { password: undefined }),
        ...(!editingUser ? {
          permission_overrides: Object.entries(permissionOverrides).map(([permission, allowed]) => ({ permission, allowed }))
        } : {})
      };
      await requestJson(`/users${editingUser ? `/${editingUser.id}` : ""}`, {
        method: editingUser ? "PATCH" : "POST",
        body: JSON.stringify(body)
      });
      if (editingUser && overridesDirty) {
        await requestJson(`/users/${editingUser.id}/permissions`, {
          method: "PUT",
          body: JSON.stringify({
            reason: userForm.reason,
            overrides: Object.entries(permissionOverrides).map(([permission, allowed]) => ({ permission, allowed }))
          })
        });
      }
      setUserModalOpen(false);
      await usersQuery.refresh();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  function openNewProfile() {
    const baseRole = "reception";
    setEditingProfile(null);
    setProfileForm({ ...emptyProfile(), base_role: baseRole, permissions: [...(rolePermissions[baseRole] || [])] });
    setError("");
    setProfileModalOpen(true);
  }

  function openEditProfile(profile) {
    setEditingProfile(profile);
    setProfileForm({
      name: profile.name, description: profile.description || "", base_role: profile.base_role,
      permissions: [...asArray(profile.permissions)], reason: ""
    });
    setError("");
    setProfileModalOpen(true);
  }

  async function saveProfile(event) {
    event.preventDefault();
    setError("");
    if (editingProfile && !profileForm.reason.trim()) return setError("Informe o motivo da alteração do perfil.");
    setBusy(true);
    try {
      await requestJson(`/access-profiles${editingProfile ? `/${editingProfile.id}` : ""}`, {
        method: editingProfile ? "PATCH" : "POST",
        body: JSON.stringify(profileForm)
      });
      setProfileModalOpen(false);
      await Promise.all([profilesQuery.refresh(), usersQuery.refresh()]);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  const profilePermissionMap = Object.fromEntries(profileForm.permissions.map((permission) => [permission, true]));

  return (
    <section className="stack access-admin-page">
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List aria-label="Gestão de equipe e acessos">
          <Tabs.Trigger value="users">Usuários</Tabs.Trigger>
          <Tabs.Trigger value="profiles">Perfis de acesso</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="users">
          <div className="panel">
            <CrudHeader title="Equipe e acessos" subtitle="Usuários, vínculos profissionais e permissões efetivas" actionLabel="Novo usuário" onAction={openNewUser} />
            {error && !userModalOpen && !profileModalOpen && <span className="form-error">{error}</span>}
            <DataView
              rows={users}
              defaultSort={{ key: "name", dir: "asc" }}
              searchPlaceholder="Buscar por nome, e-mail, perfil ou profissional"
              filters={[
                { key: "role", label: "Nível de acesso", type: "select", options: ROLE_OPTIONS },
                { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Ativo" }, { value: "inactive", label: "Inativo" }] }
              ]}
              columns={[
                { key: "name", label: "Nome" },
                { key: "email", label: "E-mail" },
                { key: "role", label: "Nível", value: (user) => roleLabel(user.role), render: (user) => <StatusBadge status={roleLabel(user.role)} /> },
                { key: "access_profile_name", label: "Perfil de acesso", render: (user) => user.access_profile_name || "Padrão do nível" },
                { key: "professional_name", label: "Profissional vinculado", render: (user) => user.professional_name || "—" },
                { key: "status", label: "Status", render: (user) => <StatusBadge status={user.status === "inactive" ? "Inativo" : "Ativo"} /> }
              ]}
              actions={(user) => (
                <RowActions actions={[
                  { label: "Editar usuário e permissões", onClick: () => openEditUser(user), primary: true },
                  {
                    label: "Excluir usuário",
                    onClick: () => setDeleting({ kind: "user", target: user, title: "Excluir usuário", message: `Remover definitivamente o acesso de ${user.name}?` }),
                    danger: true,
                    disabled: protectedLastAdmin(user)
                  }
                ]} />
              )}
              empty="Nenhum usuário cadastrado ainda."
            />
          </div>
        </Tabs.Content>

        <Tabs.Content value="profiles">
          <div className="panel">
            <CrudHeader title="Perfis de acesso" subtitle="Conjuntos reutilizáveis de permissões para a equipe" actionLabel="Novo perfil" onAction={openNewProfile} />
            {profilesQuery.data?.error && <ApiError message={profilesQuery.data.error} />}
            {!profilesQuery.data?.error && (
              <DataView
                rows={profiles}
                defaultSort={{ key: "name", dir: "asc" }}
                searchPlaceholder="Buscar perfil"
                columns={[
                  { key: "name", label: "Perfil" },
                  { key: "description", label: "Descrição", render: (profile) => profile.description || "—" },
                  { key: "base_role", label: "Nível-base", value: (profile) => roleLabel(profile.base_role), render: (profile) => roleLabel(profile.base_role) },
                  { key: "permissions", label: "Permissões", value: (profile) => profile.permissions.length, render: (profile) => `${profile.permissions.length} liberadas` },
                  { key: "users_count", label: "Usuários", render: (profile) => Number(profile.users_count || 0) }
                ]}
                actions={(profile) => (
                  <RowActions actions={[
                    { label: "Editar perfil", onClick: () => openEditProfile(profile), primary: true },
                    {
                      label: Number(profile.users_count) > 0 ? "Perfil em uso" : "Excluir perfil",
                      onClick: () => setDeleting({ kind: "profile", target: profile, title: "Excluir perfil", message: `Excluir o perfil ${profile.name}?` }),
                      danger: true,
                      disabled: Number(profile.users_count) > 0
                    }
                  ]} />
                )}
                empty="Nenhum perfil personalizado cadastrado."
              />
            )}
          </div>
        </Tabs.Content>
      </Tabs>

      <Modal
        open={userModalOpen}
        size="lg"
        title={editingUser ? "Editar usuário" : "Novo usuário"}
        subtitle="Defina o acesso completo antes de salvar"
        onClose={() => setUserModalOpen(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setUserModalOpen(false)} disabled={busy}>Cancelar</Button>
            <Button type="submit" form="access-user-form" disabled={busy}>{busy ? "Salvando…" : editingUser ? "Salvar alterações" : "Criar usuário"}</Button>
          </>
        )}
      >
        <form id="access-user-form" className="stack" onSubmit={saveUser}>
          <div className="form-grid">
            <Input label="Nome" value={userForm.name} onChange={(name) => setUserForm({ ...userForm, name })} required />
            <Input type="email" label="E-mail" value={userForm.email} onChange={(email) => setUserForm({ ...userForm, email })} required />
            <Input type="password" minLength={12} label={editingUser ? "Nova senha (opcional)" : "Senha (mínimo de 12 caracteres)"} value={userForm.password} onChange={(password) => setUserForm({ ...userForm, password })} required={!editingUser} />
            <Select
              label="Perfil de acesso"
              value={userForm.access_profile_id}
              onChange={(access_profile_id) => {
                const profile = profiles.find((item) => String(item.id) === String(access_profile_id));
                setUserForm({ ...userForm, access_profile_id, role: profile?.base_role || userForm.role });
              }}
            >
              <option value="">Usar somente o nível padrão</option>
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </Select>
            <Select
              label="Nível-base"
              value={userForm.role}
              onChange={(role) => setUserForm({ ...userForm, role, access_profile_id: "" })}
              required
            >
              {ROLE_OPTIONS.map(({ value, label }) => <option key={value} value={value} disabled={protectedLastAdmin() && value !== "admin"}>{label}</option>)}
            </Select>
            <Select label="Profissional vinculado" value={userForm.professional_id} onChange={(professional_id) => setUserForm({ ...userForm, professional_id })}>
              <option value="">Sem vínculo profissional</option>
              {professionals.map((professional) => <option key={professional.id} value={professional.id}>{professional.name}</option>)}
            </Select>
            {editingUser && (
              <Select label="Status" value={userForm.status} onChange={(status) => setUserForm({ ...userForm, status })}>
                <option value="active">Ativo</option>
                <option value="inactive" disabled={protectedLastAdmin()}>Inativo</option>
              </Select>
            )}
          </div>

          <div className="access-permissions-heading">
            <div>
              <h3>Permissões efetivas</h3>
              <p>O perfil define a base. Marque ou desmarque apenas as exceções deste usuário.</p>
            </div>
            <Button type="button" variant="secondary" onClick={() => setPermissionOverrides({})} disabled={userForm.role === "admin"}>Remover exceções</Button>
          </div>
          <PermissionEditor catalog={catalog} basePermissions={userBasePermissions} overrides={permissionOverrides} onChange={setPermissionOverrides} disabled={userForm.role === "admin"} />
          {editingUser && <Textarea label="Motivo da alteração" value={userForm.reason} onChange={(reason) => setUserForm({ ...userForm, reason })} required />}
          {protectedLastAdmin() && <span className="form-error">{LAST_ADMIN_MESSAGE}</span>}
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>

      <Modal
        open={profileModalOpen}
        size="lg"
        title={editingProfile ? "Editar perfil de acesso" : "Novo perfil de acesso"}
        subtitle="Escolha claramente o que este perfil pode fazer"
        onClose={() => setProfileModalOpen(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setProfileModalOpen(false)} disabled={busy}>Cancelar</Button>
            <Button type="submit" form="access-profile-form" disabled={busy}>{busy ? "Salvando…" : "Salvar perfil"}</Button>
          </>
        )}
      >
        <form id="access-profile-form" className="stack" onSubmit={saveProfile}>
          <div className="form-grid">
            <Input label="Nome do perfil" value={profileForm.name} onChange={(name) => setProfileForm({ ...profileForm, name })} required />
            <Select label="Nível-base" value={profileForm.base_role} onChange={(base_role) => setProfileForm({ ...profileForm, base_role })} required>
              {PROFILE_ROLE_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </div>
          <Textarea label="Descrição" value={profileForm.description} onChange={(description) => setProfileForm({ ...profileForm, description })} />
          <div className="access-permissions-heading">
            <div><h3>Permissões do perfil</h3><p>Estas permissões substituem o padrão do nível-base.</p></div>
            <Button type="button" variant="secondary" onClick={() => setProfileForm({ ...profileForm, permissions: [...(rolePermissions[profileForm.base_role] || [])] })}>Aplicar padrão do nível</Button>
          </div>
          <PermissionEditor
            catalog={catalog}
            basePermissions={[]}
            overrides={profilePermissionMap}
            onChange={(next) => setProfileForm({ ...profileForm, permissions: Object.entries(next).filter(([, allowed]) => allowed).map(([permission]) => permission) })}
          />
          {editingProfile && <Textarea label="Motivo da alteração" value={profileForm.reason} onChange={(reason) => setProfileForm({ ...profileForm, reason })} required />}
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>

      <DeleteReasonModal
        target={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async (reason) => {
          if (deleting.kind === "user") {
            await requestJson(`/users/${deleting.target.id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
            await usersQuery.refresh();
          } else {
            await requestJson(`/access-profiles/${deleting.target.id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
            await profilesQuery.refresh();
          }
        }}
      />
    </section>
  );
}
