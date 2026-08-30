import { useState } from "react";
import { Button, StatusBadge } from "../../components/common/Ui";
import { CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { apiFetch, useFetch } from "../../lib/api";
import { asArray } from "../../lib/utils";
import "./access-admin.css";

const MODULE_LABELS = {
  users: "Usuários e acessos", appointments: "Agenda e atendimentos", clients: "Clientes",
  finance: "Financeiro", inventory: "Estoque", sales: "Vendas", settings: "Configurações",
  audit: "Auditoria", privacy: "Privacidade", reports: "Relatórios"
};
const ACTION_LABELS = {
  create: "Cadastro", update: "Alteração", delete: "Exclusão", replace_permissions: "Permissões substituídas",
  login: "Login", logout: "Logout", cancel: "Cancelamento", export: "Exportação", view: "Consulta sensível"
};
const ENTITY_LABELS = {
  user: "Usuário", access_profile: "Perfil de acesso", client: "Cliente", appointment: "Atendimento",
  financial_entry: "Lançamento financeiro", inventory_item: "Item de estoque", report: "Relatório"
};
const SEVERITY_LABELS = { info: "Informativo", warning: "Atenção", critical: "Crítico" };

const labelFor = (map, value) => map[value] || String(value || "—").replaceAll("_", " ");
const formatTimestamp = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR");
};
const jsonValue = (value) => {
  if (value == null) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
};
const prettyJson = (value) => value == null ? "Sem dados" : JSON.stringify(jsonValue(value), null, 2);

export function AuditAdmin() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState(/** @type {{ key: string, dir: "asc" | "desc" }} */ ({ key: "created_at", dir: "desc" }));
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);

  const params = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
  if (search.trim()) params.set("search", search.trim());
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (sort?.key) params.set("sort", `${sort.key}:${sort.dir}`);
  const query = useFetch(`/audit-events?${params}`);
  const rows = asArray(query.data?.items);
  const total = Number(query.data?.total || 0);

  async function openDetail(row) {
    setDetail(row);
    setDetailError("");
    setDetailLoading(true);
    try {
      const response = await apiFetch(`/audit-events/${row.id}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o evento.");
      setDetail(payload);
    } catch (error) {
      setDetailError(error.message);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <section className="stack audit-admin-page">
      <div className="panel">
        <CrudHeader title="Auditoria" subtitle="Histórico imutável das ações importantes realizadas no sistema" />
        <DataView
          mode="server"
          rows={rows}
          total={total}
          loading={query.loading}
          error={query.error}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          search={search}
          onSearchChange={(value) => { setSearch(value); setPage(1); }}
          searchPlaceholder="Buscar ator, entidade, ID ou motivo"
          filters={[
            { key: "module", label: "Módulo", type: "select", options: Object.entries(MODULE_LABELS).map(([value, label]) => ({ value, label })) },
            { key: "action", label: "Ação", type: "select", options: Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label })) },
            { key: "entity_type", label: "Tipo de registro", type: "select", options: Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label })) },
            { key: "severity", label: "Criticidade", type: "select", options: Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value, label })) },
            { key: "from", label: "A partir de", type: "date" },
            { key: "to", label: "Até", type: "date" }
          ]}
          filterValues={filters}
          onFilterChange={(values) => { setFilters(values); setPage(1); }}
          sort={sort}
          onSortChange={(value) => { setSort(value); setPage(1); }}
          columns={[
            { key: "created_at", label: "Data e hora", render: (row) => formatTimestamp(row.created_at) },
            { key: "actor", label: "Responsável", value: (row) => row.actor_name || row.actor_email, render: (row) => <span><strong>{row.actor_name || "Sistema"}</strong><small className="audit-cell-detail">{row.actor_email || "ação automática"}</small></span> },
            { key: "module", label: "Módulo", render: (row) => labelFor(MODULE_LABELS, row.module) },
            { key: "action", label: "Ação", render: (row) => labelFor(ACTION_LABELS, row.action) },
            { key: "entity_type", label: "Registro", sortable: false, render: (row) => `${labelFor(ENTITY_LABELS, row.entity_type)}${row.entity_id ? ` #${row.entity_id}` : ""}` },
            { key: "severity", label: "Criticidade", render: (row) => <StatusBadge status={labelFor(SEVERITY_LABELS, row.severity)} tone={row.severity === "critical" ? "danger" : row.severity === "warning" ? "warn" : "info"} /> },
            { key: "reason", label: "Motivo", sortable: false, render: (row) => row.reason || "—" }
          ]}
          actions={(row) => <RowActions actions={[{ label: "Ver detalhes", onClick: () => openDetail(row), primary: true }]} />}
          empty="Nenhum evento de auditoria registrado."
          emptyFiltered="Nenhum evento corresponde aos filtros aplicados."
        />
      </div>

      <Modal
        open={Boolean(detail)}
        size="lg"
        title="Detalhes do evento"
        subtitle={detail ? `${formatTimestamp(detail.created_at)} · ${labelFor(ACTION_LABELS, detail.action)}` : ""}
        onClose={() => setDetail(null)}
        footer={<Button variant="secondary" onClick={() => setDetail(null)}>Fechar</Button>}
      >
        {detail && (
          <div className="stack">
            <dl className="audit-detail-summary">
              <div><dt>Responsável</dt><dd>{detail.actor_name || "Sistema"}<small>{detail.actor_email || ""}</small></dd></div>
              <div><dt>Módulo</dt><dd>{labelFor(MODULE_LABELS, detail.module)}</dd></div>
              <div><dt>Ação</dt><dd>{labelFor(ACTION_LABELS, detail.action)}</dd></div>
              <div><dt>Registro</dt><dd>{labelFor(ENTITY_LABELS, detail.entity_type)} {detail.entity_id ? `#${detail.entity_id}` : ""}</dd></div>
              <div><dt>Motivo</dt><dd>{detail.reason || "Não informado"}</dd></div>
              <div><dt>Origem</dt><dd>{detail.ip_address || "Não identificada"}<small>{detail.request_id ? `Requisição ${detail.request_id}` : ""}</small></dd></div>
            </dl>
            {detailLoading && <p>Atualizando detalhes…</p>}
            {detailError && <span className="form-error">{detailError}</span>}
            <div className="audit-diff-grid">
              <section><h3>Antes</h3><pre>{prettyJson(detail.before_data)}</pre></section>
              <section><h3>Depois</h3><pre>{prettyJson(detail.after_data)}</pre></section>
            </div>
            {detail.metadata && <section className="audit-metadata"><h3>Metadados</h3><pre>{prettyJson(detail.metadata)}</pre></section>}
          </div>
        )}
      </Modal>
    </section>
  );
}
