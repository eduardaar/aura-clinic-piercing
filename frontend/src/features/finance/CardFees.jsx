import { useEffect, useState } from "react";
import { Button, Input, Select } from "../../components/common/Ui";
import { apiFetch } from "../../lib/api";
import { asArray, localDateValue } from "../../lib/utils";
import { currency } from "../shared/helpers";

const infinitePayReference = {
  operator_name: "InfinitePay · D+1 · Visa/Mastercard · até R$ 20 mil/mês",
  debit_percent: 1.37,
  credit_rates: { 1: 3.15, 2: 5.39, 3: 6.12, 4: 6.85, 5: 7.57, 6: 8.28, 7: 8.99, 8: 9.69, 9: 10.38, 10: 11.06, 11: 11.74, 12: 12.40 },
  source_details: { source_url: "https://www.infinitepay.io/taxas", checked_at: "2026-10-30", conditions: "Maquininha/InfiniteTap; um dia útil; até R$ 20 mil/mês; Visa e Mastercard; antecipação incluída" },
};

const empty = () => ({
  operator_name: "",
  valid_from: localDateValue(new Date()),
  debit_percent: "",
  fee_policy: "studio",
  source_details: {},
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
      <div className="soft-card stack">
        <strong>Referência oficial InfinitePay</strong>
        <p>Maquininha ou InfiniteTap, recebimento em um dia útil, até R$ 20 mil por mês, Visa e Mastercard. Consulta em 30/10/2026. Outras bandeiras, faturamentos e prazos têm taxas diferentes.</p>
        <a href="https://www.infinitepay.io/taxas" target="_blank" rel="noreferrer">Conferir taxas oficiais</a>
        <Button variant="secondary" onClick={() => setForm({ ...empty(), ...infinitePayReference, debit_percent: String(infinitePayReference.debit_percent), credit_rates: Object.fromEntries(Object.entries(infinitePayReference.credit_rates).map(([count, value]) => [count, String(value)])) })}>Carregar referência para conferir</Button>
        <small>Carregar preenche o formulário. Confira o plano no aplicativo da operadora e ajuste os valores antes de salvar; a referência não é ativada automaticamente.</small>
      </div>
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
        <Select label="Quem assume a taxa por padrão" value={form.fee_policy || "studio"} onChange={(fee_policy) => setForm({ ...form, fee_policy })}>
          <option value="studio">Estúdio — registrar como despesa</option>
          <option value="customer">Cliente — calcular e informar o repasse</option>
        </Select>
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
  const table = tables.find((row) => String(row.id) === String(payment.card_fee_table_id) && String(row.valid_from).slice(0, 10) <= today) || activeTables[0];
  const rates = typeof table?.credit_rates === "string" ? JSON.parse(table.credit_rates) : table?.credit_rates;
  const percent = Number(mode === "debit" ? table?.debit_percent : rates?.[payment.installments || 1]);
  const policy = payment.fee_policy || table?.fee_policy || "studio";
  const baseCents = Math.max(0, Math.round(Number(payment.amount || 0) * 100));
  const scale = 1000000n;
  const rateScaled = BigInt(Number.isFinite(percent) ? Math.round(percent * 10000) : 0);
  const denominator = scale - rateScaled;
  const validQuote = table && Number.isSafeInteger(baseCents) && (policy !== "customer" || denominator > 0n);
  const chargedCents = validQuote && policy === "customer" ? (baseCents > 0 ? Number(((BigInt(baseCents) - 1n) * scale + scale / 2n) / denominator + 1n) : 0) : baseCents;
  const fee = validQuote ? Number((BigInt(chargedCents) * rateScaled + scale / 2n) / scale) / 100 : 0;
  const surcharge = (chargedCents - baseCents) / 100;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the computed fee and selected table may update the payment row.
  useEffect(() => {
    if (mode && table && validQuote && (Number(payment.fee_amount) !== fee || Number(payment.card_fee_table_id) !== Number(table.id) || payment.fee_policy !== policy || Number(payment.quoted_charged_amount) !== chargedCents / 100))
      onChange({ fee_amount: fee, card_fee_table_id: table.id, fee_policy: policy, card_surcharge_amount: surcharge, quoted_charged_amount: chargedCents / 100 });
    if (!mode && payment.card_fee_table_id) onChange({ fee_amount: 0, card_fee_table_id: "", fee_policy: "studio", card_surcharge_amount: 0, quoted_charged_amount: Number(payment.amount || 0) });
  }, [mode, table?.id, fee, policy, validQuote, chargedCents, payment.fee_amount, payment.card_fee_table_id, payment.fee_policy, payment.quoted_charged_amount]);
  if (!mode) return null;
  if (!table) return <small>Cadastre as taxas da maquininha em Configurações → Taxas das maquininhas para calcular o líquido e o repasse.</small>;
  return (
    <div className="stack">
      <Select label="Maquininha" value={table.id} onChange={(card_fee_table_id) => onChange({ card_fee_table_id })}>
        {activeTables.map((row) => (
          <option key={row.id} value={row.id}>
            {row.operator_name}
          </option>
        ))}
      </Select>
      <Select label="Taxa deste pagamento" value={policy} onChange={(fee_policy) => onChange({ fee_policy })}>
        <option value="studio">Absorvida pelo estúdio</option><option value="customer">Repassada ao cliente</option>
      </Select>
      {!validQuote && <p role="alert">Confira o valor e a taxa. O repasse exige taxa menor que 100%.</p>}
      <small>
        Valor do atendimento/venda {currency.format(Number(payment.amount || 0))} · Taxa {percent}% ({currency.format(fee)}) · Repasse {currency.format(surcharge)} · Total a cobrar {currency.format(chargedCents / 100)} · Líquido previsto {currency.format(chargedCents / 100 - fee)}
      </small>
      {policy === "customer" && <strong>Cobre apenas o total informado. O repasse já está incluído nesse valor.</strong>}
    </div>
  );
}
