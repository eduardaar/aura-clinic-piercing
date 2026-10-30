import { Select } from "../../components/common/Ui";
import { apiFetch } from "../../lib/api";
import { asArray } from "../../lib/utils";

export function FinancialAccountSelect({ value, onChange, label = "Conta ou caixa" }) {
  const [data, setData] = useState([]);
  useEffect(() => {
    let active = true;
    apiFetch("/finance/accounts/options").then(async (response) => {
      if (!response.ok) return;
      const result = await response.json();
      if (active) setData(asArray(result));
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const accounts = asArray(data).filter((account) => account.is_active || String(account.id) === String(value));
  return <div className="stack">
    <Select label={label} value={String(value || "")} onChange={onChange}>
      <option value="">Identificar depois</option>
      {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{!account.is_active ? " (desativada)" : ""}</option>)}
    </Select>
    <small className="field-hint">Banco, caixa físico ou saldo na operadora. Sem conta, o movimento fica em “A identificar” no Caixa.</small>
  </div>;
}
import { useEffect, useState } from "react";
