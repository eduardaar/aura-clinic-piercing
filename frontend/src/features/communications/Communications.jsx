import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Play, Save } from "lucide-react";
import { apiFetch, useFetch } from "../../lib/api";
import { asArray } from "../../lib/utils";
import { Checkbox, Input, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";

// Opções vindas das próprias notificações: nenhum filtro oferecido devolve
// lista vazia.
const distinctOptions = (rows, pick) => [...new Set(rows.map(pick).filter(Boolean))].sort();

const formatDateTime = (value) => (value ? new Date(value).toLocaleString("pt-BR") : "—");

const communicationCategories = [
  { key: "agenda", label: "Agenda", description: "Confirmações e lembretes de atendimentos." },
  { key: "postcare", label: "Pós-atendimento", description: "Acompanhamento e retorno após o procedimento." },
  { key: "relationship", label: "Relacionamento", description: "Mensagens gerais para manter contato com clientes." }
];

function categoryFor(item) {
  const content = `${item.name || ""} ${item.template_key || ""}`.toLowerCase();
  if (/(pós|pos|follow|retorno|cicatriz)/.test(content)) return "postcare";
  if (/(agend|confirm|lembret)/.test(content)) return "agenda";
  return "relationship";
}

function CommunicationCategory({ category, children }) {
  return (
    <section className="communication-category">
      <div className="communication-category-heading">
        <div>
          <h3>{category.label}</h3>
          <span>{category.description}</span>
        </div>
      </div>
      {children}
    </section>
  );
}

async function request(path, options = {}) {
  const response = await apiFetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
  return payload;
}

export function Communications() {
  const templatesRequest = useFetch("/communication-templates");
  const rulesRequest = useFetch("/automation-rules");
  const notificationsRequest = useFetch("/notifications");
  const [templates, setTemplates] = useState([]);
  const [rules, setRules] = useState([]);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [tab, setTab] = useState("service");

  useEffect(() => setTemplates(asArray(templatesRequest.data?.templates)), [templatesRequest.data]);
  useEffect(() => setRules(asArray(rulesRequest.data)), [rulesRequest.data]);

  const variables = asArray(templatesRequest.data?.variables);
  const notifications = asArray(notificationsRequest.data);
  const ready = useMemo(() => notifications.filter((item) => item.status === "ready"), [notifications]);
  const categorizedRules = useMemo(() => communicationCategories.map((category) => ({
    ...category,
    items: rules.filter((rule) => categoryFor(rule) === category.key)
  })), [rules]);
  const categorizedTemplates = useMemo(() => communicationCategories.map((category) => ({
    ...category,
    items: templates.filter((template) => categoryFor(template) === category.key)
  })), [templates]);

  function updateTemplate(id, field, value) {
    setTemplates((items) => items.map((item) => item.id === id ? { ...item, [field]: value } : item));
  }

  function updateRule(id, field, value) {
    setRules((items) => items.map((item) => item.id === id ? { ...item, [field]: value } : item));
  }

  async function saveTemplate(template) {
    setBusy(`template-${template.id}`);
    setFeedback("");
    try {
      await request(`/communication-templates/${template.id}`, { method: "PATCH", body: JSON.stringify(template) });
      setFeedback("Modelo salvo.");
      templatesRequest.refresh();
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  async function saveRule(rule) {
    setBusy(`rule-${rule.id}`);
    setFeedback("");
    try {
      await request(`/automation-rules/${rule.id}`, { method: "PATCH", body: JSON.stringify(rule) });
      setFeedback("Automação atualizada.");
      rulesRequest.refresh();
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  async function processQueue() {
    setBusy("process");
    setFeedback("");
    try {
      const result = await request("/automations/process", { method: "POST", body: JSON.stringify({ limit: 100 }) });
      setFeedback(`${result.ready} mensagem(ns) preparada(s) para envio.`);
      notificationsRequest.refresh();
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="stack communications-page">
      <section className="panel communications-intro">
        <div>
          <span className="section-eyebrow">Relacionamento com clientes</span>
          <h2><MessageCircle size={18} /> Comunicações</h2>
          <p>Organize mensagens operacionais: acompanhe a fila, configure lembretes e mantenha textos aprovados para o WhatsApp.</p>
        </div>
      </section>

      <nav className="communication-tabs" aria-label="Áreas de comunicação">
        <button className={tab === "service" ? "active" : ""} onClick={() => setTab("service")} aria-current={tab === "service" ? "page" : undefined}>
          <strong>Atendimento</strong>
          <span>Fila e histórico de mensagens</span>
        </button>
        <button className={tab === "automation" ? "active" : ""} onClick={() => setTab("automation")} aria-current={tab === "automation" ? "page" : undefined}>
          <strong>Automações</strong>
          <span>Regras de lembretes e retornos</span>
        </button>
        <button className={tab === "templates" ? "active" : ""} onClick={() => setTab("templates")} aria-current={tab === "templates" ? "page" : undefined}>
          <strong>Modelos</strong>
          <span>Textos reutilizáveis por contexto</span>
        </button>
      </nav>

      {feedback && <p className="form-message">{feedback}</p>}

      {tab === "service" && <section className="communication-tab-panel">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Fila de atendimento</h2>
              <span>Prepare as mensagens e abra o WhatsApp para concluir cada contato.</span>
            </div>
            <button className="primary-button" disabled={busy === "process"} onClick={processQueue}>
              <Play size={16} /> {busy === "process" ? "Processando…" : "Processar fila"}
            </button>
          </div>
          <div className="metrics-grid">
            <article className="metric-card"><span>Prontas para envio</span><strong>{ready.length}</strong></article>
            <article className="metric-card"><span>Automações ativas</span><strong>{rules.filter((rule) => Number(rule.is_active)).length}</strong></article>
            <article className="metric-card"><span>Modelos disponíveis</span><strong>{templates.length}</strong></article>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading"><div><h2>Fila e histórico</h2><span>Mensagens não são marcadas como enviadas sem integração oficial.</span></div></div>
          {/* GET /notifications já limita a 100 registros e ordena por criação
              desc, então a fila cabe em memória: DataView em modo cliente. */}
          <DataView
            rows={notifications}
            loading={!notificationsRequest.data}
            error={notificationsRequest.data?.error || ""}
            searchPlaceholder="Buscar por destino, mensagem ou status"
            filters={[
              {
                key: "status",
                label: "Status",
                type: "select",
                options: distinctOptions(notifications, (item) => item.status)
              }
            ]}
            columns={[
              {
                key: "status",
                label: "Status",
                render: (item) => <StatusBadge status={item.status}>{item.status}</StatusBadge>
              },
              { key: "destination", label: "Destino", render: (item) => item.destination || "—" },
              { key: "message", label: "Mensagem" },
              {
                key: "scheduled_at",
                label: "Agendamento",
                value: (item) => String(item.scheduled_at || ""),
                render: (item) => formatDateTime(item.scheduled_at)
              },
              {
                key: "created_at",
                label: "Criado em",
                value: (item) => String(item.created_at || ""),
                render: (item) => formatDateTime(item.created_at)
              }
            ]}
            actions={(item) => (item.whatsapp_link
              ? <RowActions actions={[{ label: "Abrir WhatsApp", href: item.whatsapp_link, target: "_blank", rel: "noreferrer", primary: true }]} />
              : "—")}
            empty="Nenhuma comunicação registrada."
            emptyFiltered="Nenhuma comunicação corresponde à busca ou aos filtros."
          />
        </section>
      </section>}

      {tab === "automation" && <section className="communication-tab-panel">
        <section className="panel">
          <div className="panel-heading">
          <div>
              <h2>Regras automáticas</h2>
              <span>O deslocamento é relativo ao horário do atendimento.</span>
            </div>
          </div>
          {categorizedRules.map((category) => category.items.length > 0 && (
            <CommunicationCategory category={category} key={category.key}>
              <div className="cards-grid">
                {category.items.map((rule) => (
                  <article className="detail-card" key={rule.id}>
                    <Input label="Nome" value={rule.name || ""} onChange={(value) => updateRule(rule.id, "name", value)} />
                    <Select label="Canal" value={rule.channel || "whatsapp"} onChange={(value) => updateRule(rule.id, "channel", value)}>
                      <option value="whatsapp">WhatsApp</option>
                    </Select>
                    <Input label="Minutos antes/depois" type="number" value={rule.offset_minutes ?? 0} onChange={(value) => updateRule(rule.id, "offset_minutes", Number(value))} />
                    <Checkbox label="Automação ativa" checked={Boolean(Number(rule.is_active))} onChange={(value) => updateRule(rule.id, "is_active", value ? 1 : 0)} />
                    <small>Modelo: {rule.template_name || rule.template_key} · execuções: {rule.run_count || 0}</small>
                    <button className="secondary-button" disabled={busy === `rule-${rule.id}`} onClick={() => saveRule(rule)}>
                      <Save size={15} /> Salvar automação
                    </button>
                  </article>
                ))}
              </div>
            </CommunicationCategory>
          ))}
        </section>
      </section>}

      {tab === "templates" && <section className="communication-tab-panel">
        <section className="panel">
          <div className="panel-heading"><div><h2>Modelos de mensagem</h2><span>Variáveis: {variables.map((item) => `{{${item}}}`).join(", ")}</span></div></div>
          {categorizedTemplates.map((category) => category.items.length > 0 && (
            <CommunicationCategory category={category} key={category.key}>
              <div className="cards-grid">
                {category.items.map((template) => (
                  <article className="detail-card" key={template.id}>
                    <Input label="Nome" value={template.name || ""} onChange={(value) => updateTemplate(template.id, "name", value)} />
                    <Textarea label="Mensagem" rows={7} value={template.body || ""} onChange={(value) => updateTemplate(template.id, "body", value)} />
                    <Checkbox label="Modelo ativo" checked={Boolean(Number(template.is_active))} onChange={(value) => updateTemplate(template.id, "is_active", value ? 1 : 0)} />
                    <button className="secondary-button" disabled={busy === `template-${template.id}`} onClick={() => saveTemplate(template)}>
                      <Save size={15} /> Salvar modelo
                    </button>
                  </article>
                ))}
              </div>
            </CommunicationCategory>
          ))}
        </section>
      </section>}
    </div>
  );
}
