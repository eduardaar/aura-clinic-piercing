// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import { useState } from "react";
import { Bell, Cake, Calendar, ChevronRight, CircleDollarSign, Gem, Trophy, UsersRound, } from "lucide-react";
import { Button, StatusBadge } from "../../components/common/Ui";
import { ApiError, Loading } from "../../components/common/Feedback";
import { asArray, asNumber, asObject, formatDate, formatLongDate, initials } from "../../lib/utils";
import { useFetch } from "../../lib/api";
import { currency, formatRevenueAxisLabel, formatRevenueLabel, personName, statusClass } from "../../features/shared/helpers";

export function Dashboard({ user, setPage, alertsOpen, setAlertsOpen, alertsData, alertsLoading }) {
  const [period, setPeriod] = useState("30d");
  const { data } = useFetch(`/dashboard?period=${period}`);

  if (data == null) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  return <PremiumDashboard data={data} user={user} setPage={setPage} period={period} setPeriod={setPeriod} alertsOpen={alertsOpen} setAlertsOpen={setAlertsOpen} alertsData={alertsData} alertsLoading={alertsLoading} />;
}

// Indicador ausente no payload vira "—" em vez de zero, para não mascarar falha de dado.
function statCurrency(value) {
  return value === undefined || value === null ? "—" : currency.format(Number(value));
}

function statCount(value) {
  return value === undefined || value === null ? "—" : String(value);
}

export function PremiumDashboard({ data, user, setPage, period, setPeriod, alertsOpen, setAlertsOpen, alertsData, alertsLoading }) {
  const [section, setSection] = useState("resumo");
  const [revenueMode, setRevenueMode] = useState("mensal");
  const safeData = asObject(data);
  // Sem defaults zerados: se um indicador sumir do payload precisa aparecer como "—",
  // e não como um R$ 0,00 silencioso que passa por número real.
  const safeStats = asObject(safeData.stats);
  const adminDashboard = asObject(safeData.adminDashboard);
  const upcomingAppointments = asArray(adminDashboard.upcomingAppointments);
  const criticalStockItems = asArray(adminDashboard.criticalStock);
  const birthdaysItems = asArray(adminDashboard.birthdaysMonth);
  const procedureRanking = asArray(adminDashboard.procedureRanking);
  const jewelryRanking = asArray(adminDashboard.jewelryRanking);
  const categoryRanking = asArray(adminDashboard.categoryRanking);
  const returnClients = asArray(adminDashboard.returnClients);
  const nextAppointment = asObject(adminDashboard.nextAppointment);
  const appointmentAlerts = asArray(adminDashboard.appointmentAlerts);
  const executive = asObject(adminDashboard.executive);
  const topViewed = asArray(adminDashboard.topViewed);
  const professionalRanking = asArray(adminDashboard.professionalRanking);

  const cards = [
    { label: "Agendamentos hoje", value: statCount(safeStats.todayCount), icon: Calendar, action: "Ver agenda", page: "agenda", tone: "gold" },
    { label: "Clientes novos", value: statCount(safeStats.newClientsMonth), icon: UsersRound, action: "Ver clientes", page: "clients", tone: "nude" },
    { label: "Joias em estoque crítico", value: statCount(safeStats.lowStockCount ?? safeStats.criticalStock), icon: Gem, action: "Ver estoque", page: "inventory", tone: "green" },
    { label: "Faturamento hoje", value: statCurrency(safeStats.revenueToday), icon: CircleDollarSign, action: "Ver contas", page: "receivables", tone: "brown" },
    { label: "Aniversariantes do mês", value: String(birthdaysItems.length), icon: Cake, action: "Ver todos", page: "clients", tone: "gold" }
  ];

  const pendingValue = Math.max(
    Number(safeStats.monthForecast ?? 0) - Number(safeStats.depositReceived ?? 0),
    0
  );
  const revenueData = {
    diario: asArray(adminDashboard.dailyRevenue),
    semanal: asArray(adminDashboard.weeklyRevenue),
    mensal: asArray(adminDashboard.monthlyRevenue)
  }[revenueMode] || [];

  return (
    <section className="premium-dashboard">
      {alertsOpen && <AlertsPopup alerts={alertsData} loading={alertsLoading} onClose={() => setAlertsOpen(false)} onAction={(nextPage) => { setAlertsOpen(false); setPage(nextPage); }} />}

      <div className="panel-heading dashboard-period-heading">
        <div><h2>Dashboard financeiro</h2><span>Acompanhe ganhos, recebimentos, despesas e resultado no período.</span></div>
        <div className="segmented compact">
          {[['7d', '7 dias'], ['30d', '30 dias'], ['90d', '90 dias'], ['365d', '12 meses']].map(([value, label]) => <button type="button" key={value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>{label}</button>)}
        </div>
      </div>
      <nav className="dashboard-section-tabs" aria-label="Visões financeiras">
        {[['resumo', 'Resumo'], ['entradas', 'Entradas'], ['saidas', 'Saídas'], ['resultado', 'Resultado']].map(([value, label]) => (
          <button type="button" key={value} className={section === value ? "active" : ""} onClick={() => setSection(value)}>{label}</button>
        ))}
      </nav>
      <DashboardFinance tab={section} period={period} safeStats={safeStats} executive={executive} pendingValue={pendingValue} revenueData={revenueData} revenueMode={revenueMode} setRevenueMode={setRevenueMode} professionalRanking={professionalRanking} setPage={setPage} />
    </section>
  );
}

function DashboardStock({ criticalStockItems, jewelryRanking, categoryRanking, topViewed, setPage }) {
  const { data: inventoryData } = useFetch("/jewelry");
  const { data: intelligenceData } = useFetch("/inventory/intelligence?days=90");
  const inventory = asArray(inventoryData);
  const intelligence = asObject(intelligenceData);
  const intelligenceItems = asArray(intelligence.items);
  const intelligenceSummary = asObject(intelligence.summary);
  const totalPieces = inventory.reduce((total, item) => total + asNumber(item.quantity), 0);
  const invested = inventory.reduce((total, item) => total + asNumber(item.cost_value) * asNumber(item.quantity), 0);
  const potential = inventory.reduce((total, item) => total + asNumber(item.sale_value) * asNumber(item.quantity), 0);
  const abcItems = [...intelligenceItems].sort((a, b) => asNumber(b.units_out) - asNumber(a.units_out)).slice(0, 6);
  return <div className="dashboard-section-content">
    <div className="dashboard-section-heading"><div><h3>Estoque</h3><p>Acompanhe reposições, produtos mais vendidos e interesse no catálogo.</p></div><Button variant="secondary" onClick={() => setPage("inventory")}>Abrir estoque</Button></div>
    <div className="metric-grid dashboard-stock-metrics"><article className="metric-card"><span>Produtos cadastrados</span><strong>{inventory.length}</strong></article><article className="metric-card"><span>Unidades em estoque</span><strong>{totalPieces}</strong></article><article className="metric-card"><span>Valor investido</span><strong>{currency.format(invested)}</strong></article><article className="metric-card"><span>Venda potencial</span><strong>{currency.format(potential)}</strong></article></div>
    <div className="premium-lower-grid dashboard-stock-overview">
      <article className="panel compact-list-card dashboard-stock-critical"><div className="panel-heading"><h2>Itens com estoque crítico</h2><Button variant="ghost" onClick={() => setPage("inventory")}>Gerenciar</Button></div><div className="clean-list">{criticalStockItems.slice(0, 5).map((item) => <div key={item.id || `${item.name}-${item.quantity}`}><div className="jewel-thumb"><Gem size={21} /></div><span><strong>{item.name || "Produto"}</strong><small>{item.alert_level || (Number(item.quantity || 0) <= 0 ? "Esgotado" : "Acabando")} · {item.color || item.category || "Sem categoria"}</small></span><em>{Number(item.quantity || 0)} un.</em></div>)}{!criticalStockItems.length && <p className="empty-state">Estoque sem alerta crítico.</p>}</div></article>
      <article className="panel"><div className="panel-heading"><h2>Produtos mais vendidos</h2><span>Período selecionado</span></div><MiniBarChart data={jewelryRanking} valueKey="total" labelKey="label" /></article>
    </div>
    <div className="premium-ranking-grid dashboard-stock-ranking"><div className="panel"><div className="panel-heading"><h2>Ranking por categoria</h2><span>Vendas</span></div><MiniBarChart data={categoryRanking} valueKey="total" labelKey="label" /></div><div className="panel"><div className="panel-heading"><h2>Mais vistos no catálogo</h2><span>Interesse dos clientes</span></div><MiniBarChart data={topViewed} valueKey="views" labelKey="name" /></div></div>
    <div className="premium-ranking-grid dashboard-stock-ranking"><article className="panel"><div className="panel-heading"><h2>Curva ABC e giro</h2><span>Saídas nos últimos 90 dias</span></div><div className="clean-list">{abcItems.map((item) => <div key={item.id || item.sku}><span><strong>{item.name}</strong><small>{item.sku || "Sem SKU"} · classe {item.abc_class || "—"}</small></span><em>{asNumber(item.units_out)} saídas</em></div>)}{!abcItems.length && <p className="empty-state">Ainda não há saídas suficientes para calcular a curva.</p>}</div></article><article className="panel"><div className="panel-heading"><h2>Previsão e reposição</h2><Button variant="ghost" onClick={() => setPage("inventory")}>Gerenciar</Button></div><div className="finance-summary-list"><div className="warn"><span>Rupturas em 30 dias</span><strong>{asNumber(intelligenceSummary.predicted_stockouts)}</strong></div><div className="ok"><span>Unidades sugeridas</span><strong>{asNumber(intelligenceSummary.suggested_units)}</strong></div><div><span>Produtos classe A</span><strong>{asNumber(intelligenceSummary.class_a)}</strong></div></div></article></div>
  </div>;
}

function DashboardFinance({ tab, period, safeStats, executive, pendingValue, revenueData, revenueMode, setRevenueMode, professionalRanking, setPage }) {
  const today = new Date().toISOString().slice(0, 10);
  const rangeStart = new Date();
  if (period === "7d") rangeStart.setDate(rangeStart.getDate() - 6);
  else if (period === "30d") rangeStart.setDate(rangeStart.getDate() - 29);
  else if (period === "90d") rangeStart.setDate(rangeStart.getDate() - 89);
  else rangeStart.setFullYear(rangeStart.getFullYear() - 1);
  const from = rangeStart.toISOString().slice(0, 10);
  const { data: financeData } = useFetch(`/finance/ledger?from=${from}&to=${today}`);
  const finance = asObject(financeData);
  const cashflow = asObject(finance.cashflow);
  const dre = asObject(finance.dre);
  const entries = asArray(finance.entries);
  const incomeEntries = entries.filter((entry) => ["income", "receivable"].includes(entry.entry_type));
  const expenseEntries = entries.filter((entry) => entry.entry_type === "payable");
  const title = { resumo: "Resumo financeiro", entradas: "Entradas", saidas: "Saídas", resultado: "Resultado" }[tab];
  const subtitle = { resumo: "Visão geral do caixa e dos compromissos do período.", entradas: "Recebimentos realizados e valores que ainda entram.", saidas: "Despesas pagas e compromissos a quitar.", resultado: "Margem, caixa e desempenho por profissional." }[tab];

  return <div className="dashboard-section-content">
    <div className="dashboard-section-heading">
      <div><h3>{title}</h3><p>{subtitle}</p></div>
      <div className="header-actions">
        {tab !== "saidas" && <Button variant="secondary" onClick={() => setPage("receivables")}>Contas a receber</Button>}
        {tab !== "entradas" && <Button variant="secondary" onClick={() => setPage("payables")}>Contas a pagar</Button>}
      </div>
    </div>

    {tab === "resumo" && <>
      <div className="metric-grid dashboard-finance-metrics">
        <article className="metric-card"><span>Recebido</span><strong>{currency.format(asNumber(cashflow.received))}</strong></article>
        <article className="metric-card"><span>Pago</span><strong>{currency.format(asNumber(cashflow.paid))}</strong></article>
        <article className="metric-card"><span>Saldo de caixa</span><strong>{currency.format(asNumber(cashflow.balance))}</strong></article>
        <article className="metric-card"><span>Resultado</span><strong>{currency.format(asNumber(dre.result))}</strong></article>
      </div>
      <div className="premium-dashboard-grid dashboard-finance-grid">
        <article className="panel revenue-card"><div className="panel-heading"><h2>Faturamento</h2><div className="segmented compact"><button type="button" className={revenueMode === "diario" ? "active" : ""} onClick={() => setRevenueMode("diario")}>Diário</button><button type="button" className={revenueMode === "semanal" ? "active" : ""} onClick={() => setRevenueMode("semanal")}>Semanal</button><button type="button" className={revenueMode === "mensal" ? "active" : ""} onClick={() => setRevenueMode("mensal")}>Mensal</button></div></div><RevenueLineChart data={revenueData} mode={revenueMode} /></article>
        <article className="panel finance-summary-card"><div className="panel-heading"><h2>Em aberto</h2><span>Compromissos do período</span></div><div className="finance-summary-list"><div className="ok"><span>A receber</span><strong>{currency.format(asNumber(finance.receivable || executive.receivable))}</strong></div><div className="warn"><span>A pagar</span><strong>{currency.format(asNumber(finance.payable || executive.payable))}</strong></div><div className="danger"><span>Em atraso</span><strong>{currency.format(asNumber(finance.delinquency))}</strong></div></div></article>
      </div>
    </>}

    {tab === "entradas" && <>
      <div className="metric-grid dashboard-finance-metrics"><article className="metric-card"><span>Recebido no período</span><strong>{currency.format(asNumber(cashflow.received))}</strong></article><article className="metric-card"><span>A receber</span><strong>{currency.format(asNumber(finance.receivable || executive.receivable))}</strong></article><article className="metric-card"><span>Em atraso</span><strong>{currency.format(asNumber(finance.delinquency))}</strong></article><article className="metric-card"><span>Faturamento</span><strong>{statCurrency(safeStats.revenueMonth)}</strong></article></div>
      <FinanceEntriesPanel title="Últimas entradas" subtitle="Vendas e lançamentos manuais no período selecionado." entries={incomeEntries} empty="Nenhuma entrada encontrada neste período." />
    </>}

    {tab === "saidas" && <>
      <div className="metric-grid dashboard-finance-metrics"><article className="metric-card"><span>Pago no período</span><strong>{currency.format(asNumber(cashflow.paid))}</strong></article><article className="metric-card"><span>A pagar</span><strong>{currency.format(asNumber(finance.payable || executive.payable))}</strong></article><article className="metric-card"><span>Despesas do mês</span><strong>{statCurrency(safeStats.expensesMonth)}</strong></article><article className="metric-card"><span>Saldo após saídas</span><strong>{currency.format(asNumber(cashflow.balance))}</strong></article></div>
      <FinanceEntriesPanel title="Últimas saídas" subtitle="Contas, empréstimos, parcelas e demais despesas do período." entries={expenseEntries} empty="Nenhuma saída encontrada neste período." />
    </>}

    {tab === "resultado" && <>
      <div className="metric-grid dashboard-finance-metrics"><article className="metric-card"><span>Receita bruta</span><strong>{currency.format(asNumber(dre.gross_revenue))}</strong></article><article className="metric-card"><span>Despesas operacionais</span><strong>{currency.format(asNumber(dre.operating_expenses))}</strong></article><article className="metric-card"><span>Resultado DRE</span><strong>{currency.format(asNumber(dre.result))}</strong></article><article className="metric-card"><span>Lucro estimado</span><strong>{statCurrency(safeStats.profitEstimated)}</strong></article></div>
      <div className="premium-dashboard-grid dashboard-finance-grid"><article className="panel finance-summary-card"><div className="panel-heading"><h2>Leitura do resultado</h2><span>Período selecionado</span></div><div className="finance-summary-list"><div className="ok"><span>Receita bruta</span><strong>{currency.format(asNumber(dre.gross_revenue))}</strong></div><div className="danger"><span>Despesas operacionais</span><strong>{currency.format(asNumber(dre.operating_expenses))}</strong></div></div><div className="profit-box"><span>Resultado do período</span><strong>{currency.format(asNumber(dre.result))}</strong></div></article><div className="panel"><div className="panel-heading"><h2>Profissionais</h2><span>Faturamento no período</span></div><MiniBarChart data={professionalRanking} valueKey="revenue" labelKey="label" currencyValue /></div></div>
    </>}
  </div>;
}

function FinanceEntriesPanel({ title, subtitle, entries, empty }) {
  return <section className="panel dashboard-finance-entries">
    <div className="panel-heading"><div><h2>{title}</h2><span>{subtitle}</span></div></div>
    <div className="clean-list">
      {entries.slice(0, 8).map((entry) => <div key={entry.id}><span><strong>{entry.description || "Lançamento"}</strong><small>{entry.category || "Sem categoria"} · vencimento {String(entry.due_date || "—").split("T")[0]}</small></span><em>{currency.format(asNumber(entry.amount))}</em></div>)}
      {!entries.length && <p className="empty-state">{empty}</p>}
    </div>
  </section>;
}

export function RevenueLineChart({ data = [], mode = "mensal" }) {
  const safeData = asArray(data);
  const normalized = safeData.length ? safeData : [{ month: new Date().toISOString().slice(0, 7), total: 0 }];
  const max = Math.max(...normalized.map((item) => asNumber(item?.total)), 1);
  const points = normalized.map((item, index) => {
    const x = normalized.length === 1 ? 50 : (index / (normalized.length - 1)) * 100;
    const y = 88 - (asNumber(item?.total) / max) * 66;
    return `${x},${y}`;
  }).join(" ");
  const last = normalized[normalized.length - 1];
  return (
    <div className="revenue-line-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="auraRevenueFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#C8A96A" stopOpacity=".28" />
            <stop offset="100%" stopColor="#C8A96A" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline className="area" points={`0,100 ${points} 100,100`} />
        <polyline className="line" points={points} />
      </svg>
      <div className="chart-tooltip">
        <span>{formatRevenueLabel(last, mode)}</span>
        <strong>{currency.format(asNumber(last?.total))}</strong>
      </div>
      <div className="chart-months">
        {normalized.map((item, index) => <span key={`${item.month || item.label || index}`}>{formatRevenueAxisLabel(item, mode)}</span>)}
      </div>
    </div>
  );
}

export function MiniBarChart({ data = [], valueKey, labelKey, currencyValue }) {
  const safeData = asArray(data);
  const max = Math.max(...safeData.map((item) => asNumber(item?.[valueKey])), 1);
  if (!safeData.length) return <p className="empty-state">Sem dados para exibir.</p>;
  return (
    <div className="mini-chart">
      {safeData.map((item) => {
        const value = asNumber(item?.[valueKey]);
        return (
          <div className="mini-chart-row" key={`${item[labelKey]}-${value}`}>
            <span>{item[labelKey]}</span>
            <div><i style={{ width: `${Math.max((value / max) * 100, 5)}%` }} /></div>
            <strong>{currencyValue ? currency.format(value) : value}</strong>
          </div>
        );
      })}
    </div>
  );
}

export function DashboardList({ title, items = [], render }) {
  const safeItems = asArray(items);
  return (
    <div className="panel dashboard-list-panel">
      <h2>{title}</h2>
      <div className="dashboard-list">
        {safeItems.length ? safeItems.map((item, index) => <p key={item?.id || index}>{render(item)}</p>) : <small>Sem registros.</small>}
      </div>
    </div>
  );
}

export function AlertsPopup({ alerts, loading, onClose, onAction }) {
  const safeAlerts = asObject(alerts);
  const items = asArray(safeAlerts.items);
  const iconByCategory = {
    Estoque: Gem,
    Clientes: Cake,
    Relacionamento: Trophy
  };
  return (
    <div className="popup-backdrop" role="presentation" onClick={onClose}>
      <section className="alerts-popup" role="dialog" aria-modal="true" aria-label="Alertas da Aura Clinic" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="eyebrow">Central de alertas</span>
            <h2>O que precisa de atenção hoje</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar alertas">X</button>
        </header>
        {loading ? <Loading /> : items.length ? (
          <div className="alerts-grid real-alerts-grid">
            {items.map((item) => {
              const Icon = iconByCategory[item.category] || Bell;
              return (
                <article className={`alert-card priority-${item.priority || "low"}`} key={item.id}>
                  <div className="alert-card-icon"><Icon size={20} /></div>
                  <div className="alert-card-heading">
                    <span>{item.category || "Aura Clinic"}</span>
                    <em>{item.priority === "high" ? "Alta" : item.priority === "medium" ? "Média" : "Baixa"}</em>
                  </div>
                  <h3>{item.title || "Alerta"}</h3>
                  <strong>{item.subject || ""}</strong>
                  <p>{item.description || "Verifique esta informação no sistema."}</p>
                  {item.related_date && <small>{formatLongDate(item.related_date)}</small>}
                  {item.action_page && <button type="button" onClick={() => onAction?.(item.action_page)}>{item.action_label || "Ver detalhes"} <ChevronRight size={15} /></button>}
                </article>
              );
            })}
          </div>
        ) : <div className="alerts-empty-state"><Bell size={28} /><strong>Nenhum alerta importante no momento.</strong><span>Está tudo em ordem por aqui.</span></div>}
      </section>
    </div>
  );
}
