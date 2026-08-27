import { useState } from "react";
import { Button, Input, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { ConfirmDeleteModal, CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { apiFetch, useApiInvalidate, useFetch } from "../../lib/api";
import { asArray, asNumber } from "../../lib/utils";
import { currency } from "../shared/helpers";

const emptyMaterial = () => ({ name: "", description: "", unit: "unidade", quantity: 0, minimum_quantity: 0, cost_value: 0, supplier: "", status: "active" });

function stockStatus(item) {
  if (item.status === "archived") return "Arquivado";
  if (Number(item.quantity || 0) <= 0) return "Sem estoque";
  if (Number(item.quantity || 0) <= Number(item.minimum_quantity || 0)) return "Reposição";
  return "Disponível";
}

export function ConsumablesWorkspace() {
  const { data, error } = useFetch("/consumables");
  const invalidate = useApiInvalidate();
  const [form, setForm] = useState(emptyMaterial());
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [movement, setMovement] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [message, setMessage] = useState("");
  const items = asArray(data);
  const refresh = () => invalidate("/consumables", "/purchases", "/dashboard");

  if (data == null) return <Loading />;
  if (error) return <ApiError message={error} />;

  function openNew() {
    setForm(emptyMaterial());
    setEditing(null);
    setMessage("");
    setModalOpen(true);
  }

  function edit(item) {
    setEditing(item);
    setForm({ ...emptyMaterial(), ...item });
    setMessage("");
    setModalOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    setMessage("");
    const response = await apiFetch(editing ? `/consumables/${editing.id}` : "/consumables", {
      method: editing ? "PATCH" : "POST",
      body: JSON.stringify({ ...form, quantity: Number(form.quantity || 0), minimum_quantity: Number(form.minimum_quantity || 0), cost_value: Number(form.cost_value || 0) })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setMessage(payload.error || "Não foi possível salvar o material.");
    setModalOpen(false);
    refresh();
  }

  async function saveMovement(event) {
    event.preventDefault();
    const response = await apiFetch(`/consumables/${movement.item.id}/movements`, {
      method: "POST",
      body: JSON.stringify({ movement_type: movement.type, quantity: Number(movement.quantity || 0), notes: movement.notes || "" })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setMovement({ ...movement, error: payload.error || "Não foi possível movimentar o material." });
    setMovement(null);
    refresh();
  }

  function archive(item) {
    setDeleting({ item, message: `Arquivar ${item.name}? Ele não poderá ser usado em novas compras, sem apagar o histórico.` });
  }

  async function confirmArchive() {
    const response = await apiFetch(`/consumables/${deleting.item.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível arquivar o material.");
    setDeleting(null);
    refresh();
  }

  return <section className="stack purchases-page">
    <div className="panel">
      <CrudHeader title="Materiais de consumo" subtitle="Insumos internos, como luvas, agulhas, água e descartáveis. Eles não aparecem em Vendas nem no catálogo." actionLabel="Novo material" onAction={openNew} />
      <DataView
        rows={items}
        defaultSort={{ key: "name", dir: "asc" }}
        searchPlaceholder="Buscar por material, fornecedor ou descrição"
        filters={[{ key: "status", label: "Situação", type: "select", options: [{ value: "active", label: "Ativos" }, { value: "archived", label: "Arquivados" }], match: (item, value) => item.status === value }]}
        columns={[
          { key: "name", label: "Material", value: (item) => `${item.name} ${item.description || ""} ${item.supplier || ""}`, render: (item) => <><strong>{item.name}</strong>{item.description && <><br /><small>{item.description}</small></>}</> },
          { key: "quantity", label: "Saldo", value: (item) => asNumber(item.quantity), render: (item) => `${item.quantity || 0} ${item.unit || "un."}` },
          { key: "minimum_quantity", label: "Mínimo", value: (item) => asNumber(item.minimum_quantity), render: (item) => `${item.minimum_quantity || 0} ${item.unit || "un."}` },
          { key: "cost_value", label: "Custo médio", value: (item) => asNumber(item.cost_value), render: (item) => currency.format(item.cost_value || 0) },
          { key: "status", label: "Situação", value: stockStatus, render: (item) => <StatusBadge status={stockStatus(item)} /> }
        ]}
        actions={(item) => <RowActions actions={[
          item.status === "active" && { label: "Registrar entrada", onClick: () => setMovement({ item, type: "Entrada", quantity: 1, notes: "" }), primary: true },
          item.status === "active" && { label: "Registrar uso/saída", onClick: () => setMovement({ item, type: "Saida", quantity: 1, notes: "" }) },
          item.status === "active" && { label: "Ajustar saldo", onClick: () => setMovement({ item, type: "Ajuste", quantity: item.quantity || 0, notes: "Inventário" }) },
          { label: "Editar", onClick: () => edit(item) },
          item.status === "active" && { label: "Arquivar", onClick: () => archive(item), danger: true }
        ]} />}
        empty="Nenhum material cadastrado. Cadastre primeiro para incluí-lo em uma compra."
        emptyFiltered="Nenhum material corresponde aos filtros aplicados."
      />
    </div>

    <Modal open={modalOpen} title={editing ? "Editar material" : "Novo material"} subtitle="O saldo inicial é usado só no primeiro cadastro. Novas entradas devem ser registradas por compra ou movimentação." onClose={() => setModalOpen(false)} footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button><Button type="submit" form="consumable-form">Salvar material</Button></>}>
      <form id="consumable-form" onSubmit={save} className="stack">
        <div className="form-grid">
          <Input label="Nome" value={form.name} onChange={(name) => setForm({ ...form, name })} required />
          <Input label="Unidade" value={form.unit} onChange={(unit) => setForm({ ...form, unit })} placeholder="unidade, caixa, frasco" />
          {!editing && <Input type="number" min="0" label="Saldo inicial" value={form.quantity} onChange={(quantity) => setForm({ ...form, quantity })} />}
          <Input type="number" min="0" label="Estoque mínimo" value={form.minimum_quantity} onChange={(minimum_quantity) => setForm({ ...form, minimum_quantity })} />
          <Input type="number" min="0" step="0.01" label="Custo médio" value={form.cost_value} onChange={(cost_value) => setForm({ ...form, cost_value })} />
          <Input label="Fornecedor habitual" value={form.supplier} onChange={(supplier) => setForm({ ...form, supplier })} />
        </div>
        <Textarea label="Descrição / observações" value={form.description} onChange={(description) => setForm({ ...form, description })} />
        {message && <span className="form-error">{message}</span>}
      </form>
    </Modal>

    <Modal open={!!movement} title={movement?.type === "Saida" ? "Registrar uso do material" : movement?.type === "Ajuste" ? "Ajustar saldo" : "Registrar entrada"} subtitle={movement?.item?.name} onClose={() => setMovement(null)} footer={<><Button variant="secondary" onClick={() => setMovement(null)}>Cancelar</Button><Button type="submit" form="consumable-movement-form">Salvar movimentação</Button></>}>
      {movement && <form id="consumable-movement-form" onSubmit={saveMovement} className="stack">
        <Input type="number" min="1" label={movement.type === "Ajuste" ? "Novo saldo" : "Quantidade"} value={movement.quantity} onChange={(quantity) => setMovement({ ...movement, quantity })} required />
        <Textarea label="Motivo / observação" value={movement.notes} onChange={(notes) => setMovement({ ...movement, notes })} />
        {movement.error && <span className="form-error">{movement.error}</span>}
      </form>}
    </Modal>

    <ConfirmDeleteModal open={!!deleting} message={deleting?.message} confirmWord="ARQUIVAR" onClose={() => setDeleting(null)} onConfirm={confirmArchive} title="Arquivar material" />
  </section>;
}
