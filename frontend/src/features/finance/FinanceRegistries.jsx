import { useState } from "react";
import { Button, Input, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { apiFetch, useApiInvalidate, useFetch } from "../../lib/api";
import { asArray } from "../../lib/utils";
import { SupplierRegistry } from "./SupplierRegistry";

const REGISTRY_CONFIG = {
  categories: {
    title: "Categorias financeiras",
    subtitle: "Categorias usadas nos lançamentos financeiros.",
    singular: "categoria",
    endpoint: "/finance/categories",
    empty: () => ({ name: "", description: "", is_active: true }),
  },
  centers: {
    title: "Centros de custo",
    subtitle: "Centros de custo usados em compras e contas.",
    singular: "centro de custo",
    endpoint: "/finance/cost-centers",
    empty: () => ({ name: "", description: "", is_active: true }),
  },
};

function normalizeActive(value) {
  return Boolean(Number(value ?? 1));
}

export function FinanceRegistries({ registry = "suppliers" }) {
  if (registry === "suppliers") return <SupplierRegistry />;
  return <SimpleFinanceRegistry registry={registry} />;
}

function SimpleFinanceRegistry({ registry }) {
  const config = REGISTRY_CONFIG[registry] || REGISTRY_CONFIG.categories;
  const { data, error: requestError } = useFetch(`${config.endpoint}?include_inactive=1`);
  const invalidate = useApiInvalidate();
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(config.empty);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");

  function openNew() {
    setEditing(null);
    setForm(config.empty());
    setError("");
    setModalOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({ ...config.empty(), ...item, is_active: normalizeActive(item.is_active) });
    setError("");
    setModalOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(editing ? `${config.endpoint}/${editing.id}` : config.endpoint, {
      method: editing ? "PATCH" : "POST",
      body: JSON.stringify(form),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || `Não foi possível salvar o ${config.singular}.`);
    setModalOpen(false);
    setEditing(null);
    invalidate(config.endpoint);
  }

  async function toggleActive(item) {
    const response = await apiFetch(`${config.endpoint}/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...item, is_active: !normalizeActive(item.is_active) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || `Não foi possível atualizar o ${config.singular}.`);
    invalidate(config.endpoint);
  }

  if (data == null) return <Loading />;
  if (requestError) return <ApiError message={requestError} />;

  const commonColumns = [
    { key: "name", label: "Nome" },
    { key: "description", label: "Descrição", render: (item) => item.description || item.notes || "—" },
    {
      key: "is_active",
      label: "Status",
      value: (item) => (normalizeActive(item.is_active) ? "Ativo" : "Inativo"),
      render: (item) => <StatusBadge status={normalizeActive(item.is_active) ? "Ativo" : "Inativo"} />,
    },
  ];
  return (
    <section className="stack finance-registries-page">
      <section className="panel stack">
        <CrudHeader
          title={config.title}
          subtitle={config.subtitle}
          actionLabel={`Novo ${config.singular}`}
          onAction={openNew}
        />
        {error && !modalOpen && <span className="form-error">{error}</span>}
        <DataView
          rows={asArray(data)}
          defaultSort={{ key: "name", dir: "asc" }}
          searchPlaceholder={`Buscar ${config.title.toLowerCase()}`}
          filters={[
            {
              key: "status",
              label: "Status",
              type: "select",
              options: [
                { value: "ativo", label: "Ativo" },
                { value: "inativo", label: "Inativo" },
              ],
              match: (item, value) => (normalizeActive(item.is_active) ? "ativo" : "inativo") === value,
            },
          ]}
          columns={commonColumns}
          actions={(item) => (
            <RowActions
              actions={[
                { label: "Editar", onClick: () => openEdit(item), primary: true },
                {
                  label: normalizeActive(item.is_active) ? "Desativar" : "Ativar",
                  onClick: () => toggleActive(item),
                  danger: normalizeActive(item.is_active),
                },
              ]}
            />
          )}
          empty={`Nenhum ${config.singular} cadastrado ainda.`}
        />
      </section>

      <Modal
        open={modalOpen}
        title={editing ? `Editar ${config.singular}` : `Novo ${config.singular}`}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="finance-registry-form">
              Salvar
            </Button>
          </>
        }
      >
        <form id="finance-registry-form" className="stack" onSubmit={save}>
          <div className="form-grid">
            <Input label="Nome" value={form.name} onChange={(name) => setForm({ ...form, name })} required />
          </div>
          <Textarea
            label="Descrição"
            value={form.description || ""}
            onChange={(description) => setForm({ ...form, description })}
          />
          <Select
            label="Status"
            value={normalizeActive(form.is_active) ? "active" : "inactive"}
            onChange={(value) => setForm({ ...form, is_active: value === "active" })}
          >
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </Select>
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>
    </section>
  );
}
