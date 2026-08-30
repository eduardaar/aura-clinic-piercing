import React, { useState } from "react";
import { ChevronDown, ChevronRight, Gem, Lock } from "lucide-react";
import { canAccessPage, planAllowsPage } from "../../lib/permissions";
import { menuPages } from "../../lib/appPages";
import { Modal } from "../common/Crud";
import { useFetch } from "../../lib/api";

export function Sidebar({ page, navigationTarget, role, user, brand, features, setPage, open, collapsed = false }) {
  // Marca do tenant logado (com fallback para a marca-mãe "Aura").
  const brandName = brand?.name || "Aura";
  const brandShort = brand?.short || (brand?.name ? "" : "Clinic Piercing");
  const brandLogo = brand?.logoUrl || "";
  const { data: onboardingReadiness } = useFetch(user?.role === "admin" || role === "admin" ? "/booking/readiness" : "");
  const onboardingAtBottom = Boolean(onboardingReadiness?.deprioritize);
  const onboardingComplete = Boolean(onboardingReadiness?.ready);
  const activeFeatures = Array.isArray(features) ? features : [];
  const groups = menuPages({ onboardingAtBottom, onboardingComplete })
    .map(({ group, pages }) => [group, pages
      .map((entry) => ({
        ...entry,
        visibleChildren: (entry.menuChildren || []).filter((child) => canAccessPage(user || role, child.page))
      }))
      .filter((entry) => canAccessPage(user || role, entry.id) || entry.visibleChildren.length > 0)])
    .filter(([, pages]) => pages.length > 0);

  const showPlan = canAccessPage(user || role, "meu-plano");
  // Quem não enxerga "Meu plano" (recepção, financeiro, piercer) não pode ser
  // levado para lá ao clicar num item cadeado — a navegação seria descartada e
  // o usuário voltaria para a tela inicial sem entender o motivo.
  const [lockedItem, setLockedItem] = useState("");
  const [openMenus, setOpenMenus] = useState({});

  function openLocked(label) {
    if (showPlan) return setPage("meu-plano");
    setLockedItem(label);
  }

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
            {entries.map(({ id, icon: Icon, title, menuTitle, visibleChildren }) => {
              const label = menuTitle || title;
              // Item fora do plano: mostra cadeado e leva para "Meu plano" (upgrade)
              // quem tem acesso a essa tela; para os demais, explica o bloqueio.
              const locked = !planAllowsPage(activeFeatures, id);
              const hasChildren = visibleChildren.length > 0;
              const expanded = Boolean(openMenus[id]);
              const parentActive = page === id || visibleChildren.some((child) => child.page === page);
              return (
                <React.Fragment key={id}>
                  <button
                    className={`${parentActive ? "active" : ""} ${locked ? "locked" : ""} ${hasChildren ? "has-submenu" : ""}`}
                    onClick={() => {
                      if (locked) return openLocked(label);
                      if (hasChildren && collapsed) return setPage(id);
                      if (hasChildren) return setOpenMenus((current) => ({ ...current, [id]: !current[id] }));
                      setPage(id);
                    }}
                    title={locked ? `${label} — disponível em planos superiores` : label}
                    aria-current={page === id && !hasChildren ? "page" : undefined}
                    aria-expanded={hasChildren ? expanded : undefined}
                  >
                    <Icon size={18} />
                    <span className="nav-label">{label}</span>
                    {locked ? <Lock size={14} className="lock-icon" /> : hasChildren && (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
                  </button>
                  {hasChildren && expanded && !collapsed && (
                    <div className="nav-submenu" aria-label={`Atalhos de ${label}`}>
                      {visibleChildren.map((child) => {
                        const childLocked = !planAllowsPage(activeFeatures, child.page) || Boolean(child.feature && !activeFeatures.includes(child.feature));
                        const childActive = page === child.page && (child.target ? navigationTarget === child.target : !navigationTarget);
                        return (
                          <button
                            key={child.id}
                            className={`${childActive ? "active" : ""} ${childLocked ? "locked" : ""}`}
                            onClick={() => childLocked ? openLocked(child.label) : setPage(child.page, child.target)}
                            title={childLocked ? `${child.label} — disponível em planos superiores` : child.queue ? `${child.label} — fila operacional` : child.label}
                            aria-current={childActive ? "page" : undefined}
                          >
                            <span className="nav-submenu-dot" aria-hidden="true" />
                            <span className="nav-label">{child.label}</span>
                            {child.queue && <small>Fila</small>}
                            {childLocked && <Lock size={13} className="lock-icon" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </React.Fragment>
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
