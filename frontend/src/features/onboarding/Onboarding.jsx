import { CheckCircle2, Circle, ClipboardCheck } from "lucide-react";
import { Button } from "../../components/common/Ui";
import { Loading } from "../../components/common/Feedback";
import { asArray, asObject } from "../../lib/utils";
import { useFetch } from "../../lib/api";

const ACTIONS = {
  clinicProfile: { label: "Abrir configurações", page: "settings" },
  services: { label: "Cadastrar serviços", tab: "servicos" },
  procedures: { label: "Cadastrar procedimentos", tab: "servicos" },
  professionals: { label: "Cadastrar profissionais", tab: "profissionais" },
  weeklySchedule: { label: "Configurar horários", tab: "horarios" },
  links: { label: "Vincular serviços", tab: "profissionais" },
  products: { label: "Cadastrar produto", page: "products" },
  clients: { label: "Cadastrar cliente", page: "client-center" },
  terms: { label: "Abrir termos digitais", page: "terms" },
  catalog: { label: "Personalizar catálogo", page: "catalog" }
};

export function Onboarding({ onOpenAgendaSettings, onNavigate }) {
  const { data: readiness } = useFetch("/booking/readiness");
  if (readiness == null) return <Loading />;

  const checklist = asArray(asObject(readiness).checklist);
  const pending = checklist.filter((item) => !item.done);
  const completed = Number(readiness.completed ?? checklist.filter((item) => item.done).length);
  const progress = Math.min(100, Math.max(0, Number(readiness.progress ?? Math.round((completed / Math.max(checklist.length, 1)) * 100))));
  const essentials = checklist.filter((item) => item.essential);
  const optional = checklist.filter((item) => !item.essential);
  const orderPendingFirst = (items) => [...items].sort((a, b) => Number(a.done) - Number(b.done));

  function openAction(action) {
    if (!action) return;
    if (action.tab) return onOpenAgendaSettings?.(action.tab);
    onNavigate?.(action.page);
  }

  function ChecklistGroup({ title, items }) {
    if (!items.length) return null;
    return (
      <section className="onboarding-group">
        <h3>{title}</h3>
        <div className="onboarding-items">
          {orderPendingFirst(items).map((item) => {
            const action = ACTIONS[item.key];
            return <article key={item.key} className={item.done ? "done" : "pending"}>
              {item.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
              <div><strong>{item.label}</strong><span>{item.done ? "Concluído" : item.description || "Pendente"}</span></div>
              {!item.done && action && <Button variant="secondary" onClick={() => openAction(action)}>{action.label}</Button>}
            </article>;
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="onboarding-page stack">
      <div className="panel onboarding-header">
        <span className="onboarding-icon"><ClipboardCheck size={21} /></span>
        <div><span className="eyebrow">Configuração inicial</span><h2>Onboarding</h2><p>Siga a sequência para deixar operação, agenda e catálogo prontos.</p></div>
      </div>
      <div className="panel onboarding-checklist">
        <div className="panel-heading"><div><h2>{pending.length ? "Pendências da conta" : "Conta pronta"}</h2><span>{pending.length ? `${pending.length} etapa(s) para concluir` : "Sua estrutura inicial está completa."}</span></div><strong className="onboarding-percent">{progress}%</strong></div>
        <div className="onboarding-progress" aria-label={`${progress}% do onboarding concluído`}><span style={{ width: `${progress}%` }} /></div>
        <ChecklistGroup title="Essencial para começar" items={essentials} />
        <ChecklistGroup title="Próximas etapas" items={optional} />
        {Boolean(readiness.deprioritize) && <p className="onboarding-deprioritized">O essencial já está encaminhado. Este atalho foi movido para o fim do menu para não ocupar a navegação principal.</p>}
      </div>
    </section>
  );
}
