import React from "react";
import { Calendar, Gem, Home, LogOut, ShieldCheck, ShoppingCart, UsersRound, WalletCards } from "lucide-react";
import { canAccessPage } from "../../lib/permissions";

export function Sidebar({ page, role, setPage, open, onLogout }) {
  const items = [
    ["dashboard", Home, "Dashboard"],
    ["erp", ShieldCheck, "Aura ERP"],
    ["catalog", Gem, "Catálogo"],
    ["agenda", Calendar, "Agenda"],
    ["sales", ShoppingCart, "Vendas"],
    ["finance", WalletCards, "Financeiro"],
    ["client-center", UsersRound, "Clientes"],
    ["admin", ShieldCheck, "Acessos"]
  ].filter(([id]) => canAccessPage(role, id));

  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-brand">
        <strong>Aura</strong>
        <span>Clinic Piercing</span>
        <small>Marca registrada por Eduarda Santos, bodypiercer.</small>
      </div>
      <nav>
        {items.map(([id, Icon, label]) => (
          <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}>
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>
      <button className="logout-button" onClick={onLogout}>
        <LogOut size={18} />
        Sair
      </button>
    </aside>
  );
}
