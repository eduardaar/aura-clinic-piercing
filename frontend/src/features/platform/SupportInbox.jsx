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
// A tela é um mestre-detalhe (`.platform-split`): a fila à esquerda, a conversa
// do chamado aberto à direita. Trabalhar na fila é ler uma linha, responder e
// voltar — com a lista dentro de um modal, cada resposta custava fechar e
// reabrir o contexto.
//
// Três regras que não podem escorregar nesta tela:
//   1. Nota interna é anotação da EQUIPE. Ela aparece aqui com marcação
//      própria, e a rota da clínica nunca a devolve — mas quem escreve precisa
//      enxergar, sem ambiguidade, o que é nota e o que vai para o cliente.
//   2. Todo texto vindo da clínica entra como TEXTO em JSX. Nenhum
//      `dangerouslySetInnerHTML`: o corpo da mensagem é escrito por terceiros.
//   3. A busca é do SERVIDOR e com atraso (debounce). Buscar a cada tecla
//      dispararia uma requisição por letra, e buscar só na página atual mentiria
//      sobre chamados que existem na página seguinte.
import { useCallback, useEffect, useState } from "react";
import { Button, Checkbox, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { Loading } from "../../components/common/Feedback";
import { API } from "../../lib/api";
import { asArray, asNumber, asObject } from "../../lib/utils";
// A camada compartilhada do painel entra pelo próprio componente: `.platform-split`
// e `.tab-count` são dependência desta tela, não do PlatformAdmin.
import "../../styles/platform-panel.css";
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

/**
 * Contador de chamados em aberto, pendurado no botão da aba "Suporte".
 *
 * Renderiza `.tab-count` — a pastilha que o menu superior do painel já
 * desenha (platform-panel.css) — e NADA quando o contador é zero: badge com "0"
 * é ruído que treina o olho a ignorar a pastilha justamente quando ela acende.
 *
 * @param {{ token: string, onUnauthorized?: () => void, refreshKey?: number }} props
 */
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
  return <span className="tab-count" title={`${count} chamado(s) em aberto`}>{count}</span>;
}

/** Uma bolha da conversa. O lado (e a nota interna) é o que se lê primeiro. */
function ThreadMessage({ message }) {
  const isNote = message.internal_note === true;
  const isSupport = message.author_side === "suporte";
  return (
    <article className={`sup-msg${isSupport ? " is-suporte" : ""}${isNote ? " is-nota" : ""}`}>
      <header>
        <strong>{message.author_name || (isSupport ? "Suporte" : "Clínica")}</strong>
        {isNote && <StatusBadge tone="warn">Nota interna · a clínica não vê</StatusBadge>}
        <span>{formatMoment(message.created_at)}</span>
      </header>
      {/* Texto puro: o corpo é escrito por terceiros e nunca vira HTML. */}
      <p>{message.body}</p>
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
  const [replyOpen, setReplyOpen] = useState(false);
  // Um formulário só para responder E mexer em status/prioridade: as três coisas
  // são a mesma decisão ("o que eu faço com este chamado agora"), e separá-las em
  // controles que salvam sozinhos fazia cada clique virar uma requisição.
  const [form, setForm] = useState({ status: "aberto", priority: "normal", body: "", nota: false });
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
    setActionError("");
    loadTicket(id);
  }

  function openReply() {
    // O formulário nasce com o estado ATUAL do chamado: assim "salvar" sem mexer
    // nos selects não muda status nem prioridade sem querer.
    setForm({ status: ticket.status || "aberto", priority: ticket.priority || "normal", body: "", nota: false });
    setActionError("");
    setReplyOpen(true);
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

  const mudouTriagem = Boolean(ticket) && (form.status !== ticket.status || form.priority !== ticket.priority);
  const temTexto = Boolean(form.body.trim());

  function submitReply(event) {
    event.preventDefault();
    return run("reply", async () => {
      // Triagem primeiro: se a mensagem falhar depois, o texto continua na caixa
      // e o operador reenvia — mas a fila já mostra o chamado no lugar certo.
      if (mudouTriagem) {
        setTicket(await send(`/platform/support/tickets/${openId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: form.status, priority: form.priority })
        }));
      }
      if (temTexto) {
        setTicket(await send(`/platform/support/tickets/${openId}/messages`, {
          method: "POST",
          body: JSON.stringify({ body: form.body.trim(), internal_note: form.nota })
        }));
      }
      setReplyOpen(false);
      loadTickets();
      onChanged?.();
    });
  }

  const rows = asArray(tickets);
  const messages = asArray(asObject(ticket).messages);

  return (
    <section className="stack">
      <div className="platform-split platform-split--wide">
        <article className="panel">
          <CrudHeader title="Chamados das clínicas" subtitle="Fila de suporte da plataforma" />

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
                    {waitingForUs(row) && <span className="sup-dot" title="Aguardando resposta do suporte" />}
                    {row.subject}
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
                label: "Atualizado",
                sortable: false,
                render: (row) => formatMoment(row.updated_at)
              }
            ]}
            actions={(row) => <RowActions actions={[{ label: "Abrir", onClick: () => openTicket(row.id), primary: true }]} />}
            empty="Nenhum chamado na fila."
            emptyFiltered="Nenhum chamado corresponde aos filtros aplicados."
          />
        </article>

        {/* ---------------------------------------------------------------- */}
        {/* Conversa do chamado aberto                                        */}
        {/* ---------------------------------------------------------------- */}
        <article className="panel">
          {!openId ? (
            <p className="empty-state">Escolha um chamado na lista para ler a conversa e responder.</p>
          ) : detailError ? (
            <span className="form-error">{detailError}</span>
          ) : !ticket ? (
            <Loading />
          ) : (
            <>
              <div className="panel-heading">
                <div>
                  <h2>{ticket.subject}</h2>
                  <span>Chamado #{ticket.id} · {ticket.tenant_name || ticket.tenant_slug || "—"}</span>
                </div>
                <div className="header-actions">
                  <Button variant="primary" onClick={openReply} disabled={isBusy}>Responder</Button>
                </div>
              </div>

              <div className="stack">
                <p className="field-hint">
                  <StatusBadge tone={STATUS_TONE[ticket.status] || "neutral"}>
                    {label(STATUS_LABEL, ticket.status)}
                  </StatusBadge>{" "}
                  <StatusBadge tone={PRIORITY_TONE[ticket.priority] || "neutral"}>
                    {label(PRIORITY_LABEL, ticket.priority)}
                  </StatusBadge>{" "}
                  · Categoria <strong>{label(CATEGORY_LABEL, ticket.category)}</strong>
                  {" "}· Aberto em <strong>{formatMoment(ticket.created_at)}</strong>
                  {" "}por <strong>{ticket.opened_by_name || "—"}</strong>
                  {ticket.opened_by_email ? ` (${ticket.opened_by_email})` : ""}
                </p>

                <div className="sup-thread">
                  {messages.map((item) => <ThreadMessage key={item.id} message={item} />)}
                </div>

                {/* `.platform-notice` e não `.empty-state`: não há nada de vazio
                    aqui — a conversa está logo acima. É o callout âmbar de "leia
                    antes de clicar" do painel, o mesmo que a gestão de contas usa
                    para dizer por que uma ação está indisponível. */}
                {ticket.status === "fechado" && (
                  <p className="platform-notice">
                    Chamado fechado pela clínica. Para voltar a escrever nele, mude o status em “Responder” — assim a
                    clínica enxerga que o assunto foi reaberto.
                  </p>
                )}

                {actionError && !replyOpen && <span className="form-error">{actionError}</span>}
              </div>
            </>
          )}
        </article>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Responder / triar                                                   */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        open={replyOpen}
        title="Responder chamado"
        // "Chamado #N · assunto", a mesma legenda da outra ponta (features/support):
        // é o mesmo chamado visto de dois lados e não pode ter dois nomes.
        subtitle={ticket ? `Chamado #${ticket.id} · ${ticket.subject}` : ""}
        onClose={() => setReplyOpen(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setReplyOpen(false)} disabled={isBusy}>Cancelar</Button>
            <Button
              type="submit"
              form="support-reply-form"
              variant="primary"
              disabled={isBusy || (!temTexto && !mudouTriagem)}
            >
              {/* "Enviar resposta", e não "Enviar": é o rótulo que a tela da
                  clínica usa para o mesmo botão do mesmo formulário. */}
              {busy === "reply" ? "Enviando…" : form.nota ? "Salvar nota" : "Enviar resposta"}
            </Button>
          </>
        )}
      >
        {/* `.stack` dá o respiro entre os campos: `<form>` não é um container
            com espaçamento próprio no sistema, e sem ele os campos se encostam. */}
        <form id="support-reply-form" className="stack" onSubmit={submitReply}>
          <div className="form-grid">
            <Select label="Status" value={form.status} onChange={(value) => setForm({ ...form, status: value })}>
              {Object.entries(STATUS_LABEL).map(([value, text]) => (
                <option key={value} value={value}>{text}</option>
              ))}
            </Select>
            <Select label="Prioridade" value={form.priority} onChange={(value) => setForm({ ...form, priority: value })}>
              {Object.entries(PRIORITY_LABEL).map(([value, text]) => (
                <option key={value} value={value}>{text}</option>
              ))}
            </Select>
          </div>

          <Textarea
            label={form.nota ? "Nota interna (a clínica não vê)" : "Resposta para a clínica"}
            rows={6}
            value={form.body}
            placeholder={form.nota
              ? "Anotação da equipe sobre este caso…"
              : "Escreva a resposta que a clínica vai ler…"}
            onChange={(value) => setForm({ ...form, body: value })}
          />
          <Checkbox
            label="Registrar como nota interna (não vai para a clínica e não marca o chamado como respondido)"
            checked={form.nota}
            onChange={(checked) => setForm({ ...form, nota: checked })}
          />
          {/* Contador no vermelho ANTES do envio: descobrir o limite só na
              mensagem de erro do servidor custa o texto já digitado. */}
          <span className={form.body.length > MAX_BODY ? "form-error" : "field-hint"}>
            {form.body.length}/{MAX_BODY} caracteres
          </span>

          {actionError && <span className="form-error">{actionError}</span>}
        </form>
      </Modal>
    </section>
  );
}
