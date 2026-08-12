// Gestão de contas: a lista de clínicas e o DETALHE de UMA delas no painel do
// super-admin.
//
// A aba "Clínicas" (PlatformAdmin) é o CADASTRO — quem existe, quem foi criado
// quando. Esta é a outra metade: uso x cotas, plano, assinatura, trial e as
// ações que cortam acesso ou mexem em cobrança. Por isso ela consome
// `/api/platform/accounts/...` (a CONTA) e não `/api/platform/tenants/...` (o
// CADASTRO), a mesma separação que o backend faz nas rotas.
//
// FORMA DA TELA (por que ela é assim e não com CSS próprio)
// A tela nasceu com um sistema `aa-` inteiro só dela — 448 linhas de CSS para
// refazer listagem, barra de busca, pares rótulo/valor e barras de progresso que
// o painel já tinha. Agora:
//   listagem ......... <DataView>            (busca, ordenação, loading, erro)
//   escrita .......... <Modal>               (motivo dentro da confirmação)
//   mestre-detalhe ... .platform-split       (styles/platform-panel.css)
//   rótulo/valor ..... .platform-facts
//   cotas ............ .platform-quota*
//   destrutivo ....... .platform-danger + .platform-sticky-warning
// O que sobra em styles/accounts-admin.css é o que ainda não tem equivalente.
//
// Três decisões valem para o arquivo inteiro:
//
//  1. NENHUMA ESCRITA SEM MOTIVO. O backend recusa toda ação sem `reason` e
//     grava o texto na auditoria. Aqui o campo é obrigatório dentro da própria
//     confirmação e o botão só habilita quando ele está preenchido: pedir o
//     motivo depois de o clique já ter falhado transformaria a regra em ruído.
//
//  2. AS ASSIMETRIAS FICAM ESCRITAS NA TELA. Suspender não cancela a cobrança;
//     cancelar a assinatura não corta o acesso; trocar de plano reajusta a
//     recorrência mas o reajuste pode não chegar ao gateway. São deliberadas no
//     backend, e escondê-las custa dinheiro (clínica cobrada errado) ou acesso
//     indevido. Por isso aparecem duas vezes: num bloco fixo acima das ações e
//     DENTRO da confirmação de cada uma — que é o instante em que a decisão é
//     tomada.
//
//  3. COTA NÃO APAGA DADO. Todo item acima do limite vem com a frase de que
//     nada foi removido e a clínica continua editando o que já tem. É o
//     comportamento real de planLimits.js ("cota só impede criar"), e omiti-lo
//     faria um downgrade legítimo parecer perda de dados.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { AlertBlock, Button, Input, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { CrudHeader, Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { API } from "../../lib/api";
import { asArray, asObject } from "../../lib/utils";
// A camada compartilhada do painel é importada aqui também (e não só no
// PlatformAdmin) para a tela não depender de quem a monta: import de CSS é
// deduplicado pelo bundler, então isto não muda a ordem final das regras.
import "../../styles/platform-panel.css";
import "../../styles/accounts-admin.css";

// Mesmo mínimo do `requireReason` do backend: o botão de confirmar fica
// desabilitado abaixo disso, em vez de mandar a requisição para levar 400.
const MOTIVO_MINIMO = 3;

// Teto do `adjustTrial`. Validado aqui só para o erro aparecer antes do envio —
// quem manda continua sendo o backend.
const MAX_TRIAL_DAYS = 365;

// Acima desta fração da cota a barra já muda de cor. Não é bloqueio: é o aviso
// de que o próximo upgrade/limpeza precisa entrar na conversa com a clínica.
const ATENCAO_RATIO = 80;

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Centavos (preço de plano) -> "R$ 149,90". */
const formatarCentavos = (centavos) => MOEDA.format(Number(centavos || 0) / 100);

/**
 * Reais (valor de fatura) -> "R$ 149,90".
 * `platform.tenant_invoices.amount` é NUMERIC em REAIS, não centavos — o Asaas
 * trabalha com decimal. Dividir por 100 aqui mostraria centavos de real.
 */
const formatarReais = (valor) => MOEDA.format(Number(valor || 0));

const NUMERO = new Intl.NumberFormat("pt-BR");

// Data com ANO: a tela mistura datas de anos diferentes (criação da clínica x
// vencimento da fatura), e "12/03" sozinho não responde nada.
function formatarData(valor) {
  if (!valor) return "—";
  const data = new Date(String(valor).length <= 10 ? `${valor}T12:00:00` : valor);
  return Number.isNaN(data.getTime()) ? String(valor) : data.toLocaleDateString("pt-BR");
}

const SUBSCRIPTION_LABELS = {
  trial_active: "Em teste",
  trial_expired: "Teste expirado",
  active: "Ativa",
  overdue: "Em atraso",
  canceled: "Cancelada",
  suspended: "Suspensa",
};

const SUBSCRIPTION_TONES = {
  trial_active: "info",
  trial_expired: "warn",
  active: "ok",
  overdue: "warn",
  canceled: "danger",
  suspended: "danger",
};

const rotuloDaAssinatura = (status) => SUBSCRIPTION_LABELS[status] || "Sem assinatura";

// Status de assinatura que o super-admin pode FORÇAR (FORCEABLE_SUBSCRIPTION_STATUSES
// do backend). Os dois de trial ficam de fora de propósito: quem mexe em trial é
// a ação de trial, que também acerta as datas.
const STATUS_FORCAVEIS = [
  { value: "active", label: "Ativa — libera o acesso" },
  { value: "overdue", label: "Em atraso — mantém o aviso de inadimplência" },
  { value: "canceled", label: "Cancelada — carimba a data de cancelamento" },
  { value: "suspended", label: "Suspensa — bloqueia pelo gating da assinatura" },
];

// Status que tiram o acesso da clínica pelo gating. Forçá-los exige a mesma
// confirmação reforçada da suspensão.
const STATUS_QUE_CORTAM = ["canceled", "suspended"];

const FATURA_TONES = {
  paga: "ok",
  pendente: "warn",
  atrasada: "danger",
  cancelada: "neutral",
  estornada: "danger",
};

// ---------------------------------------------------------------------------
// As três assimetrias
// ---------------------------------------------------------------------------
//
// Não são "avisos": são o contrato real do backend. Cada texto vive UMA vez e é
// reusado no bloco fixo da tela e na confirmação da ação correspondente — duas
// cópias divergentes seriam pior do que nenhuma.
const ASSIMETRIAS = {
  suspender:
    "Suspender NÃO cancela a assinatura no Asaas: a cobrança recorrente continua sendo gerada normalmente. " +
    "Suspensão é medida operacional e quase sempre temporária; para PARAR DE COBRAR é preciso cancelar a " +
    "assinatura, que é outra ação nesta mesma tela.",
  cancelar:
    "Cancelar a assinatura NÃO suspende a conta: a clínica continua entrando e trabalhando normalmente, porque " +
    "o período já pago é dela. Para tirar o acesso é preciso suspender, que é outra ação nesta mesma tela.",
  plano:
    "Trocar de plano reajusta a cobrança recorrente, mas as duas coisas não acontecem no mesmo lugar: recursos e " +
    "cotas mudam no banco (sempre), e o valor novo é enviado ao Asaas em seguida (pode falhar). Quando o envio " +
    "não completa, o aviso vermelho aparece e a clínica continua sendo cobrada pelo valor anterior até alguém " +
    'usar "Reenviar ajuste ao Asaas" — que pode ser clicado quantas vezes for preciso.',
};

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------
//
// `exigeCodigo` marca o que corta acesso ou encerra cobrança: além do motivo, o
// super-admin digita o slug da clínica. É a diferença entre errar de linha na
// lista e confirmar a clínica certa.
const ACOES = {
  suspender: {
    titulo: "Suspender a clínica",
    resumo:
      "Bloqueia IMEDIATAMENTE todo o acesso desta clínica: o servidor recusa qualquer requisição dela, inclusive " +
      "a tela de login dos funcionários.",
    naoFaz: ASSIMETRIAS.suspender,
    confirmar: "Suspender clínica",
    exigeCodigo: true,
  },
  reativar: {
    titulo: "Reativar a clínica",
    resumo: "Devolve o acesso da clínica na hora. O estado da assinatura continua exatamente como está.",
    naoFaz:
      "Reativar NÃO conserta a assinatura: se ela estiver cancelada, em atraso ou com o teste vencido, a clínica " +
      "volta a entrar mas continua barrada pelo gating do plano. Para liberar de verdade, force o status da " +
      "assinatura para Ativa.",
    confirmar: "Reativar clínica",
    exigeCodigo: false,
  },
  forcar_status: {
    titulo: "Forçar o status da assinatura",
    resumo:
      "Válvula de escape para o que o webhook não cobre: pagamento fora do gateway, acordo comercial, cortesia ou " +
      "fraude. Forçar 'Ativa' com o período já vencido também empurra o vencimento em 30 dias, senão a clínica " +
      "ficaria liberada e com '0 dias restantes' na tela.",
    naoFaz:
      "Isto muda apenas o NOSSO registro. A assinatura no Asaas fica inalterada: forçar 'Cancelada' aqui não " +
      "cancela a recorrência lá, e forçar 'Ativa' não cobra nada.",
    confirmar: "Forçar status",
    exigeCodigo: false,
  },
  trial: {
    titulo: "Ajustar o teste grátis",
    resumo:
      "Estender soma dias ao fim do teste (a partir de hoje, se ele já tiver vencido). Reiniciar recomeça a " +
      "contagem hoje. Nos dois casos, um teste vencido volta a valer.",
    naoFaz:
      "Uma assinatura PAGA (ativa ou em atraso) não é rebaixada para teste: as datas mudam, mas o status é " +
      "preservado — a clínica não perde o acesso que já pagou.",
    confirmar: "Aplicar ao teste",
    exigeCodigo: false,
  },
  cancelar_assinatura: {
    titulo: "Cancelar a assinatura",
    resumo:
      "Encerra a recorrência no Asaas e marca a assinatura como cancelada aqui. O cancelamento no gateway é " +
      "best-effort: se ele falhar, o cancelamento local acontece assim mesmo e o aviso fica na tela para alguém " +
      "cancelar à mão no painel do Asaas.",
    naoFaz: ASSIMETRIAS.cancelar,
    confirmar: "Cancelar assinatura",
    exigeCodigo: true,
  },
  plano: {
    titulo: "Trocar o plano da clínica",
    resumo:
      "A troca vale na hora para recursos e cotas, e o valor do plano novo é enviado à assinatura no Asaas (com as " +
      "cobranças pendentes junto). O status da assinatura não muda: uma clínica inadimplente que troca de plano " +
      "continua inadimplente.",
    naoFaz: ASSIMETRIAS.plano,
    confirmar: "Trocar plano",
    exigeCodigo: false,
  },
};

// ---------------------------------------------------------------------------
// Rede
// ---------------------------------------------------------------------------

// O `code` do backend viaja junto da mensagem porque é ele que permite reagir ao
// erro (assinatura inexistente pede uma orientação diferente de plano inválido).
class ErroDaApi extends Error {
  constructor(payload, alternativa) {
    super(payload?.error || alternativa);
    this.name = "ErroDaApi";
    this.code = payload?.code || "";
    this.detalhes = asObject(payload);
  }
}

// Orientação extra por código de erro. A mensagem do backend é sempre exibida;
// isto só acrescenta o "e agora?" quando ele existe.
const DICAS_DE_ERRO = {
  assinatura_inexistente:
    "Esta clínica não tem linha de assinatura. Ela é criada no provisionamento ou no checkout — até lá, só a " +
    "troca de plano (que grava no cadastro) funciona aqui.",
  motivo_obrigatorio: "O motivo fica registrado na auditoria e é o que responde “por quê?” meses depois.",
};

export function AccountsAdmin({ token, onUnauthorized, onCreate, refreshKey = 0 }) {
  const [tenants, setTenants] = useState(null);
  const [planos, setPlanos] = useState([]);
  const [loadError, setLoadError] = useState("");

  const [tenantId, setTenantId] = useState(null);
  const [conta, setConta] = useState(null);
  const [carregandoConta, setCarregandoConta] = useState(false);
  const [contaErro, setContaErro] = useState("");
  const [atualizandoUso, setAtualizandoUso] = useState(false);

  const [planoAlvo, setPlanoAlvo] = useState("");
  const [previsao, setPrevisao] = useState(null);
  const [previsaoErro, setPrevisaoErro] = useState("");
  const [carregandoPrevisao, setCarregandoPrevisao] = useState(false);

  const [acao, setAcao] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [codigoDigitado, setCodigoDigitado] = useState("");
  const [trialForm, setTrialForm] = useState({ days: "7", mode: "extend" });
  const [statusAlvo, setStatusAlvo] = useState("active");
  const [executando, setExecutando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [erroDaAcao, setErroDaAcao] = useState({ mensagem: "", dica: "" });

  const [feedback, setFeedback] = useState({ error: "", success: "" });
  // Avisos que NÃO somem sozinhos: cada um é dinheiro pendurado (recorrência no
  // valor errado, cancelamento que não pegou no gateway). Um aviso que se apaga
  // depois de 4 segundos é um aviso que ninguém leu.
  const [avisos, setAvisos] = useState([]);

  // O callback de 401 vem do painel e é recriado a cada render dele; em ref, o
  // `request` para de mudar de identidade e os efeitos de carga não disparam de
  // novo a cada render do pai.
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => {
    unauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  const request = useCallback(
    async (path, options = {}) => {
      const headers = new Headers(options.headers || {});
      if (options.body !== undefined && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      if (token) headers.set("Authorization", `Bearer ${token}`);
      let response;
      try {
        response = await fetch(`${API}${path}`, { ...options, headers });
      } catch {
        throw new Error("Não foi possível conectar ao servidor.");
      }
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        unauthorizedRef.current?.();
        throw new Error("Sessão de plataforma expirada. Entre novamente.");
      }
      if (!response.ok) throw new ErroDaApi(payload, "Não foi possível concluir a operação.");
      return payload;
    },
    [token],
  );

  const carregarClinicas = useCallback(async () => {
    const payload = await request("/platform/tenants");
    setTenants(asArray(payload).length ? asArray(payload) : asArray(asObject(payload).items));
  }, [request]);

  useEffect(() => {
    let ativo = true;
    carregarClinicas().catch((error) => {
      if (ativo) setLoadError(error.message);
    });
    // O catálogo de planos alimenta o seletor de troca e a coluna "Plano" da
    // listagem. Falha dele não impede a tela: o resto da conta (uso, assinatura,
    // faturas) continua legível, e a coluna cai no código cru do plano.
    request("/platform/plans")
      .then((payload) => {
        if (ativo) setPlanos(asArray(asObject(payload).plans));
      })
      .catch(() => {
        if (ativo) setPlanos([]);
      });
    return () => {
      ativo = false;
    };
  }, [carregarClinicas, request, refreshKey]);

  const carregarConta = useCallback(
    async (id) => {
      setCarregandoConta(true);
      setContaErro("");
      try {
        const payload = asObject(await request(`/platform/accounts/${id}`));
        setConta(payload);
        // O seletor volta para o plano vigente a cada carga: deixá-lo num plano
        // simulado depois de recarregar convidaria a "aplicar" o que já não é a
        // decisão em curso.
        setPlanoAlvo(asObject(payload.plan).code || "");
      } catch (error) {
        setConta(null);
        setContaErro(error.message);
      } finally {
        setCarregandoConta(false);
      }
    },
    [request],
  );

  useEffect(() => {
    if (!tenantId) return;
    carregarConta(tenantId);
  }, [tenantId, carregarConta]);

  const planoAtual = asObject(conta?.plan).code || "";
  const assinatura = conta?.subscription ? asObject(conta.subscription) : null;
  const clinica = asObject(conta?.tenant);

  // Simulação do downgrade ANTES de aplicar: é ela que responde "o que estoura
  // se eu mover esta clínica para o plano X?". Dispara sozinha na troca do
  // seletor porque exigir um clique a mais só produziria trocas sem conferência.
  useEffect(() => {
    if (!tenantId || !planoAlvo || planoAlvo === planoAtual) {
      setPrevisao(null);
      setPrevisaoErro("");
      return undefined;
    }
    let ativo = true;
    setCarregandoPrevisao(true);
    setPrevisaoErro("");
    request(`/platform/accounts/${tenantId}/limits-preview?plan_code=${encodeURIComponent(planoAlvo)}`)
      .then((payload) => {
        if (ativo) setPrevisao(asObject(payload));
      })
      .catch((error) => {
        if (!ativo) return;
        setPrevisao(null);
        setPrevisaoErro(error.message);
      })
      .finally(() => {
        if (ativo) setCarregandoPrevisao(false);
      });
    return () => {
      ativo = false;
    };
  }, [tenantId, planoAlvo, planoAtual, request]);

  // Planos oferecidos: os ativos, mais o plano vigente da clínica mesmo se ele
  // tiver sido desativado — sumir com o plano atual da lista faria o seletor
  // mostrar outro plano como se fosse o dela.
  const planosOferecidos = useMemo(() => {
    const ativos = asArray(planos).filter((plano) => plano.is_active || plano.code === planoAtual);
    if (planoAtual && !ativos.some((plano) => plano.code === planoAtual)) {
      ativos.unshift({ code: planoAtual, name: asObject(conta?.plan).name || planoAtual, price_cents: 0 });
    }
    return ativos;
  }, [planos, planoAtual, conta]);

  function adicionarAviso(titulo, texto) {
    if (!texto) return;
    setAvisos((atuais) => [...atuais, { id: `${Date.now()}-${atuais.length}`, titulo, texto }]);
  }

  function abrirAcao(tipo) {
    setAcao(tipo);
    setMotivo("");
    setCodigoDigitado("");
    setErroDaAcao({ mensagem: "", dica: "" });
    setFeedback({ error: "", success: "" });
  }

  function fecharAcao() {
    if (executando) return;
    setAcao(null);
    setMotivo("");
    setCodigoDigitado("");
    setErroDaAcao({ mensagem: "", dica: "" });
  }

  async function atualizarUso() {
    if (!tenantId) return;
    setAtualizandoUso(true);
    setFeedback({ error: "", success: "" });
    try {
      // Endpoint separado de propósito: medir uso é a parte CARA da visão
      // completa (uma consulta por cota dentro do schema da clínica), e é a
      // única que muda logo depois de uma troca de plano.
      const payload = asObject(await request(`/platform/accounts/${tenantId}/usage`));
      setConta((atual) => (atual ? { ...atual, usage: asArray(payload.usage) } : atual));
    } catch (error) {
      setFeedback({ error: error.message, success: "" });
    } finally {
      setAtualizandoUso(false);
    }
  }

  // Reprocesso do reajuste que não chegou ao gateway.
  //
  // Sem confirmação e sem motivo, ao contrário de todas as ações de escrita
  // desta tela: aqui nada NOSSO muda: a rota só faz o Asaas concordar com o
  // plano que já está gravado (e cuja troca já foi para a auditoria com o
  // motivo dela). É idempotente do lado do backend — ele lê a assinatura antes
  // de escrever e não faz nada se o valor já estiver certo —, então clicar duas
  // vezes não cobra duas vezes.
  async function reenviarAjusteAoGateway() {
    if (!tenantId) return;
    setSincronizando(true);
    setFeedback({ error: "", success: "" });
    try {
      const payload = asObject(
        await request(`/platform/accounts/${tenantId}/sync-subscription`, { method: "POST" }),
      );
      adicionarAviso("Pendência no gateway de pagamento", payload.warning);
      const gateway = asObject(payload.gateway);
      setFeedback({
        error: "",
        success: gateway.detalhe || "Ajuste reenviado ao Asaas.",
      });
      await carregarConta(tenantId);
    } catch (error) {
      setFeedback({ error: error.message, success: "" });
    } finally {
      setSincronizando(false);
    }
  }

  // Monta a requisição de cada ação. Fica separado do `executar` para o fluxo de
  // erro/sucesso ser um só, qualquer que seja o botão clicado.
  function requisicaoDaAcao(tipo, reason) {
    const base = `/platform/accounts/${tenantId}`;
    if (tipo === "suspender") return { path: `${base}/suspend`, method: "POST", body: { reason } };
    if (tipo === "reativar") return { path: `${base}/reactivate`, method: "POST", body: { reason } };
    if (tipo === "cancelar_assinatura") {
      return { path: `${base}/cancel-subscription`, method: "POST", body: { reason } };
    }
    if (tipo === "forcar_status") {
      return { path: `${base}/subscription-status`, method: "PATCH", body: { status: statusAlvo, reason } };
    }
    if (tipo === "plano") {
      return { path: `${base}/plan`, method: "PATCH", body: { plan_code: planoAlvo, reason } };
    }
    const dias = Number(String(trialForm.days).trim());
    if (!Number.isInteger(dias) || dias <= 0 || dias > MAX_TRIAL_DAYS) {
      return { erro: `Informe um número inteiro de dias entre 1 e ${MAX_TRIAL_DAYS}.` };
    }
    return { path: `${base}/trial`, method: "PATCH", body: { days: dias, mode: trialForm.mode, reason } };
  }

  function mensagemDeSucesso(tipo, payload) {
    if (tipo === "suspender") {
      return `Clínica "${clinica.name}" suspensa. O acesso está bloqueado; a assinatura no Asaas continua ativa.`;
    }
    if (tipo === "reativar") return `Clínica "${clinica.name}" reativada.`;
    if (tipo === "cancelar_assinatura") {
      return payload.gateway_canceled
        ? "Assinatura cancelada aqui e no Asaas. A clínica continua com acesso."
        : "Assinatura cancelada aqui. A clínica continua com acesso.";
    }
    if (tipo === "forcar_status") {
      const rotulo = STATUS_FORCAVEIS.find((item) => item.value === statusAlvo)?.label || statusAlvo;
      return `Status da assinatura forçado para "${rotulo.split(" —")[0]}".`;
    }
    if (tipo === "plano") {
      // O que aconteceu com a COBRANÇA vem do backend por escrito (`gateway.detalhe`)
      // em vez de ser deduzido aqui: "atualizado", "já estava sincronizado" e
      // "esta clínica não tem recorrência" são três finais diferentes para o
      // mesmo clique, e adivinhar qual foi é como a tela passa a mentir.
      const gateway = asObject(payload.gateway);
      const cobranca = gateway.detalhe || "Recursos e cotas já valem.";
      return `Plano trocado para "${payload.plan_name || planoAlvo}". ${cobranca}`;
    }
    return trialForm.mode === "restart"
      ? `Teste reiniciado por ${payload.days} dia(s).`
      : `Teste estendido em ${payload.days} dia(s).`;
  }

  async function executar() {
    if (!acao || !tenantId) return;
    const reason = motivo.trim();
    const { path, method, body, erro } = requisicaoDaAcao(acao, reason);
    if (erro) {
      setErroDaAcao({ mensagem: erro, dica: "" });
      return;
    }

    setExecutando(true);
    setErroDaAcao({ mensagem: "", dica: "" });
    try {
      const payload = asObject(await request(path, { method, body: JSON.stringify(body) }));

      // Avisos do backend viram bloco fixo na tela, não texto de sucesso: o
      // `warning` da troca de plano é o reajuste que NÃO chegou à recorrência, e
      // o do cancelamento é uma cobrança que pode continuar viva no gateway. O
      // que deu certo não vira aviso — vai na mensagem de sucesso.
      adicionarAviso("Pendência no gateway de pagamento", payload.warning);
      if (payload.gateway_error && !payload.warning) {
        adicionarAviso("Falha ao falar com o Asaas", payload.gateway_error);
      }

      setAcao(null);
      setMotivo("");
      setCodigoDigitado("");
      setFeedback({ error: "", success: mensagemDeSucesso(acao, payload) });
      // Recarrega conta E listagem: status e plano aparecem nas duas, e uma
      // delas velha faria a tela contar duas histórias diferentes.
      await carregarConta(tenantId);
      await carregarClinicas().catch(() => {});
    } catch (error) {
      setErroDaAcao({ mensagem: error.message, dica: DICAS_DE_ERRO[error.code] || "" });
    } finally {
      setExecutando(false);
    }
  }

  const definicao = acao ? ACOES[acao] : null;
  const exigeCodigo =
    Boolean(definicao?.exigeCodigo) || (acao === "forcar_status" && STATUS_QUE_CORTAM.includes(statusAlvo));
  const codigoConfere = !exigeCodigo || codigoDigitado.trim().toLowerCase() === String(clinica.slug || "").toLowerCase();
  const podeConfirmar = motivo.trim().length >= MOTIVO_MINIMO && codigoConfere && !executando;
  const semAssinatura = Boolean(conta) && !assinatura;
  const trocaPendente = Boolean(planoAlvo) && planoAlvo !== planoAtual;

  return (
    <div className="stack">
      {/* Avisos de gateway: `.platform-danger` pelo peso (é dinheiro pendurado) e
          `.platform-sticky-warning` para não escaparem da vista ao rolar. Só
          somem no clique — nunca sozinhos. */}
      {avisos.map((aviso) => (
        <div className="platform-danger platform-sticky-warning" role="alert" key={aviso.id}>
          <h3>
            <AlertTriangle size={16} aria-hidden="true" /> {aviso.titulo}
          </h3>
          <p>{aviso.texto}</p>
          <Button
            variant="secondary"
            onClick={() => setAvisos((atuais) => atuais.filter((item) => item.id !== aviso.id))}
          >
            Já anotei, dispensar
          </Button>
        </div>
      ))}

      {feedback.error && <span className="form-error">{feedback.error}</span>}
      {feedback.success && <span className="form-success">{feedback.success}</span>}

      {/*
        A mesma listagem em dois tamanhos: sozinha, ela ocupa a largura toda e as
        cinco colunas são legíveis; com uma conta aberta, o MESMO nó vira a
        coluna estreita do `.platform-split` e o detalhe entra ao lado. Trocar só
        a classe (em vez de mover o <DataView> para outro lugar da árvore)
        preserva busca, ordenação e página ao abrir e fechar uma conta.
      */}
      <div className={tenantId ? "platform-split" : ""}>
        <section className="panel">
          {/* `<CrudHeader>` e não um `.panel-heading` escrito à mão: é o mesmo
              cabeçalho de painel das outras telas, e duas grafias da mesma coisa
              é como o espaçamento começa a divergir entre abas. */}
          <CrudHeader title="Clínicas" subtitle="Cadastre e gerencie plano, assinatura, uso e faturas em um só lugar." actionLabel={onCreate ? "Nova clínica" : undefined} onAction={onCreate} />

          <DataView
            rows={asArray(tenants)}
            rowKey={(item) => item.id ?? item.slug}
            loading={tenants === null && !loadError}
            error={loadError}
            defaultSort={{ key: "name", dir: "asc" }}
            searchPlaceholder="Buscar por nome ou slug"
            empty="Nenhuma clínica cadastrada até o momento."
            emptyFiltered="Nenhuma clínica corresponde à busca."
            columns={[
              {
                key: "name",
                label: "Clínica",
                value: (item) => item.name || "",
                // O selo de suspensão viaja junto do nome em vez de virar uma
                // sexta coluna: acesso cortado é a única informação da lista que
                // não pode passar despercebida.
                render: (item) => (
                  <>
                    {item.name || "—"}{" "}
                    {item.status === "suspenso" && <StatusBadge status="suspenso" tone="danger" />}
                  </>
                ),
              },
              {
                key: "slug",
                label: "Slug",
                value: (item) => item.slug || "",
                // Identificador técnico -> `<code>`, o mesmo que a listagem de
                // planos faz com o código do plano. É por ele que se confirma a
                // clínica na hora de suspender, então precisa ser copiável e não
                // se confundir com o nome comercial.
                render: (item) => (item.slug ? <code>{item.slug}</code> : "—"),
              },
              {
                key: "plan",
                label: "Plano",
                value: (item) => nomeDoPlano(planos, item.plan),
                render: (item) => nomeDoPlano(planos, item.plan),
              },
              {
                key: "subscription_status",
                label: "Status da assinatura",
                // Sem `value` a busca e a ordenação receberiam o JSX do selo e
                // comparariam "[object Object]".
                value: (item) => rotuloDaAssinatura(item.subscription_status),
                render: (item) => (
                  <StatusBadge tone={SUBSCRIPTION_TONES[item.subscription_status] || "neutral"}>
                    {rotuloDaAssinatura(item.subscription_status)}
                  </StatusBadge>
                ),
              },
              {
                key: "created_at",
                label: "Criada em",
                // Ordena pelo ISO do backend; dd/MM/aaaa ordenaria por dia.
                value: (item) => String(item.created_at || ""),
                render: (item) => formatarData(item.created_at),
              },
            ]}
            actions={(item) => (
              <RowActions actions={[{
                label: item.id === tenantId ? "Gerenciando" : "Gerenciar",
                onClick: () => setTenantId(item.id),
                primary: true,
                disabled: item.id === tenantId,
              }]} />
            )}
          />
        </section>

        {tenantId && (
          <div className="stack">
            {carregandoConta && !conta && <Loading />}
            {contaErro && <ApiError message={contaErro} />}

            {conta && (
              <>
                <ResumoDaConta clinica={clinica} plano={asObject(conta.plan)} assinatura={assinatura} />

                <UsoXCotas itens={asArray(conta.usage)} atualizando={atualizandoUso} onAtualizar={atualizarUso} />

                <TrocaDePlano
                  planos={planosOferecidos}
                  planoAtual={planoAtual}
                  planoAlvo={planoAlvo}
                  onEscolher={setPlanoAlvo}
                  previsao={previsao}
                  previsaoErro={previsaoErro}
                  carregando={carregandoPrevisao}
                  trocaPendente={trocaPendente}
                  onAplicar={() => abrirAcao("plano")}
                />

                <AcoesDaConta
                  suspensa={clinica.status === "suspenso"}
                  semAssinatura={semAssinatura}
                  assinaturaNoGateway={assinatura?.asaas_subscription_id || ""}
                  sincronizando={sincronizando}
                  onSincronizar={reenviarAjusteAoGateway}
                  onAbrir={abrirAcao}
                />

                <section className="panel">
                  <CrudHeader title="Faturas recentes" subtitle="As últimas cobranças desta clínica na plataforma." />
                  <DataView
                    rows={asArray(conta.invoices)}
                    rowKey={(fatura) => fatura.id}
                    searchable={false}
                    defaultSort={{ key: "due_date", dir: "desc" }}
                    empty="Nenhuma fatura registrada para esta clínica."
                    columns={[
                      {
                        key: "due_date",
                        label: "Vencimento",
                        value: (fatura) => String(fatura.due_date || ""),
                        render: (fatura) => formatarData(fatura.due_date),
                      },
                      {
                        key: "plan_code",
                        label: "Plano",
                        value: (fatura) => fatura.plan_code || "",
                        render: (fatura) => (fatura.plan_code ? <code>{fatura.plan_code}</code> : "—"),
                      },
                      {
                        key: "amount",
                        label: "Valor",
                        align: "right",
                        value: (fatura) => Number(fatura.amount || 0),
                        render: (fatura) => formatarReais(fatura.amount),
                      },
                      {
                        key: "status",
                        label: "Status",
                        value: (fatura) => fatura.status || "",
                        render: (fatura) => (
                          <StatusBadge status={fatura.status} tone={FATURA_TONES[fatura.status] || "neutral"} />
                        ),
                      },
                      {
                        key: "paid_at",
                        label: "Pagamento",
                        value: (fatura) => String(fatura.paid_at || ""),
                        render: (fatura) => (fatura.paid_at ? formatarData(fatura.paid_at) : "—"),
                      },
                    ]}
                    // A fatura sai da COLUNA e vira ação de linha, como no
                    // financeiro da plataforma: era o mesmo "abrir a cobrança no
                    // Asaas" escrito de dois jeitos — lá uma pílula na coluna de
                    // ações, aqui um link nu no meio da tabela. Mesmo rótulo,
                    // mesmo lugar. A pílula vem de `.table-actions a` (styles.css).
                    actions={(fatura) => fatura.invoice_url
                      ? <RowActions actions={[{ label: "Abrir fatura", href: fatura.invoice_url, target: "_blank", rel: "noreferrer", primary: true }]} />
                      : null}
                  />
                </section>
              </>
            )}
          </div>
        )}
      </div>

      {/* Toda escrita passa por aqui: o motivo obrigatório e a digitação do slug
          ficam DENTRO da confirmação, junto da assimetria da ação. */}
      <Modal
        open={Boolean(acao)}
        title={definicao?.titulo}
        subtitle={clinica.name ? `${clinica.name} (${clinica.slug})` : ""}
        onClose={fecharAcao}
        footer={
          <>
            <Button variant="secondary" disabled={executando} onClick={fecharAcao}>
              Cancelar
            </Button>
            <Button variant="danger" disabled={!podeConfirmar} onClick={executar}>
              {executando ? "Aplicando…" : definicao?.confirmar}
            </Button>
          </>
        }
      >
        <p>{definicao?.resumo}</p>

        {/* A assimetria repetida no instante da decisão. É aqui que ela evita o
            erro — no bloco lá em cima ela é referência, não alerta. */}
        <p className="platform-notice">
          <AlertTriangle size={16} aria-hidden="true" /> {definicao?.naoFaz}
        </p>

        {acao === "plano" && (
          <div>
            <p className="field-hint">
              De <strong>{nomeDoPlano(planosOferecidos, planoAtual)}</strong> para{" "}
              <strong>{nomeDoPlano(planosOferecidos, planoAlvo)}</strong>.
            </p>
            <ResumoDaPrevisao previsao={previsao} erro={previsaoErro} carregando={carregandoPrevisao} compacto />
          </div>
        )}

        {acao === "forcar_status" && (
          <div>
            <Select label="Novo status da assinatura" value={statusAlvo} onChange={setStatusAlvo}>
              {STATUS_FORCAVEIS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
            {STATUS_QUE_CORTAM.includes(statusAlvo) && (
              <p className="platform-notice">
                Este status BLOQUEIA o uso do sistema pela clínica (a conta continua ativa, mas o plano deixa de
                liberar as telas).
              </p>
            )}
          </div>
        )}

        {acao === "trial" && (
          <div>
            <div className="form-grid">
              <Input
                type="number"
                label={`Dias (1 a ${MAX_TRIAL_DAYS})`}
                value={trialForm.days}
                onChange={(value) => setTrialForm((atual) => ({ ...atual, days: value }))}
              />
              <Select
                label="Modo"
                value={trialForm.mode}
                onChange={(value) => setTrialForm((atual) => ({ ...atual, mode: value }))}
              >
                <option value="extend">Estender — soma dias ao prazo atual</option>
                <option value="restart">Reiniciar — recomeça a contagem hoje</option>
              </Select>
            </div>
            <p className="field-hint">
              Teste atual termina em {formatarData(assinatura?.trial_ends_at)}.{" "}
              {trialForm.mode === "restart"
                ? "Reiniciar descarta o prazo que resta e conta de hoje."
                : "Estender soma a partir de hoje quando o prazo já venceu — nunca devolve uma data no passado."}
            </p>
          </div>
        )}

        <div>
          <Textarea
            label="Motivo (obrigatório)"
            value={motivo}
            rows={3}
            placeholder="Ex.: pedido da própria clínica no chamado #482"
            onChange={setMotivo}
          />
          <p className="field-hint">
            O motivo vai para a auditoria junto do seu e-mail e do que mudou. Mínimo de {MOTIVO_MINIMO} caracteres — é
            a resposta para “por quê?” quando alguém revisar esta conta meses depois.
          </p>
        </div>

        {exigeCodigo && (
          <label className="confirm-delete-field">
            Digite <strong>{clinica.slug}</strong> para confirmar que é esta a clínica
            <input
              type="text"
              value={codigoDigitado}
              autoComplete="off"
              placeholder={clinica.slug}
              onChange={(event) => setCodigoDigitado(event.target.value)}
            />
          </label>
        )}

        {erroDaAcao.mensagem && (
          <div role="alert">
            <span className="form-error">{erroDaAcao.mensagem}</span>
            {erroDaAcao.dica && <p className="field-hint">{erroDaAcao.dica}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

// --- Blocos auxiliares -------------------------------------------------------

function nomeDoPlano(planos, code) {
  return asArray(planos).find((plano) => plano.code === code)?.name || code || "—";
}

function Fato({ rotulo, valor }) {
  return (
    <div className="platform-fact">
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

function ResumoDaConta({ clinica, plano, assinatura }) {
  const status = assinatura?.status || "";
  return (
    <section className="panel">
      <CrudHeader
        title={clinica.name || "—"}
        subtitle={
          <>
            <code>{clinica.slug}</code> · criada em {formatarData(clinica.created_at)}
          </>
        }
      />

      {/* Os dois selos entram como fatos, e não soltos no cabeçalho: acesso e
          assinatura são estados independentes (a assimetria de novo), e lado a
          lado com rótulo isso fica dito em vez de subentendido. */}
      <dl className="platform-facts">
        <Fato
          rotulo="Acesso da clínica"
          valor={
            <StatusBadge status={clinica.status || "ativo"} tone={clinica.status === "suspenso" ? "danger" : "ok"} />
          }
        />
        <Fato
          rotulo="Assinatura"
          valor={
            <StatusBadge tone={SUBSCRIPTION_TONES[status] || "neutral"}>{rotuloDaAssinatura(status)}</StatusBadge>
          }
        />
        <Fato rotulo="Plano vigente" valor={`${plano.name || "—"} · ${formatarCentavos(plano.price_cents)}/mês`} />
        <Fato rotulo="Responsável" valor={clinica.responsible_name || "—"} />
        <Fato rotulo="E-mail" valor={clinica.email || "—"} />
        <Fato rotulo="Telefone" valor={clinica.phone || "—"} />
        <Fato rotulo="Cidade/UF" valor={[clinica.city, clinica.state].filter(Boolean).join("/") || "—"} />
        {/*
          O documento chega MASCARADO do servidor e é assim que fica — o rótulo
          diz isso para ninguém achar que o campo veio truncado. Esta tela não
          precisa do CPF/CNPJ inteiro para nada, e ele é dado pessoal do
          responsável: o suficiente é ele reconhecer o próprio número.
        */}
        <Fato
          rotulo="Documento (mascarado pelo servidor)"
          valor={clinica.tax_id || (clinica.has_tax_id ? "informado" : "—")}
        />
        {/* Ids do gateway em `<code>`: são identificadores técnicos que alguém
            vai copiar para o painel do Asaas — o mesmo tratamento que o código do
            plano e o slug recebem nas outras telas. */}
        <Fato
          rotulo="Cliente no Asaas"
          valor={clinica.asaas_customer_id ? <code>{clinica.asaas_customer_id}</code> : "—"}
        />
        <Fato
          rotulo="Assinatura no Asaas"
          valor={assinatura?.asaas_subscription_id ? <code>{assinatura.asaas_subscription_id}</code> : "—"}
        />
        <Fato
          rotulo="Teste grátis"
          valor={assinatura?.trial_ends_at ? `termina em ${formatarData(assinatura.trial_ends_at)}` : "—"}
        />
        <Fato
          rotulo="Período atual"
          valor={assinatura?.current_period_ends_at ? `até ${formatarData(assinatura.current_period_ends_at)}` : "—"}
        />
        <Fato rotulo="Dias restantes" valor={assinatura?.days_left == null ? "—" : `${assinatura.days_left} dia(s)`} />
        <Fato rotulo="Cancelada em" valor={assinatura?.canceled_at ? formatarData(assinatura.canceled_at) : "—"} />
      </dl>
    </section>
  );
}

/**
 * Uso x cotas com barra por item.
 *
 * Quatro leituras precisam ficar óbvias, e cada uma tem um desenho próprio:
 *  - cota normal: barra preenchida, com a faixa de atenção antes do teto.
 *  - cota `null` é ILIMITADO: trilho tracejado e VAZIO. Nem cheio (que sugeriria
 *    teto atingido) nem 0% (que sugeriria uma cota existente e intacta).
 *  - `approximate` (armazenamento) vira "≈" e diz que é estimativa: o backend
 *    conta arquivos referenciados e multiplica por uma média — fingir precisão
 *    aqui faria alguém tomar decisão comercial com um número inventado.
 *  - `measured: false` não desenha barra nenhuma: uma barra vazia afirmaria
 *    "zero", e zero é uma afirmação que o backend não fez.
 * Acima da cota destaca E explica que nada foi apagado. É o comportamento real
 * do backend, e é o que evita o pânico de "downgrade apaga cliente".
 */
function UsoXCotas({ itens, atualizando, onAtualizar }) {
  const estourados = asArray(itens).filter((item) => item.over_limit);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Uso x cotas do plano</h2>
          <span>Medido agora, direto no banco da clínica.</span>
        </div>
        {/* `.header-actions` em volta, mesmo com um botão só: é o invólucro que
            as outras telas do painel usam no lado direito do `.panel-heading`, e
            é ele que dá o gap quando um segundo botão aparecer aqui.
            `ghost` e ícone de 15: é o mesmo "reler este bloco" dos cinco painéis
            do financeiro da plataforma, e ali ele é ghost. Duas variantes para o
            mesmo gesto faziam o botão parecer mais pesado numa aba que na outra. */}
        <div className="header-actions">
          <Button variant="ghost" disabled={atualizando} onClick={onAtualizar}>
            <RefreshCw size={15} aria-hidden="true" /> {atualizando ? "Medindo…" : "Atualizar uso"}
          </Button>
        </div>
      </div>

      {estourados.length > 0 && (
        <p className="platform-notice">
          Esta clínica está acima da cota em {estourados.length} item(ns) — e isso NÃO apagou nada. Todos os registros
          continuam visíveis e editáveis por ela; o plano apenas impede criar novos até ela liberar espaço ou subir de
          plano.
        </p>
      )}

      {asArray(itens).map((item) => (
        <LinhaDeCota item={item} key={item.key} />
      ))}

      {!asArray(itens).length && (
        <p className="empty-state">
          Não foi possível medir o uso desta clínica agora. O restante da conta continua acessível.
        </p>
      )}
    </section>
  );
}

function LinhaDeCota({ item }) {
  const usado = item.used == null ? null : Number(item.used);
  const aproximado = Boolean(item.approximate);
  const prefixo = aproximado ? "≈ " : "";
  const usadoTexto = usado == null ? "não foi possível medir" : `${prefixo}${NUMERO.format(usado)} ${item.unit}`;

  if (!item.measured) {
    return (
      <div className="platform-quota">
        <div className="platform-quota-head">
          <strong>{item.label}</strong>
          <span>{usadoTexto}</span>
        </div>
        <p className="field-hint">
          A contagem falhou nesta cota. Falha de medição LIBERA a criação no backend — a clínica não fica travada por
          um erro nosso.
        </p>
      </div>
    );
  }

  if (item.unlimited) {
    return (
      <div className="platform-quota">
        <div className="platform-quota-head">
          <strong>{item.label}</strong>
          <span>
            {usadoTexto} <StatusBadge tone="info">Ilimitado</StatusBadge>
          </span>
        </div>
        {/* Sem `<span>` dentro: o trilho tracejado precisa ficar VAZIO, e um
            preenchimento sem largura definida ocuparia a barra inteira. */}
        <div className="platform-quota-bar is-unlimited" aria-hidden="true" />
        <p className="field-hint">
          Este plano não tem cota para este item — não há teto a atingir.
          {aproximado ? " O valor é uma estimativa (ver abaixo)." : ""}
        </p>
        {aproximado && <NotaDeEstimativa />}
      </div>
    );
  }

  const percent = Number(item.percent ?? 0);
  const faixa = item.over_limit ? " is-over" : percent >= ATENCAO_RATIO ? " is-near" : "";
  return (
    <div className="platform-quota">
      <div className="platform-quota-head">
        <strong>{item.label}</strong>
        <span>
          {prefixo}
          {NUMERO.format(usado)} de {NUMERO.format(Number(item.limit))} {item.unit} · {percent}%
        </span>
      </div>
      <div
        className={`platform-quota-bar${faixa}`}
        role="progressbar"
        aria-label={item.label}
        aria-valuemin={0}
        aria-valuemax={Number(item.limit)}
        aria-valuenow={usado}
      >
        {/* A barra satura em 100% para não vazar do trilho; o percentual real
            (que pode passar de 100) continua escrito ao lado. */}
        <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      {item.over_limit && (
        <p className="platform-notice">
          Acima da cota. <strong>Nada foi apagado:</strong> a clínica continua vendo e editando tudo o que já
          cadastrou. O plano só impede CRIAR novos registros desta cota.
        </p>
      )}
      {aproximado && <NotaDeEstimativa />}
    </div>
  );
}

// O armazenamento é declaradamente aproximado no backend (contagem de arquivos
// referenciados x média por tipo, sem `stat` no disco). Dizer isso é mais útil
// do que exibir um número redondo que ninguém pode auditar.
function NotaDeEstimativa() {
  return (
    <p className="field-hint">
      <strong>Estimativa.</strong> O espaço não é medido no disco: contamos os arquivos que a clínica referencia e
      multiplicamos por uma média por tipo. Use como ordem de grandeza, não como número exato — e evite decidir
      bloqueio por esta cota.
    </p>
  );
}

function TrocaDePlano({
  planos,
  planoAtual,
  planoAlvo,
  onEscolher,
  previsao,
  previsaoErro,
  carregando,
  trocaPendente,
  onAplicar,
}) {
  return (
    <section className="panel">
      <CrudHeader title="Plano da clínica" subtitle={`Hoje: ${nomeDoPlano(planos, planoAtual)}.`} />

      {!planos.length && (
        <p className="platform-notice">
          Não foi possível carregar o catálogo de planos. Recarregue a página para trocar o plano desta clínica.
        </p>
      )}

      <div className="toolbar">
        <Select label="Trocar para" value={planoAlvo} onChange={onEscolher}>
          {planos.map((plano) => (
            <option key={plano.code} value={plano.code}>
              {plano.name} — {formatarCentavos(plano.price_cents)}
              {plano.code === planoAtual ? " (atual)" : ""}
            </option>
          ))}
        </Select>
        <Button disabled={!trocaPendente} onClick={onAplicar}>
          Revisar e trocar plano
        </Button>
      </div>

      {trocaPendente ? (
        <ResumoDaPrevisao previsao={previsao} erro={previsaoErro} carregando={carregando} />
      ) : (
        <p className="field-hint">Escolha outro plano para simular o que mudaria antes de aplicar.</p>
      )}
    </section>
  );
}

/**
 * Resultado do `limits-preview`: o que ESTOURARIA no plano simulado.
 *
 * A simulação roda antes de aplicar porque é a única forma de a troca ser uma
 * decisão informada. Se ela falhar, a tela diz isso em letras e NÃO trava a
 * troca: a autoridade é o backend, e uma medição quebrada não pode impedir o
 * super-admin de arrumar a conta de alguém.
 */
function ResumoDaPrevisao({ previsao, erro, carregando, compacto = false }) {
  if (carregando) return <p className="field-hint">Simulando o plano escolhido…</p>;
  if (erro) {
    return (
      <p className="platform-notice">
        Não foi possível simular a troca: {erro} A troca continua possível — só não dá para prever o que ficaria acima
        da cota.
      </p>
    );
  }
  if (!previsao) return null;

  const excedentes = asArray(previsao.usage).filter((item) => item.over_limit);

  // Âmbar só quando alguma cota estoura: destacar uma simulação limpa treinaria
  // o olho a ignorar o destaque justamente quando ele importa.
  return (
    <div className={excedentes.length ? "platform-notice" : "field-hint"}>
      <strong>
        {excedentes.length
          ? `${excedentes.length} cota(s) ficariam acima do limite no plano simulado`
          : "Nenhuma cota ficaria acima do limite no plano simulado"}
      </strong>
      {excedentes.length > 0 && (
        <ul>
          {excedentes.map((item) => (
            <li key={item.key}>
              <strong>{item.label}</strong>: {NUMERO.format(Number(item.used))} {item.unit} contra um teto de{" "}
              {NUMERO.format(Number(item.limit))}.
            </li>
          ))}
        </ul>
      )}
      {/* O `efeito` vem do backend por escrito. Repeti-lo aqui é o que impede a
          leitura de "estourou" como "vai perder dado". */}
      <p>
        {previsao.efeito ||
          "Registros acima da cota continuam visíveis e editáveis pela clínica; o plano só impede criar novos."}
      </p>
      {!compacto && (
        <p>
          Simulação de {previsao.plano_atual} para {previsao.plano_simulado}. Nada foi alterado ainda.
        </p>
      )}
    </div>
  );
}

/**
 * As cinco ações (mais o reenvio do ajuste ao gateway) num painel só.
 *
 * Antes eram cinco cartões com CSS próprio; o que eles carregavam de essencial
 * — a assimetria e o motivo de um botão estar desligado — continua na tela: a
 * primeira no bloco de referência (e de novo dentro de cada confirmação), o
 * segundo numa linha de nota abaixo dos botões. Suspender e cancelar ficam
 * separados em `.platform-danger` para nunca aparecerem ao lado de "salvar".
 */
function AcoesDaConta({ suspensa, semAssinatura, assinaturaNoGateway, sincronizando, onSincronizar, onAbrir }) {
  const semAssinaturaPorque = "sem linha de assinatura não há o que ajustar.";
  const acoes = [
    { tipo: "reativar", ok: suspensa, porque: "Reativar a clínica: ela já está ativa." },
    { tipo: "trial", ok: !semAssinatura, porque: `Ajustar o teste grátis: ${semAssinaturaPorque}` },
    { tipo: "forcar_status", ok: !semAssinatura, porque: `Forçar o status da assinatura: ${semAssinaturaPorque}` },
  ];
  const destrutivas = [
    { tipo: "suspender", ok: !suspensa, porque: "Suspender a clínica: ela já está suspensa." },
    {
      tipo: "cancelar_assinatura",
      ok: !semAssinatura,
      porque: `Cancelar a assinatura: ${semAssinaturaPorque}`,
    },
  ];
  const indisponiveis = [...acoes, ...destrutivas].filter((item) => !item.ok).map((item) => item.porque);

  return (
    <section className="panel">
      <CrudHeader title="Ações de conta" subtitle="Todas exigem motivo e confirmação. Todas vão para a auditoria." />

      {/*
        As três assimetrias juntas, antes dos botões. Elas são deliberadas no
        backend e cada uma já causou (ou causaria) um erro operacional caro:
        clínica suspensa continuar sendo cobrada, assinatura cancelada derrubar
        quem já pagou, upgrade não chegar à recorrência.
      */}
      {/* `.field-hint` dentro do AlertBlock, como nas outras telas do painel.
          `.alert-item` era a classe errada por duas razões: ela é o CARTÃO de
          alerta do painel da clínica (moldura e fundo próprios, spacing outro), e
          o `.alert-item strong` global impõe `white-space: nowrap` — o "Suspender
          ≠ cancelar cobrança." em negrito deixava de quebrar linha.
          Aqui a assimetria é REFERÊNCIA; o alerta de verdade é o
          `.platform-notice` dentro de cada confirmação. */}
      <AlertBlock icon={AlertTriangle} title="O que estas ações NÃO fazem" empty="">
        <p className="field-hint">
          <strong>Suspender ≠ cancelar cobrança.</strong> {ASSIMETRIAS.suspender}
        </p>
        <p className="field-hint">
          <strong>Cancelar ≠ cortar acesso.</strong> {ASSIMETRIAS.cancelar}
        </p>
        <p className="field-hint">
          <strong>Trocar de plano reajusta a cobrança — se o gateway responder.</strong> {ASSIMETRIAS.plano}
        </p>
      </AlertBlock>

      {/* O reprocesso mora ao lado das assimetrias porque é a resposta à
          terceira delas. Fora do bloco vermelho e sem confirmação: reenviar o
          valor que já está gravado não corta acesso, não cria cobrança e pode
          ser repetido à vontade — o backend só escreve no gateway se o valor de
          lá estiver diferente. */}
      <div className="header-actions">
        <Button variant="secondary" disabled={!assinaturaNoGateway || sincronizando} onClick={onSincronizar}>
          <RefreshCw size={15} aria-hidden="true" />{" "}
          {sincronizando ? "Reenviando…" : "Reenviar ajuste ao Asaas"}
        </Button>
      </div>
      <p className="field-hint">
        {assinaturaNoGateway
          ? `Reenvia à assinatura ${assinaturaNoGateway} o valor do plano vigente, junto das cobranças pendentes. Use quando a troca de plano avisar que o reajuste não chegou ao gateway.`
          : "Reenviar ajuste ao Asaas: indisponível porque esta clínica não tem assinatura recorrente no gateway — não há cobrança a reajustar."}
      </p>

      {semAssinatura && (
        <p className="platform-notice">
          Esta clínica não tem linha de assinatura: teste grátis, status da assinatura e cancelamento ficam
          indisponíveis até ela ser criada pelo provisionamento ou pelo checkout.
        </p>
      )}

      {/* `.header-actions` e não `.card-actions`: a segunda repinta TODO botão
          dentro dela como pílula neutra, o que apagaria o vermelho do
          `danger-button` logo abaixo. */}
      <div className="header-actions">
        {acoes.map((item) => (
          <Button key={item.tipo} variant="secondary" disabled={!item.ok} onClick={() => onAbrir(item.tipo)}>
            {ACOES[item.tipo].titulo}
          </Button>
        ))}
      </div>

      <div className="platform-danger">
        <h3>Corta acesso ou encerra cobrança</h3>
        <p>
          As duas ações abaixo pedem, além do motivo, digitar o slug da clínica — é o que separa "errei de linha na
          lista" de "confirmei a clínica certa".
        </p>
        <div className="header-actions">
          {destrutivas.map((item) => (
            <Button key={item.tipo} variant="danger" disabled={!item.ok} onClick={() => onAbrir(item.tipo)}>
              {ACOES[item.tipo].titulo}
            </Button>
          ))}
        </div>
      </div>

      {indisponiveis.length > 0 && <p className="field-hint">Indisponível agora — {indisponiveis.join(" ")}</p>}
    </section>
  );
}
