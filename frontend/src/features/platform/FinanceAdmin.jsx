// Financeiro da PLATAFORMA (aba do painel do super-admin).
//
// A tela responde a uma pergunta só: a receita da Monitence está saudável? Ela é
// a ponta visual de backend/src/services/platformFinance.js, e quatro decisões
// atravessam este arquivo inteiro:
//
//  1. PROJEÇÃO E CAIXA NÃO SE MISTURAM. `mrr_estimado` é o preço de tabela das
//     assinaturas ativas — dinheiro que ainda NÃO entrou. `recebido_mes` é
//     fatura paga — dinheiro que entrou. Por isso os números vêm em GRUPOS com
//     título (`.form-section` + `.platform-metrics`), e não numa grade única:
//     grade única convida a somar MRR com recebido, que é a conta errada mais
//     fácil de fazer aqui.
//
//  2. DINHEIRO NÃO PASSA POR PONTO FLUTUANTE. O backend soma em NUMERIC e manda
//     cada valor em dois formatos: `<campo>` (string decimal, ex. "189.80") e
//     `<campo>_centavos` (inteiro). Aqui a string é o que se EXIBE e os centavos
//     são o que se COMPARA (altura de barra, ordenação da tabela). Não existe
//     `Number(valor) + Number(outro)` nesta tela — nem deve passar a existir.
//
//  3. CADA BLOCO CARREGA E FALHA SOZINHO. São cinco chamadas independentes; uma
//     consulta lenta de inadimplência não pode segurar o resumo, e um erro em um
//     bloco não pode apagar os outros quatro. Daí `useRecurso` por bloco, com o
//     próprio "carregando", o próprio erro e o próprio botão de tentar de novo.
//
//  4. NADA DE DESENHO PRÓPRIO. Listagem é `<DataView>`, cartão de número é
//     `.platform-metric`, moldura é `.panel`, filtro é `.toolbar`, erro é
//     `.form-error`. O CSS de finance-admin.css cobre só o gráfico SVG.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Info, RefreshCw } from "lucide-react";
import { AlertBlock, Button, Input, Select, StatusBadge } from "../../components/common/Ui";
import { CrudHeader } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { Loading } from "../../components/common/Feedback";
import { API } from "../../lib/api";
import { asArray, asNumber, asObject } from "../../lib/utils";
import { whatsappUrl } from "../shared/helpers";
// A camada compartilhada do painel entra pelo próprio componente, e não só pelo
// PlatformAdmin: `.platform-metrics` é dependência desta tela, não do pai.
import "../../styles/platform-panel.css";
import "../../styles/finance-admin.css";

// ---------------------------------------------------------------------------
// Dinheiro: da string do backend para a tela, sem float no meio
// ---------------------------------------------------------------------------

const MILHAR = new Intl.NumberFormat("pt-BR");

/**
 * Centavos (inteiro) -> "R$ 1.234,56".
 *
 * Só aritmética inteira: a parte em reais sai de uma divisão exata por 100 e os
 * centavos, do resto. É o formatador de reserva — usado quando a tela só tem o
 * inteiro em mãos.
 */
function moedaDeCentavos(valor) {
  const total = Math.trunc(asNumber(valor));
  const sinal = total < 0 ? "-" : "";
  const absoluto = Math.abs(total);
  return `${sinal}R$ ${MILHAR.format(Math.trunc(absoluto / 100))},${String(absoluto % 100).padStart(2, "0")}`;
}

/**
 * Valor para EXIBIÇÃO, a partir da string decimal do backend ("189.80").
 *
 * Essa string é o NUMERIC do Postgres convertido para texto pelo driver: nunca
 * passou por float, então formatá-la é só reposicionar caracteres. Os centavos
 * entram apenas como fallback, se a string vier ausente ou fora do formato.
 */
function moeda(texto, centavos) {
  const partes = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(texto ?? "").trim());
  if (!partes) return moedaDeCentavos(centavos);
  return `${partes[1]}R$ ${MILHAR.format(Number(partes[2]))},${(partes[3] || "").padEnd(2, "0")}`;
}

/** Percentual já calculado pelo backend. `null` vira "—", nunca 0%. */
function percentual(valor) {
  if (valor === null || valor === undefined) return "—";
  return `${asNumber(valor).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// `formatDate` de lib/utils devolve dd/MM sem ano, e esta tela lista vencimentos
// de anos diferentes lado a lado (a fatura mais antiga em aberto pode ser do ano
// passado) — sem o ano as linhas ficam indistinguíveis. Mesmo motivo do
// `formatDateWithYear` em features/finance/Finance.jsx.
function dataCompleta(valor) {
  const texto = String(valor || "").slice(0, 10);
  const parsed = new Date(`${texto}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("pt-BR");
}

/** "2026-07" -> "jul/26", para o eixo do gráfico. */
function mesCurto(competencia) {
  const texto = String(competencia || "");
  const parsed = new Date(`${texto}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return texto;
  return `${parsed.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}/${texto.slice(2, 4)}`;
}

// Espelha os status de platform.tenant_subscriptions. Código desconhecido
// aparece cru em vez de sumir da coluna.
const STATUS_ASSINATURA = {
  trial_active: "Em teste",
  trial_expired: "Teste expirado",
  active: "Ativa",
  overdue: "Em atraso",
  canceled: "Cancelada",
  suspended: "Suspensa",
};

const TOM_ASSINATURA = {
  trial_active: "info",
  trial_expired: "warn",
  active: "ok",
  overdue: "danger",
  canceled: "neutral",
  suspended: "danger",
};

// Atraso é uma escala de urgência, não um número solto: acima de 30 dias a
// cobrança já passou do ponto em que um lembrete resolve.
function tomDoAtraso(dias) {
  if (asNumber(dias) >= 30) return "danger";
  if (asNumber(dias) >= 7) return "warn";
  return "info";
}

const plural = (total, singular, pluralizado) => `${total} ${total === 1 ? singular : pluralizado}`;

/** "recebido_mes" -> "Recebido mes", para o título das notas do backend. */
const humanizar = (campo) => {
  const texto = String(campo).replace(/_/g, " ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

// ---------------------------------------------------------------------------
// Rede
// ---------------------------------------------------------------------------

/**
 * Uma leitura da API por bloco da tela.
 *
 * Estado próprio (dados/carregando/erro) porque os cinco endpoints são
 * independentes: o resumo aparece assim que chega, mesmo que a inadimplência
 * ainda esteja rodando o COUNT DISTINCT — e um erro em `by-plan` não apaga o
 * resto da tela. `recarregar` existe para o erro ter saída sem recarregar a aba
 * inteira.
 */
function useRecurso(request, path) {
  const [estado, setEstado] = useState({ dados: null, carregando: true, erro: "" });
  const [tentativa, setTentativa] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tentativa` não é lida no corpo de propósito — ela existe só para o botão "Atualizar" pedir uma releitura com a MESMA rota, e é justamente por estar na lista que o efeito roda de novo.
  useEffect(() => {
    let ativo = true;
    setEstado((atual) => ({ ...atual, carregando: true, erro: "" }));
    request(path)
      .then((payload) => {
        if (ativo) setEstado({ dados: payload, carregando: false, erro: "" });
      })
      .catch((erro) => {
        // Os dados antigos ficam de fora de propósito: número financeiro velho
        // exibido ao lado de um erro é pior do que bloco vazio.
        if (ativo) setEstado({ dados: null, carregando: false, erro: erro.message });
      });
    return () => {
      ativo = false;
    };
  }, [request, path, tentativa]);

  const recarregar = useCallback(() => setTentativa((atual) => atual + 1), []);
  return { ...estado, recarregar };
}

/** Lê o envelope `{ items, total }` e também o array puro (ver services/pagination.js). */
function lerPagina(payload) {
  const envelope = asObject(payload);
  const items = asArray(payload).length ? asArray(payload) : asArray(envelope.items);
  return { items, total: envelope.total === undefined ? items.length : asNumber(envelope.total) };
}

// ---------------------------------------------------------------------------
// Blocos visuais
// ---------------------------------------------------------------------------

/**
 * Painel com estado de carga e de erro embutidos.
 *
 * O erro fica DENTRO do bloco (e não numa faixa no topo da tela) porque só assim
 * dá para saber qual dos cinco números não carregou — uma faixa geral faria a
 * tela parecer inteira quebrada por causa de um endpoint.
 *
 * `delegaEstado` existe para os blocos cujo conteúdo é um `DataView`: ele já sabe
 * desenhar "carregando" e erro dentro da própria tabela, e trocar a tabela por um
 * texto a cada virada de página faria a lista piscar inteira.
 */
function Bloco({ titulo, subtitulo, carregando, erro, onRecarregar, filtros, acoes, delegaEstado = false, children }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>{titulo}</h2>
          {subtitulo && <span>{subtitulo}</span>}
        </div>
        <div className="header-actions">
          {acoes}
          <Button variant="ghost" onClick={onRecarregar} disabled={carregando} aria-label={`Recarregar ${titulo}`}>
            <RefreshCw size={15} /> {carregando ? "Carregando…" : "Atualizar"}
          </Button>
        </div>
      </div>
      <div className="stack">
        {/* Controle de janela/período na `.toolbar`, a barra de filtros do
            sistema — no cabeçalho ele empurraria a linha do título para baixo. */}
        {filtros && <div className="toolbar">{filtros}</div>}
        {!delegaEstado && erro ? (
          <span className="form-error" role="alert">
            {erro}
          </span>
        ) : !delegaEstado && carregando ? (
          <Loading />
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/**
 * Grupo de números com título e régua.
 *
 * `.form-section` é a seção com título do sistema (régua em cima + `h3`); é ela
 * que separa PROJEÇÃO de CAIXA. A etiqueta mora no TÍTULO do grupo, e não em
 * cada cartão: um selo por cartão repetido cinco vezes vira ruído, e o que
 * precisa ficar claro é a fronteira entre os dois blocos.
 */
function Grupo({ titulo, explicacao, children }) {
  return (
    <section className="form-section">
      <h3>{titulo}</h3>
      {explicacao && <p className="field-hint">{explicacao}</p>}
      {children}
    </section>
  );
}

/** Cartão de número do painel. `indisponivel` = o backend não sabe calcular. */
function Numero({ rotulo, valor, detalhe, indisponivel = false }) {
  return (
    <article className={`platform-metric${indisponivel ? " is-unavailable" : ""}`}>
      <span className="label">{rotulo}</span>
      <span className="value">{valor}</span>
      {detalhe && <span className="hint">{detalhe}</span>}
    </article>
  );
}

/** Célula de duas linhas (nome + identificador), repetida nas três listas. */
function Duplo({ principal, secundario }) {
  return (
    <div className="fin-cell">
      <strong>{principal || "—"}</strong>
      <small>{secundario}</small>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Resumo
// ---------------------------------------------------------------------------

function Resumo({ dados }) {
  const resumo = asObject(dados);
  const notas = asObject(resumo.notas);
  const clinicas = asObject(resumo.clinicas);

  const porStatus = [
    ["Ativas", clinicas.ativa, "ok"],
    ["Em teste", clinicas.trial, "info"],
    ["Teste expirado", clinicas.trial_expirada, "warn"],
    ["Em atraso", clinicas.atrasada, "danger"],
    ["Suspensas", clinicas.suspensa, "danger"],
    ["Canceladas", clinicas.cancelada, "neutral"],
    ["Sem assinatura", clinicas.sem_assinatura, "neutral"],
    ["Sem cobrança no gateway", clinicas.sem_cobranca_no_gateway, "neutral"],
  ];

  return (
    <div className="stack">
      <Grupo
        titulo="Projeção · assinaturas ativas"
        explicacao="Preço de tabela do plano. Ainda NÃO entrou em conta."
      >
        <div className="platform-metrics">
          <Numero
            rotulo="MRR estimado"
            valor={moeda(resumo.mrr_estimado, resumo.mrr_estimado_centavos)}
            detalhe={`${plural(asNumber(clinicas.ativa), "assinatura ativa", "assinaturas ativas")} com cobrança no gateway`}
          />
          <Numero
            rotulo="MRR em risco"
            valor={moeda(resumo.mrr_em_risco, resumo.mrr_em_risco_centavos)}
            detalhe={`${plural(asNumber(clinicas.atrasada), "assinatura", "assinaturas")} com pagamento em atraso`}
          />
        </div>
      </Grupo>

      <Grupo
        titulo="Caixa e cobrança · faturas"
        explicacao={`Fatos registrados em fatura, no fuso ${resumo.fuso || "America/Sao_Paulo"}.`}
      >
        <div className="platform-metrics">
          <Numero
            rotulo="Recebido no mês"
            valor={moeda(resumo.recebido_mes, resumo.recebido_mes_centavos)}
            detalhe={`${plural(asNumber(resumo.recebido_mes_faturas), "fatura paga", "faturas pagas")} neste mês`}
          />
          <Numero
            rotulo="A receber no mês"
            valor={moeda(resumo.a_receber_mes, resumo.a_receber_mes_centavos)}
            detalhe={`${plural(asNumber(resumo.a_receber_mes_faturas), "fatura vence", "faturas vencem")} até o fim do mês`}
          />
          <Numero
            rotulo="Vencido"
            valor={moeda(resumo.vencido, resumo.vencido_centavos)}
            detalhe={`${plural(asNumber(resumo.vencido_faturas), "fatura", "faturas")} · ${plural(asNumber(resumo.vencido_clinicas), "clínica", "clínicas")}`}
          />
        </div>
      </Grupo>

      <Grupo titulo="Movimento do mês">
        <div className="platform-metrics">
          <Numero
            rotulo="Assinaturas novas"
            valor={String(asNumber(resumo.assinaturas_novas_mes))}
            detalhe="Clínicas cuja primeira fatura paga da história caiu neste mês"
          />
          {/*
            `cancelamentos_mes` fica em zero enquanto nenhum fluxo gravar
            canceled_at. Exibir "0" seco viraria "ninguém cancelou este mês", que
            é uma afirmação que o dado não sustenta — daí a ressalva no detalhe.
          */}
          <Numero
            rotulo="Cancelamentos"
            valor={String(asNumber(resumo.cancelamentos_mes))}
            detalhe="Subestimado: nenhum fluxo do sistema carimba a data de cancelamento ainda"
          />
          {/*
            Churn: `null` de propósito. Nem 0%, nem "—" mudo, nem uma conta
            improvisada com os dados que existem — o motivo vem escrito do
            backend e é ele que aparece, no cartão tracejado de indisponível.
          */}
          <Numero
            rotulo="Churn do mês"
            valor="Não calculável"
            detalhe={notas.churn_mes || "O backend não conseguiu calcular este indicador com os dados de hoje."}
            indisponivel
          />
        </div>
      </Grupo>

      <Grupo titulo="Clínicas por status de assinatura">
        <div className="fin-status">
          {porStatus.map(([rotulo, valor, tom]) => (
            <span key={rotulo}>
              <StatusBadge tone={tom}>{asNumber(valor)}</StatusBadge> {rotulo}
            </span>
          ))}
        </div>
      </Grupo>

      {/*
        As notas do backend, na íntegra. Elas são a diferença entre um painel que
        informa e um painel que engana: cada uma diz o que o número NÃO inclui.
      */}
      <AlertBlock icon={Info} title="Como ler estes números" empty="Sem observações do servidor.">
        {Object.entries(notas).map(([campo, texto]) => (
          <p className="field-hint" key={campo}>
            <strong>{humanizar(campo)}</strong> — {texto}
          </p>
        ))}
      </AlertBlock>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Inadimplência — lista de ação
// ---------------------------------------------------------------------------

function contatoDaClinica(linha) {
  return [linha.telefone, linha.email].filter(Boolean).join(" · ");
}

/** Telefone e e-mail da clínica, clicáveis: quem abre esta tela abre para cobrar. */
function Contato({ linha }) {
  if (!linha.telefone && !linha.email) return <small>Sem contato cadastrado</small>;
  return (
    <div className="fin-cell">
      {linha.responsavel && <small>{linha.responsavel}</small>}
      {linha.telefone && <a href={`tel:${String(linha.telefone).replace(/[^\d+]/g, "")}`}>{linha.telefone}</a>}
      {linha.email && <a href={`mailto:${linha.email}`}>{linha.email}</a>}
    </div>
  );
}

function Inadimplencia({ dados, carregando, erro, pagina, tamanho, onPagina, onTamanho }) {
  const { items, total } = lerPagina(dados);

  return (
    <DataView
      mode="server"
      rows={items}
      rowKey={(linha) => linha.tenant_id}
      total={total}
      page={pagina}
      pageSize={tamanho}
      onPageChange={onPagina}
      onPageSizeChange={onTamanho}
      loading={carregando}
      error={erro}
      // O backend já ordena (mais atrasado primeiro) e não aceita busca nem
      // ordenação por parâmetro: oferecer os controles seria oferecer botão que
      // não faz nada.
      searchable={false}
      caption="Clínicas com fatura vencida, da mais atrasada para a menos"
      columns={[
        {
          key: "clinica",
          label: "Clínica",
          sortable: false,
          value: (linha) => linha.clinica || "",
          render: (linha) => <Duplo principal={linha.clinica} secundario={linha.slug} />,
        },
        {
          key: "dias_atraso",
          label: "Atraso",
          sortable: false,
          value: (linha) => asNumber(linha.dias_atraso),
          render: (linha) => (
            <StatusBadge tone={tomDoAtraso(linha.dias_atraso)}>
              {plural(asNumber(linha.dias_atraso), "dia", "dias")}
            </StatusBadge>
          ),
        },
        {
          key: "valor_devido",
          label: "Valor devido",
          align: "right",
          sortable: false,
          // Ordenação e busca leem os CENTAVOS: "1.200,00" como texto ordenaria
          // antes de "900,00".
          value: (linha) => asNumber(linha.valor_devido_centavos),
          render: (linha) => <strong>{moeda(linha.valor_devido, linha.valor_devido_centavos)}</strong>,
        },
        {
          key: "faturas_vencidas",
          label: "Faturas",
          align: "right",
          sortable: false,
          value: (linha) => asNumber(linha.faturas_vencidas),
        },
        {
          key: "vencimento_mais_antigo",
          label: "Vence desde",
          sortable: false,
          value: (linha) => String(linha.vencimento_mais_antigo || ""),
          render: (linha) => dataCompleta(linha.vencimento_mais_antigo),
        },
        {
          key: "assinatura_status",
          label: "Assinatura",
          sortable: false,
          value: (linha) => linha.assinatura_status || "",
          render: (linha) => (
            <StatusBadge tone={TOM_ASSINATURA[linha.assinatura_status] || "neutral"}>
              {STATUS_ASSINATURA[linha.assinatura_status] || linha.assinatura_status || "—"}
            </StatusBadge>
          ),
        },
        {
          // Contato na LINHA, não escondido atrás de um clique: quem abre esta
          // tela abre para cobrar, e o telefone é o dado que ele veio buscar.
          key: "contato",
          label: "Contato",
          sortable: false,
          value: contatoDaClinica,
          render: (linha) => <Contato linha={linha} />,
        },
      ]}
      actions={(linha) => (
        <>
          {linha.telefone && (
            <a
              className="fin-acao"
              href={whatsappUrl(
                linha.telefone,
                `Olá! Aqui é da Monitence. Identificamos ${plural(
                  asNumber(linha.faturas_vencidas),
                  "fatura em aberto",
                  "faturas em aberto",
                )} da ${linha.clinica}, no total de ${moeda(linha.valor_devido, linha.valor_devido_centavos)}. Podemos ajudar a regularizar?`,
              )}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
          )}
          {linha.link_fatura_mais_antiga && (
            <a className="fin-acao" href={linha.link_fatura_mais_antiga} target="_blank" rel="noreferrer">
              Abrir fatura <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </>
      )}
      empty="Nenhuma clínica com fatura vencida na data base."
    />
  );
}

// ---------------------------------------------------------------------------
// 3. Vencimentos próximos
// ---------------------------------------------------------------------------

function Vencimentos({ dados, carregando, erro, pagina, tamanho, onPagina, onTamanho }) {
  const payload = asObject(dados);
  const items = asArray(payload.items);

  return (
    <div className="stack">
      {/* Com erro o destaque some: um "R$ 0,00" grande ao lado de uma mensagem
          de falha seria lido como "nada vence nesta janela". */}
      {!erro && (
        <div className="platform-metrics">
          <Numero
            rotulo={`Vence nos próximos ${asNumber(payload.dias) || 7} dias`}
            valor={carregando ? "…" : moeda(payload.valor_total, payload.valor_total_centavos)}
            detalhe={`${plural(asNumber(payload.total), "fatura pendente", "faturas pendentes")} · o que já venceu está na lista de inadimplência, não aqui`}
          />
        </div>
      )}
      <DataView
        mode="server"
        rows={items}
        rowKey={(linha) => linha.id}
        total={asNumber(payload.total)}
        page={pagina}
        pageSize={tamanho}
        onPageChange={onPagina}
        onPageSizeChange={onTamanho}
        loading={carregando}
        error={erro}
        searchable={false}
        caption="Faturas pendentes com vencimento dentro da janela"
        columns={[
          {
            key: "clinica",
            label: "Clínica",
            sortable: false,
            value: (linha) => linha.clinica || "",
            render: (linha) => <Duplo principal={linha.clinica} secundario={linha.slug} />,
          },
          { key: "plan_code", label: "Plano", sortable: false, value: (linha) => linha.plan_code || "—" },
          {
            key: "vencimento",
            label: "Vencimento",
            sortable: false,
            value: (linha) => String(linha.vencimento || ""),
            render: (linha) => dataCompleta(linha.vencimento),
          },
          {
            key: "dias_para_vencer",
            label: "Quando",
            sortable: false,
            value: (linha) => asNumber(linha.dias_para_vencer),
            render: (linha) => {
              const dias = asNumber(linha.dias_para_vencer);
              return (
                <StatusBadge tone={dias <= 1 ? "warn" : "neutral"}>
                  {dias === 0 ? "Hoje" : dias === 1 ? "Amanhã" : `Em ${dias} dias`}
                </StatusBadge>
              );
            },
          },
          {
            key: "valor",
            label: "Valor",
            align: "right",
            sortable: false,
            value: (linha) => asNumber(linha.valor_centavos),
            render: (linha) => moeda(linha.valor, linha.valor_centavos),
          },
          { key: "billing_type", label: "Forma", sortable: false, value: (linha) => linha.billing_type || "—" },
          {
            key: "contato",
            label: "Contato",
            sortable: false,
            value: contatoDaClinica,
            render: (linha) => <Contato linha={linha} />,
          },
        ]}
        actions={(linha) =>
          linha.invoice_url ? (
            <a className="fin-acao" href={linha.invoice_url} target="_blank" rel="noreferrer">
              Abrir fatura <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : null
        }
        empty="Nenhuma fatura pendente vence nesta janela."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Série mensal (o gráfico)
// ---------------------------------------------------------------------------

// Geometria em unidades do viewBox. O SVG é escrito à mão de propósito: uma
// biblioteca de gráficos para desenhar doze pares de barras custaria mais em
// bundle do que o projeto inteiro de estilos.
const COLUNA = 46;
const BARRA = 19;
const VAO = 2; // respiro entre as duas barras do par, para não virarem um bloco só
const ALTURA_PLOT = 150;
const ALTURA_TOTAL = 186;
const MARGEM_ESQ = 8;

/**
 * Recebido (caixa) x emitido (competência) mês a mês.
 *
 * Barras agrupadas, UM eixo só: as duas séries são reais na mesma escala, e
 * segundo eixo é o jeito clássico de fazer duas curvas parecerem se cruzar sem
 * que isso queira dizer nada.
 *
 * A altura sai dos CENTAVOS (inteiros); a string decimal fica para os rótulos.
 */
function GraficoSerie({ itens }) {
  const [foco, setFoco] = useState(-1);

  const maximo = itens.reduce(
    (maior, item) => Math.max(maior, asNumber(item.recebido_centavos), asNumber(item.emitido_centavos)),
    0,
  );

  if (!itens.length || maximo === 0) {
    return <p className="empty-state">Sem faturas no período para montar o gráfico.</p>;
  }

  const largura = MARGEM_ESQ * 2 + COLUNA * itens.length;
  const alturaDaBarra = (centavos) =>
    Math.max((asNumber(centavos) / maximo) * ALTURA_PLOT, asNumber(centavos) > 0 ? 2 : 0);
  const destacado = itens[foco];

  return (
    <div className="fin-chart">
      <div className="fin-legend">
        <span>
          <i className="fin-recebido" aria-hidden="true" />
          Recebido (caixa)
        </span>
        <span>
          <i className="fin-emitido" aria-hidden="true" />
          Emitido (competência)
        </span>
        {/* Leitura do mês sob o cursor. Sem ela o gráfico só daria a forma, e o
            valor exato é o que se leva para a reunião. */}
        <span className="field-hint" aria-live="polite">
          {destacado
            ? `${destacado.mes} · recebido ${moeda(destacado.recebido, destacado.recebido_centavos)} · emitido ${moeda(destacado.emitido, destacado.emitido_centavos)}`
            : "Passe o cursor sobre um mês para ver os valores."}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${largura} ${ALTURA_TOTAL}`}
        role="img"
        aria-label={`Receita mês a mês. Maior valor da série: ${moedaDeCentavos(maximo)}.`}
      >
        <title>Recebido e emitido por mês</title>
        {/* Linha de base: grade discreta, só o suficiente para dar escala. */}
        <line className="fin-axis" x1="0" y1={ALTURA_PLOT} x2={largura} y2={ALTURA_PLOT} />
        <text className="fin-tick" x="2" y="10">
          {moedaDeCentavos(maximo)}
        </text>

        {itens.map((item, indice) => {
          const x = MARGEM_ESQ + indice * COLUNA;
          const recebido = alturaDaBarra(item.recebido_centavos);
          const emitido = alturaDaBarra(item.emitido_centavos);
          return (
            <g
              className={`fin-col${foco === indice ? " is-foco" : ""}`}
              key={item.mes}
              onMouseEnter={() => setFoco(indice)}
              onMouseLeave={() => setFoco(-1)}
              onFocus={() => setFoco(indice)}
              onBlur={() => setFoco(-1)}
            >
              {/* Alvo do cursor: a coluna inteira, não a barra fina. */}
              <rect className="fin-hit" x={x} y="0" width={COLUNA} height={ALTURA_PLOT} tabIndex={0}>
                <title>
                  {`${item.mes}: recebido ${moeda(item.recebido, item.recebido_centavos)}, emitido ${moeda(item.emitido, item.emitido_centavos)}`}
                </title>
              </rect>
              <rect
                className="fin-recebido"
                x={x + (COLUNA - BARRA * 2 - VAO) / 2}
                y={ALTURA_PLOT - recebido}
                width={BARRA}
                height={recebido}
                rx="2"
              />
              <rect
                className="fin-emitido"
                x={x + (COLUNA - BARRA * 2 - VAO) / 2 + BARRA + VAO}
                y={ALTURA_PLOT - emitido}
                width={BARRA}
                height={emitido}
                rx="2"
              />
              <text className="fin-tick" x={x + COLUNA / 2} y={ALTURA_PLOT + 16} textAnchor="middle">
                {mesCurto(item.mes)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* O gráfico dá a forma; a tabela dá o número — e é a versão que funciona
          para quem lê por leitor de tela ou precisa copiar os valores. */}
      <details>
        <summary>Ver os números em tabela</summary>
        <DataView
          rows={itens}
          rowKey={(item) => item.mes}
          searchable={false}
          paginated={false}
          caption="Recebido e emitido, mês a mês"
          columns={[
            { key: "mes", label: "Mês", sortable: false },
            {
              key: "recebido",
              label: "Recebido",
              align: "right",
              sortable: false,
              render: (item) => moeda(item.recebido, item.recebido_centavos),
            },
            {
              key: "faturas_pagas",
              label: "Faturas pagas",
              align: "right",
              sortable: false,
              render: (item) => asNumber(item.faturas_pagas),
            },
            {
              key: "emitido",
              label: "Emitido",
              align: "right",
              sortable: false,
              render: (item) => moeda(item.emitido, item.emitido_centavos),
            },
            {
              key: "faturas_emitidas",
              label: "Faturas emitidas",
              align: "right",
              sortable: false,
              render: (item) => asNumber(item.faturas_emitidas),
            },
          ]}
          empty="Sem faturas no período."
        />
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Receita por plano
// ---------------------------------------------------------------------------

function PorPlano({ dados }) {
  const itens = asArray(asObject(dados).items);

  return (
    <DataView
      rows={itens}
      rowKey={(linha) => linha.plan_code}
      defaultSort={{ key: "mrr_estimado", dir: "desc" }}
      searchPlaceholder="Buscar por plano"
      caption="Participação de cada plano no MRR estimado e no caixa do mês"
      columns={[
        {
          key: "plano",
          label: "Plano",
          value: (linha) => linha.plano || linha.plan_code || "",
          render: (linha) => (
            <Duplo
              principal={linha.plano || linha.plan_code}
              secundario={`${linha.plan_code} · ${moeda(linha.preco, linha.preco_centavos)}/mês${linha.plano_ativo ? "" : " · inativo na vitrine"}`}
            />
          ),
        },
        {
          key: "assinantes_ativos",
          label: "Ativos",
          align: "right",
          value: (linha) => asNumber(linha.assinantes_ativos),
        },
        {
          key: "assinantes_atrasados",
          label: "Em atraso",
          align: "right",
          value: (linha) => asNumber(linha.assinantes_atrasados),
        },
        {
          key: "assinantes_em_trial",
          label: "Em teste",
          align: "right",
          value: (linha) => asNumber(linha.assinantes_em_trial),
        },
        {
          key: "mrr_estimado",
          label: "MRR estimado (projeção)",
          align: "right",
          value: (linha) => asNumber(linha.mrr_estimado_centavos),
          render: (linha) => moeda(linha.mrr_estimado, linha.mrr_estimado_centavos),
        },
        {
          key: "participacao_mrr",
          label: "Participação",
          value: (linha) => asNumber(linha.participacao_mrr),
          // `.platform-quota-bar` é a barra de proporção do painel. Ela é
          // geometria, não dinheiro: o percentual já vem pronto do backend,
          // calculado sobre os centavos inteiros.
          render: (linha) => (
            <>
              {percentual(linha.participacao_mrr)}
              <div className="platform-quota-bar">
                <span style={{ width: `${Math.min(asNumber(linha.participacao_mrr), 100)}%` }} />
              </div>
            </>
          ),
        },
        {
          key: "recebido_mes",
          label: "Recebido no mês (caixa)",
          align: "right",
          value: (linha) => asNumber(linha.recebido_mes_centavos),
          render: (linha) => (
            <Duplo
              principal={moeda(linha.recebido_mes, linha.recebido_mes_centavos)}
              secundario={plural(asNumber(linha.recebido_mes_faturas), "fatura", "faturas")}
            />
          ),
        },
      ]}
      empty="Nenhum plano cadastrado."
      emptyFiltered="Nenhum plano corresponde à busca."
    />
  );
}

// ---------------------------------------------------------------------------
// A tela
// ---------------------------------------------------------------------------

/**
 * @param {{ token: string, onUnauthorized?: () => void }} props
 */
export function PlatformFinance({ token, onUnauthorized }) {
  // Data base vazia = "hoje" no fuso do painel, decidido pelo BANCO. Preenchida,
  // congela o dia inteiro da tela — é assim que se confere um fechamento sem que
  // a resposta mude conforme o dia em que se olha.
  const [dataBase, setDataBase] = useState("");
  const [dias, setDias] = useState("7");
  const [meses, setMeses] = useState("12");

  const [paginaAtraso, setPaginaAtraso] = useState(1);
  const [tamanhoAtraso, setTamanhoAtraso] = useState(25);
  const [paginaVencimento, setPaginaVencimento] = useState(1);
  const [tamanhoVencimento, setTamanhoVencimento] = useState(25);

  // O callback de 401 vem do painel e é recriado a cada render dele; em ref,
  // `request` para de mudar de identidade e os cinco efeitos de carga não
  // disparam de novo a cada render do pai. Mesmo desenho do PlansAdmin.
  const unauthorizedRef = useRef(onUnauthorized);
  useEffect(() => {
    unauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  const request = useCallback(
    async (path) => {
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      let response;
      try {
        response = await fetch(`${API}${path}`, { headers });
      } catch {
        throw new Error("Não foi possível conectar ao servidor.");
      }
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        unauthorizedRef.current?.();
        throw new Error("Sessão de plataforma expirada. Entre novamente.");
      }
      // A mensagem do backend é sempre preferida: só ela sabe dizer, por
      // exemplo, que a data base não existe no calendário.
      if (!response.ok) throw new Error(asObject(payload).error || "Não foi possível carregar este bloco.");
      return payload;
    },
    [token],
  );

  const consulta = useCallback(
    (extra = {}) => {
      const params = new URLSearchParams();
      if (dataBase) params.set("data_base", dataBase);
      for (const [chave, valor] of Object.entries(extra)) params.set(chave, String(valor));
      const texto = params.toString();
      return texto ? `?${texto}` : "";
    },
    [dataBase],
  );

  const rotaResumo = useMemo(() => `/platform/finance/summary${consulta()}`, [consulta]);
  const rotaAtraso = useMemo(
    () => `/platform/finance/overdue${consulta({ limit: tamanhoAtraso, offset: (paginaAtraso - 1) * tamanhoAtraso })}`,
    [consulta, tamanhoAtraso, paginaAtraso],
  );
  const rotaVencimento = useMemo(
    () =>
      `/platform/finance/upcoming${consulta({
        dias,
        limit: tamanhoVencimento,
        offset: (paginaVencimento - 1) * tamanhoVencimento,
      })}`,
    [consulta, dias, tamanhoVencimento, paginaVencimento],
  );
  const rotaSerie = useMemo(() => `/platform/finance/monthly${consulta({ meses })}`, [consulta, meses]);
  const rotaPlanos = useMemo(() => `/platform/finance/by-plan${consulta()}`, [consulta]);

  const resumo = useRecurso(request, rotaResumo);
  const atraso = useRecurso(request, rotaAtraso);
  const vencimento = useRecurso(request, rotaVencimento);
  const serie = useRecurso(request, rotaSerie);
  const planos = useRecurso(request, rotaPlanos);

  // Trocar a data base (ou a janela de dias) muda o CONJUNTO de linhas: manter a
  // página 5 depois disso mostra uma lista vazia sem explicar por quê. O reset
  // acompanha o próprio evento em vez de virar efeito — assim a página nova já
  // sai junto com a rota nova, sem uma requisição jogada fora no meio.
  function trocarDataBase(valor) {
    setDataBase(valor);
    setPaginaAtraso(1);
    setPaginaVencimento(1);
  }

  function trocarJanela(valor) {
    setDias(valor);
    setPaginaVencimento(1);
  }

  const cabecalho = asObject(resumo.dados);
  const devedores = lerPagina(atraso.dados).total;

  return (
    <div className="stack">
      <section className="panel">
        <CrudHeader
          title="Financeiro da plataforma"
          subtitle="Quanto entrou, quanto ainda vai entrar e quem está devendo. Somente leitura — nada aqui cria, altera ou baixa fatura."
        />
        <div className="stack">
          <div className="toolbar">
            <Input type="date" label="Data base" value={dataBase} onChange={trocarDataBase} />
            <Button variant="secondary" disabled={!dataBase} onClick={() => trocarDataBase("")}>
              Voltar para hoje
            </Button>
          </div>
          <p className="field-hint">
            {cabecalho.data_base ? (
              <>
                Painel calculado como se hoje fosse <strong>{dataCompleta(cabecalho.data_base)}</strong> · competência{" "}
                <strong>{cabecalho.competencia}</strong> · fuso {cabecalho.fuso}.
              </>
            ) : (
              "Deixe a data base vazia para ver a situação de hoje. Preenchida, ela congela o “hoje” de todos os blocos — é o que permite conferir um fechamento passado."
            )}
          </p>
        </div>
      </section>

      <Bloco
        titulo="Resumo"
        subtitulo="Projeção e caixa em grupos separados, cada um com sua etiqueta."
        carregando={resumo.carregando}
        erro={resumo.erro}
        onRecarregar={resumo.recarregar}
      >
        <Resumo dados={resumo.dados} />
      </Bloco>

      <Bloco
        titulo="Inadimplência"
        subtitulo="Quem cobrar hoje, da clínica mais atrasada para a menos."
        carregando={atraso.carregando}
        erro={atraso.erro}
        onRecarregar={atraso.recarregar}
        delegaEstado
        acoes={
          devedores > 0 && (
            <StatusBadge tone="danger">
              <AlertTriangle size={12} aria-hidden="true" /> {plural(devedores, "clínica devendo", "clínicas devendo")}
            </StatusBadge>
          )
        }
      >
        <Inadimplencia
          dados={atraso.dados}
          carregando={atraso.carregando}
          erro={atraso.erro}
          pagina={paginaAtraso}
          tamanho={tamanhoAtraso}
          onPagina={setPaginaAtraso}
          onTamanho={setTamanhoAtraso}
        />
      </Bloco>

      <Bloco
        titulo="Vencimentos próximos"
        subtitulo="O que ainda vai vencer na janela escolhida."
        carregando={vencimento.carregando}
        erro={vencimento.erro}
        onRecarregar={vencimento.recarregar}
        delegaEstado
        filtros={
          <Select label="Janela" value={dias} onChange={trocarJanela}>
            <option value="7">Próximos 7 dias</option>
            <option value="15">Próximos 15 dias</option>
            <option value="30">Próximos 30 dias</option>
            <option value="60">Próximos 60 dias</option>
            <option value="90">Próximos 90 dias</option>
          </Select>
        }
      >
        <Vencimentos
          dados={vencimento.dados}
          carregando={vencimento.carregando}
          erro={vencimento.erro}
          pagina={paginaVencimento}
          tamanho={tamanhoVencimento}
          onPagina={setPaginaVencimento}
          onTamanho={setTamanhoVencimento}
        />
      </Bloco>

      <Bloco
        titulo="Receita mês a mês"
        subtitulo="Recebido é caixa (data do pagamento); emitido é competência (o mês a que a cobrança se refere)."
        carregando={serie.carregando}
        erro={serie.erro}
        onRecarregar={serie.recarregar}
        filtros={
          <Select label="Período" value={meses} onChange={setMeses}>
            <option value="6">Últimos 6 meses</option>
            <option value="12">Últimos 12 meses</option>
            <option value="24">Últimos 24 meses</option>
          </Select>
        }
      >
        <GraficoSerie itens={asArray(asObject(serie.dados).items)} />
      </Bloco>

      <Bloco
        titulo="Receita por plano"
        subtitulo="Quanto cada plano representa hoje. Plano sem assinante aparece zerado — é o dado que responde se ele vende."
        carregando={planos.carregando}
        erro={planos.erro}
        onRecarregar={planos.recarregar}
      >
        <PorPlano dados={planos.dados} />
      </Bloco>
    </div>
  );
}
