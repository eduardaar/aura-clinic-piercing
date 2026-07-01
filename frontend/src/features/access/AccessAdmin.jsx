// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Input, Metric, Select } from "../../components/common/Ui";
import { Modal, CrudHeader, DataTable, ConfirmDeleteModal } from "../../components/common/Crud";
import { ApiError, Loading } from "../../components/common/Feedback";
import { asArray, asNumber, asObject, removeAccents } from "../../lib/utils";
import { apiFetch, useFetch } from "../../lib/api";
import { defaultAccessUser } from "../../lib/defaultForms";
import { currency, roleLabel } from "../../features/shared/helpers";

export function AuraERP({ setPage }) {
  const { data } = useFetch("/erp");
  const [moduleFilter, setModuleFilter] = useState("todos");
  if (!data) return <Loading />;
  if (data.error) {
    return (
      <section className="panel erp-error">
        <span className="eyebrow">Aura Clinic ERP</span>
        <h2>Não foi possível carregar esta área.</h2>
        <p>{data.error}</p>
        <small>Reinicie o servidor com npm.cmd run dev para carregar a nova rota /api/erp.</small>
      </section>
    );
  }
  const safeData = asObject(data);
  const product = asObject(safeData.product);
  const metrics = asObject(safeData.metrics);
  const modules = asArray(safeData.modules).filter((item) => moduleFilter === "todos" || item?.status === moduleFilter);
  const crm = asArray(safeData.crm);
  const catalogItems = asArray(safeData.catalogItems);
  const coupons = asArray(safeData.coupons);
  const influencers = asArray(safeData.influencers);
  const consultancies = asArray(safeData.consultancies);
  const academy = asArray(safeData.academy);
  const contentPlanner = asArray(safeData.contentPlanner);
  const bodyMap = asArray(safeData.bodyMap);

  return (
    <section className="erp-page">
      <div className="erp-hero panel">
        <div>
          <span className="eyebrow">SaaS multiempresa</span>
          <h2>{product.name || "Aura ERP"}</h2>
          <p>{product.positioning || "Gestão integrada para a Aura Clinic."}</p>
          <div className="erp-stack">
            {asArray(product.stackTarget).map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
        <div className="erp-metrics">
          <Metric label="Estúdios" value={asNumber(metrics.studios)} />
          <Metric label="Clientes" value={asNumber(metrics.clients)} />
          <Metric label="Agendamentos" value={asNumber(metrics.appointments)} />
          <Metric label="Receita" value={currency.format(asNumber(metrics.revenue))} />
        </div>
      </div>

      <div className="erp-toolbar">
        {["todos", "ativo", "planejado"].map((status) => (
          <button key={status} className={moduleFilter === status ? "active" : ""} onClick={() => setModuleFilter(status)}>{status}</button>
        ))}
      </div>

      <div className="erp-module-grid">
        {modules.map((module) => {
          const action = erpModuleAction(module.name);
          return (
          <article className="erp-module-card" key={module.name}>
            <span className={`erp-status ${module.status}`}>{module.status}</span>
            <h3>{module.name}</h3>
            <p>{module.description}</p>
            <button
              type="button"
              onClick={() => {
                if (action.url) window.open(action.url, "_blank", "noopener,noreferrer");
                if (action.page) setPage(action.page);
              }}
            >
              {action.label}
              <ChevronRight size={16} />
            </button>
          </article>
          );
        })}
      </div>

      <div className="erp-sections-grid">
        <ERPPanel title="CRM e funil" subtitle="Classificacao automatica por historico">
          <div className="erp-bars">
            {crm.map((item) => <div key={item.stage}><span>{item.stage}</span><strong>{asNumber(item.total)}</strong></div>)}
          </div>
        </ERPPanel>
        <ERPPanel title="Catalogo online" subtitle="Vitrine publica de joalherias">
          <div className="erp-catalog-preview">
            {catalogItems.slice(0, 4).map((item) => (
              <article key={item.id}>
                <img src={item.photo_url} alt={item.name} />
                <strong>{item.name}</strong>
                <span>{currency.format(item.sale_value)} · {item.quantity} un.</span>
              </article>
            ))}
          </div>
        </ERPPanel>
        <ERPPanel title="Cupons e influenciadores" subtitle="Rastreamento comercial">
          <div className="erp-list">
            {coupons.map((coupon) => <p key={coupon.code}><strong>{coupon.code}</strong><span>{asNumber(coupon.value)}% · {coupon.status}</span></p>)}
            {influencers.map((item) => <p key={item.instagram}><strong>{item.name}</strong><span>{item.coupon} · {asNumber(item.conversions)} conversões</span></p>)}
          </div>
        </ERPPanel>
        <ERPPanel title="Consultorias e Aura Academy" subtitle="Produtos digitais">
          <div className="erp-list">
            {consultancies.map((item) => <p key={item.name}><strong>{item.name}</strong><span>{currency.format(asNumber(item.price))} · {item.format}</span></p>)}
            {academy.map((item) => <p key={item.name}><strong>{item.name}</strong><span>{asNumber(item.lessons)} aulas · {asNumber(item.students)} alunos</span></p>)}
          </div>
        </ERPPanel>
        <ERPPanel title="Calendario editorial" subtitle="Planejamento de conteudo Aura">
          <div className="content-planner">
            {contentPlanner.map((item) => <div key={item.day}><strong>{item.day}</strong><span>{item.theme}</span></div>)}
          </div>
        </ERPPanel>
        <ERPPanel title="Mapa corporal" subtitle="Regioes mais realizadas">
          <div className="erp-list">
            {bodyMap.map((item) => <p key={item.region}><strong>{item.region}</strong><span>{asNumber(item.total)} procedimento(s)</span></p>)}
          </div>
        </ERPPanel>
      </div>
    </section>
  );
}

export function ERPPanel({ title, subtitle, children }) {
  return (
    <article className="panel erp-panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <span>{subtitle}</span>
        </div>
      </div>
      {children}
    </article>
  );
}

export function erpModuleAction(name = "") {
  const normalized = removeAccents(String(name).toLowerCase());
  if (normalized.includes("dashboard")) return { label: "Abrir dashboard", page: "dashboard" };
  if (normalized.includes("agendamento")) return { label: "Abrir agenda", page: "agenda" };
  if (normalized.includes("clientes") || normalized.includes("prontuario") || normalized.includes("crm") || normalized.includes("rewards") || normalized.includes("mapa corporal")) return { label: "Abrir clientes", page: "client-center" };
  if (normalized.includes("termo")) return { label: "Abrir clientes", page: "client-center" };
  if (normalized.includes("estoque") || normalized.includes("joalheria")) return { label: "Abrir catálogo", page: "catalog" };
  if (normalized.includes("catalogo")) return { label: "Abrir catálogo", page: "catalog" };
  if (normalized.includes("venda") || normalized.includes("ordem")) return { label: "Abrir vendas", page: "sales" };
  if (normalized.includes("Financeiro") || normalized.includes("relatorio")) return { label: "Abrir Financeiro", page: "finance" };
  if (normalized.includes("administrativo") || normalized.includes("configur")) return { label: "Abrir acessos", page: "admin" };
  if (normalized.includes("pos-atendimento") || normalized.includes("retorno")) return { label: "Abrir clientes", page: "client-center" };
  return { label: "Ver no Aura ERP", page: "erp" };
}


export function AccessAdmin() {
  const { data, refresh } = useFetch("/users");
  const [form, setForm] = useState(defaultAccessUser());
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [deleting, setDeleting] = useState(null);
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const users = asArray(data);

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

  async function save(event) {
    event.preventDefault();
    setError("");
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
    await apiFetch(`/users/${user.id}`, { method: "DELETE" });
    refresh();
  }

  async function resetDemoData() {
    setResetLoading(true);
    setResetMessage("");
    const response = await apiFetch("/admin/reset-demo-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: resetConfirmation })
    });
    const payload = await response.json().catch(() => ({}));
    setResetLoading(false);
    if (!response.ok) {
      setResetMessage(payload.error || "Não foi possível limpar os dados.");
      return;
    }
    setResetConfirmation("");
    setResetMessage(payload.message || "Dados de demonstração removidos.");
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
        <DataTable
          rows={users}
          columns={[
            { key: "name", label: "Nome" },
            { key: "email", label: "E-mail" },
            { key: "role", label: "Nível", render: (user) => <span className="status-badge">{roleLabel(user.role)}</span> },
          ]}
          actions={(user) => (
            <>
              <button type="button" onClick={() => openEdit(user)}>Editar</button>
              <button type="button" onClick={() => setDeleting({ message: `Remover o acesso de ${user.name}?`, run: () => remove(user) })}>Apagar</button>
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
            <button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>Cancelar</button>
            <button type="submit" form="access-user-form" className="primary-button">{editing ? "Salvar alterações" : "Criar usuário"}</button>
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
              <option value="piercer">Body Piercer</option>
              <option value="reception">Recepção</option>
              <option value="finance">Financeiro</option>
            </Select>
          </div>
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>

      <article className="panel admin-reset-panel">
        <div>
          <span className="eyebrow">Preparação para Uso Real</span>
          <h2>Limpar Dados de Demonstração</h2>
          <p>Remove clientes, produtos, variações, agendamentos, vendas, despesas e lançamentos financeiros. Usuários, categorias e configurações permanecem.</p>
        </div>
        <div className="admin-reset-action">
          <Input label="Digite RESETAR para confirmar" value={resetConfirmation} onChange={setResetConfirmation} />
          <button
            type="button"
            className="danger-button"
            disabled={resetConfirmation !== "RESETAR" || resetLoading}
            onClick={resetDemoData}
          >
            {resetLoading ? "Limpando..." : "Limpar Dados Fictícios"}
          </button>
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

