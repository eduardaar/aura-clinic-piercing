// Caixa de entrada do suporte (painel da plataforma, /plataforma).
//
// É a outra ponta de features/support/Support.jsx: aqui a Monitence lê os
// chamados de TODAS as clínicas, responde, muda status e prioridade.
//
// Recebe o `token` por prop e faz o próprio fetch — o mesmo contrato do
// LandingEditor. Motivo: o super-admin tem sessão própria
// (`aura-platform-session`) e não manda `X-Tenant`, então nada aqui pode passar
// pelo `apiFetch` de lib/api.js, que injeta a sessão da clínica.
//
// Duas regras que não podem escorregar nesta tela:
//   1. Nota interna é anotação da EQUIPE. Ela aparece aqui com marcação
//      própria, e a rota da clínica nunca a devolve — mas quem escreve precisa
//      enxergar, sem ambiguidade, o que é nota e o que vai para o cliente.
//   2. Todo texto vindo da clínica entra como TEXTO em JSX. Nenhum
//      `dangerouslySetInnerHTML`: o corpo da mensagem é escrito por terceiros.
import { useCallback, useEffect, useState } from "react";
import { Button, Checkbox, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { CrudHeader, Modal } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { API } from "../../lib/api";
import { asArray, asNumber, asObject } from "../../lib/utils";
import "../../styles/support.css";

// Espelham os CHECKs de platform.support_tickets. Código desconhecido aparece
// cru em vez de sumir da tela.
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
  aguardando_cliente: "Aguardando cliente",
  resolvido: "Resolvido",
  fechado: "Fechado"
};

const STATUS_TONE = {
  aberto: "danger",
  em_andamento: "warn",
  aguardando_cliente: "info",
  resolvido: "ok",
  fechado: "neutral"
};

const PRIORITY_LABEL = { baixa: "Baixa", normal: "Normal", alta: "Alta" };
const PRIORITY_TONE = { baixa: "neutral", normal: "info", alta: "danger" };

// Espelha MAX_BODY_LENGTH em backend/src/services/support.js.
const MAX_BODY = 4000;

const label = (map, value) => map[value] || value || "—";

function formatMoment(value) {
  if (!value) return "";
  const parsed = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

// Do lado do suporte, "não lido" é o contrário do lado da clínica: a clínica
// falou depois da última resposta nossa.
function waitingForUs(ticket) {
  if (!ticket?.last_clinic_message_at) return false;
  if (!ticket?.last_support_message_at) return true;
  return new Date(ticket.last_clinic_message_at) > new Date(ticket.last_support_message_at);
}

// Fetch com o token de plataforma. Fábrica em vez de componente: o badge e a
// caixa de entrada precisam do mesmo comportamento, inclusive o 401 que derruba
// a sessão do painel.
function usePlatformFetch(token, onUnauthorized) {
  return useCallback(async (path, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${API}${path}`, { ...options, headers });
    if (response.status === 401) onUnauthorized?.();
    return response;
  }, [token, onUnauthorized]);
}

// Badge com o número de chamados que ainda dependem de alguém. Exportado
// separado para o painel poder pendurá-lo no rótulo da aba sem montar a caixa
// de entrada inteira (que traz a lista e as clínicas).
export function SupportOpenBadge({ token, onUnauthorized, refreshKey = 0 }) {
  const platformFetch = usePlatformFetch(token, onUnauthorized);
  const [count, setCount] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refreshKey` não é lido no corpo de propósito — ele existe só para o painel pedir uma releitura do contador depois de uma resposta, e é justamente por estar na lista que o efeito roda de novo.
  useEffect(() => {
    let active = true;
    if (!token) return undefined;
    platformFetch("/platform/support/open-count")
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload) => { if (active) setCount(asNumber(asObject(payload).open)); })
      .catch(() => { /* badge é informativo: falhar em silêncio é melhor que quebrar a aba */ });
    return () => { active = false; };
  }, [token, platformFetch, refreshKey]);

  if (!count) return null;
  return <span className="sup-tab-badge" title={`${count} chamado(s) em aberto`}>{count}</span>;
}

function ThreadMessage({ message }) {
  const isNote = message.internal_note === true;
  const side = message.author_side === "suporte" ? "suporte" : "clinica";
  return (
    <article className={`sup-msg sup-msg-${side}${isNote ? " sup-msg-nota" : ""}`}>
      {isNote && <span className="sup-note-tag">Nota interna · a clínica não vê</span>}
      <div className="sup-msg-head">
        <span className="sup-msg-author">
          {side === "suporte" ? (message.author_name || "Suporte") : (message.author_name || "Clínica")}
        </span>
        <span className="sup-msg-time">{formatMoment(message.created_at)}</span>
      </div>
      <p className="sup-msg-body">{message.body}</p>
    </article>
  );
}

/**
 * @param {object} props
 * @param {string} props.token Token da sessão de plataforma.
 * @param {() => void} [props.onUnauthorized] Chamado no 401 (derruba a sessão do painel).
 * @param {() => void} [props.onChanged] Avisa o painel que a fila mudou — é o gancho
 *   para o badge da aba se atualizar depois de uma resposta ou troca de status.
 *   Sem ele, o contador só se refaz quando o painel remonta.
 */
export function SupportInbox({ token, onUnauthorized, onChanged }) {
  const platformFetch = usePlatformFetch(token, onUnauthorized);

  const [tickets, setTickets] = useState(null);
  const [total, setTotal] = useState(0);
  const [clinics, setClinics] = useState([]);
  const [listError, setListError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  // Termo com atraso: buscar a cada tecla dispararia uma requisição por letra.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterValues, setFilterValues] = useState({ status: "abertos" });

  const [openId, setOpenId] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [reply, setReply] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");

  const isBusy = Boolean(busy);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadTickets = useCallback(async () => {
    setListError("");
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String((page - 1) * pageSize)
    });
    if (filterValues.status) params.set("status", filterValues.status);
    if (filterValues.tenant_id) params.set("tenant_id", filterValues.tenant_id);
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    try {
      const response = await platformFetch(`/platform/support/tickets?${params}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status !== 401) setListError(asObject(payload).error || "Não foi possível carregar os chamados.");
        return;
      }
      setTickets(asArray(asObject(payload).items));
      setTotal(asNumber(asObject(payload).total));
    } catch {
      setListError("Não foi possível conectar ao servidor.");
    }
  }, [platformFetch, page, pageSize, filterValues.status, filterValues.tenant_id, debouncedSearch]);

  useEffect(() => { if (token) loadTickets(); }, [token, loadTickets]);

  // Lista de clínicas só para as opções do filtro. Sem ela, a única forma de
  // isolar uma clínica seria digitar o nome na busca — e opção derivada das
  // linhas da página atual esconderia as clínicas das outras páginas.
  useEffect(() => {
    let active = true;
    if (!token) return undefined;
    platformFetch("/platform/tenants")
      .then(async (response) => (response.ok ? response.json() : []))
      .then((payload) => { if (active) setClinics(asArray(payload)); })
      .catch(() => { /* sem opções de clínica o filtro some, o resto continua */ });
    return () => { active = false; };
  }, [token, platformFetch]);

  const loadTicket = useCallback(async (id) => {
    setDetailError("");
    try {
      const response = await platformFetch(`/platform/support/tickets/${id}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status !== 401) setDetailError(asObject(payload).error || "Não foi possível abrir o chamado.");
        return;
      }
      setTicket(payload);
    } catch {
      setDetailError("Não foi possível conectar ao servidor.");
    }
  }, [platformFetch]);

  function openTicket(id) {
    setOpenId(id);
    setTicket(null);
    setReply("");
    setInternalNote(false);
    setActionError("");
    loadTicket(id);
  }

  async function run(action, task) {
    setBusy(action);
    setActionError("");
    try {
      await task();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy("");
    }
  }

  async function send(path, options) {
    const response = await platformFetch(path, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(asObject(payload).error || "Não foi possível concluir a operação.");
    return payload;
  }

  function submitReply(event) {
    event.preventDefault();
    return run("reply", async () => {
      const updated = await send(`/platform/support/tickets/${openId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: reply.trim(), internal_note: internalNote })
      });
      setTicket(updated);
      setReply("");
      setInternalNote(false);
      loadTickets();
      onChanged?.();
    });
  }

  function patchTicket(changes) {
    return run("patch", async () => {
      const updated = await send(`/platform/support/tickets/${openId}`, {
        method: "PATCH",
        body: JSON.stringify(changes)
      });
      setTicket(updated);
      loadTickets();
      onChanged?.();
    });
  }

  const rows = asArray(tickets);
  const messages = asArray(asObject(ticket).messages);

  return (
    <section className="stack sup-stack">
      <article className="panel">
        <CrudHeader
          title="Chamados das clínicas"
          subtitle="Fila de suporte da plataforma"
        />

        {actionError && !openId && <span className="form-error">{actionError}</span>}

        <DataView
          mode="server"
          rows={rows}
          total={total}
          loading={tickets === null && !listError}
          error={listError}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Buscar por assunto, quem abriu ou clínica"
          filters={[
            {
              key: "status",
              label: "Status",
              type: "select",
              // "Em aberto" não é um status do banco: é a pergunta que a fila
              // realmente faz, e o backend a traduz para os três status vivos.
              options: [
                { value: "abertos", label: "Em aberto (todos)" },
                ...Object.entries(STATUS_LABEL).map(([value, text]) => ({ value, label: text }))
              ]
            },
            {
              key: "tenant_id",
              label: "Clínica",
              type: "select",
              options: clinics.map((clinic) => ({ value: String(clinic.id), label: clinic.name || clinic.slug }))
            }
          ]}
          filterValues={filterValues}
          onFilterChange={(values) => { setFilterValues(values); setPage(1); }}
          columns={[
            {
              key: "subject",
              label: "Assunto",
              sortable: false,
              render: (row) => (
                <span>
                  {waitingForUs(row) && <span className="sup-unread-dot" title="Aguardando resposta do suporte" />}
                  <span className="sup-subject" title={row.subject}>{row.subject}</span>
                </span>
              )
            },
            {
              key: "tenant_name",
              label: "Clínica",
              sortable: false,
              render: (row) => row.tenant_name || row.tenant_slug || "—"
            },
            {
              key: "category",
              label: "Categoria",
              sortable: false,
              render: (row) => label(CATEGORY_LABEL, row.category)
            },
            {
              key: "priority",
              label: "Prioridade",
              sortable: false,
              render: (row) => (
                <StatusBadge tone={PRIORITY_TONE[row.priority] || "neutral"}>
                  {label(PRIORITY_LABEL, row.priority)}
                </StatusBadge>
              )
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
              label: "Movimentado em",
              sortable: false,
              render: (row) => formatMoment(row.updated_at)
            }
          ]}
          actions={(row) => (
            <button type="button" onClick={() => openTicket(row.id)}>Abrir</button>
          )}
          empty="Nenhum chamado na fila."
          emptyFiltered="Nenhum chamado corresponde aos filtros aplicados."
        />
      </article>

      <Modal
        open={Boolean(openId)}
        size="lg"
        title={asObject(ticket).subject || "Chamado"}
        subtitle={asObject(ticket).id
          ? `Chamado #${asObject(ticket).id} · ${asObject(ticket).tenant_name || asObject(ticket).tenant_slug || ""}`
          : ""}
        onClose={() => { setOpenId(null); setTicket(null); }}
        footer={<Button variant="secondary" onClick={() => { setOpenId(null); setTicket(null); }}>Fechar</Button>}
      >
        {detailError ? (
          <p className="form-error">{detailError}</p>
        ) : !ticket ? (
          <p className="empty-state">Carregando…</p>
        ) : (
          <>
            <div className="sup-detail-meta">
              <StatusBadge tone={STATUS_TONE[ticket.status] || "neutral"}>
                {label(STATUS_LABEL, ticket.status)}
              </StatusBadge>
              <span>Categoria: <strong>{label(CATEGORY_LABEL, ticket.category)}</strong></span>
              <span>Aberto em <strong>{formatMoment(ticket.created_at)}</strong></span>
              <span>
                por <strong>{ticket.opened_by_name || "—"}</strong>
                {ticket.opened_by_email ? ` (${ticket.opened_by_email})` : ""}
              </span>
            </div>

            <div className="sup-controls">
              <Select
                label="Status"
                value={ticket.status || "aberto"}
                onChange={(value) => patchTicket({ status: value })}
              >
                {Object.entries(STATUS_LABEL).map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </Select>
              <Select
                label="Prioridade"
                value={ticket.priority || "normal"}
                onChange={(value) => patchTicket({ priority: value })}
              >
                {Object.entries(PRIORITY_LABEL).map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </Select>
            </div>

            <div className="sup-thread">
              {messages.map((item) => <ThreadMessage key={item.id} message={item} />)}
            </div>

            {ticket.status === "fechado" ? (
              <p className="sup-closed-note">
                Chamado fechado pela clínica. Para voltar a escrever nele, mude o status acima — assim a clínica
                enxerga que o assunto foi reaberto.
              </p>
            ) : (
              <form className="sup-reply" onSubmit={submitReply}>
                <Textarea
                  label={internalNote ? "Nota interna (a clínica não vê)" : "Resposta para a clínica"}
                  rows={4}
                  required
                  value={reply}
                  placeholder={internalNote
                    ? "Anotação da equipe sobre este caso…"
                    : "Escreva a resposta que a clínica vai ler…"}
                  onChange={setReply}
                />
                <Checkbox
                  label="Registrar como nota interna (não vai para a clínica e não marca o chamado como respondido)"
                  checked={internalNote}
                  onChange={setInternalNote}
                />
                <div className="sup-reply-actions">
                  <span className={`sup-counter ${reply.length > MAX_BODY ? "sup-counter-over" : ""}`}>
                    {reply.length}/{MAX_BODY} caracteres
                  </span>
                  <Button type="submit" variant="primary" disabled={isBusy || !reply.trim()}>
                    {busy === "reply" ? "Enviando…" : internalNote ? "Salvar nota" : "Enviar resposta"}
                  </Button>
                </div>
              </form>
            )}

            {actionError && <span className="form-error">{actionError}</span>}
          </>
        )}
      </Modal>
    </section>
  );
}
