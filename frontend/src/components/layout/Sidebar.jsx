import React, { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, BarChart3, Calendar, ContactRound, Gem, Home, Lock, Package, PackagePlus, ShieldCheck, ShoppingCart, Sparkles, Table2, UsersRound } from "lucide-react";
import { canAccessPage, planAllowsPage } from "../../lib/permissions";
import { Modal } from "../common/Crud";
import { useFetch } from "../../lib/api";

export function Sidebar({ page, role, user, brand, features, setPage, open }) {
  // Marca do tenant logado (com fallback para a marca-mãe "Aura").
  const brandName = brand?.name || "Aura";
  const brandShort = brand?.short || (brand?.name ? "" : "Clinic Piercing");
  const brandLogo = brand?.logoUrl || "";
  const { data: onboardingReadiness } = useFetch(user?.role === "admin" || role === "admin" ? "/booking/readiness" : "");
  const onboardingAtBottom = Boolean(onboardingReadiness?.deprioritize);
  const onboardingEntry = ["onboarding", Sparkles, "Onboarding"];

  // Módulos do produto. Cadastros auxiliares do financeiro permanecem como
  // atalhos contextuais em Compras/Pagar/Receber, sem poluir a navegação.
  const groups = [
    ["Início", [
      ["dashboard", Home, "Dashboard"],
      ...(!onboardingAtBottom ? [onboardingEntry] : [])
    ]],
    ["Atendimento", [
      ["agenda", Calendar, "Agenda"],
      ["services", Sparkles, "Serviços"],
      ["client-center", UsersRound, "Clientes"]
    ]],
    ["Comercial", [
      ["catalog", Gem, "Catálogo"],
      ["sales", ShoppingCart, "Vendas"]
    ]],
    ["Estoque e compras", [
      ["products", Package, "Produtos"],
      ["inventory", Table2, "Estoque"],
      ["consumables", Package, "Materiais"],
      ["purchases", PackagePlus, "Compras"],
      ["suppliers", ContactRound, "Fornecedores"]
    ]],
    ["Financeiro", [
      ["receivables", ArrowDownToLine, "Contas a receber"],
      ["payables", ArrowUpFromLine, "Contas a pagar"]
    ]],
    ["Gestão", [
      ["reports", BarChart3, "Relatórios"]
    ]],
    ["Sistema", [
      ["admin", ShieldCheck, "Acessos"],
      ...(onboardingAtBottom ? [onboardingEntry] : [])
    ]]
  ]
    .map(([label, entries]) => [label, entries.filter(([id]) => canAccessPage(user || role, id))])
    .filter(([, entries]) => entries.length > 0);

  const showPlan = canAccessPage(user || role, "meu-plano");
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
          : <span className="sidebar-logo sidebar-initial" aria-hidden="true"><Gem size={22} /></span>}
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
