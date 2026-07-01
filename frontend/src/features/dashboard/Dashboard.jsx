// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useState } from "react";
import { Bell, Cake, Calendar, ChevronRight, CircleDollarSign, Gem, Trophy, UsersRound, X } from "lucide-react";
import { Button, StatusBadge } from "../../components/common/Ui";
import { ApiError, Loading } from "../../components/common/Feedback";
import { asArray, asNumber, asObject, formatDate, formatLongDate, initials } from "../../lib/utils";
import { useFetch } from "../../lib/api";
import { currency, formatRevenueAxisLabel, formatRevenueLabel, statusClass } from "../../features/shared/helpers";

export function Dashboard({ user, setPage, alertsOpen, setAlertsOpen, alertsData, alertsLoading }) {
  const { data } = useFetch("/dashboard");

  if (data == null) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  return <PremiumDashboard data={data} user={user} setPage={setPage} alertsOpen={alertsOpen} setAlertsOpen={setAlertsOpen} alertsData={alertsData} alertsLoading={alertsLoading} />;
}

export function PremiumDashboard({ data, user, setPage, alertsOpen, setAlertsOpen, alertsData, alertsLoading }) {
  const [revenueMode, setRevenueMode] = useState("mensal");
  const safeData = asObject(data);
  const safeStats = {
    todayCount: 0,
    pendingCount: 0,
    completedCount: 0,
    revenue: 0,
    criticalStock: 0,
    lowStockCount: 0,
    depositReceived: 0,
    monthForecast: 0,
    ...asObject(safeData.stats)
  };
  const adminDashboard = asObject(safeData.adminDashboard);
  const upcomingAppointments = asArray(adminDashboard.upcomingAppointments);
  const criticalStockItems = asArray(adminDashboard.criticalStock);
  const birthdaysItems = asArray(adminDashboard.birthdaysMonth);
  const procedureRanking = asArray(adminDashboard.procedureRanking);
  const jewelryRanking = asArray(adminDashboard.jewelryRanking);
  const categoryRanking = asArray(adminDashboard.categoryRanking);
  const returnClients = asArray(adminDashboard.returnClients);
  const todaysAppointments = asArray(safeData.todaysAppointments);

  const cards = [
    { label: "Agendamentos hoje", value: String(safeStats.todayCount ?? 0), icon: Calendar, action: "Ver agenda", page: "agenda", tone: "gold" },
    { label: "Clientes novos", value: String(upcomingAppointments.length || todaysAppointments.length), icon: UsersRound, action: "Ver clientes", page: "clients", tone: "nude" },
    { label: "Joias em estoque crítico", value: String(safeStats.lowStockCount ?? safeStats.criticalStock ?? 0), icon: Gem, action: "Ver estoque", page: "catalog", tone: "green" },
    { label: "Faturamento hoje", value: currency.format(Number(safeStats.depositReceived ?? 0)), icon: CircleDollarSign, action: "Ver Financeiro", page: "finance", tone: "brown" },
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

      <div className="premium-metric-grid">
        {cards.map(({ label, value, icon: Icon, action, page, tone, critical }) => (
          <article className={`premium-metric-card ${tone}`} key={label}>
            <div className="metric-icon"><Icon size={22} /></div>
            <div>
              <strong>{value}</strong>
              <span>{label}</span>
              {critical && <small>crítico</small>}
              <button type="button" onClick={() => setPage(page)}>{action} →</button>
            </div>
          </article>
        ))}
      </div>

      <div className="premium-dashboard-grid">
        <article className="panel revenue-card">
          <div className="panel-heading">
            <h2>Faturamento</h2>
            <div className="segmented compact">
              <button type="button" className={revenueMode === "diario" ? "active" : ""} onClick={() => setRevenueMode("diario")}>Diário</button>
              <button type="button" className={revenueMode === "semanal" ? "active" : ""} onClick={() => setRevenueMode("semanal")}>Semanal</button>
              <button type="button" className={revenueMode === "mensal" ? "active" : ""} onClick={() => setRevenueMode("mensal")}>Mensal</button>
            </div>
          </div>
          <RevenueLineChart data={revenueData} mode={revenueMode} />
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
                <div className="avatar-circle">{initials(item.full_name)}</div>
                <div>
                  <strong>{item.full_name || "Cliente"}</strong>
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

      <div className="premium-lower-grid">
        <article className="panel compact-list-card">
          <div className="panel-heading">
            <h2>Estoque crítico</h2>
            <Button variant="ghost" onClick={() => setPage("catalog")}>Ver estoque</Button>
          </div>
          <div className="clean-list">
            {criticalStockItems.slice(0, 3).map((item) => (
              <div key={item.id || `${item.name}-${item.quantity}`}>
                <div className="jewel-thumb"><Gem size={21} /></div>
                <span><strong>{item.name || "Joia"}</strong><small>{item.color || item.category || "Sem categoria"}</small></span>
                <em>{Number(item.quantity || 0)} unidade{Number(item.quantity || 0) === 1 ? "" : "s"}</em>
              </div>
            ))}
            {!criticalStockItems.length && <p className="empty-state">Estoque sem alerta crítico.</p>}
          </div>
        </article>

        <article className="panel compact-list-card">
          <div className="panel-heading">
            <h2>Aniversariantes do mês</h2>
            <Button variant="ghost" onClick={() => setPage("client-center")}>Ver todos</Button>
          </div>
          <div className="clean-list birthday-list">
            {birthdaysItems.slice(0, 3).map((item) => (
              <div key={item.id || `${item.full_name}-${item.birth_date}`}>
                <div className="avatar-circle">{initials(item.full_name)}</div>
                <span><strong>{item.full_name || "Cliente"}</strong><small>{formatLongDate(item.birth_date)}</small></span>
                <Cake size={18} />
              </div>
            ))}
            {!birthdaysItems.length && <p className="empty-state">Nenhum aniversário neste mês.</p>}
          </div>
        </article>

        <article className="panel finance-summary-card">
          <div className="panel-heading">
            <h2>Resumo Financeiro</h2>
            <span>{new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span>
          </div>
          <div className="finance-summary-list">
            <div className="ok"><span>Faturamento</span><strong>{currency.format(Number(safeStats.revenue ?? safeStats.monthForecast ?? 0))}</strong></div>
            <div className="ok"><span>Sinais recebidos</span><strong>{currency.format(Number(safeStats.depositReceived ?? 0))}</strong></div>
            <div className="warn"><span>Pendentes</span><strong>{currency.format(Number(pendingValue || 0))}</strong></div>
            <div className="danger"><span>Despesas</span><strong>{currency.format(0)}</strong></div>
          </div>
          <div className="profit-box">
            <span>Lucro estimado</span>
            <strong>{currency.format(Number(safeStats.revenue ?? safeStats.monthForecast ?? 0))}</strong>
          </div>
        </article>
      </div>

      <div className="premium-ranking-grid">
        <div className="panel">
          <div className="panel-heading"><h2>Procedimentos mais feitos</h2><span>Ranking</span></div>
          <MiniBarChart data={procedureRanking} valueKey="total" labelKey="label" />
        </div>
        <div className="panel">
          <div className="panel-heading"><h2>Joias mais vendidas</h2><span>Peças vinculadas</span></div>
          <MiniBarChart data={jewelryRanking} valueKey="total" labelKey="label" />
        </div>
        <div className="panel">
          <div className="panel-heading"><h2>Ranking por categoria</h2><span>Joalherias</span></div>
          <MiniBarChart data={categoryRanking} valueKey="total" labelKey="label" />
        </div>
        <DashboardList title="Clientes em retorno" items={returnClients} render={(item) => `${formatDate(item.due_date)} · ${item.full_name || "Cliente"} · ${item.reminder_day || 0} dias`} />
      </div>
    </section>
  );
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

