// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useState } from "react";
import { Button, Input, Select, StatusBadge } from "../../components/common/Ui";
import { Modal, CrudHeader, ConfirmDeleteModal } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { asArray } from "../../lib/utils";
import { apiFetch, useFetch } from "../../lib/api";
import { defaultAccessUser } from "../../lib/defaultForms";
import { roleLabel } from "../../features/shared/helpers";

const ROLE_OPTIONS = ["admin", "piercer", "reception", "finance"]
  .map((value) => ({ value, label: roleLabel(value) }));

export function AccessAdmin() {
  const { data, refresh } = useFetch("/users");
  const [form, setForm] = useState(defaultAccessUser());
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetType, setResetType] = useState("operational");
  const [resetMessage, setResetMessage] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [deleting, setDeleting] = useState(null);
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

  function openEdit(user) {
    setEditing(user);
    setForm({ name: user.name, email: user.email, role: user.role, password: "" });
    setError("");
    setModalOpen(true);
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

  async function resetClinicData() {
    setResetLoading(true);
    setResetMessage("");
    const response = await apiFetch("/admin/reset-clinic-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: resetConfirmation, reset_type: resetType })
    });
    const payload = await response.json().catch(() => ({}));
    setResetLoading(false);
    if (!response.ok) {
      setResetMessage(payload.error || "Não foi possível limpar os dados.");
      return;
    }
    setResetConfirmation("");
    setResetMessage(payload.message || "Reset concluído com segurança.");
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
            <>
              <button type="button" onClick={() => openEdit(user)}>Editar</button>
              <button type="button" disabled={isProtectedLastAdmin(user)} onClick={() => setDeleting({ message: `Remover o acesso de ${user.name}?`, run: () => remove(user) })}>Excluir</button>
            </>
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
          </div>
          {isProtectedLastAdmin() && <span className="form-error">{lastAdminMessage}</span>}
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>

      <article className="panel admin-reset-panel">
        <div>
          <span className="eyebrow">Zona de perigo</span>
          <h2>Resetar dados da clínica</h2>
          <p>Use apenas quando precisar limpar dados reais de operação. A ação não pode ser desfeita e exige confirmação digitada.</p>
        </div>
        <div className="admin-reset-action">
          <Select label="Tipo de reset" value={resetType} onChange={setResetType}>
            <option value="operational">Reset operacional</option>
            <option value="complete">Reset completo da clínica</option>
          </Select>
          <p className="danger-zone-copy">
            {resetType === "complete"
              ? "Apaga clientes, agenda, vendas, financeiro, produtos, serviços, profissionais e configurações operacionais. Preserva a clínica e a conta administradora."
              : "Apaga agendamentos, vendas, ordens de serviço, financeiro, prontuários, termos, pós-atendimento e histórico operacional. Preserva cadastros estruturais."}
          </p>
          <Input label="Digite RESETAR DADOS para confirmar" value={resetConfirmation} onChange={setResetConfirmation} />
          <Button
            type="button"
            variant="danger"
            disabled={resetConfirmation !== "RESETAR DADOS" || resetLoading}
            onClick={resetClinicData}
          >
            {resetLoading ? "Resetando..." : "Confirmar reset"}
          </Button>
        </div>
        {resetMessage && <span className="admin-reset-message">{resetMessage}</span>}
      </article>

      <ConfirmDeleteModal
        open={!!deleting}
        message={deleting?.message}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { await deleting.run(); setDeleting(null); }}
      />
    </section>
  );
}

