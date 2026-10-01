import { Lock } from "lucide-react";
import { Button } from "./Ui";

/**
 * Explica um bloqueio de plano exatamente no ponto da ação.
 * `planName` é o plano que libera o recurso: a maioria está no Profissional,
 * mas comissões são do Studio, e o título dizia Studio enquanto o botão e a
 * linha de rodapé diziam Profissional.
 * @param {{ title?: React.ReactNode, children?: React.ReactNode, onUpgrade?: () => void, planName?: string }} props
 */
export function PlanUpgradeNotice({ title, children, onUpgrade, planName = "Profissional" }) {
  return (
    <div className="soft-card stack" role="note">
      <div className="section-inline-header">
        <strong><Lock size={15} aria-hidden="true" /> {title}</strong>
        {onUpgrade && <Button type="button" variant="secondary" onClick={onUpgrade}>Conhecer o {planName}</Button>}
      </div>
      <small>{children}</small>
      {!onUpgrade && <small>Peça ao administrador do estúdio para liberar o plano {planName}.</small>}
    </div>
  );
}
