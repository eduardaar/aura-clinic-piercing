// Gestão dos planos vendidos pela plataforma (aba do painel do super-admin).
//
// Esta tela mexe em DINHEIRO DE CLÍNICA PAGANTE: o mesmo formulário que troca um
// selo também recobra todo mundo que assina o plano. Três decisões saem daí e
// valem para o arquivo inteiro:
//
//  1. A conversão reais <-> centavos acontece em UM lugar só (as três funções
//     logo abaixo). Um `/100` esquecido no meio do componente cobra cem vezes o
//     preço, e o estrago só aparece na fatura da clínica.
//  2. Catálogo de features e de limites vêm da API a cada carga. Replicá-los
//     aqui faria a tela mentir no dia em que o backend ganhasse uma feature —
//     caixinha que não existe não protege rota nenhuma.
//  3. O relatório de propagação de preço com falhas NÃO some sozinho: cada linha
//     de falha é uma clínica que continua sendo cobrada no valor antigo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Plus } from "lucide-react";
import { AlertBlock, Button, Checkbox, Input, StatusBadge, Textarea } from "../../components/common/Ui";
import { ConfirmDeleteModal, CrudHeader, Modal } from "../../components/common/Crud";
import { ApiError, Loading } from "../../components/common/Feedback";
import { API } from "../../lib/api";
import { asArray, asObject } from "../../lib/utils";
import "../../styles/plans-admin.css";

// Chave do rascunho do plano ainda não criado. Não pode colidir com um código
// real: `CODE_RE` no backend exige começar por letra minúscula.
const NOVO = "__novo__";

const MAX_TRIAL_DAYS = 90;

// ---------------------------------------------------------------------------
// Dinheiro: a ÚNICA fronteira entre reais (tela) e centavos (API)
// ---------------------------------------------------------------------------

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Centavos -> "R$ 149,90", para leitura. */
function formatarPreco(centavos) {
  return MOEDA.format(Number(centavos || 0) / 100);
}

/** Centavos -> "149,90", para dentro do campo de edição. */
function centavosParaCampo(centavos) {
  return (Number(centavos || 0) / 100).toFixed(2).replace(".", ",");
}

/**
 * "R$ 1.499,90" -> { centavos: 149990 }; entrada inválida -> { erro }.
 *
 * O separador decimal é o ÚLTIMO "." ou "," do texto, e só quando sobram 1 ou 2
 * casas depois dele: quem digita "1.500" quer mil e quinhentos reais, e ler esse
 * ponto como decimal cobraria R$ 1,50 de todo mundo. Grupos de milhar precisam
 * ter exatamente 3 dígitos, senão "1.2.3" viraria um preço qualquer em silêncio.
 */
function reaisParaCentavos(texto) {
  const bruto = String(texto ?? "").replace(/[\sR$]/g, "");
  if (!bruto) return { erro: "Informe o preço do plano. Use 0 para um plano gratuito." };
  if (!/^[\d.,]+$/.test(bruto)) {
    return { erro: 'Preço inválido: use apenas números, como "149,90".' };
  }

  const ultimo = Math.max(bruto.lastIndexOf(","), bruto.lastIndexOf("."));
  const casasFinais = ultimo < 0 ? 0 : bruto.length - ultimo - 1;
  const temDecimal = ultimo >= 0 && casasFinais >= 1 && casasFinais <= 2;
  const parteInteira = temDecimal ? bruto.slice(0, ultimo) : bruto;

  const grupos = parteInteira.split(/[.,]/);
  if (grupos.slice(1).some((grupo) => grupo.length !== 3)) {
    return { erro: 'Preço inválido: separe os centavos com vírgula, como "1.499,90".' };
  }

  const inteiro = grupos.join("");
  const decimal = temDecimal ? bruto.slice(ultimo + 1).padEnd(2, "0") : "00";
  const centavos = Number(inteiro || "0") * 100 + Number(decimal);
  if (!Number.isSafeInteger(centavos)) return { erro: "Preço inválido." };
  return { centavos };
}

// ---------------------------------------------------------------------------
// Rascunhos
// ---------------------------------------------------------------------------

// Um rascunho é a FOTO EDITÁVEL do plano: o preço vira texto ("149,90") e os
// limites viram texto também, porque campo vazio precisa continuar vazio até o
// salvamento — e não virar zero, que é o oposto de "ilimitado".
const rascunhoVazio = () => ({
  code: "",
  name: "",
  price: "",
  audience: "",
  description: "",
  trial_days: "7",
  badge: "",
  is_recommended: false,
  features: [],
  limits: {},
});

function planoParaRascunho(plano) {
  return {
    code: plano.code,
    name: plano.name || "",
    price: centavosParaCampo(plano.price_cents),
    audience: plano.audience || "",
    description: plano.description || "",
    trial_days: String(plano.trial_days ?? 7),
    badge: plano.badge || "",
    is_recommended: Boolean(plano.is_recommended),
    features: asArray(plano.features),
    limits: Object.fromEntries(
      Object.entries(asObject(plano.limits))
        .filter(([, valor]) => valor !== null && valor !== undefined)
        .map(([chave, valor]) => [chave, String(valor)]),
    ),
  };
}

function rascunhoBase(code, plans) {
  if (code === NOVO) return rascunhoVazio();
  const plano = asArray(plans).find((item) => item.code === code);
  return plano ? planoParaRascunho(plano) : null;
}

// ---------------------------------------------------------------------------
// Rede
// ---------------------------------------------------------------------------

// O `code` do backend é o que faz a tela REAGIR ao erro (abrir a confirmação de
// preço, oferecer desativar em vez de excluir), então ele viaja junto da
// mensagem em vez de ser descartado no `throw`.
class ErroDaApi extends Error {
  constructor(payload, alternativa) {
    super(payload?.error || alternativa);
    this.name = "ErroDaApi";
    this.code = payload?.code || "";
    this.detalhes = asObject(payload);
  }
}

function moveInList(list, index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(nextIndex, 0, item);
  return copy;
}

const plural = (total, singular, pluralizado) => `${total} ${total === 1 ? singular : pluralizado}`;

export function PlansAdmin({ token, onUnauthorized }) {
  const [plans, setPlans] = useState(null);
  const [featureCatalog, setFeatureCatalog] = useState([]);
  const [limitCatalog, setLimitCatalog] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const [loadError, setLoadError] = useState("");

  const [activeCode, setActiveCode] = useState("");
  // Rascunhos por plano: trocar de plano na lista não pode jogar fora o que já
  // foi digitado no outro. Mesmo desenho do editor da landing.
  const [drafts, setDrafts] = useState({});
  const [feedback, setFeedback] = useState({ error: "", success: "" });
  const [salvando, setSalvando] = useState(false);
  const [dragCode, setDragCode] = useState("");

  const [descartando, setDescartando] = useState("");
  const [confirmandoPreco, setConfirmandoPreco] = useState(null);
  const [propagacao, setPropagacao] = useState(null);
  const [desativando, setDesativando] = useState(null);
  const [excluindo, setExcluindo] = useState(null);
  const [emUso, setEmUso] = useState(null);
  const [carregandoUso, setCarregandoUso] = useState("");

  // O callback de 401 vem do painel e é recriado a cada render dele; em ref,
  // `request` para de mudar de identidade e o efeito de carga não dispara de
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
      // A mensagem do backend é sempre preferida: só ela sabe dizer "este é o
      // único plano ativo" ou quais features não existem.
      if (!response.ok) throw new ErroDaApi(payload, "Não foi possível concluir a operação.");
      return payload;
    },
    [token],
  );

  const carregar = useCallback(async () => {
    const payload = await request("/platform/plans");
    setPlans(asArray(payload?.plans));
    setFeatureCatalog(asArray(payload?.feature_catalog));
    setLimitCatalog(asArray(payload?.limit_catalog));
    setAlertas(asArray(payload?.alertas));
  }, [request]);

  useEffect(() => {
    let ativo = true;
    carregar().catch((error) => {
      if (ativo) setLoadError(error.message);
    });
    return () => {
      ativo = false;
    };
  }, [carregar]);

  const planList = asArray(plans);

  const dirtyCodes = useMemo(
    () =>
      Object.keys(drafts).filter((code) => JSON.stringify(drafts[code]) !== JSON.stringify(rascunhoBase(code, plans))),
    [drafts, plans],
  );

  // Fechar a aba com edição pendente perde trabalho sem aviso: o navegador só
  // pergunta se houver um handler registrado.
  useEffect(() => {
    if (!dirtyCodes.length) return undefined;
    const avisar = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [dirtyCodes.length]);

  const nomeDoPlano = useCallback(
    (code) => {
      if (code === NOVO) return drafts[NOVO]?.name?.trim() || "Novo plano";
      return asArray(plans).find((item) => item.code === code)?.name || code;
    },
    [drafts, plans],
  );

  const planoAtivo = planList.find((item) => item.code === activeCode) || null;
  const criando = activeCode === NOVO;
  const draft = drafts[activeCode] ?? (planoAtivo ? planoParaRascunho(planoAtivo) : null);
  const activeDirty = dirtyCodes.includes(activeCode);

  const grupos = useMemo(() => {
    const mapa = new Map();
    for (const item of asArray(featureCatalog)) {
      const grupo = item.group || "Outros";
      if (!mapa.has(grupo)) mapa.set(grupo, []);
      mapa.get(grupo).push(item);
    }
    return [...mapa.entries()].map(([nome, itens]) => ({ nome, itens }));
  }, [featureCatalog]);

  function editarRascunho(patch) {
    if (!draft) return;
    setDrafts((atual) => ({ ...atual, [activeCode]: { ...draft, ...patch } }));
  }

  function descartarRascunho(code) {
    setDrafts((atual) => {
      const proximo = { ...atual };
      delete proximo[code];
      return proximo;
    });
  }

  function abrirNovo() {
    setFeedback({ error: "", success: "" });
    setDrafts((atual) => ({ ...atual, [NOVO]: atual[NOVO] ?? rascunhoVazio() }));
    setActiveCode(NOVO);
  }

  // --- Features ------------------------------------------------------------

  // A lista é sempre reconstruída na ORDEM DO CATÁLOGO: assim o rascunho de um
  // plano sem alteração real continua idêntico ao que veio do servidor e a
  // marca "não salvo" não aparece só porque as caixinhas foram clicadas fora de
  // ordem.
  function definirFeatures(marcadas) {
    const conjunto = new Set(marcadas);
    editarRascunho({ features: asArray(featureCatalog).filter((item) => conjunto.has(item.key)).map((item) => item.key) });
  }

  function alternarFeature(key, marcado) {
    const atuais = new Set(asArray(draft?.features));
    if (marcado) atuais.add(key);
    else atuais.delete(key);
    definirFeatures(atuais);
  }

  function alternarGrupo(itens, marcado) {
    const atuais = new Set(asArray(draft?.features));
    for (const item of itens) {
      if (marcado) atuais.add(item.key);
      else atuais.delete(item.key);
    }
    definirFeatures(atuais);
  }

  // Campo vazio some do rascunho (em vez de virar ""), senão digitar e apagar
  // deixaria o plano marcado como "não salvo" sem nenhuma diferença real.
  function definirLimite(key, valor) {
    const limits = { ...asObject(draft?.limits) };
    if (String(valor).trim() === "") delete limits[key];
    else limits[key] = valor;
    editarRascunho({ limits });
  }

  // --- Salvar --------------------------------------------------------------

  function montarCorpo() {
    const nome = String(draft.name || "").trim();
    if (!nome) return { erro: "Informe o nome do plano." };

    const { centavos, erro } = reaisParaCentavos(draft.price);
    if (erro) return { erro };

    const dias = Number(String(draft.trial_days).trim());
    if (!Number.isInteger(dias) || dias < 0 || dias > MAX_TRIAL_DAYS) {
      return { erro: `O teste grátis deve ser um número inteiro de 0 a ${MAX_TRIAL_DAYS} dias.` };
    }

    // Todas as cotas do catálogo entram no corpo, inclusive as vazias: o backend
    // descarta "" e grava o resto, então apagar um campo realmente devolve a
    // cota para "ilimitado" em vez de manter o número antigo.
    const limits = {};
    for (const item of asArray(limitCatalog)) {
      const valor = String(asObject(draft.limits)[item.key] ?? "").trim();
      if (!valor) {
        limits[item.key] = "";
        continue;
      }
      const numero = Number(valor);
      if (!Number.isInteger(numero) || numero < 0) {
        return { erro: `O limite "${item.label}" deve ser um número inteiro maior ou igual a zero, ou ficar vazio para ilimitado.` };
      }
      limits[item.key] = numero;
    }

    const corpo = {
      name: nome,
      price_cents: centavos,
      audience: String(draft.audience || "").trim(),
      description: String(draft.description || "").trim(),
      trial_days: dias,
      badge: String(draft.badge || "").trim(),
      is_recommended: Boolean(draft.is_recommended),
      features: asArray(draft.features),
      limits,
    };
    if (criando) corpo.code = String(draft.code || "").trim().toLowerCase();
    return { corpo };
  }

  async function salvar({ confirmarPreco = false } = {}) {
    if (!draft) return;
    const { corpo, erro } = montarCorpo();
    if (erro) {
      setFeedback({ error: erro, success: "" });
      return;
    }
    if (confirmarPreco) corpo.confirm_price_change = true;

    const codigoEditado = activeCode;
    setSalvando(true);
    setFeedback({ error: "", success: "" });
    try {
      const payload = criando
        ? await request("/platform/plans", { method: "POST", body: JSON.stringify(corpo) })
        : await request(`/platform/plans/${codigoEditado}`, { method: "PUT", body: JSON.stringify(corpo) });

      const salvo = asObject(payload?.plan);
      setConfirmandoPreco(null);
      descartarRascunho(codigoEditado);
      setActiveCode(salvo.code || codigoEditado);
      // O relatório do gateway fica na tela até ser dispensado: com falhas, cada
      // linha é uma clínica ainda cobrada no valor antigo.
      if (payload?.propagacao) setPropagacao({ plano: salvo, relatorio: asObject(payload.propagacao) });
      await carregar();
      setFeedback({
        error: "",
        success: criando
          ? `Plano "${salvo.name}" criado. Ele já aparece na vitrine e no cadastro de novas clínicas.`
          : `Plano "${salvo.name}" salvo.`,
      });
    } catch (error) {
      // O backend recusou a mudança de preço até haver confirmação explícita, e
      // mandou os números junto — o diálogo monta sem uma segunda requisição.
      if (error.code === "confirmacao_de_preco_necessaria") {
        setConfirmandoPreco({ mensagem: error.message, ...error.detalhes });
        return;
      }
      // Feature que o servidor não conhece = o catálogo desta tela está velho
      // (o backend mudou depois que a aba abriu). Recarregar é a correção, e as
      // caixinhas precisam refletir o catálogo de verdade antes da nova
      // tentativa — o rascunho continua intacto.
      if (error.code === "feature_desconhecida") {
        await carregar().catch(() => {});
        setFeedback({
          error: `${error.message} A lista de recursos foi recarregada do servidor — confira as marcações e salve de novo.`,
          success: "",
        });
        return;
      }
      setFeedback({ error: error.message, success: "" });
    } finally {
      setSalvando(false);
    }
  }

  // --- Ordem ---------------------------------------------------------------

  async function aplicarOrdem(proximaLista) {
    const anterior = planList;
    setPlans(proximaLista);
    setFeedback({ error: "", success: "" });
    try {
      const payload = await request("/platform/plans/order", {
        method: "PATCH",
        body: JSON.stringify({ codes: proximaLista.map((item) => item.code) }),
      });
      setPlans(asArray(payload?.plans));
      setAlertas(asArray(payload?.alertas));
      setFeedback({ error: "", success: "Ordem dos planos atualizada. É esta a ordem da vitrine pública." });
    } catch (error) {
      // Reverte: a lista precisa refletir o banco, senão o super-admin acha que
      // reordenou e a página de preços mostra outra coisa.
      setPlans(anterior);
      // "Faltaram planos na ordem" ou "plano não encontrado" só acontece quando
      // esta lista está velha (outro plano foi criado ou excluído em outra
      // aba/sessão). Buscar de novo é o que devolve a tela ao estado real.
      if (error.code === "ordem_incompleta" || error.code === "plano_inexistente") {
        await carregar().catch(() => {});
      }
      setFeedback({ error: error.message, success: "" });
    }
  }

  function moverPlano(index, direcao) {
    const proxima = moveInList(planList, index, direcao);
    if (proxima === planList) return;
    aplicarOrdem(proxima);
  }

  // Arrastar é COMPLEMENTO das setas ↑/↓, nunca o único caminho: arrastar não
  // funciona por teclado e é impreciso no toque.
  function soltarSobre(codeAlvo) {
    const de = planList.findIndex((item) => item.code === dragCode);
    const para = planList.findIndex((item) => item.code === codeAlvo);
    setDragCode("");
    if (de < 0 || para < 0 || de === para) return;
    aplicarOrdem(moveInList(planList, de, para - de));
  }

  // --- Ativar / desativar / excluir ----------------------------------------

  async function buscarUso(code) {
    setCarregandoUso(code);
    try {
      return asObject(await request(`/platform/plans/${code}/usage`));
    } finally {
      setCarregandoUso("");
    }
  }

  async function alternarAtivo(plano) {
    setFeedback({ error: "", success: "" });
    try {
      // Ativar não afeta ninguém; desativar tira o plano da vitrine e do
      // cadastro, então antes de perguntar já mostramos quantas clínicas usam.
      if (plano.is_active) {
        setDesativando({ plano, uso: await buscarUso(plano.code) });
        return;
      }
      await request(`/platform/plans/${plano.code}/active`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: true }),
      });
      await carregar();
      setFeedback({ error: "", success: `Plano "${plano.name}" ativado.` });
    } catch (error) {
      setFeedback({ error: error.message, success: "" });
    }
  }

  async function desativar(plano) {
    try {
      await request(`/platform/plans/${plano.code}/active`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: false }),
      });
      setDesativando(null);
      setEmUso(null);
      await carregar();
      setFeedback({
        error: "",
        success: `Plano "${plano.name}" desativado. Quem já assina continua funcionando normalmente.`,
      });
    } catch (error) {
      setDesativando(null);
      setEmUso(null);
      setFeedback({ error: error.message, success: "" });
    }
  }

  async function abrirExclusao(plano) {
    setFeedback({ error: "", success: "" });
    try {
      const uso = await buscarUso(plano.code);
      // Perguntar ao /usage ANTES é a diferença entre oferecer a saída certa e
      // levar um 409 depois de o super-admin já ter digitado a confirmação.
      if (!uso.pode_excluir) setEmUso({ plano, uso });
      else setExcluindo({ plano, uso });
    } catch (error) {
      setFeedback({ error: error.message, success: "" });
    }
  }

  async function excluir(plano) {
    try {
      await request(`/platform/plans/${plano.code}`, { method: "DELETE" });
      setExcluindo(null);
      descartarRascunho(plano.code);
      if (activeCode === plano.code) setActiveCode("");
      await carregar();
      setFeedback({ error: "", success: `Plano "${plano.name}" excluído.` });
    } catch (error) {
      setExcluindo(null);
      // Corrida: alguém assinou o plano entre o /usage e o DELETE.
      if (error.code === "plano_com_assinantes") {
        setEmUso({
          plano,
          uso: { total: error.detalhes.subscribers ?? 0, clinicas: asArray(error.detalhes.clinicas) },
          mensagem: error.message,
        });
        return;
      }
      setFeedback({ error: error.message, success: "" });
    }
  }

  if (plans === null && !loadError) return <Loading />;
  if (loadError) return <ApiError message={loadError} />;

  const marcadas = new Set(asArray(draft?.features));
  const precoPrevisto = draft ? reaisParaCentavos(draft.price) : null;

  return (
    <div className="pa-root">
      <div className="panel pa-intro">
        <div>
          <h2>Planos da plataforma</h2>
          <p>
            Esta é a grade de preços que aparece na vitrine pública e no cadastro de novas clínicas. O que estiver
            marcado aqui libera (ou bloqueia) telas dentro do sistema de cada clínica.
          </p>
        </div>
      </div>

      {alertas.length > 0 && (
        <AlertBlock icon={AlertTriangle} title="Confira estes pontos" empty="Nenhum alerta.">
          {alertas.map((alerta) => (
            <p className="pa-alerta" key={alerta}>
              {alerta}
            </p>
          ))}
        </AlertBlock>
      )}

      {propagacao && <RelatorioPropagacao dados={propagacao} onDispensar={() => setPropagacao(null)} />}

      {dirtyCodes.length > 0 && (
        <p className="pa-unsaved-banner" role="status">
          Você tem alterações não salvas em: {dirtyCodes.map(nomeDoPlano).join(", ")}. Elas ficam guardadas enquanto você
          navega entre os planos, mas só valem depois de salvar.
        </p>
      )}

      {feedback.error && <span className="form-error">{feedback.error}</span>}
      {feedback.success && <span className="form-success">{feedback.success}</span>}

      <div className="pa-columns">
        <section className="panel pa-list-panel">
          <CrudHeader
            title="Planos"
            subtitle="A ordem aqui é a ordem da vitrine pública."
            actionLabel="Novo plano"
            onAction={abrirNovo}
          />

          {drafts[NOVO] && (
            <button
              type="button"
              className={`pa-new-row${activeCode === NOVO ? " is-active" : ""}`}
              onClick={() => setActiveCode(NOVO)}
            >
              <Plus size={16} aria-hidden="true" />
              <span>{nomeDoPlano(NOVO)}</span>
              {dirtyCodes.includes(NOVO) && <StatusBadge tone="warn">Não salvo</StatusBadge>}
            </button>
          )}

          <ul className="pa-list">
            {planList.map((plano, index) => (
              <li
                key={plano.code}
                className={`pa-item${activeCode === plano.code ? " is-active" : ""}${plano.is_active ? "" : " is-off"}`}
                draggable
                onDragStart={() => setDragCode(plano.code)}
                onDragEnd={() => setDragCode("")}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => soltarSobre(plano.code)}
              >
                <div className="pa-item-head">
                  <span className="pa-item-position" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="pa-item-title">
                    <strong>{plano.name}</strong>
                    <span>
                      <code>{plano.code}</code> · {formatarPreco(plano.price_cents)}
                    </span>
                    <span>
                      {plural(plano.subscribers ?? 0, "assinante", "assinantes")} ·{" "}
                      {plural(asArray(plano.features).length, "recurso", "recursos")}
                    </span>
                  </div>
                  <div className="pa-item-badges">
                    <StatusBadge tone={plano.is_active ? "ok" : "neutral"}>
                      {plano.is_active ? "Ativo" : "Inativo"}
                    </StatusBadge>
                    {plano.is_recommended && <StatusBadge tone="info">Recomendado</StatusBadge>}
                    {dirtyCodes.includes(plano.code) && <StatusBadge tone="warn">Não salvo</StatusBadge>}
                  </div>
                </div>

                <div className="pa-item-actions">
                  <div className="pa-move">
                    <button
                      type="button"
                      className="icon-button"
                      disabled={index === 0}
                      aria-label={`Mover o plano "${plano.name}" para cima`}
                      onClick={() => moverPlano(index, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={index === planList.length - 1}
                      aria-label={`Mover o plano "${plano.name}" para baixo`}
                      onClick={() => moverPlano(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                  <div className="pa-item-buttons">
                    <Button variant="ghost" disabled={carregandoUso === plano.code} onClick={() => alternarAtivo(plano)}>
                      {plano.is_active ? "Desativar" : "Ativar"}
                    </Button>
                    <Button variant="ghost" disabled={carregandoUso === plano.code} onClick={() => abrirExclusao(plano)}>
                      Excluir
                    </Button>
                    <Button
                      variant={activeCode === plano.code ? "primary" : "secondary"}
                      onClick={() => setActiveCode(plano.code)}
                    >
                      Editar
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {!planList.length && <p className="pa-placeholder">Nenhum plano cadastrado ainda.</p>}
        </section>

        <section className="panel pa-editor-panel">
          {!draft ? (
            <p className="pa-placeholder">Escolha um plano na lista para editar, ou crie um novo.</p>
          ) : (
            <>
              <div className="panel-heading">
                <div>
                  <h2>{criando ? "Novo plano" : planoAtivo?.name}</h2>
                  <span>
                    {criando
                      ? "O plano nasce ativo e entra no fim da vitrine."
                      : `${plural(planoAtivo?.subscribers ?? 0, "clínica assina", "clínicas assinam")} este plano.`}
                  </span>
                </div>
                <div className="pa-editor-actions">
                  <Button
                    variant="secondary"
                    disabled={!activeDirty}
                    onClick={() => setDescartando(activeCode)}
                  >
                    Descartar
                  </Button>
                  <Button disabled={!activeDirty || salvando} onClick={() => salvar()}>
                    {salvando ? "Salvando…" : criando ? "Criar plano" : "Salvar plano"}
                  </Button>
                </div>
              </div>

              {activeDirty && (
                <p className="pa-unsaved-inline" role="status">
                  Alterações não salvas neste plano.
                </p>
              )}

              <div className="stack pa-form">
                <div className="form-grid">
                  <Input label="Nome do plano" value={draft.name} onChange={(value) => editarRascunho({ name: value })} />
                  {criando ? (
                    <Input
                      label="Código"
                      value={draft.code}
                      onChange={(value) => editarRascunho({ code: value.toLowerCase() })}
                    />
                  ) : (
                    <div className="pa-code-lock">
                      <span className="pa-code-label">Código</span>
                      <code>{draft.code}</code>
                    </div>
                  )}
                </div>
                <p className="pa-hint">
                  {criando
                    ? 'De 2 a 30 caracteres, começando por letra minúscula: letras, números, "-" e "_" (ex.: "studio_plus"). ' +
                      "O código NÃO poderá ser alterado depois: as assinaturas das clínicas passam a apontar para ele."
                    : "O código não muda depois de criado — as assinaturas das clínicas apontam para ele. " +
                      "Para trocar, crie um plano novo e migre as clínicas."}
                </p>

                <div className="form-grid">
                  <Input label="Preço mensal (R$)" value={draft.price} onChange={(value) => editarRascunho({ price: value })} />
                  <Input
                    type="number"
                    label="Dias de teste grátis"
                    value={draft.trial_days}
                    onChange={(value) => editarRascunho({ trial_days: value })}
                  />
                </div>
                <p className={`pa-hint${precoPrevisto?.erro ? " is-error" : ""}`}>
                  {precoPrevisto?.erro
                    ? precoPrevisto.erro
                    : `Será cobrado ${formatarPreco(precoPrevisto?.centavos)} por mês de cada clínica. ` +
                      "Digite em reais, com vírgula nos centavos."}
                </p>

                <div className="form-grid">
                  <Input
                    label="Público-alvo"
                    value={draft.audience}
                    onChange={(value) => editarRascunho({ audience: value })}
                  />
                  <Input label="Selo" value={draft.badge} onChange={(value) => editarRascunho({ badge: value })} />
                </div>
                <p className="pa-hint">
                  O público-alvo é a linha curta abaixo do nome na vitrine (ex.: "Para quem atende sozinho"). O selo é a
                  etiqueta no canto do card (ex.: "Mais vendido").
                </p>

                <Textarea
                  label="Descrição"
                  value={draft.description}
                  rows={4}
                  onChange={(value) => editarRascunho({ description: value })}
                />

                <Checkbox
                  label="Destacar como recomendado na vitrine"
                  checked={Boolean(draft.is_recommended)}
                  onChange={(value) => editarRascunho({ is_recommended: value })}
                />

                <section className="pa-block">
                  <div className="pa-block-head">
                    <h3>Recursos liberados</h3>
                    <span>
                      {marcadas.size} de {asArray(featureCatalog).length} marcados
                    </span>
                  </div>
                  <p className="pa-hint">
                    Cada caixinha libera uma tela dentro do sistema da clínica. Desmarcar um recurso de um plano que já
                    tem assinantes tira o acesso delas na próxima carga da tela.
                  </p>
                  <div className="pa-groups">
                    {grupos.map((grupo) => {
                      const total = grupo.itens.length;
                      const marcadasNoGrupo = grupo.itens.filter((item) => marcadas.has(item.key)).length;
                      return (
                        <fieldset className="pa-group" key={grupo.nome}>
                          <legend>
                            {grupo.nome} <span>({marcadasNoGrupo}/{total})</span>
                          </legend>
                          <Checkbox
                            label={marcadasNoGrupo === total ? "Desmarcar o grupo inteiro" : "Marcar o grupo inteiro"}
                            checked={marcadasNoGrupo === total}
                            onChange={(value) => alternarGrupo(grupo.itens, value)}
                          />
                          <div className="pa-group-items">
                            {grupo.itens.map((item) => (
                              <Checkbox
                                key={item.key}
                                label={item.label}
                                checked={marcadas.has(item.key)}
                                onChange={(value) => alternarFeature(item.key, value)}
                              />
                            ))}
                          </div>
                        </fieldset>
                      );
                    })}
                  </div>
                </section>

                <section className="pa-block">
                  <div className="pa-block-head">
                    <h3>Limites do plano</h3>
                  </div>
                  <p className="pa-hint pa-hint-strong">
                    Campo VAZIO = ILIMITADO. Zero não libera: zero bloqueia a cota por completo.
                  </p>
                  <div className="pa-limits">
                    {asArray(limitCatalog).map((item) => {
                      const valor = String(asObject(draft.limits)[item.key] ?? "");
                      return (
                        <div className="pa-limit" key={item.key}>
                          <Input
                            type="number"
                            label={`${item.label} (${item.unit})`}
                            value={valor}
                            onChange={(value) => definirLimite(item.key, value)}
                          />
                          <p className="pa-hint">
                            {item.hint} {valor === "" ? "Hoje: ilimitado." : `Hoje: ${valor} ${item.unit}.`}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            </>
          )}
        </section>
      </div>

      <Modal
        open={Boolean(descartando)}
        title="Descartar alterações"
        size="sm"
        onClose={() => setDescartando("")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDescartando("")}>
              Continuar editando
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                descartarRascunho(descartando);
                if (descartando === NOVO) setActiveCode("");
                setDescartando("");
              }}
            >
              Descartar
            </Button>
          </>
        }
      >
        <p>
          As alterações não salvas de "{nomeDoPlano(descartando)}" serão perdidas e o plano volta ao que está gravado.
        </p>
      </Modal>

      <Modal
        open={Boolean(confirmandoPreco)}
        title="Confirmar reajuste de preço"
        size="sm"
        onClose={() => setConfirmandoPreco(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmandoPreco(null)}>
              Cancelar
            </Button>
            <Button variant="danger" disabled={salvando} onClick={() => salvar({ confirmarPreco: true })}>
              {salvando ? "Aplicando…" : "Confirmar e recobrar"}
            </Button>
          </>
        }
      >
        <p>{confirmandoPreco?.mensagem}</p>
        <div className="pa-price-diff">
          <div>
            <span>Preço atual</span>
            <strong>{formatarPreco(confirmandoPreco?.price_cents_atual)}</strong>
          </div>
          <div>
            <span>Preço novo</span>
            <strong>{formatarPreco(confirmandoPreco?.price_cents_novo)}</strong>
          </div>
        </div>
        <p>
          {plural(confirmandoPreco?.subscribers ?? 0, "clínica usa", "clínicas usam")} este plano, e{" "}
          {plural(confirmandoPreco?.cobrando ?? 0, "assinatura ativa será recobrada", "assinaturas ativas serão recobradas")}{" "}
          no valor novo, inclusive as cobranças já geradas e ainda não pagas.
        </p>
      </Modal>

      <Modal
        open={Boolean(desativando)}
        title="Desativar plano"
        size="sm"
        onClose={() => setDesativando(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDesativando(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => desativar(desativando.plano)}>
              Desativar plano
            </Button>
          </>
        }
      >
        <p>
          O plano "{desativando?.plano?.name}" some da vitrine e do cadastro de novas clínicas. Quem já assina continua
          funcionando normalmente, com os mesmos recursos e o mesmo preço.
        </p>
        <ListaDeClinicas uso={desativando?.uso} />
      </Modal>

      <Modal
        open={Boolean(emUso)}
        title="Plano em uso"
        size="sm"
        onClose={() => setEmUso(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEmUso(null)}>
              Fechar
            </Button>
            <Button variant="danger" onClick={() => desativar(emUso.plano)}>
              Desativar em vez de excluir
            </Button>
          </>
        }
      >
        <p>
          {emUso?.mensagem ||
            `Não dá para excluir o plano "${emUso?.plano?.name}": ${plural(
              emUso?.uso?.total ?? 0,
              "clínica usa",
              "clínicas usam",
            )} ele hoje.`}
        </p>
        <p>
          Desative o plano: ele sai da vitrine e do cadastro de novas clínicas, e quem já assina continua funcionando
          normalmente.
        </p>
        <ListaDeClinicas uso={emUso?.uso} />
      </Modal>

      <ConfirmDeleteModal
        open={Boolean(excluindo)}
        title="Excluir plano"
        message={
          excluindo
            ? `Excluir o plano "${excluindo.plano.name}" (${formatarPreco(excluindo.plano.price_cents)})? ` +
              "Nenhuma clínica usa este plano hoje, e a exclusão não pode ser desfeita."
            : ""
        }
        confirmWord={excluindo?.plano?.code}
        onClose={() => setExcluindo(null)}
        onConfirm={() => excluir(excluindo.plano)}
      />
    </div>
  );
}

// --- Blocos auxiliares -------------------------------------------------------

// Amostra de quem seria afetado. O backend já limita a 50 nomes; aqui mostramos
// menos ainda, porque a pergunta na tela é "quantas e quais são as principais",
// não "liste todas".
function ListaDeClinicas({ uso }) {
  const clinicas = asArray(uso?.clinicas);
  if (!clinicas.length) return null;
  const amostra = clinicas.slice(0, 8);
  return (
    <div className="pa-usage">
      <strong>{plural(uso?.total ?? clinicas.length, "clínica afetada", "clínicas afetadas")}</strong>
      <ul>
        {amostra.map((clinica) => (
          <li key={clinica.id ?? clinica.slug}>
            {clinica.name} <span>({clinica.subscription_status || "sem assinatura"})</span>
          </li>
        ))}
      </ul>
      {clinicas.length > amostra.length && <span>e mais {clinicas.length - amostra.length}…</span>}
    </div>
  );
}

/**
 * Resultado da propagação do preço novo para o gateway.
 *
 * Fica na tela até ser dispensado à mão, e não vira "toast": cada falha é uma
 * clínica que continua sendo cobrada no valor ANTIGO até alguém agir. Um aviso
 * que some sozinho depois de 4 segundos é um aviso que ninguém leu.
 */
function RelatorioPropagacao({ dados, onDispensar }) {
  const relatorio = asObject(dados?.relatorio);
  const falhas = Number(relatorio.falhas || 0);
  const erros = asArray(relatorio.erros);
  return (
    <div className={`pa-propagacao${falhas ? " is-falha" : ""}`} role={falhas ? "alert" : "status"}>
      <div className="pa-propagacao-head">
        <strong>
          {falhas
            ? `Atenção: ${plural(falhas, "assinatura NÃO recebeu", "assinaturas NÃO receberam")} o preço novo`
            : "Preço propagado para as assinaturas"}
        </strong>
        <Button variant="ghost" onClick={onDispensar}>
          {falhas ? "Já anotei, dispensar" : "Dispensar"}
        </Button>
      </div>
      <p>
        Plano "{dados?.plano?.name}": {relatorio.atualizadas || 0} de {relatorio.total || 0} assinatura(s) atualizadas no
        gateway
        {falhas ? `, ${falhas} com falha` : ""}
        {relatorio.ignoradas ? `, ${relatorio.ignoradas} ignorada(s)` : ""}.
      </p>
      {relatorio.motivo === "gateway_indisponivel" && (
        <p>
          O gateway de pagamento não está configurado neste ambiente, então nenhuma assinatura foi alterada lá: elas
          seguem com o valor antigo no Asaas.
        </p>
      )}
      {erros.length > 0 && (
        <ul>
          {erros.map((erro) => (
            <li key={erro.asaas_subscription_id || erro.tenant_id}>
              <strong>{erro.tenant_name}</strong> — continua no valor antigo. {erro.erro}
            </li>
          ))}
        </ul>
      )}
      {falhas > 0 && <p>Corrija a assinatura no gateway ou salve o plano de novo para tentar propagar outra vez.</p>}
    </div>
  );
}
