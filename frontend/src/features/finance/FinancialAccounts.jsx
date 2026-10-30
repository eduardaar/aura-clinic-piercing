import { useState } from "react";
import { Button, Input, Metric, Select, Textarea } from "../../components/common/Ui";
import { CrudHeader, Modal } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { apiFetch, useFetch, useApiInvalidate, readStoredSession } from "../../lib/api";
import { asArray, asObject, localDateValue } from "../../lib/utils";
import { can } from "../../lib/permissions";
import { currency } from "../shared/helpers";

const kinds = { bank: "Conta bancária", cash: "Dinheiro físico", wallet: "Carteira digital", card: "Saldo na operadora" };
const date = (value) => String(value || "").slice(0, 10);
const today = () => localDateValue(new Date());
const key = () => crypto.randomUUID();

function Pages({ page, onOffset }) {
  return <div className="section-inline-header">
    <span>{page.total || 0} registros</span>
    <Button variant="secondary" disabled={!page.offset} onClick={() => onOffset(Math.max(0, page.offset - page.limit))}>Anterior</Button>
    <Button variant="secondary" disabled={(page.offset || 0) + (page.limit || 30) >= (page.total || 0)} onClick={() => onOffset((page.offset || 0) + (page.limit || 30))}>Próxima</Button>
  </div>;
}

export function FinancialAccounts({ onNavigate }) {
  const invalidate = useApiInvalidate();
  const [accountId, setAccountId] = useState("");
  const [offset, setOffset] = useState(0);
  const [unallocatedOffset, setUnallocatedOffset] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { data, loading, error } = useFetch("/finance/accounts");
  const { data: history } = useFetch(`/finance/account-movements?${new URLSearchParams({ account_id: accountId, offset: String(offset), from, to })}`);
  const { data: unallocated } = useFetch(`/finance/accounts/unallocated?offset=${unallocatedOffset}`);
  const [modal, setModal] = useState("");
  const [form, setForm] = useState(/** @type {Record<string, any>} */ ({}));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [allocations, setAllocations] = useState({});
  const accounts = asArray(data);
  const active = accounts.filter((account) => account.is_active);
  const canEdit = can(readStoredSession()?.user || {}, "finance.edit");
  const update = (patch) => setForm((current) => ({ ...current, ...patch }));
  const refresh = () => { invalidate("/finance"); };
  const open = (kind, seed = {}) => {
    setModal(kind); setMessage("");
    setForm({ name: "", kind: "bank", opening_balance: "0", opening_date: today(),
      from_account_id: "", to_account_id: "", amount: "", movement_date: today(), description: "", reason: "",
      idempotency_key: key(), ...seed });
  };
  async function request(path, body, method = "POST") {
    const response = await apiFetch(path, { method, body: JSON.stringify(body) });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Não foi possível salvar.");
    refresh(); return json;
  }
  async function save(event) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      if (modal === "account") await request("/finance/accounts", form);
      else if (modal === "rename") await request(`/finance/accounts/${form.id}`, { name: form.name }, "PATCH");
      else if (modal === "reverse") await request(`/finance/account-movements/${form.id}/reverse`, { reason: form.reason });
      else await request("/finance/account-movements", { ...form, kind: modal });
      setModal("");
    } catch (failure) { setMessage(failure.message); }
    finally { setSaving(false); }
  }
  async function allocate(row) {
    const sourceKey = `${row.source_type}/${row.source_id}`;
    setMessage(""); setSaving(true);
    try { await request("/finance/accounts/allocate", { source_type: row.source_type, source_id: row.source_id, financial_account_id: allocations[sourceKey] }); }
    catch (failure) { setMessage(failure.message); }
    finally { setSaving(false); }
  }
  if (loading && !data) return <Loading />;
  if (error || data?.error) return <ApiError message={error || data.error} />;
  const selected = accounts.find((account) => String(account.id) === accountId);
  return <section className="stack finance-page">
    <section className="panel stack">
      <CrudHeader title="Contas e caixa" subtitle="Saldos por banco, dinheiro físico e operadora, com origem e destino de cada movimento"
        actionLabel={canEdit ? "Nova conta" : undefined} onAction={canEdit ? () => open("account") : undefined}
        actions={[
          ...(canEdit ? [{ label: "Transferir", onClick: () => open("transfer", { kind: "transfer" }) }, { label: "Ajustar saldo", onClick: () => open("adjustment", { kind: "adjustment" }) }] : []),
          { label: "Contas a pagar", onClick: () => onNavigate?.("payables") },
          { label: "Contas a receber", onClick: () => onNavigate?.("receivables") },
        ]} />
      <p>Conta bancária guarda o saldo do banco. Caixa físico é o dinheiro em espécie. Carteiras e operadoras têm saldos próprios. Contas a pagar e a receber ficam separadas até o pagamento acontecer.</p>
      <p>Para valores ainda com a maquininha, use uma conta do tipo “Saldo na operadora”. Quando o dinheiro cair no banco, registre a transferência entre essas contas.</p>
      <div className="metric-grid">{accounts.map((account) => <div key={account.id} className="stack soft-card">
        <Metric label={account.name} value={currency.format(Number(account.balance))} />
        <small>{kinds[account.kind]} · Saldo inicial em {date(account.opening_date)}{!account.is_active ? " · Desativada" : ""}</small>
        {canEdit && <Button variant="secondary" onClick={() => open("rename", { id: account.id, name: account.name })}>Renomear</Button>}
        {canEdit && <Button variant="secondary" disabled={saving} onClick={async () => {
          setMessage(""); try { await request(`/finance/accounts/${account.id}`, { is_active: !account.is_active }, "PATCH"); } catch (failure) { setMessage(failure.message); }
        }}>{account.is_active ? "Desativar" : "Ativar"}</Button>}
      </div>)}</div>
      {!accounts.length && <p>Cadastre as contas utilizadas pelo estúdio e informe o saldo no início da data escolhida.</p>}
      {message && !modal && <p role="alert" className="form-error">{message}</p>}
    </section>
    <section className="panel stack">
      <h2>Histórico de movimentações</h2>
      <div className="form-grid">
        <Select label="Conta do extrato" value={accountId} onChange={(value) => { setAccountId(value); setOffset(0); }}>
          <option value="">Todas as contas</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </Select>
        <Input label="De" type="date" value={from} onChange={(value) => { setFrom(value); setOffset(0); }} />
        <Input label="Até" type="date" value={to} onChange={(value) => { setTo(value); setOffset(0); }} />
      </div>
      {selected && <small>Saldo inicial de {currency.format(Number(selected.opening_balance))} no início de {date(selected.opening_date)}. Movimentos anteriores permanecem no histórico e não são somados novamente ao saldo.</small>}
      {history?.error ? <ApiError message={history.error} /> : <>
        <DataView rows={asArray(asObject(history).items)} paginated={false} searchable={false} columns={[
          { key: "movement_date", label: "Data", render: (row) => date(row.movement_date) },
          { key: "description", label: "Movimento" },
          { key: "from_account", label: "Origem", render: (row) => row.from_account || "Origem externa" },
          { key: "to_account", label: "Destino", render: (row) => row.to_account || "Destino externo" },
          { key: "amount", label: "Valor", render: (row) => currency.format(Number(row.amount)) },
          ...(accountId ? [{ key: "running_balance", label: "Saldo após", render: (row) => date(row.movement_date) < date(selected?.opening_date) ? "Anterior ao saldo inicial" : currency.format(Number(row.running_balance)) }] : []),
          { key: "action", label: "Ações", render: (row) => canEdit && ["transfer", "adjustment"].includes(row.source_type) && !row.reversed ? <Button variant="secondary" onClick={() => open("reverse", { id: row.id })}>Estornar</Button> : row.reversed ? "Estornado" : "Origem preservada" },
        ]} empty="Nenhuma movimentação no período." />
        <Pages page={asObject(history)} onOffset={setOffset} />
      </>}
    </section>
    <section className="panel stack">
      <h2>A identificar</h2>
      <p>Pagamentos já realizados sem conta informada. Identifique a conta uma vez para atualizar o saldo. Valores pendentes não entram nesta lista.</p>
      {unallocated?.error ? <ApiError message={unallocated.error} /> : <>
        <DataView rows={asArray(asObject(unallocated).items)} paginated={false} searchable={false} columns={[
          { key: "movement_date", label: "Data", render: (row) => date(row.movement_date) },
          { key: "description", label: "Origem do registro" },
          { key: "amount", label: "Entrada / saída", render: (row) => currency.format(Number(row.amount)) },
          { key: "payment_method", label: "Forma" },
          { key: "account", label: "Conta", render: (row) => {
            const sourceKey = `${row.source_type}/${row.source_id}`;
            return canEdit ? <div className="stack"><Select ariaLabel={`Conta para ${row.description}`} value={allocations[sourceKey] || ""} onChange={(value) => setAllocations((current) => ({ ...current, [sourceKey]: value }))}>
              <option value="">Selecione</option>{active.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </Select><Button variant="secondary" disabled={saving || !allocations[sourceKey]} onClick={() => allocate(row)}>Associar conta</Button></div> : "A identificar";
          } },
        ]} empty="Todos os movimentos realizados têm conta identificada." />
        <Pages page={asObject(unallocated)} onOffset={setUnallocatedOffset} />
      </>}
    </section>
    <Modal open={Boolean(modal)} title={modal === "account" ? "Nova conta" : modal === "rename" ? "Renomear conta" : modal === "reverse" ? "Estornar movimentação" : modal === "transfer" ? "Transferir entre contas" : "Ajustar saldo"} onClose={() => setModal("")} footer={null}>
      <form onSubmit={save} className="stack">
        {modal === "rename" ? <Input label="Nome da conta" value={form.name || ""} onChange={(name) => update({ name })} required /> : modal === "account" ? <>
          <Input label="Nome da conta" value={form.name || ""} onChange={(name) => update({ name })} required />
          <Select label="Tipo" value={form.kind || "bank"} onChange={(kind) => update({ kind })}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
          <Input label="Saldo inicial" type="number" step="0.01" value={form.opening_balance ?? ""} onChange={(opening_balance) => update({ opening_balance })} required />
          <Input label="Saldo no início de" type="date" max={today()} value={form.opening_date || ""} onChange={(opening_date) => update({ opening_date })} required />
          <p>Informe o saldo no início desse dia. Movimentos anteriores não serão somados novamente. O saldo inicial será preservado; correções posteriores ficam registradas como ajustes.</p>
        </> : modal === "reverse" ? <Textarea label="Motivo do estorno" value={form.reason || ""} onChange={(reason) => update({ reason })} required /> : <>
          {modal === "adjustment" && <p>Ajustes corrigem a conferência do saldo. Pagamentos e recebimentos devem ser registrados nas contas a pagar/receber ou no atendimento. Transferências não geram receita nem despesa.</p>}
          <Select label="Origem do dinheiro" value={form.from_account_id || ""} onChange={(from_account_id) => update({ from_account_id })}>
            <option value="">Origem externa (entrada de ajuste)</option>{active.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </Select>
          <Select label="Destino do dinheiro" value={form.to_account_id || ""} onChange={(to_account_id) => update({ to_account_id })}>
            <option value="">Destino externo (saída de ajuste)</option>{active.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </Select>
          <Input label="Valor" type="number" min="0.01" step="0.01" value={form.amount || ""} onChange={(amount) => update({ amount })} required />
          <Input label="Data da movimentação" type="date" max={today()} value={form.movement_date || ""} onChange={(movement_date) => update({ movement_date })} required />
          <Textarea label="Motivo / descrição" value={form.description || ""} onChange={(description) => update({ description })} required />
        </>}
        {message && <p role="alert" className="form-error">{message}</p>}
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={() => setModal("")}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Confirmar"}</Button></div>
      </form>
    </Modal>
  </section>;
}
