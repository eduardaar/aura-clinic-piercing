import React, { useState } from "react";
import { Download } from "lucide-react";
import { Button, Input, Select } from "../../components/common/Ui";
import { ApiError, Loading } from "../../components/common/Feedback";
import { asArray, asObject } from "../../lib/utils";
import { downloadApiFile, useFetch } from "../../lib/api";

const TYPES = [
  ["financial", "Financeiro"], ["sales", "Vendas"], ["stock", "Estoque"], ["services", "Serviços"],
  ["clients", "Clientes"], ["professionals", "Profissionais"], ["appointments", "Agendamentos"],
  ["cancellations", "Cancelamentos"], ["promotions", "Promoções"], ["coupons", "Cupons"],
  ["commissions", "Comissões"], ["payments", "Pagamentos"], ["catalog_conversion", "Conversão do catálogo"]
];

export function Reports() {
  const today = new Date().toISOString().slice(0, 10);
  const [filters, setFilters] = useState({ type: "sales", from: `${today.slice(0, 7)}-01`, to: today, status: "" });
  const params = new URLSearchParams({ from: filters.from, to: filters.to, ...(filters.status ? { status: filters.status } : {}) });
  const { data } = useFetch(`/reports/${filters.type}?${params}`);
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const report = asObject(data);
  const rows = asArray(report.rows);
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const download = (format) => downloadApiFile(`/reports/${filters.type}?${params}&format=${format}`, `${filters.type}-${filters.from}-${filters.to}.${format}`);
  return (
    <section className="stack">
      <div className="panel">
        <div className="panel-heading">
          <div><h2>Central de relatórios</h2><span>Dados reais e isolados por clínica, com exportação em três formatos.</span></div>
          <div className="export-actions">
            {["pdf", "xlsx", "csv"].map((format) => <Button key={format} variant="secondary" onClick={() => download(format)}><Download size={15} /> {format.toUpperCase()}</Button>)}
          </div>
        </div>
        <div className="form-grid">
          <Select label="Relatório" value={filters.type} onChange={(value) => setFilters({ ...filters, type: value })}>
            {TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </Select>
          <Input type="date" label="De" value={filters.from} onChange={(value) => setFilters({ ...filters, from: value })} />
          <Input type="date" label="Até" value={filters.to} onChange={(value) => setFilters({ ...filters, to: value })} />
          <Input label="Status (opcional)" value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} />
        </div>
      </div>
      <div className="panel">
        <div className="panel-heading"><h2>{TYPES.find(([value]) => value === filters.type)?.[1]}</h2><span>{report.total_rows || 0} registro(s)</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll("_", " ")}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, index) => <tr key={row.id || index}>{columns.map((column) => <td key={column}>{row[column] ?? "—"}</td>)}</tr>)}
              {!rows.length && <tr><td colSpan={Math.max(columns.length, 1)}>Nenhum dado para os filtros selecionados.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
