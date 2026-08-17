import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Play, Save, Sparkles } from "lucide-react";
import { apiFetch, useFetch } from "../../lib/api";
import { asArray } from "../../lib/utils";
import { Button, Checkbox, Input, Select, StatusBadge, Tabs, Textarea } from "../../components/common/Ui";
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
  const aiStatusRequest = useFetch("/ai-assistant/status");
  const creditsRequest = useFetch("/communication-credits");
  const [templates, setTemplates] = useState([]);
  const [rules, setRules] = useState([]);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [tab, setTab] = useState("service");
  const [assistantTask, setAssistantTask] = useState("draft_message");
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantOutput, setAssistantOutput] = useState("");
  const [assistantError, setAssistantError] = useState("");

  useEffect(() => setTemplates(asArray(templatesRequest.data?.templates)), [templatesRequest.data]);
  useEffect(() => setRules(asArray(rulesRequest.data)), [rulesRequest.data]);

  const variables = asArray(templatesRequest.data?.variables);
  const notifications = asArray(notificationsRequest.data);
  const ready = useMemo(() => notifications.filter((item) => item.status === "ready"), [notifications]);
  const communicationCredits = creditsRequest.data?.balance?.available || {};
  const creditProducts = asArray(creditsRequest.data?.products);
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

  async function askAssistant() {
    const input = assistantInput.trim();
    if (!input) {
      setAssistantError("Descreva o que você precisa para o assistente preparar.");
      return;
    }
    setBusy("assistant");
    setAssistantError("");
    setAssistantOutput("");
    try {
      const result = await request("/ai-assistant", {
        method: "POST",
        body: JSON.stringify({ task: assistantTask, input: { context: input } })
      });
      setAssistantOutput(result.output || "O assistente não retornou um texto.");
    } catch (error) {
      setAssistantError(error.message);
    } finally {
      setBusy("");
    }
  }

  async function requestTopup(product) {
    setBusy(`topup-${product.key}`);
    setFeedback("");
    try {
      const result = await request("/communication-credits/purchase", {
        method: "POST",
        body: JSON.stringify({ product_key: product.key })
      });
      setFeedback(result.checkout?.message || "Solicitação de recarga criada.");
      creditsRequest.refresh();
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

      <Tabs value={tab} onValueChange={setTab}>
        <Tabs.List className="communication-tabs" aria-label="Áreas de comunicação">
        <Tabs.Trigger value="service">
          <strong>Atendimento</strong>
          <span>Fila e histórico de mensagens</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="automation">
          <strong>Automações</strong>
          <span>Regras de lembretes e retornos</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="templates">
          <strong>Modelos</strong>
          <span>Textos reutilizáveis por contexto</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="assistant">
          <strong>Assistente IA</strong>
          <span>Ajuda para redigir e resumir</span>
        </Tabs.Trigger>
        </Tabs.List>
      </Tabs>

      {feedback && <p className="form-message">{feedback}</p>}

      {tab === "service" && <section className="communication-tab-panel">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Fila de atendimento</h2>
              <span>Prepare as mensagens e abra o WhatsApp para concluir cada contato.</span>
            </div>
            <Button disabled={busy === "process"} onClick={processQueue}>
              <Play size={16} /> {busy === "process" ? "Processando…" : "Processar fila"}
            </Button>
          </div>
          <div className="metrics-grid">
            <article className="metric-card"><span>Prontas para envio</span><strong>{ready.length}</strong></article>
            <article className="metric-card"><span>Automações ativas</span><strong>{rules.filter((rule) => Number(rule.is_active)).length}</strong></article>
            <article className="metric-card"><span>Modelos disponíveis</span><strong>{templates.length}</strong></article>
          </div>
        </section>

        <section className="panel communication-credits">
          <div className="panel-heading"><div><h2>Saldo de comunicação</h2><span>Franquia do plano e recargas são separadas por canal. O saldo mensal vale para a competência atual.</span></div></div>
          <div className="communication-credit-balance">
            <article><span>WhatsApp oficial</span><strong>{Number(communicationCredits.whatsapp || 0)}</strong><small>mensagens disponíveis</small></article>
            <article><span>E-mail</span><strong>{Number(communicationCredits.email || 0)}</strong><small>envios disponíveis</small></article>
            <article><span>Assistente IA</span><strong>{Number(communicationCredits.ai || 0)}</strong><small>tarefas disponíveis</small></article>
          </div>
          <div className="communication-topups">
            <div><h3>Recargas avulsas</h3><span>Solicite créditos extras; eles só entram após a confirmação do pagamento.</span></div>
            <div className="communication-topup-actions">
              {creditProducts.map((product) => <Button key={product.key} variant="secondary" disabled={busy === `topup-${product.key}`} onClick={() => requestTopup(product)}>{busy === `topup-${product.key}` ? "Solicitando…" : `${product.name} · ${(Number(product.price_cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`}</Button>)}
            </div>
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
                    <Button variant="secondary" disabled={busy === `rule-${rule.id}`} onClick={() => saveRule(rule)}>
                      <Save size={15} /> Salvar automação
                    </Button>
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
                    <Button variant="secondary" disabled={busy === `template-${template.id}`} onClick={() => saveTemplate(template)}>
                      <Save size={15} /> Salvar modelo
                    </Button>
                  </article>
                ))}
              </div>
            </CommunicationCategory>
          ))}
        </section>
      </section>}

      {tab === "assistant" && <section className="communication-tab-panel">
        <section className="panel assistant-panel">
          <div className="panel-heading">
            <div>
              <h2><Sparkles size={18} /> Assistente virtual</h2>
              <span>Use para preparar mensagens e resumir informações. Revise o resultado antes de enviar.</span>
            </div>
            <StatusBadge tone={aiStatusRequest.data?.enabled ? "ok" : "warn"}>
              {aiStatusRequest.data?.enabled ? `Conectado · ${aiStatusRequest.data.provider || "IA"}` : "Aguardando configuração"}
            </StatusBadge>
          </div>
          <div className="assistant-workspace">
            <div className="assistant-form">
              <Select label="O que você quer fazer?" value={assistantTask} onChange={setAssistantTask}>
                <option value="draft_message">Redigir mensagem para cliente</option>
                <option value="summarize_client">Resumir informações do cliente</option>
                <option value="suggest_reply">Sugerir resposta a uma mensagem</option>
              </Select>
              <Textarea
                label="Contexto"
                rows={8}
                value={assistantInput}
                onChange={setAssistantInput}
              />
              <small>Não informe senhas, documentos ou dados sensíveis além do necessário para a tarefa.</small>
              <Button disabled={busy === "assistant" || !aiStatusRequest.data?.enabled} onClick={askAssistant}>
                <Sparkles size={16} /> {busy === "assistant" ? "Preparando…" : "Gerar sugestão"}
              </Button>
              {assistantError && <p className="form-error">{assistantError}</p>}
              {!aiStatusRequest.data?.enabled && <p className="field-optional">O administrador precisa configurar uma chave OpenAI ou Gemini no ambiente seguro do servidor.</p>}
            </div>
            <div className="assistant-result" aria-live="polite">
              <span className="catalog-link-label">Sugestão do assistente</span>
              {assistantOutput ? <p>{assistantOutput}</p> : <p className="field-optional">A resposta aparecerá aqui. Ela não é enviada automaticamente.</p>}
            </div>
          </div>
        </section>
      </section>}
    </div>
  );
}
