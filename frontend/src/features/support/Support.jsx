// Suporte da clínica: abrir chamado para a Monitence e conversar com ela.
//
// É a mesma tela da caixa de entrada do super-admin (features/platform/SupportInbox.jsx),
// com duas subtrações: não existe coluna de clínica (aqui só há uma) e não
// existe controle de prioridade (quem prioriza é a Monitence). O desenho é o
// mesmo de propósito — mestre-detalhe `.platform-split`, lista em `<DataView>`,
// resposta em `<Modal>`: quem dá suporte e quem pede suporte devem estar
// olhando para a mesma conversa, com a mesma cara.
//
// Três decisões moldam a tela:
//
//   1. Nada de HTML vindo de fora. Todo texto (assunto, mensagem, nome de quem
//      escreveu) é do usuário e entra como TEXTO em JSX — nunca por
//      `dangerouslySetInnerHTML`. As quebras de linha são preservadas por CSS
//      (`white-space: pre-wrap`), não por conversão para <br>.
//   2. A lista é paginada NO SERVIDOR. Por isso o DataView roda em `mode="server"`
//      e a busca livre fica desligada: um campo de busca que filtrasse só a
//      página atual mentiria — pareceria dizer "não existe" sobre um chamado que
//      existe na página seguinte. O filtro de status, esse, vai para a query.
//   3. O detalhe é uma leitura própria (`/support/tickets/:id`), não a linha da
//      lista: a conversa só é carregada de quem realmente abriu o chamado. E a
//      rota da clínica nunca devolve nota interna — a anotação da equipe não
//      passa por aqui em momento nenhum.
import { useState } from "react";
import { Button, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { Loading } from "../../components/common/Feedback";
import { apiFetch, useFetch } from "../../lib/api";
import { asArray, asNumber, asObject } from "../../lib/utils";
import "../../styles/support.css";

// Espelham os CHECKs de platform.support_tickets (backend/src/db/platformSchema.sql).
// Um código novo no banco sem entrada aqui aparece cru em vez de sumir da tela.
const CATEGORY_LABEL = {
  duvida: "Dúvida",
  problema: "Problema",
  sugestao: "Sugestão",
  financeiro: "Financeiro",
  outro: "Outro"
};

const STATUS_LABEL = {
  aberto: "Aberto",
  em_andamento: "Em andamento",
  aguardando_cliente: "Aguardando você",
  resolvido: "Resolvido",
  fechado: "Fechado"
};

const STATUS_TONE = {
  aberto: "info",
  em_andamento: "warn",
  aguardando_cliente: "warn",
  resolvido: "ok",
  fechado: "neutral"
};

// Espelha MAX_SUBJECT_LENGTH/MAX_BODY_LENGTH em backend/src/services/support.js.
// O servidor continua sendo quem decide; isto existe só para o usuário não
// descobrir o limite depois de escrever.
const MAX_SUBJECT = 120;
const MAX_BODY = 4000;

const EMPTY_FORM = { subject: "", category: "duvida", body: "" };

const label = (map, value) => map[value] || value || "—";

// TIMESTAMPTZ chega em ISO; um valor estranho é exibido cru em vez de sumir.
function formatMoment(value) {
  if (!value) return "";
  const parsed = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

// Tem resposta do suporte depois da última fala da clínica? É a única pergunta
// que a lista precisa responder de relance.
function hasUnread(ticket) {
  if (!ticket?.last_support_message_at) return false;
  if (!ticket?.last_clinic_message_at) return true;
  return new Date(ticket.last_support_message_at) > new Date(ticket.last_clinic_message_at);
}

// Uma mensagem da conversa. Mesma bolha da caixa de entrada do suporte — a
// diferença é só o que cada lado recebe do backend.
function ThreadMessage({ message }) {
  const isSupport = message.author_side === "suporte";
  return (
    <article className={`sup-msg${isSupport ? " is-suporte" : ""}`}>
      <header>
        <strong>{message.author_name || (isSupport ? "Suporte Monitence" : "Você")}</strong>
        <span>{formatMoment(message.created_at)}</span>
      </header>
      {/* Texto puro: o corpo é do usuário e nunca vira HTML. */}
      <p>{message.body}</p>
    </article>
  );
}

export function Support() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [filterValues, setFilterValues] = useState({});
  const [openId, setOpenId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const status = filterValues.status || "";
  const listPath = `/support/tickets?limit=${pageSize}&offset=${(page - 1) * pageSize}${status ? `&status=${status}` : ""}`;
  const list = useFetch(listPath);
  // Caminho vazio desliga a leitura: sem chamado aberto não há o que buscar.
  const detail = useFetch(openId ? `/support/tickets/${openId}` : "");

  const payload = asObject(list.data);
  const tickets = asArray(payload.items);
  const total = asNumber(payload.total);
  const ticket = openId ? asObject(detail.data) : null;
  const messages = asArray(ticket?.messages);
  const isClosed = ticket?.status === "fechado";
  const isBusy = Boolean(busy);

  async function send(path, options) {
    const response = await apiFetch(path, options);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Não foi possível concluir a operação.");
    return result;
  }

  // Envolve as mutações: limpa o feedback anterior, marca qual botão está em
  // curso e transforma a mensagem do backend no erro exibido — é ela que
  // distingue "chamado fechado" de "teto de chamados atingido".
  async function run(action, task) {
    setBusy(action);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy("");
    }
  }

  function openTicket(id) {
    setOpenId(id);
    setReply("");
    setError("");
    setMessage("");
  }

  function submitNew(event) {
    event.preventDefault();
    return run("new", async () => {
      const created = await send("/support/tickets", {
        method: "POST",
        body: JSON.stringify({ subject: form.subject.trim(), category: form.category, body: form.body.trim() })
      });
      setForm(EMPTY_FORM);
      setShowNew(false);
      list.refresh();
      // Abre o chamado recém-criado: o próximo passo natural é acompanhar a
      // resposta, não voltar para a lista.
      openTicket(created.id);
      setMessage("Chamado aberto. Você recebe a resposta por aqui mesmo.");
    });
  }

  function submitReply(event) {
    event.preventDefault();
    return run("reply", async () => {
      await send(`/support/tickets/${openId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: reply.trim() })
      });
      setReply("");
      setShowReply(false);
      detail.refresh();
      list.refresh();
    });
  }

  function closeTicket() {
    return run("close", async () => {
      await send(`/support/tickets/${openId}/close`, { method: "POST" });
      detail.refresh();
      list.refresh();
      setMessage("Chamado encerrado. Se o assunto voltar, abra um novo chamado.");
    });
  }

  return (
    <section className="stack support-page">
      <div className="panel">
          <CrudHeader
            title="Suporte"
            subtitle="Fale com a equipe da Monitence e acompanhe as respostas"
            actionLabel="Novo chamado"
            onAction={() => { setForm(EMPTY_FORM); setError(""); setMessage(""); setShowNew(true); }}
          />

          {error && !showNew && !showReply && !openId && <span className="form-error">{error}</span>}
          {message && !openId && <span className="form-success">{message}</span>}

          <DataView
            mode="server"
            rows={tickets}
            total={total}
            loading={list.loading}
            error={list.error}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            // Busca desligada: o endpoint pagina no servidor e uma busca que só
            // olhasse a página atual esconderia chamados sem avisar.
            searchable={false}
            filters={[{
              key: "status",
              label: "Status",
              type: "select",
              options: Object.entries(STATUS_LABEL).map(([value, text]) => ({ value, label: text }))
            }]}
            filterValues={filterValues}
            onFilterChange={(values) => { setFilterValues(values); setPage(1); }}
            columns={[
              {
                key: "subject",
                label: "Assunto",
                sortable: false,
                render: (row) => (
                  <span>
                    {hasUnread(row) && <span className="sup-dot" title="Resposta nova do suporte" />}
                    {row.subject}
                  </span>
                )
              },
              {
                key: "category",
                label: "Categoria",
                sortable: false,
                render: (row) => label(CATEGORY_LABEL, row.category)
              },
              {
                key: "status",
                label: "Status",
                sortable: false,
                render: (row) => (
                  <StatusBadge tone={STATUS_TONE[row.status] || "neutral"}>
                    {label(STATUS_LABEL, row.status)}
                  </StatusBadge>
                )
              },
              {
                key: "updated_at",
                label: "Atualizado",
                sortable: false,
                render: (row) => formatMoment(row.updated_at)
              }
            ]}
            actions={(row) => <RowActions actions={[{ label: "Abrir", onClick: () => openTicket(row.id), primary: true }]} />}
            empty="Nenhum chamado aberto até agora."
            emptyFiltered="Nenhum chamado com esse status."
          />
      </div>

      <Modal
        open={Boolean(openId)}
        title={ticket?.subject || "Detalhes do chamado"}
        subtitle={ticket?.id ? `Chamado #${ticket.id}` : "Carregando chamado…"}
        size="lg"
        onClose={() => { setOpenId(null); setReply(""); setError(""); setMessage(""); }}
        footer={!ticket || isClosed ? null : (
          <>
            <Button variant="secondary" onClick={closeTicket} disabled={isBusy}>{busy === "close" ? "Encerrando…" : "Encerrar chamado"}</Button>
            <Button variant="primary" onClick={() => { setShowReply(true); setError(""); }} disabled={isBusy}>Responder</Button>
          </>
        )}
      >
        {detail.error ? <span className="form-error">{detail.error}</span> : detail.loading ? <Loading /> : (
          <div className="stack">
            <div className="support-ticket-status">
              <StatusBadge tone={STATUS_TONE[ticket?.status] || "neutral"}>{label(STATUS_LABEL, ticket?.status)}</StatusBadge>
              <span>Categoria: <strong>{label(CATEGORY_LABEL, ticket?.category)}</strong></span>
              <span>Aberto em <strong>{formatMoment(ticket?.created_at)}</strong></span>
            </div>
            <div className="sup-thread">
              {messages.map((item) => <ThreadMessage key={item.id} message={item} />)}
            </div>
            {message && <span className="form-success">{message}</span>}
            {error && !showReply && <span className="form-error">{error}</span>}
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* Novo chamado                                                        */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        open={showNew}
        title="Novo chamado"
        subtitle="Descreva o que está acontecendo — quanto mais concreto, mais rápida a resposta"
        onClose={() => setShowNew(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setShowNew(false)} disabled={isBusy}>Cancelar</Button>
            <Button type="submit" form="support-new-form" variant="primary" disabled={isBusy}>
              {busy === "new" ? "Enviando…" : "Abrir chamado"}
            </Button>
          </>
        )}
      >
        {/* `.stack` dá o respiro entre os campos: `<form>` não é um container
            com espaçamento próprio no sistema. */}
        <form id="support-new-form" className="stack" onSubmit={submitNew}>
          <div className="form-grid">
            <label>
              Assunto
              <input
                type="text"
                required
                maxLength={MAX_SUBJECT}
                value={form.subject}
                placeholder="ex.: Não consigo emitir cobrança"
                onChange={(event) => setForm({ ...form, subject: event.target.value })}
              />
            </label>
            <Select
              label="Categoria"
              value={form.category}
              onChange={(value) => setForm({ ...form, category: value })}
            >
              {Object.entries(CATEGORY_LABEL).map(([value, text]) => (
                <option key={value} value={value}>{text}</option>
              ))}
            </Select>
          </div>

          <Textarea
            label="Mensagem"
            rows={6}
            required
            value={form.body}
            placeholder="Conte o que aconteceu, em que tela e o que você já tentou."
            onChange={(value) => setForm({ ...form, body: value })}
          />
          {/* Contador no vermelho ANTES do envio: descobrir o limite só na
              mensagem de erro do servidor custa o texto já digitado. */}
          <span className={form.body.length > MAX_BODY ? "form-error" : "field-hint"}>
            {form.body.length}/{MAX_BODY} caracteres
          </span>

          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* Responder                                                           */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        open={showReply}
        // "Responder chamado", o mesmo título da caixa de entrada do suporte.
        title="Responder chamado"
        subtitle={ticket?.id ? `Chamado #${ticket.id} · ${ticket.subject}` : ""}
        onClose={() => setShowReply(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setShowReply(false)} disabled={isBusy}>Cancelar</Button>
            <Button type="submit" form="support-reply-form" variant="primary" disabled={isBusy || !reply.trim()}>
              {busy === "reply" ? "Enviando…" : "Enviar resposta"}
            </Button>
          </>
        )}
      >
        <form id="support-reply-form" className="stack" onSubmit={submitReply}>
          <Textarea
            label="Sua resposta"
            rows={6}
            required
            value={reply}
            placeholder="Escreva sua resposta…"
            onChange={setReply}
          />
          <span className={reply.length > MAX_BODY ? "form-error" : "field-hint"}>
            {reply.length}/{MAX_BODY} caracteres
          </span>

          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>

    </section>
  );
}
