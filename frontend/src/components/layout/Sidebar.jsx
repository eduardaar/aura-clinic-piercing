import React, { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, BarChart3, Calendar, Gem, Home, Lock, LogOut, MessageCircle, Package, Plug, Settings, ShieldCheck, ShoppingCart, Sparkles, UsersRound, LifeBuoy } from "lucide-react";
import { canAccessPage, planAllowsPage } from "../../lib/permissions";
import { Modal } from "../common/Crud";

export function Sidebar({ page, role, brand, features, trialDays, setPage, open, collapsed = false, onLogout }) {
  // Marca do tenant logado (com fallback para a marca-mãe "Aura").
  const brandName = brand?.name || "Aura";
  const brandShort = brand?.short || (brand?.name ? "" : "Clinic Piercing");
  const brandLogo = brand?.logoUrl || "";

  // Menu em blocos por área de trabalho. Uma lista plana de 11 itens obriga a
  // ler tudo para achar qualquer coisa; agrupado, o olho vai direto ao bloco.
  // Um bloco só aparece se sobrar algum item depois do filtro por papel.
  const groups = [
    ["Visão geral", [
      ["dashboard", Home, "Dashboard"],
      ["onboarding", Sparkles, "Onboarding"]
    ]],
    ["Atendimento", [
      ["agenda", Calendar, "Agenda"],
      ["client-center", UsersRound, "Clientes"]
    ]],
    ["Comercial", [
      ["products", Package, "Produtos e estoque"],
      ["catalog", Gem, "Catálogo"],
      ["sales", ShoppingCart, "Vendas"],
      ["communications", MessageCircle, "Comunicações"]
    ]],
    ["Gestão", [
      ["receivables", ArrowDownToLine, "Contas a receber"],
      ["payables", ArrowUpFromLine, "Contas a pagar"],
      ["reports", BarChart3, "Relatórios"]
    ]],
      ["Sistema", [
        ["admin", ShieldCheck, "Acessos"],
        ["integrations", Plug, "Integrações"],
        ["support", LifeBuoy, "Suporte"],
        ["settings", Settings, "Configurações"]
      ]]
  ]
    .map(([label, entries]) => [label, entries.filter(([id]) => canAccessPage(role, id))])
    .filter(([, entries]) => entries.length > 0);

  const showPlan = canAccessPage(role, "meu-plano");
  // Quem não enxerga "Meu plano" (recepção, financeiro, piercer) não pode ser
  // levado para lá ao clicar num item cadeado — a navegação seria descartada e
  // o usuário voltaria para a tela inicial sem entender o motivo.
  const [lockedItem, setLockedItem] = useState("");

  return (
    <>
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-brand">
        {brandLogo
          ? <img className="sidebar-logo" src={brandLogo} alt={brandName} />
          : <span className="sidebar-logo sidebar-initial" aria-hidden="true">{brandName.trim().charAt(0) || "A"}</span>}
        <strong>{brandName}</strong>
        {brandShort && <span>{brandShort}</span>}
        <small>Gestão por Aura · plataforma para studios de piercing.</small>
      </div>
      <nav>
        {groups.map(([groupLabel, entries]) => (
          <React.Fragment key={groupLabel || "principal"}>
            {groupLabel && <p className="nav-group-label">{groupLabel}</p>}
            {entries.map(([id, Icon, label]) => {
              // Item fora do plano: mostra cadeado e leva para "Meu plano" (upgrade)
              // quem tem acesso a essa tela; para os demais, explica o bloqueio.
              const locked = !planAllowsPage(features, id);
              return (
                <button
                  key={id}
                  className={`${page === id ? "active" : ""} ${locked ? "locked" : ""}`}
                  onClick={() => {
                    if (!locked) return setPage(id);
                    if (showPlan) return setPage("meu-plano");
                    setLockedItem(label);
                  }}
                  title={locked ? `${label} — disponível em planos superiores` : label}
                  aria-current={page === id ? "page" : undefined}
                >
                  <Icon size={18} />
                  <span className="nav-label">{label}</span>
                  {locked && <Lock size={14} className="lock-icon" />}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </nav>
      <div className="sidebar-foot">
        {showPlan && (
          <button className={`plan-link ${page === "meu-plano" ? "active" : ""}`} onClick={() => setPage("meu-plano")} title="Meu plano">
            <Sparkles size={18} />
            <span className="nav-label">Meu plano</span>
            {typeof trialDays === "number" && <span className="trial-badge">{trialDays}d</span>}
          </button>
        )}
        <button className="logout-button" onClick={onLogout} title="Sair">
          <LogOut size={18} />
          <span className="nav-label">Sair</span>
        </button>
      </div>
    </aside>
    {/* Fora do <aside> de propósito: dentro dele o modal herdaria as cores e o
        contexto de empilhamento do menu escuro. */}
    <Modal
      open={!!lockedItem}
      size="sm"
      title="Recurso fora do plano"
      onClose={() => setLockedItem("")}
      footer={<button type="button" className="secondary-button" onClick={() => setLockedItem("")}>Entendi</button>}
    >
      <p>O módulo "{lockedItem}" não está incluído no plano atual do estúdio.</p>
      <p>Fale com o administrador do estúdio para liberar esse acesso.</p>
    </Modal>
    </>
  );
}
