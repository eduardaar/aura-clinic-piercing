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
  const [section, setSection] = useState("geral");
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
    { label: "Joias em estoque crítico", value: statCount(safeStats.lowStockCount ?? safeStats.criticalStock), icon: Gem, action: "Ver estoque", page: "catalog", tone: "green" },
    { label: "Faturamento hoje", value: statCurrency(safeStats.revenueToday), icon: CircleDollarSign, action: "Ver Financeiro", page: "finance", tone: "brown" },
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
        <div><h2>Visão executiva</h2><span>Indicadores consolidados do período.</span></div>
        <div className="segmented compact">
          {["7d", "30d", "90d", "365d"].map((value) => <button type="button" key={value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>{value}</button>)}
        </div>
      </div>
      <nav className="dashboard-section-tabs" aria-label="Áreas do dashboard">
        {[['geral', 'Dashboard geral'], ['estoque', 'Estoque'], ['financeiro', 'Financeiro']].map(([value, label]) => (
          <button type="button" key={value} className={section === value ? "active" : ""} onClick={() => setSection(value)}>{label}</button>
        ))}
      </nav>

      {section === "geral" && <>
        <div className="metric-grid dashboard-executive-metrics">
          <article className="metric-card"><span>Comparecimento</span><strong>{asNumber(executive.attendance_rate)}%</strong></article>
          <article className="metric-card"><span>Cancelamentos</span><strong>{asNumber(executive.cancellation_rate)}%</strong></article>
          <article className="metric-card"><span>Ticket médio</span><strong>{currency.format(asNumber(executive.average_ticket))}</strong></article>
          <article className="metric-card"><span>Conversão catálogo</span><strong>{asNumber(executive.catalog_conversion_rate)}%</strong></article>
        </div>

        <div className="premium-metric-grid">
          {cards.filter((card) => !["Joias em estoque crítico", "Faturamento hoje"].includes(card.label)).map(({ label, value, icon: Icon, action, page, tone, critical }) => (
            <article className={`premium-metric-card ${tone}`} key={label}>
              <div className="metric-icon"><Icon size={22} /></div>
              <div><strong>{value}</strong><span>{label}</span>{critical && <small>crítico</small>}<button type="button" onClick={() => setPage(page)}>{action} →</button></div>
            </article>
          ))}
        </div>

        <div className="premium-dashboard-grid">
        <article className="panel next-appointment-card">
          <div className="panel-heading">
            <h2>Próximo agendamento</h2>
            <Button variant="ghost" onClick={() => setPage("agenda")}>Ver na agenda</Button>
          </div>
          {nextAppointment.id ? (
            <div className="next-appointment-body">
              <strong>{nextAppointment.countdown || "Em breve"}</strong>
              <p>{personName(nextAppointment)} — {nextAppointment.service_name || nextAppointment.procedure || "Atendimento"}</p>
              <span>{formatLongDate(nextAppointment.appointment_date)} · {nextAppointment.appointment_time} · Prof. {nextAppointment.professional_name || "Sem profissional"}</span>
              <div className="row-actions">
                <StatusBadge status={nextAppointment.status || "pendente"} />
                {nextAppointment.whatsapp && <a href={`https://wa.me/${String(nextAppointment.whatsapp).replace(/\D/g, "")}`} target="_blank" rel="noreferrer">Entrar em contato</a>}
              </div>
            </div>
          ) : <p className="empty-state">Não há atendimentos futuros agendados.</p>}
          {!!appointmentAlerts.length && <small className="dashboard-alert-hint">{appointmentAlerts.length} aviso(s) de agenda precisam de atenção.</small>}
        </article>

        <article className="panel upcoming-card">
          <div className="panel-heading">
            <h2>Próximos agendamentos</h2>
            <Button variant="ghost" onClick={() => setPage("agenda")}>Ver todos</Button>
          </div>
          <div className="premium-appointment-list">
            {upcomingAppointments.slice(0, 4).map((item) => (
              <button type="button" className="premium-appointment-row" key={item.id} onClick={() => setPage("agenda")}>
                <span className="dot-time"><i />{item.appointment_time}</span>
                <div className="avatar-circle">{initials(personName(item))}</div>
                <div>
                  <strong>{personName(item)}</strong>
                  <small>{item.procedure || "Procedimento"}<br />Prof. {item.professional_name || "—"}</small>
                </div>
                <em className={statusClass[item.status] || ""}>{item.status || "—"}</em>
                <ChevronRight size={18} />
              </button>
            ))}
            {!upcomingAppointments.length && <p className="empty-state">Nenhum próximo agendamento.</p>}
          </div>
        </article>
        </div>

        <div className="premium-lower-grid dashboard-general-lower-grid">
        <article className="panel compact-list-card">
          <div className="panel-heading">
            <h2>Aniversariantes do mês</h2>
            <Button variant="ghost" onClick={() => setPage("client-center")}>Ver todos</Button>
          </div>
          <div className="clean-list birthday-list">
            {birthdaysItems.slice(0, 3).map((item) => (
              <div key={item.id || `${personName(item)}-${item.birth_date}`}>
                <div className="avatar-circle">{initials(personName(item))}</div>
                <span><strong>{personName(item)}</strong><small>{formatLongDate(item.birth_date)}</small></span>
                <Cake size={18} />
              </div>
            ))}
            {!birthdaysItems.length && <p className="empty-state">Nenhum aniversário neste mês.</p>}
          </div>
        </article>
        </div>

        <div className="premium-ranking-grid dashboard-general-ranking-grid">
        <div className="panel">
          <div className="panel-heading"><h2>Procedimentos mais feitos</h2><span>Ranking</span></div>
          <MiniBarChart data={procedureRanking} valueKey="total" labelKey="label" />
        </div>
        <DashboardList title="Clientes em retorno" items={returnClients} render={(item) => `${formatDate(item.due_date)} · ${personName(item)} · ${item.reminder_day || 0} dias`} />
        </div>
      </>}

      {section === "estoque" && <DashboardStock criticalStockItems={criticalStockItems} jewelryRanking={jewelryRanking} categoryRanking={categoryRanking} topViewed={topViewed} setPage={setPage} />}
      {section === "financeiro" && <DashboardFinance safeStats={safeStats} executive={executive} pendingValue={pendingValue} revenueData={revenueData} revenueMode={revenueMode} setRevenueMode={setRevenueMode} professionalRanking={professionalRanking} setPage={setPage} />}
    </section>
  );
}

function DashboardStock({ criticalStockItems, jewelryRanking, categoryRanking, topViewed, setPage }) {
  return <div className="dashboard-section-content">
    <div className="dashboard-section-heading"><div><h3>Estoque</h3><p>Acompanhe reposições, produtos mais vendidos e interesse no catálogo.</p></div><Button variant="secondary" onClick={() => setPage("catalog")}>Abrir estoque</Button></div>
    <div className="premium-lower-grid dashboard-stock-overview">
      <article className="panel compact-list-card dashboard-stock-critical"><div className="panel-heading"><h2>Itens com estoque crítico</h2><Button variant="ghost" onClick={() => setPage("catalog")}>Gerenciar</Button></div><div className="clean-list">{criticalStockItems.slice(0, 5).map((item) => <div key={item.id || `${item.name}-${item.quantity}`}><div className="jewel-thumb"><Gem size={21} /></div><span><strong>{item.name || "Produto"}</strong><small>{item.alert_level || (Number(item.quantity || 0) <= 0 ? "Esgotado" : "Acabando")} · {item.color || item.category || "Sem categoria"}</small></span><em>{Number(item.quantity || 0)} un.</em></div>)}{!criticalStockItems.length && <p className="empty-state">Estoque sem alerta crítico.</p>}</div></article>
      <article className="panel"><div className="panel-heading"><h2>Produtos mais vendidos</h2><span>Período selecionado</span></div><MiniBarChart data={jewelryRanking} valueKey="total" labelKey="label" /></article>
    </div>
    <div className="premium-ranking-grid dashboard-stock-ranking"><div className="panel"><div className="panel-heading"><h2>Ranking por categoria</h2><span>Vendas</span></div><MiniBarChart data={categoryRanking} valueKey="total" labelKey="label" /></div><div className="panel"><div className="panel-heading"><h2>Mais vistos no catálogo</h2><span>Interesse dos clientes</span></div><MiniBarChart data={topViewed} valueKey="views" labelKey="name" /></div></div>
  </div>;
}

function DashboardFinance({ safeStats, executive, pendingValue, revenueData, revenueMode, setRevenueMode, professionalRanking, setPage }) {
  return <div className="dashboard-section-content">
    <div className="dashboard-section-heading"><div><h3>Financeiro</h3><p>Visão consolidada de entradas, despesas e valores em aberto.</p></div><Button variant="secondary" onClick={() => setPage("finance")}>Abrir financeiro</Button></div>
    <div className="metric-grid dashboard-finance-metrics"><article className="metric-card"><span>A receber</span><strong>{currency.format(asNumber(executive.receivable))}</strong></article><article className="metric-card"><span>A pagar</span><strong>{currency.format(asNumber(executive.payable))}</strong></article><article className="metric-card"><span>Faturamento do mês</span><strong>{statCurrency(safeStats.revenueMonth)}</strong></article><article className="metric-card"><span>Lucro estimado</span><strong>{statCurrency(safeStats.profitEstimated)}</strong></article></div>
    <div className="premium-dashboard-grid dashboard-finance-grid"><article className="panel revenue-card"><div className="panel-heading"><h2>Faturamento</h2><div className="segmented compact"><button type="button" className={revenueMode === "diario" ? "active" : ""} onClick={() => setRevenueMode("diario")}>Diário</button><button type="button" className={revenueMode === "semanal" ? "active" : ""} onClick={() => setRevenueMode("semanal")}>Semanal</button><button type="button" className={revenueMode === "mensal" ? "active" : ""} onClick={() => setRevenueMode("mensal")}>Mensal</button></div></div><RevenueLineChart data={revenueData} mode={revenueMode} /></article><article className="panel finance-summary-card"><div className="panel-heading"><h2>Resumo do mês</h2><span>{new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span></div><div className="finance-summary-list"><div className="ok"><span>Sinais recebidos</span><strong>{statCurrency(safeStats.depositReceived)}</strong></div><div className="warn"><span>Pendentes</span><strong>{currency.format(Number(pendingValue || 0))}</strong></div><div className="danger"><span>Despesas</span><strong>{statCurrency(safeStats.expensesMonth)}</strong></div></div><div className="profit-box"><span>Lucro estimado</span><strong>{statCurrency(safeStats.profitEstimated)}</strong></div></article></div>
    <div className="panel"><div className="panel-heading"><h2>Profissionais</h2><span>Faturamento no período</span></div><MiniBarChart data={professionalRanking} valueKey="revenue" labelKey="label" currencyValue /></div>
  </div>;
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
