import React, { useState } from "react";
import { Gem, Lock } from "lucide-react";
import { canAccessPage, planAllowsPage } from "../../lib/permissions";
import { menuPages } from "../../lib/appPages";
import { Modal } from "../common/Crud";
import { useFetch } from "../../lib/api";

export function Sidebar({ page, role, user, brand, features, setPage, open }) {
  // Marca do tenant logado (com fallback para a marca-mãe "Aura").
  const brandName = brand?.name || "Aura";
  const brandShort = brand?.short || (brand?.name ? "" : "Clinic Piercing");
  const brandLogo = brand?.logoUrl || "";
  const { data: onboardingReadiness } = useFetch(user?.role === "admin" || role === "admin" ? "/booking/readiness" : "");
  const onboardingAtBottom = Boolean(onboardingReadiness?.deprioritize);
  const groups = menuPages({ onboardingAtBottom })
    .map(({ group, pages }) => [group, pages.filter(({ id }) => canAccessPage(user || role, id))])
    .filter(([, pages]) => pages.length > 0);

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
            {entries.map(({ id, icon: Icon, title, menuTitle }) => {
              const label = menuTitle || title;
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
