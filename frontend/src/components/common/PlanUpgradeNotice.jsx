import { Lock } from "lucide-react";
import { Button } from "./Ui";

/** Explica um bloqueio de plano exatamente no ponto da ação. */
export function PlanUpgradeNotice({ title, children, onUpgrade }) {
  return (
    <div className="soft-card stack" role="note">
      <div className="section-inline-header">
        <strong><Lock size={15} aria-hidden="true" /> {title}</strong>
        {onUpgrade && <Button type="button" variant="secondary" onClick={onUpgrade}>Conhecer o Profissional</Button>}
      </div>
      <small>{children}</small>
      {!onUpgrade && <small>Peça ao administrador do estúdio para liberar o plano Profissional.</small>}
    </div>
  );
}
