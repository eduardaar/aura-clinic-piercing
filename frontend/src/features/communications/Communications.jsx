import React, { useEffect, useMemo, useState } from "react";
import { MessageCircle, Play, Save } from "lucide-react";
import { apiFetch, useFetch } from "../../lib/api";
import { asArray } from "../../lib/utils";
import { Checkbox, Input, Select, StatusBadge, Textarea } from "../../components/common/Ui";

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

  useEffect(() => setTemplates(asArray(templatesRequest.data?.templates)), [templatesRequest.data]);
  useEffect(() => setRules(asArray(rulesRequest.data)), [rulesRequest.data]);

  const variables = asArray(templatesRequest.data?.variables);
  const notifications = asArray(notificationsRequest.data);
  const ready = useMemo(() => notifications.filter((item) => item.status === "ready"), [notifications]);

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
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2><MessageCircle size={18} /> Central de comunicações</h2>
            <span>Confirmações e lembretes automáticos, com envio assistido pelo WhatsApp.</span>
          </div>
          <button className="primary-button" disabled={busy === "process"} onClick={processQueue}>
            <Play size={16} /> {busy === "process" ? "Processando…" : "Processar fila"}
          </button>
        </div>
        {feedback && <p className="form-message">{feedback}</p>}
        <div className="metrics-grid">
          <article className="metric-card"><span>Modelos</span><strong>{templates.length}</strong></article>
          <article className="metric-card"><span>Automações ativas</span><strong>{rules.filter((rule) => Number(rule.is_active)).length}</strong></article>
          <article className="metric-card"><span>Prontas para envio</span><strong>{ready.length}</strong></article>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading"><h2>Automações</h2><span>O deslocamento é relativo ao horário do atendimento.</span></div>
        <div className="cards-grid">
          {rules.map((rule) => (
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
      </section>

      <section className="panel">
        <div className="panel-heading"><h2>Modelos de mensagem</h2><span>Variáveis: {variables.map((item) => `{{${item}}}`).join(", ")}</span></div>
        <div className="cards-grid">
          {templates.map((template) => (
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
      </section>

      <section className="panel">
        <div className="panel-heading"><h2>Fila e histórico recente</h2><span>Mensagens não são marcadas como enviadas sem integração oficial.</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Status</th><th>Destino</th><th>Mensagem</th><th>Agendamento</th><th>Ação</th></tr></thead>
            <tbody>
              {notifications.map((item) => (
                <tr key={item.id}>
                  <td><StatusBadge status={item.status}>{item.status}</StatusBadge></td>
                  <td>{item.destination || "—"}</td>
                  <td>{item.message}</td>
                  <td>{item.scheduled_at ? new Date(item.scheduled_at).toLocaleString("pt-BR") : "—"}</td>
                  <td>{item.whatsapp_link ? <a className="secondary-button" href={item.whatsapp_link} target="_blank" rel="noreferrer">Abrir WhatsApp</a> : "—"}</td>
                </tr>
              ))}
              {!notifications.length && <tr><td colSpan="5">Nenhuma comunicação registrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
