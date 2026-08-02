// Cofre de credenciais do gateway da clínica (Asaas) — lado da tela.
//
// As regras que moldam este arquivo são as mesmas do backend
// (backend/src/routes/integrations.js):
//
//   1. A chave da API NUNCA volta do servidor. A tela vive da máscara
//      (`secret_hint`) e dos booleanos de status — não há, e não pode haver,
//      nenhum caminho aqui que reconstrua ou guarde o segredo.
//   2. O token do webhook aparece UMA única vez, na resposta que o gera. Ele
//      fica só em estado deste componente: sair da tela o perde de propósito.
//      Persistir em localStorage/estado global entregaria a quem lê o navegador
//      o poder de forjar "pagamento confirmado" para esta clínica.
//   3. Todo erro exibido é a mensagem que o backend mandou. É ela que
//      distingue "chave recusada" de "ambiente errado" de "gateway fora do ar";
//      um "erro genérico" deixaria o admin sem saber o que corrigir.
import { useEffect, useState } from "react";
import { AlertTriangle, KeyRound, Webhook } from "lucide-react";
import { AlertBlock, Button, Input, Select, StatusBadge } from "../../components/common/Ui";
import { ConfirmDeleteModal, CrudHeader } from "../../components/common/Crud";
import { ApiError, Loading } from "../../components/common/Feedback";
import { apiFetch, useFetch } from "../../lib/api";
import { asObject } from "../../lib/utils";

const ENVIRONMENT_LABEL = {
  sandbox: "Sandbox (teste)",
  production: "Produção (cobranças reais)"
};

// `CURRENT_TIMESTAMP` chega como "YYYY-MM-DD HH:MM:SS" — com espaço, o Safari
// devolve Invalid Date. Quando nem assim der, mostramos o valor cru: melhor um
// carimbo estranho do que esconder do admin quando o teste rodou.
function formatMoment(value) {
  if (!value) return "";
  const parsed = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

// Bloco copiável (URL do webhook e token recém-gerado). Reaproveita o CSS dos
// "links exclusivos" da personalização do catálogo — mesmo problema visual:
// valor longo que o usuário precisa levar inteiro para outro sistema.
function CopyBlock({ label, value, hint }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard indisponível (contexto não seguro ou permissão negada): o
      // valor continua visível na tela para cópia manual.
    }
  }

  return (
    <div className="catalog-link-row">
      <div>
        <span className="catalog-link-label">{label}</span>
        <code>{value}</code>
        {hint && <p className="field-optional">{hint}</p>}
      </div>
      <div className="catalog-link-actions">
        <Button variant="secondary" onClick={copy}>{copied ? "Copiado!" : "Copiar"}</Button>
      </div>
    </div>
  );
}

export function Integrations() {
  const { data, refresh } = useFetch("/integrations/asaas");
  // O servidor é a fonte da verdade do status; este estado existe para as
  // respostas de PUT/POST/DELETE já refletirem na tela antes da revalidação.
  const [status, setStatus] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [environment, setEnvironment] = useState("");
  const [webhookToken, setWebhookToken] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!data || data.error) return;
    setStatus(data);
    // O ambiente é semeado do servidor apenas enquanto o admin não escolheu
    // nada: uma revalidação em segundo plano não pode desfazer uma seleção
    // ainda não salva.
    setEnvironment((current) => current || data.environment || "sandbox");
  }, [data]);

  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;

  const info = asObject(status || data);
  const configured = Boolean(info.configured);
  const savedEnvironment = info.environment || "sandbox";
  const selectedEnvironment = environment || savedEnvironment;
  const lastCheckOk = info.last_check_status === "ok";
  const isBusy = Boolean(busy);

  function applyStatus(payload) {
    setStatus(payload);
    if (payload?.environment) setEnvironment(payload.environment);
  }

  async function send(path, options) {
    const response = await apiFetch(path, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
    return payload;
  }

  // Envolve as mutações: limpa o feedback anterior, marca qual botão está em
  // curso e transforma a mensagem do backend no erro exibido.
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

  function saveCredentials(event) {
    event.preventDefault();
    return run("save", async () => {
      const trimmedKey = apiKey.trim();
      // Campo em branco NÃO entra no corpo: omitido, o backend preserva a chave
      // atual; enviado vazio, ele recusa. É o que sustenta a promessa da tela de
      // que "deixar em branco mantém a chave".
      const payload = await send("/integrations/asaas", {
        method: "PUT",
        body: JSON.stringify({ environment: selectedEnvironment, ...(trimmedKey ? { api_key: trimmedKey } : {}) })
      });
      applyStatus(payload);
      // A chave sai do estado assim que é salva — o campo não guarda segredo
      // depois do envio.
      setApiKey("");
      refresh();
      const check = asObject(payload.check);
      if (payload.check && !check.ok) {
        setError(`Chave salva, mas o Asaas recusou: ${check.detail || "sem detalhe do gateway."}`);
        return;
      }
      setMessage(payload.check ? `Chave salva. ${check.detail || "Chave aceita pelo Asaas."}` : "Ajustes salvos.");
    });
  }

  function toggleEnabled() {
    return run("toggle", async () => {
      const payload = await send("/integrations/asaas", {
        method: "PUT",
        body: JSON.stringify({ enabled: !info.enabled })
      });
      applyStatus(payload);
      refresh();
      setMessage(payload.enabled
        ? "Cobrança online ativada."
        : "Cobrança online desativada. As cobranças já emitidas continuam válidas no Asaas.");
    });
  }

  function testConnection() {
    return run("test", async () => {
      const result = await send("/integrations/asaas/test", { method: "POST" });
      // O teste grava `last_check_*` no servidor: recarregar é o que atualiza o
      // "último teste" exibido acima.
      refresh();
      if (result.ok) setMessage(result.detail || "Chave aceita pelo Asaas.");
      else setError(result.detail || "O gateway recusou a chave.");
    });
  }

  function generateWebhookToken() {
    return run("token", async () => {
      const payload = await send("/integrations/asaas/webhook-token", { method: "POST" });
      const { webhook_token: token, warning, ...safeStatus } = payload;
      // O token em claro fica fora do estado de status justamente para não ser
      // carregado adiante por engano em nenhuma outra atualização.
      applyStatus(safeStatus);
      setWebhookToken(token || "");
      refresh();
      setMessage(warning || "Token gerado. Copie agora: ele não será exibido novamente.");
    });
  }

  function removeCredentials() {
    return run("remove", async () => {
      const payload = await send("/integrations/asaas", {
        method: "DELETE",
        body: JSON.stringify({ confirm: true })
      });
      applyStatus(payload);
      // Sem credencial, o token gerado nesta sessão não serve mais para nada.
      setWebhookToken("");
      refresh();
      setMessage("Credencial removida. A cobrança online está desativada.");
    });
  }

  return (
    <section className="stack">
      <article className="panel">
        <CrudHeader
          title="Asaas — cobrança online"
          subtitle="Credencial da conta que recebe os pagamentos dos seus clientes"
        />

        <div className="catalog-links">
          <div className="catalog-links-title">
            <strong>Estado da integração</strong>
            <span>Só o administrador da clínica vê e altera esta configuração.</span>
          </div>
          <div className="catalog-links-grid">
            <div className="catalog-link-row">
              <div>
                <span className="catalog-link-label">Credencial</span>
                <StatusBadge tone={configured ? "ok" : "warn"}>
                  {configured ? "Configurada" : "Não configurada"}
                </StatusBadge>
                <p className="field-optional">
                  {configured
                    ? `Chave salva no cofre: ${info.secret_hint || "••••"}`
                    : "Nenhuma chave cadastrada até agora."}
                </p>
              </div>
            </div>

            <div className="catalog-link-row">
              <div>
                <span className="catalog-link-label">Ambiente</span>
                <StatusBadge tone={savedEnvironment === "production" ? "danger" : "info"}>
                  {ENVIRONMENT_LABEL[savedEnvironment] || savedEnvironment}
                </StatusBadge>
                <p className="field-optional">
                  {savedEnvironment === "production"
                    ? "As cobranças emitidas são reais e caem na conta Asaas da clínica."
                    : "Nada é cobrado de verdade: use para testar o fluxo antes de ir para produção."}
                </p>
              </div>
            </div>

            <div className="catalog-link-row">
              <div>
                <span className="catalog-link-label">Cobrança online</span>
                <StatusBadge tone={info.enabled ? "ok" : "neutral"}>
                  {info.enabled ? "Ativada" : "Desativada"}
                </StatusBadge>
                {configured
                  ? <p className="field-optional">Controla se o sistema pode emitir cobranças no Asaas.</p>
                  : <p className="form-error">Cadastre a chave da API antes de ativar a cobrança online.</p>}
              </div>
              <div className="catalog-link-actions">
                <Button
                  variant={info.enabled ? "secondary" : "primary"}
                  disabled={!configured || isBusy}
                  onClick={toggleEnabled}
                >
                  {busy === "toggle" ? "Salvando…" : info.enabled ? "Desativar" : "Ativar"}
                </Button>
              </div>
            </div>

            <div className="catalog-link-row">
              <div>
                <span className="catalog-link-label">Último teste</span>
                <StatusBadge tone={info.last_check_status ? (lastCheckOk ? "ok" : "danger") : "neutral"}>
                  {info.last_check_status ? (lastCheckOk ? "Chave aceita" : "Falhou") : "Nunca testada"}
                </StatusBadge>
                <p className="field-optional">
                  {info.last_check_detail || "Rode o teste para confirmar que a chave continua válida."}
                  {info.last_check_at ? ` — ${formatMoment(info.last_check_at)}` : ""}
                </p>
              </div>
              <div className="catalog-link-actions">
                <Button variant="secondary" disabled={!configured || isBusy} onClick={testConnection}>
                  {busy === "test" ? "Testando…" : "Testar conexão"}
                </Button>
              </div>
            </div>

            <div className="catalog-link-row">
              <div>
                <span className="catalog-link-label">Webhook</span>
                <StatusBadge tone={info.webhook_configured ? "ok" : "warn"}>
                  {info.webhook_configured ? "Token cadastrado" : "Sem token"}
                </StatusBadge>
                <p className="field-optional">
                  {info.webhook_configured
                    ? "O Asaas precisa enviar este token junto das notificações de pagamento."
                    : "Sem token, o Asaas não consegue avisar o sistema quando um pagamento é confirmado."}
                </p>
              </div>
            </div>
          </div>
        </div>

        {error && <span className="form-error">{error}</span>}
        {message && <span className="form-success">{message}</span>}
      </article>

      <article className="panel">
        <CrudHeader title="Chave da API" subtitle="Painel do Asaas > Integrações > API" />
        <form onSubmit={saveCredentials}>
          <div className="form-grid">
            <Input
              type="password"
              label={(
                <>
                  Chave da API do Asaas{" "}
                  <span className="field-optional">
                    {configured
                      ? `chave atual: ${info.secret_hint || "••••"} — deixe em branco para mantê-la`
                      : "copie do painel do Asaas em Integrações > API"}
                  </span>
                </>
              )}
              value={apiKey}
              onChange={setApiKey}
            />
            <Select
              label="Ambiente"
              value={selectedEnvironment}
              onChange={setEnvironment}
            >
              <option value="sandbox">Sandbox (teste)</option>
              <option value="production">Produção (cobranças reais)</option>
            </Select>
          </div>

          <p className="field-optional">
            {configured
              ? "A chave nunca é exibida de volta — nem para você. O campo acima começa vazio de propósito: salvar com ele em branco preserva a chave que já está no cofre. Preencha somente para substituí-la."
              : "A chave fica cifrada no sistema e não é exibida de novo depois de salva. Guarde-a também no painel do Asaas."}
          </p>

          {selectedEnvironment === "production" && (
            <AlertBlock icon={AlertTriangle} title="Ambiente de produção">
              <p>
                Em produção as cobranças são <strong>reais</strong>: seus clientes pagam de verdade e o
                dinheiro cai na conta Asaas da clínica. Use a chave de produção (a de sandbox é recusada) e
                confira o fluxo de ponta a ponta antes de divulgar o link de pagamento.
              </p>
            </AlertBlock>
          )}

          <div className="card-actions">
            <Button type="submit" variant="primary" disabled={isBusy}>
              {busy === "save" ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </article>

      <article className="panel">
        <CrudHeader
          title="Webhook do Asaas"
          subtitle="Sem este passo o sistema nunca fica sabendo que o cliente pagou"
        />

        <AlertBlock icon={Webhook} title="Como cadastrar no Asaas">
          <p>
            No painel do Asaas, vá em <strong>Integrações &gt; Webhooks</strong>, crie um webhook com a URL
            abaixo e cole o token no campo de autenticação. Enquanto isso não for feito, a cobrança é criada
            mas o pagamento nunca é confirmado automaticamente aqui.
          </p>
        </AlertBlock>

        <div className="catalog-links">
          <div className="catalog-links-title">
            <strong>Dados para colar no painel do Asaas</strong>
            <span>Estes dois valores são o que ligam o Asaas a esta clínica.</span>
          </div>
          <div className="catalog-links-grid">
            <CopyBlock
              label="URL do webhook"
              value={info.webhook_url || ""}
              hint="Endereço exclusivo desta clínica. Cadastre exatamente como está."
            />
            {webhookToken
              ? (
                <CopyBlock
                  label="Token do webhook (exibido só agora)"
                  value={webhookToken}
                  hint="Copie e cole no painel do Asaas antes de sair desta tela. Ao recarregar a página, ele desaparece — e não há como recuperá-lo, só gerar outro."
                />
              )
              : (
                <div className="catalog-link-row">
                  <div>
                    <span className="catalog-link-label">Token do webhook</span>
                    <code>{info.webhook_configured ? "•••••••••• (já cadastrado)" : "nenhum token gerado"}</code>
                    <p className="field-optional">
                      O token não é exibido depois de gerado. Se você perdeu o valor, gere outro e atualize o
                      painel do Asaas — o token antigo deixa de valer na hora.
                    </p>
                  </div>
                  <div className="catalog-link-actions">
                    <Button variant="primary" disabled={isBusy} onClick={generateWebhookToken}>
                      {busy === "token" ? "Gerando…" : "Gerar token"}
                    </Button>
                  </div>
                </div>
              )}
          </div>
        </div>

        {webhookToken && (
          <AlertBlock icon={KeyRound} title="Guarde o token agora">
            <p>
              Este é o único momento em que o token aparece. Ele é o segredo que impede qualquer pessoa na
              internet de marcar uma cobrança sua como paga — não o envie por e-mail nem por mensagem.
            </p>
          </AlertBlock>
        )}
      </article>

      <article className="panel admin-reset-panel">
        <div>
          <span className="eyebrow">Zona de perigo</span>
          <h2>Remover credencial</h2>
          <p>
            Apaga a chave e o token do cofre e desativa a cobrança online da clínica. A chave não pode ser
            recuperada: será preciso pegar outra no painel do Asaas e cadastrar de novo.
          </p>
        </div>
        <div className="admin-reset-action">
          <Button variant="danger" disabled={!configured || isBusy} onClick={() => setConfirmRemove(true)}>
            {busy === "remove" ? "Removendo…" : "Remover credencial"}
          </Button>
          {!configured && <span className="field-optional">Não há credencial cadastrada para remover.</span>}
        </div>
      </article>

      <ConfirmDeleteModal
        open={confirmRemove}
        title="Remover credencial do Asaas"
        message="A chave da API e o token do webhook serão apagados e a cobrança online será desativada. Esta ação não pode ser desfeita."
        onClose={() => setConfirmRemove(false)}
        onConfirm={async () => { await removeCredentials(); setConfirmRemove(false); }}
      />
    </section>
  );
}
