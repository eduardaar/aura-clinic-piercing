import { useState } from "react";
import { AdvancedFields, FormSection, FormWorkflow, ValidationSummary } from "../../components/common/FormWorkflow";
import { Button, Input, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { apiFetch, readStoredSession, tenantSlug, useApiInvalidate, useFetch } from "../../lib/api";
import { useFormDraft } from "../../lib/useFormDraft";
import {
  BRAZILIAN_STATES,
  SUPPLIER_CATEGORIES,
  emptySupplier,
  formatBrazilianPhone,
  formatPostalCode,
  formatSupplierTaxId,
  supplierFormErrors,
  supplierPayload,
  supplierToForm
} from "../../lib/supplierFields";
import { asArray, formatDate } from "../../lib/utils";

const qualityLabels = { approved: "Aprovado", review: "Em análise", blocked: "Bloqueado" };
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const normalizeActive = (value) => Boolean(Number(value ?? 1));

export function SupplierRegistry() {
  const endpoint = "/finance/suppliers";
  const { data, error: requestError } = useFetch(`${endpoint}?include_inactive=1`);
  const invalidate = useApiInvalidate();
  const sessionUser = readStoredSession()?.user || {};
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptySupplier);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [validationErrors, setValidationErrors] = useState([]);
  const draft = useFormDraft({
    tenantId: tenantSlug() || "tenant",
    userId: sessionUser.id || "user",
    formId: editing ? `supplier-${editing.id}` : "supplier-new",
    schemaKey: "supplier-v1",
    version: undefined,
    storage: undefined,
    value: form,
    onRestore: setForm,
    enabled: modalOpen
  });

  function openNew() {
    setEditing(null);
    setForm(emptySupplier());
    setError("");
    setValidationErrors([]);
    setModalOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm(supplierToForm(item));
    setError("");
    setValidationErrors([]);
    setModalOpen(true);
  }

  function closeSupplierForm() {
    draft.flushDraft();
    setModalOpen(false);
  }

  function change(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    if (validationErrors.length) setValidationErrors((current) => current.filter((item) => item.field !== field));
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    const errors = supplierFormErrors(form);
    setValidationErrors(errors);
    if (errors.length) return;
    const response = await apiFetch(editing ? `${endpoint}/${editing.id}` : endpoint, {
      method: editing ? "PATCH" : "POST",
      body: JSON.stringify(supplierPayload(form))
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível salvar o fornecedor.");
    draft.clearDraft();
    setModalOpen(false);
    setEditing(null);
    invalidate(endpoint);
  }

  async function toggleActive(item) {
    setError("");
    const response = await apiFetch(`${endpoint}/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !normalizeActive(item.is_active) })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setError(payload.error || "Não foi possível atualizar o fornecedor.");
    invalidate(endpoint);
  }

  if (data == null) return <Loading />;
  if (requestError) return <ApiError message={requestError} />;

  const columns = [
    {
      key: "name", label: "Fornecedor",
      value: (item) => `${item.name} ${item.legal_name || ""} ${item.trade_name || ""}`,
      render: (item) => <><strong>{item.name}</strong>{item.trade_name && <><br /><small>{item.trade_name}</small></>}</>
    },
    { key: "document", label: "CPF/CNPJ", render: (item) => item.document ? formatSupplierTaxId(item.document, item.person_type) : "—" },
    {
      key: "contact", label: "Contato",
      value: (item) => `${item.contact_name || ""} ${item.phone || ""} ${item.whatsapp || ""} ${item.email || ""}`,
      render: (item) => <>{item.contact_name || "—"}{(item.whatsapp || item.phone) && <><br /><small>{formatBrazilianPhone(item.whatsapp || item.phone)}</small></>}</>
    },
    {
      key: "categories", label: "Categorias",
      value: (item) => [...asArray(item.categories), ...asArray(item.brands), ...asArray(item.material_references)].join(" "),
      render: (item) => asArray(item.categories).join(", ") || "—"
    },
    {
      key: "commercial", label: "Condições",
      value: (item) => `${item.lead_time_days || ""} ${item.payment_terms || ""} ${item.minimum_order_value || ""}`,
      render: (item) => <>{item.lead_time_days != null ? `${item.lead_time_days} dia(s) de entrega` : "Prazo não informado"}{item.minimum_order_value != null && <><br /><small>Pedido mínimo: {money(item.minimum_order_value)}</small></>}</>
    },
    {
      key: "quality_status", label: "Qualidade",
      render: (item) => <StatusBadge status={qualityLabels[item.quality_status] || "Em análise"} />
    },
    {
      key: "is_active", label: "Status",
      value: (item) => normalizeActive(item.is_active) ? "Ativo" : "Inativo",
      render: (item) => <StatusBadge status={normalizeActive(item.is_active) ? "Ativo" : "Inativo"} />
    }
  ];

  return (
    <section className="stack finance-registries-page supplier-registry-page">
      <section className="panel stack">
        <CrudHeader
          title="Fornecedores"
          subtitle="Fonte única usada em compras, estoque e contas a pagar."
          actionLabel="Novo fornecedor"
          onAction={openNew}
        />
        {error && !modalOpen && <span className="form-error">{error}</span>}
        <DataView
          rows={asArray(data)}
          defaultSort={{ key: "name", dir: "asc" }}
          searchPlaceholder="Buscar por nome, documento, contato, marca ou material"
          filters={[
            {
              key: "status", label: "Status", type: "select",
              options: [{ value: "active", label: "Ativo" }, { value: "inactive", label: "Inativo" }],
              match: (item, value) => (normalizeActive(item.is_active) ? "active" : "inactive") === value
            },
            {
              key: "quality", label: "Qualidade", type: "select",
              options: Object.entries(qualityLabels).map(([value, label]) => ({ value, label })),
              match: (item, value) => item.quality_status === value
            }
          ]}
          columns={columns}
          actions={(item) => (
            <RowActions actions={[
              { label: "Editar", onClick: () => openEdit(item), primary: true },
              { label: normalizeActive(item.is_active) ? "Arquivar" : "Ativar", onClick: () => toggleActive(item), danger: normalizeActive(item.is_active) }
            ]} />
          )}
          empty="Nenhum fornecedor cadastrado ainda."
        />
      </section>

      <Modal
        open={modalOpen}
        size="lg"
        title={editing ? "Editar fornecedor" : "Novo fornecedor"}
        subtitle="Nome e tipo são os únicos campos obrigatórios."
        onClose={closeSupplierForm}
        footer={<><Button variant="secondary" onClick={closeSupplierForm}>Fechar</Button><Button type="submit" form="supplier-form">Salvar fornecedor</Button></>}
      >
        <FormWorkflow
          mobileFullscreen
          as="form"
          id="supplier-form"
          className="stack"
          title="Cadastro do fornecedor"
          description="Preencha primeiro o essencial; os controles avançados são opcionais."
          eyebrow={null}
          actions={null}
          draft={draft}
          onSubmit={save}
        >
          {draft.hasDraft && (
            <div className="soft-card stack" role="status">
              <strong>Há um rascunho anterior deste cadastro.</strong>
              <div className="inline-actions"><Button variant="secondary" onClick={draft.restoreDraft}>Restaurar rascunho</Button><Button variant="ghost" onClick={draft.discardDraft}>Descartar</Button></div>
            </div>
          )}
          <ValidationSummary errors={validationErrors} title={undefined} onErrorClick={undefined} />
          <FormSection title="Informações principais" description="Identificação fiscal e nome usado na rotina." badge={null} actions={null}>
            <div className="form-grid">
              <Input label="Nome do fornecedor" value={form.name} onChange={(value) => change("name", value)} required />
              <Select label="Tipo" value={form.person_type} onChange={(value) => setForm((current) => ({ ...current, person_type: value, document: "" }))} required>
                <option value="PJ">Pessoa jurídica</option><option value="PF">Pessoa física</option>
              </Select>
              <Input label={form.person_type === "PF" ? "CPF" : "CNPJ"} value={form.document} onChange={(value) => change("document", formatSupplierTaxId(value, form.person_type))} inputMode="numeric" />
              <Input label="Inscrição estadual" value={form.state_registration} onChange={(value) => change("state_registration", value.toUpperCase())} />
              <Input label={form.person_type === "PF" ? "Nome completo" : "Razão social"} value={form.legal_name} onChange={(value) => change("legal_name", value)} />
              <Input label="Nome fantasia" value={form.trade_name} onChange={(value) => change("trade_name", value)} />
              <Select label="Status" value={normalizeActive(form.is_active) ? "active" : "inactive"} onChange={(value) => change("is_active", value === "active")}>
                <option value="active">Ativo</option><option value="inactive">Arquivado</option>
              </Select>
            </div>
          </FormSection>

          <FormSection title="Contato" description="Canais usados para orçamento, pedidos e suporte." badge={null} actions={null}>
            <div className="form-grid">
              <Input label="Contato comercial" value={form.contact_name} onChange={(value) => change("contact_name", value)} />
              <Input label="Telefone" value={form.phone} onChange={(value) => change("phone", formatBrazilianPhone(value))} inputMode="tel" />
              <Input label="WhatsApp" value={form.whatsapp} onChange={(value) => change("whatsapp", formatBrazilianPhone(value))} inputMode="tel" />
              <Input type="email" label="E-mail" value={form.email} onChange={(value) => change("email", value.replace(/\s/g, "").toLowerCase())} />
              <Input label="Site HTTPS ou @Instagram" value={form.website} onChange={(value) => change("website", value)} />
            </div>
          </FormSection>

          <FormSection title="Fornecimento e condições comerciais" description="Dados para comparar compras e prever reposição." badge={null} actions={null}>
            <div className="form-grid">
              <Input label="Categorias fornecidas" list="supplier-category-options" value={form.categories} onChange={(value) => change("categories", value)} placeholder="Joias, Equipamentos" />
              <datalist id="supplier-category-options">{SUPPLIER_CATEGORIES.map((item) => <option key={item} value={item} />)}</datalist>
              <Input label="Marcas" value={form.brands} onChange={(value) => change("brands", value)} placeholder="Separe por vírgulas" />
              <Input type="number" min="0" label="Lead time / entrega (dias)" value={form.lead_time_days} onChange={(value) => change("lead_time_days", value)} />
              <Input type="number" min="0" label="Prazo de pagamento (dias)" value={form.payment_days} onChange={(value) => change("payment_days", value)} />
              <Input type="number" min="0" step="0.01" label="Pedido mínimo (R$)" value={form.minimum_order_value} onChange={(value) => change("minimum_order_value", value)} />
              <Input label="Forma de pagamento padrão" value={form.payment_method} onChange={(value) => change("payment_method", value)} />
              <Input label="Condições de pagamento" value={form.payment_terms} onChange={(value) => change("payment_terms", value)} placeholder="Ex.: 30/60 dias" />
              <Input label="Frete habitual" value={form.freight_terms} onChange={(value) => change("freight_terms", value)} placeholder="Transportadora, CIF, FOB…" />
            </div>
          </FormSection>

          <AdvancedFields title="Endereço" description="Opcional para entrega, cobrança e documentos fiscais." count={undefined} open={undefined} onOpenChange={undefined}>
            <div className="form-grid">
              <Input label="CEP" value={form.postal_code} onChange={(value) => change("postal_code", formatPostalCode(value))} inputMode="numeric" />
              <Input label="Logradouro" value={form.street} onChange={(value) => change("street", value)} />
              <Input label="Número" value={form.street_number} onChange={(value) => change("street_number", value)} />
              <Input label="Complemento" value={form.address_complement} onChange={(value) => change("address_complement", value)} />
              <Input label="Bairro" value={form.neighborhood} onChange={(value) => change("neighborhood", value)} />
              <Input label="Cidade" value={form.city} onChange={(value) => change("city", value)} />
              <Select label="UF" value={form.state} onChange={(value) => change("state", value)}><option value="">Não informada</option>{BRAZILIAN_STATES.map((state) => <option key={state} value={state}>{state}</option>)}</Select>
              <Input label="País" value={form.country} onChange={(value) => change("country", value)} />
            </div>
          </AdvancedFields>

          <AdvancedFields title="Qualidade e rastreabilidade" description="Útil para joias, materiais implantáveis, descartáveis e lotes." count={undefined} open={undefined} onOpenChange={undefined}>
            <div className="form-grid">
              <Select label="Situação de qualidade" value={form.quality_status} onChange={(value) => change("quality_status", value)}>
                {Object.entries(qualityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
              <Input label="Materiais/referências" value={form.material_references} onChange={(value) => change("material_references", value)} placeholder="Titânio ASTM F-136, nióbio…" />
              <Input label="Certificações e laudos" value={form.certifications} onChange={(value) => change("certifications", value)} placeholder="Separe por vírgulas" />
              <Input label="Referências/requisitos de lote" value={form.lot_references} onChange={(value) => change("lot_references", value)} />
            </div>
          </AdvancedFields>

          <FormSection title="Observações" description="Informações livres que ajudam a equipe nas próximas compras." badge={null} actions={null}>
            <Textarea label="Observações" value={form.notes} onChange={(value) => change("notes", value)} rows={4} />
            {editing && <small>Última compra: {editing.last_purchase_date ? formatDate(editing.last_purchase_date) : "nenhuma"} · Total comprado: {money(editing.total_purchased)} · Contas pendentes: {money(editing.pending_payables)}</small>}
          </FormSection>
          {error && <span className="form-error" role="alert">{error}</span>}
        </FormWorkflow>
      </Modal>
    </section>
  );
}
