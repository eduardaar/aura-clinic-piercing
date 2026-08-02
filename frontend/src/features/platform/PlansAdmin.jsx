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
//
// A ESTRUTURA segue o padrão do painel: a lista é um <DataView> (busca,
// ordenação, paginação e os estados de carregando/erro/vazio vêm dele) e o
// formulário é um <Modal>. A tela antiga desenhava uma lista à mão em duas
// colunas com editor embutido, e por isso guardava um MAPA de rascunhos por
// plano; com o modal só existe uma edição por vez, então sobrou um rascunho só.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import { AlertBlock, Button, Checkbox, Input, StatusBadge, Textarea } from "../../components/common/Ui";
import { ConfirmDeleteModal, CrudHeader, Modal } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { API } from "../../lib/api";
import { asArray, asObject } from "../../lib/utils";
import "../../styles/plans-admin.css";

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
// Rascunho
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

  // Uma edição por vez: `editando` guarda o código alvo ("" = criando) e a FOTO
  // de como o plano estava ao abrir o modal — é contra essa foto que se decide
  // se há alteração pendente, e não contra a lista, que muda sozinha a cada
  // recarga.
  const [editando, setEditando] = useState(null);
  const [draft, setDraft] = useState(null);
  const [formErro, setFormErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);

  const [feedback, setFeedback] = useState({ error: "", success: "" });
  const [confirmandoPreco, setConfirmandoPreco] = useState(null);
  const [propagacao, setPropagacao] = useState(null);
  const [desativando, setDesativando] = useState(null);
  const [excluindo, setExcluindo] = useState(null);
  const [emUso, setEmUso] = useState(null);
  const [ocupado, setOcupado] = useState("");

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
  const criando = editando?.code === "";

  const sujo = useMemo(
    () => Boolean(editando) && JSON.stringify(draft) !== JSON.stringify(editando.base),
    [draft, editando],
  );

  // Fechar a aba com edição pendente perde trabalho sem aviso: o navegador só
  // pergunta se houver um handler registrado.
  useEffect(() => {
    if (!sujo) return undefined;
    const avisar = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo]);

  // A posição é calculada aqui e vira campo da linha para o DataView poder
  // ORDENAR por ela: é a ordem da vitrine pública, e é a ordenação inicial.
  const linhas = useMemo(
    () => asArray(plans).map((plano, index) => ({ ...plano, posicao: index + 1 })),
    [plans],
  );

  const grupos = useMemo(() => {
    const mapa = new Map();
    for (const item of asArray(featureCatalog)) {
      const grupo = item.group || "Outros";
      if (!mapa.has(grupo)) mapa.set(grupo, []);
      mapa.get(grupo).push(item);
    }
    return [...mapa.entries()].map(([nome, itens]) => ({ nome, itens }));
  }, [featureCatalog]);

  // --- Abrir e fechar o formulário -----------------------------------------

  function abrirFormulario(plano) {
    const base = plano ? planoParaRascunho(plano) : rascunhoVazio();
    setEditando({ code: plano ? plano.code : "", base, subscribers: plano?.subscribers ?? 0 });
    setDraft(base);
    setFormErro("");
    setConfirmandoDescarte(false);
  }

  // Esc, clique fora e "Cancelar" passam por aqui: fechar com alteração
  // pendente joga trabalho fora em silêncio, então antes vem a pergunta.
  function fecharFormulario({ forcar = false } = {}) {
    if (!forcar && sujo) {
      setConfirmandoDescarte(true);
      return;
    }
    setConfirmandoDescarte(false);
    setEditando(null);
    setDraft(null);
    setFormErro("");
    setConfirmandoPreco(null);
  }

  function editarRascunho(patch) {
    setDraft((atual) => ({ ...atual, ...patch }));
  }

  // --- Features ------------------------------------------------------------

  // A lista é sempre reconstruída na ORDEM DO CATÁLOGO: assim o rascunho de um
  // plano sem alteração real continua idêntico ao que veio do servidor e o botão
  // "salvar" não acende só porque as caixinhas foram clicadas fora de ordem.
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
  // deixaria o formulário marcado como alterado sem nenhuma diferença real.
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
      setFormErro(erro);
      return;
    }
    if (confirmarPreco) corpo.confirm_price_change = true;

    const codigoEditado = editando.code;
    setSalvando(true);
    setFormErro("");
    try {
      const payload = criando
        ? await request("/platform/plans", { method: "POST", body: JSON.stringify(corpo) })
        : await request(`/platform/plans/${codigoEditado}`, { method: "PUT", body: JSON.stringify(corpo) });

      const salvo = asObject(payload?.plan);
      // O relatório do gateway fica na tela até ser dispensado: com falhas, cada
      // linha é uma clínica ainda cobrada no valor antigo.
      if (payload?.propagacao) setPropagacao({ plano: salvo, relatorio: asObject(payload.propagacao) });
      fecharFormulario({ forcar: true });
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
      // tentativa — o rascunho continua intacto, o modal continua aberto.
      if (error.code === "feature_desconhecida") {
        await carregar().catch(() => {});
        setFormErro(`${error.message} A lista de recursos foi recarregada do servidor — confira as marcações e salve de novo.`);
        return;
      }
      setFormErro(error.message);
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

  // A seta trabalha sobre a ORDEM REAL da vitrine, não sobre a ordem visível na
  // tabela: ordenar a coluna "Preço" no DataView é um jeito de LER a lista, e
  // não pode virar um jeito de reordenar a vitrine sem querer.
  function moverPlano(plano, direcao) {
    const index = planList.findIndex((item) => item.code === plano.code);
    const proxima = moveInList(planList, index, direcao);
    if (proxima === planList) return;
    aplicarOrdem(proxima);
  }

  // --- Ativar / desativar / excluir ----------------------------------------

  async function buscarUso(code) {
    setOcupado(code);
    try {
      return asObject(await request(`/platform/plans/${code}/usage`));
    } finally {
      setOcupado("");
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

  const marcadas = new Set(asArray(draft?.features));
  const precoPrevisto = draft ? reaisParaCentavos(draft.price) : null;

  return (
    <div className="stack">
      {propagacao && <RelatorioPropagacao dados={propagacao} onDispensar={() => setPropagacao(null)} />}

      {alertas.length > 0 && (
        <AlertBlock icon={AlertTriangle} title="Confira estes pontos" empty="Nenhum alerta.">
          {alertas.map((alerta) => (
            <p className="field-hint" key={alerta}>
              {alerta}
            </p>
          ))}
        </AlertBlock>
      )}

      {feedback.error && <span className="form-error">{feedback.error}</span>}
      {feedback.success && <span className="form-success">{feedback.success}</span>}

      <section className="panel">
        <CrudHeader
          title="Planos da plataforma"
          subtitle="Esta é a grade de preços da vitrine pública e do cadastro de novas clínicas — na ordem em que as setas ↑↓ deixarem."
          actionLabel="Novo plano"
          onAction={() => abrirFormulario(null)}
        />

        <DataView
          rows={linhas}
          rowKey={(plano) => plano.code}
          loading={plans === null && !loadError}
          error={loadError}
          defaultSort={{ key: "posicao", dir: "asc" }}
          searchPlaceholder="Buscar por nome ou código"
          caption="Planos vendidos pela plataforma"
          filters={[
            {
              key: "status",
              label: "Status",
              type: "select",
              options: [
                { value: "ativo", label: "Ativo" },
                { value: "inativo", label: "Inativo" },
              ],
              match: (plano, valor) => (plano.is_active ? "ativo" : "inativo") === valor,
            },
          ]}
          columns={[
            { key: "posicao", label: "Ordem", align: "right", searchable: false, value: (p) => p.posicao },
            {
              key: "name",
              label: "Nome",
              value: (p) => p.name || "",
              render: (p) => (
                <>
                  {p.name || "—"} {p.is_recommended && <StatusBadge tone="info">Recomendado</StatusBadge>}
                </>
              ),
            },
            {
              key: "code",
              label: "Código",
              value: (p) => p.code || "",
              render: (p) => <code>{p.code}</code>,
            },
            {
              key: "price_cents",
              label: "Preço",
              align: "right",
              searchable: false,
              // Ordena pelos CENTAVOS: "R$ 1.499,90" ordenado como texto ficaria
              // antes de "R$ 9,90".
              value: (p) => Number(p.price_cents || 0),
              render: (p) => formatarPreco(p.price_cents),
            },
            {
              key: "features",
              label: "Recursos",
              align: "right",
              searchable: false,
              value: (p) => asArray(p.features).length,
              render: (p) => asArray(p.features).length,
            },
            {
              key: "subscribers",
              label: "Assinantes",
              align: "right",
              searchable: false,
              value: (p) => Number(p.subscribers || 0),
              render: (p) => Number(p.subscribers || 0),
            },
            {
              key: "is_active",
              label: "Status",
              value: (p) => (p.is_active ? "Ativo" : "Inativo"),
              render: (p) => (
                <StatusBadge tone={p.is_active ? "ok" : "neutral"}>{p.is_active ? "Ativo" : "Inativo"}</StatusBadge>
              ),
            },
          ]}
          actions={(plano) => (
            <>
              <button type="button" onClick={() => abrirFormulario(plano)}>
                Editar
              </button>
              <button
                type="button"
                disabled={ocupado === plano.code}
                onClick={() => alternarAtivo(plano)}
              >
                {plano.is_active ? "Desativar" : "Ativar"}
              </button>
              <button
                type="button"
                disabled={ocupado === plano.code}
                onClick={() => abrirExclusao(plano)}
              >
                Excluir
              </button>
              <button
                type="button"
                disabled={plano.posicao === 1}
                aria-label={`Mover o plano "${plano.name}" para cima na vitrine`}
                onClick={() => moverPlano(plano, -1)}
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                disabled={plano.posicao === planList.length}
                aria-label={`Mover o plano "${plano.name}" para baixo na vitrine`}
                onClick={() => moverPlano(plano, 1)}
              >
                <ArrowDown size={15} />
              </button>
            </>
          )}
          empty="Nenhum plano cadastrado ainda."
          emptyFiltered="Nenhum plano corresponde à busca ou ao filtro."
        />
      </section>

      {/* Formulário do plano. Uma edição por vez — daí não haver mais mapa de
          rascunhos —, e fechar com alteração pendente passa pela confirmação de
          descarte logo abaixo. */}
      <Modal
        open={Boolean(editando)}
        size="lg"
        title={criando ? "Novo plano" : `Editar "${editando?.base?.name || editando?.code}"`}
        subtitle={
          criando
            ? "O plano nasce ativo e entra no fim da vitrine."
            : `Código ${editando?.code} · ${plural(editando?.subscribers ?? 0, "clínica assina", "clínicas assinam")} este plano.`
        }
        onClose={() => fecharFormulario()}
        footer={
          <>
            <Button variant="secondary" onClick={() => fecharFormulario()}>
              Cancelar
            </Button>
            <Button disabled={!sujo || salvando} onClick={() => salvar()}>
              {salvando ? "Salvando…" : criando ? "Criar plano" : "Salvar plano"}
            </Button>
          </>
        }
      >
        {draft && (
          <>
            {formErro && <span className="form-error">{formErro}</span>}

            <div className="form-grid">
              <Input label="Nome do plano" value={draft.name} onChange={(value) => editarRascunho({ name: value })} />
              {criando && (
                <Input
                  label="Código"
                  value={draft.code}
                  onChange={(value) => editarRascunho({ code: value.toLowerCase() })}
                />
              )}
            </div>
            <p className="field-hint">
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
            {/* Prévia ao vivo do que será cobrado: é o único lugar onde o
                super-admin confere a conversão reais -> centavos antes de gravar. */}
            <p className={precoPrevisto?.erro ? "form-error" : "field-hint"}>
              {precoPrevisto?.erro
                ? precoPrevisto.erro
                : `Será cobrado ${formatarPreco(precoPrevisto?.centavos)} por mês de cada clínica. ` +
                  "Digite em reais, com vírgula nos centavos."}
            </p>

            <div className="form-grid">
              <Input label="Público-alvo" value={draft.audience} onChange={(value) => editarRascunho({ audience: value })} />
              <Input label="Selo" value={draft.badge} onChange={(value) => editarRascunho({ badge: value })} />
            </div>
            <p className="field-hint">
              O público-alvo é a linha curta abaixo do nome na vitrine (ex.: "Para quem atende sozinho"). O selo é a
              etiqueta no canto do card (ex.: "Mais vendido").
            </p>

            <Textarea
              label="Descrição"
              value={draft.description}
              rows={3}
              onChange={(value) => editarRascunho({ description: value })}
            />

            <Checkbox
              label="Destacar como recomendado na vitrine"
              checked={Boolean(draft.is_recommended)}
              onChange={(value) => editarRascunho({ is_recommended: value })}
            />

            <section className="panel">
              <div className="panel-heading">
                <h3>Recursos liberados</h3>
                <span>
                  {marcadas.size} de {asArray(featureCatalog).length} marcados
                </span>
              </div>
              <div className="stack">
                <p className="field-hint">
                  Cada caixinha libera uma tela dentro do sistema da clínica. Desmarcar um recurso de um plano que já tem
                  assinantes tira o acesso delas na próxima carga da tela.
                </p>
                {/* Com ~35 caixinhas, o agrupamento é o que torna a marcação
                    possível: sem ele vira uma lista única e ninguém confere. */}
                <div className="form-grid">
                  {grupos.map((grupo) => {
                    const total = grupo.itens.length;
                    const marcadasNoGrupo = grupo.itens.filter((item) => marcadas.has(item.key)).length;
                    return (
                      <fieldset className="pa-group" key={grupo.nome}>
                        <legend>
                          {grupo.nome} ({marcadasNoGrupo}/{total})
                        </legend>
                        <Checkbox
                          label={marcadasNoGrupo === total ? "Desmarcar o grupo inteiro" : "Marcar o grupo inteiro"}
                          checked={marcadasNoGrupo === total}
                          onChange={(value) => alternarGrupo(grupo.itens, value)}
                        />
                        {grupo.itens.map((item) => (
                          <Checkbox
                            key={item.key}
                            label={item.label}
                            checked={marcadas.has(item.key)}
                            onChange={(value) => alternarFeature(item.key, value)}
                          />
                        ))}
                      </fieldset>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <h3>Limites do plano</h3>
              </div>
              <div className="stack">
                {/* "Vazio = ilimitado" é a regra que, se ficar subentendida, faz
                    o super-admin digitar 0 achando que libera — e zerar a cota de
                    uma clínica pagante. Por isso vai num bloco de alerta, e não
                    numa linha de texto de apoio. */}
                <AlertBlock icon={AlertTriangle} title="Campo vazio = ilimitado">
                  <p className="field-hint">Zero não libera: zero bloqueia a cota por completo.</p>
                </AlertBlock>
                <div className="form-grid">
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
                        <p className="field-hint">
                          {item.hint} {valor === "" ? "Hoje: ilimitado." : `Hoje: ${valor} ${item.unit}.`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </>
        )}
      </Modal>

      {/* Os diálogos abaixo do formulário no JSX ficam POR CIMA dele na tela:
          `.modal-backdrop` usa o mesmo z-index, então quem vem depois vence. */}

      <Modal
        open={confirmandoDescarte}
        title="Descartar alterações"
        size="sm"
        onClose={() => setConfirmandoDescarte(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmandoDescarte(false)}>
              Continuar editando
            </Button>
            <Button variant="danger" onClick={() => fecharFormulario({ forcar: true })}>
              Descartar
            </Button>
          </>
        }
      >
        <p>
          As alterações não salvas de "{editando?.base?.name || "Novo plano"}" serão perdidas e o plano volta ao que está
          gravado.
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
        <dl className="platform-facts">
          <div className="platform-fact">
            <dt>Preço atual</dt>
            <dd>{formatarPreco(confirmandoPreco?.price_cents_atual)}</dd>
          </div>
          <div className="platform-fact">
            <dt>Preço novo</dt>
            <dd>{formatarPreco(confirmandoPreco?.price_cents_novo)}</dd>
          </div>
        </dl>
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
    <div>
      <strong>{plural(uso?.total ?? clinicas.length, "clínica afetada", "clínicas afetadas")}</strong>
      <ul>
        {amostra.map((clinica) => (
          <li key={clinica.id ?? clinica.slug}>
            {clinica.name} <span className="field-hint">({clinica.subscription_status || "sem assinatura"})</span>
          </li>
        ))}
      </ul>
      {clinicas.length > amostra.length && <p className="field-hint">e mais {clinicas.length - amostra.length}…</p>}
    </div>
  );
}

/**
 * Resultado da propagação do preço novo para o gateway.
 *
 * Fica na tela até ser dispensado à mão, e não vira "toast": cada falha é uma
 * clínica que continua sendo cobrada no valor ANTIGO até alguém agir. Um aviso
 * que some sozinho depois de 4 segundos é um aviso que ninguém leu.
 *
 * Com falhas ele usa a moldura vermelha compartilhada (`.platform-danger`) e
 * gruda no topo (`.platform-sticky-warning`) para continuar visível enquanto a
 * lista rola; sem falhas é um `.panel` comum, porque aí não há nada a corrigir.
 */
function RelatorioPropagacao({ dados, onDispensar }) {
  const relatorio = asObject(dados?.relatorio);
  const falhas = Number(relatorio.falhas || 0);
  const erros = asArray(relatorio.erros);
  const corpo = (
    <>
      <div className="panel-heading">
        <h3>
          {falhas
            ? `Atenção: ${plural(falhas, "assinatura NÃO recebeu", "assinaturas NÃO receberam")} o preço novo`
            : "Preço propagado para as assinaturas"}
        </h3>
        {/* `secondary`, o mesmo do "Já anotei, dispensar" dos avisos de gateway
            na gestão de contas: é literalmente a mesma frase e o mesmo gesto, e
            só um deles pode ser o botão apagado. */}
        <Button variant="secondary" onClick={onDispensar}>
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
    </>
  );

  if (!falhas) {
    return (
      <section className="panel" role="status">
        {corpo}
      </section>
    );
  }
  // As duas classes no MESMO nó, como na gestão de contas. Antes havia um <div>
  // envolvendo a seção só para dar fundo opaco ao aviso grudado — e uma classe
  // `pa-sticky` que nunca chegou a existir no CSS. O fundo opaco já é parte do
  // contrato de `.platform-danger.platform-sticky-warning` (platform-panel.css),
  // então o invólucro só servia para o mesmo aviso ter duas estruturas
  // diferentes em duas abas.
  return (
    <section className="platform-danger platform-sticky-warning" role="alert">
      {corpo}
    </section>
  );
}
