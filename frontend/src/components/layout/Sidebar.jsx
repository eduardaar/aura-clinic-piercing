import React from "react";
import { Bug, Calendar, Gem, Home, Lock, LogOut, ShieldCheck, ShoppingCart, Sparkles, UsersRound, WalletCards } from "lucide-react";
import { canAccessPage, planAllowsPage } from "../../lib/permissions";

export function Sidebar({ page, role, brand, features, trialDays, setPage, open, onLogout }) {
  // Marca do tenant logado (com fallback para a marca-mãe "Aura").
  const brandName = brand?.name || "Aura";
  const brandShort = brand?.short || (brand?.name ? "" : "Clinic Piercing");
  const brandLogo = brand?.logoUrl || "";

  const items = [
    ["dashboard", Home, "Dashboard"],
    ["erp", ShieldCheck, "Aura ERP"],
    ["catalog", Gem, "Catálogo"],
    ["agenda", Calendar, "Agenda"],
    ["sales", ShoppingCart, "Vendas"],
    ["finance", WalletCards, "Financeiro"],
    ["client-center", UsersRound, "Clientes"],
    ["admin", ShieldCheck, "Acessos"],
    ["error-logs", Bug, "Monitor de erros"]
  ].filter(([id]) => canAccessPage(role, id));

  const showPlan = canAccessPage(role, "meu-plano");

  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-brand">
        {brandLogo && <img className="sidebar-logo" src={brandLogo} alt={brandName} />}
        <strong>{brandName}</strong>
        {brandShort && <span>{brandShort}</span>}
        <small>Gestão por Aura · plataforma para studios de piercing.</small>
      </div>
      <nav>
        {items.map(([id, Icon, label]) => {
          // Item fora do plano: mostra cadeado e leva para "Meu plano" (upgrade).
          const locked = !planAllowsPage(features, id);
          return (
            <button
              key={id}
              className={`${page === id ? "active" : ""} ${locked ? "locked" : ""}`}
              onClick={() => setPage(locked ? "meu-plano" : id)}
              title={locked ? "Disponível em planos superiores" : undefined}
            >
              <Icon size={18} />
              {label}
              {locked && <Lock size={14} className="lock-icon" />}
            </button>
          );
        })}
      </nav>
      {showPlan && (
        <button className={`plan-link ${page === "meu-plano" ? "active" : ""}`} onClick={() => setPage("meu-plano")}>
          <Sparkles size={18} />
          Meu plano
          {typeof trialDays === "number" && <span className="plan-trial-badge">{trialDays}d</span>}
        </button>
      )}
      <button className="logout-button" onClick={onLogout}>
        <LogOut size={18} />
        Sair
      </button>
    </aside>
  );
}
