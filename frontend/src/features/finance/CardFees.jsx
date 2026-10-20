import { useEffect, useState } from "react";
import { Button, Input, Select } from "../../components/common/Ui";
import { apiFetch } from "../../lib/api";
import { asArray, localDateValue } from "../../lib/utils";
import { currency } from "../shared/helpers";

const empty = () => ({
  operator_name: "",
  valid_from: localDateValue(new Date()),
  debit_percent: "",
  credit_rates: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, ""])),
});
const modeOf = (method) => {
  const value = String(method || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return value.includes("debito") ? "debit" : value.includes("cartao") || value.includes("credito") ? "credit" : null;
};

export function CardFeesSettings() {
  const [form, setForm] = useState(empty);
  const [tables, setTables] = useState([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  async function load() {
    const response = await apiFetch("/finance/card-fees");
    if (response.ok) setTables(asArray(await response.json()));
  }
  useEffect(() => {
    void load().catch(() => setMessage("Não foi possível carregar as taxas."));
  }, []);
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await apiFetch("/finance/card-fees", { method: "POST", body: JSON.stringify(form) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      await load();
      setMessage("Tabela de taxas salva. Pagamentos anteriores mantêm as taxas já aplicadas.");
    } catch (error) {
      setMessage(error.message || "Não foi possível salvar as taxas.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="panel stack" aria-label="Taxas de cartão">
      <h2>Taxas das maquininhas</h2>
      <p>
        Cadastre uma tabela por operadora e data de vigência. Cada atualização cria uma versão e preserva os pagamentos
        anteriores.
      </p>
      <Select
        label="Usar tabela como base"
        value=""
        onChange={(id) => {
          const table = tables.find((row) => String(row.id) === id);
          if (table) setForm({ ...table, valid_from: localDateValue(new Date()) });
        }}
      >
        <option value="">Nova tabela</option>
        {tables.map((table) => (
          <option key={table.id} value={table.id}>
            {table.operator_name} · {String(table.valid_from).slice(0, 10)}
          </option>
        ))}
      </Select>
      <form onSubmit={save} className="stack">
        <div className="form-grid">
          <Input
            label="Operadora ou maquininha"
            value={form.operator_name}
            onChange={(operator_name) => setForm({ ...form, operator_name })}
            required
          />
          <Input
            type="date"
            label="Vigência das taxas"
            value={form.valid_from}
            onChange={(valid_from) => setForm({ ...form, valid_from })}
            required
          />
          <Input
            type="number"
            min="0"
            max="100"
            step="0.0001"
            label="Débito (%)"
            value={form.debit_percent}
            onChange={(debit_percent) => setForm({ ...form, debit_percent })}
            required
          />
          {Array.from({ length: 12 }, (_, i) => i + 1).map((count) => (
            <Input
              key={count}
              type="number"
              min="0"
              max="100"
              step="0.0001"
              label={`Crédito ${count}x (%)`}
              value={form.credit_rates[count]}
              onChange={(value) => setForm({ ...form, credit_rates: { ...form.credit_rates, [count]: value } })}
              required
            />
          ))}
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando..." : "Salvar tabela de taxas"}
        </Button>
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}

export function CardFeePreview({ payment, onChange }) {
  const [tables, setTables] = useState([]);
  const mode = modeOf(payment.method);
  useEffect(() => {
    if (!mode) return undefined;
    let active = true;
    (async () => {
      try {
        const response = await apiFetch("/finance/card-fees");
        if (response.ok && active) setTables(asArray(await response.json()));
      } catch {
        /* The form stays usable if rates cannot be loaded. */
      }
    })();
    return () => {
      active = false;
    };
  }, [mode]);
  const today = localDateValue(new Date());
  const activeTables = tables
    .filter((table) => String(table.valid_from).slice(0, 10) <= today)
    .filter((table, index, all) => all.findIndex((row) => row.operator_name === table.operator_name) === index);
  const table = activeTables.find((row) => String(row.id) === String(payment.card_fee_table_id)) || activeTables[0];
  const rates = typeof table?.credit_rates === "string" ? JSON.parse(table.credit_rates) : table?.credit_rates;
  const percent = Number(mode === "debit" ? table?.debit_percent : rates?.[payment.installments || 1]);
  const fee = table && Number.isFinite(percent) ? Math.round(Number(payment.amount || 0) * percent) / 100 : 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the computed fee and selected table may update the payment row.
  useEffect(() => {
    if (mode && table && (Number(payment.fee_amount) !== fee || Number(payment.card_fee_table_id) !== Number(table.id)))
      onChange({ fee_amount: fee, card_fee_table_id: table.id });
  }, [mode, table?.id, fee, payment.fee_amount, payment.card_fee_table_id]);
  if (!mode || !table) return null;
  return (
    <div className="stack">
      <Select label="Maquininha" value={table.id} onChange={(card_fee_table_id) => onChange({ card_fee_table_id })}>
        {activeTables.map((row) => (
          <option key={row.id} value={row.id}>
            {row.operator_name}
          </option>
        ))}
      </Select>
      <small>
        Bruto {currency.format(Number(payment.amount || 0))} · Taxa {percent}% ({currency.format(fee)}) · Líquido{" "}
        {currency.format(Number(payment.amount || 0) - fee)}
      </small>
    </div>
  );
}
