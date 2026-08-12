import { CheckCircle2, Circle, ClipboardCheck } from "lucide-react";
import { Button } from "../../components/common/Ui";
import { Loading } from "../../components/common/Feedback";
import { asArray, asObject } from "../../lib/utils";
import { useFetch } from "../../lib/api";

const ACTIONS = {
  services: { label: "Cadastrar serviços", tab: "servicos" },
  procedures: { label: "Cadastrar procedimentos", tab: "servicos" },
  professionals: { label: "Cadastrar profissionais", tab: "profissionais" },
  weeklySchedule: { label: "Configurar horários", tab: "horarios" },
  links: { label: "Vincular serviços", tab: "profissionais" }
};

export function Onboarding({ onOpenAgendaSettings }) {
  const { data: readiness } = useFetch("/booking/readiness");
  if (readiness == null) return <Loading />;

  const checklist = asArray(asObject(readiness).checklist);
  const pending = checklist.filter((item) => !item.done);

  return (
    <section className="onboarding-page stack">
      <div className="panel onboarding-header">
        <span className="onboarding-icon"><ClipboardCheck size={21} /></span>
        <div><span className="eyebrow">Configuração inicial</span><h2>Onboarding</h2><p>Conclua estes cadastros para liberar o agendamento online.</p></div>
      </div>
      <div className="panel onboarding-checklist">
        <div className="panel-heading"><div><h2>{pending.length ? "Pendências da conta" : "Conta pronta"}</h2><span>{pending.length ? `${pending.length} etapa(s) para concluir` : "Seu agendamento online está configurado."}</span></div></div>
        <div className="onboarding-items">
          {checklist.map((item) => {
            const action = ACTIONS[item.key];
            return <article key={item.key} className={item.done ? "done" : "pending"}>
              {item.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
              <div><strong>{item.label}</strong><span>{item.done ? "Concluído" : "Pendente"}</span></div>
              {!item.done && action && <Button variant="secondary" onClick={() => onOpenAgendaSettings?.(action.tab)}>{action.label}</Button>}
            </article>;
          })}
        </div>
      </div>
    </section>
  );
}
