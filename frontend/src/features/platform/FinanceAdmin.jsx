// Financeiro da PLATAFORMA (aba do painel do super-admin).
//
// A tela responde a uma pergunta só: a receita da Monitence está saudável? Ela é
// a ponta visual de backend/src/services/platformFinance.js, e três decisões de
// lá atravessam este arquivo inteiro:
//
//  1. PROJEÇÃO E CAIXA NUNCA APARECEM SEM ETIQUETA. `mrr_estimado` é o preço de
//     tabela das assinaturas ativas — dinheiro que ainda NÃO entrou.
//     `recebido_mes` é fatura paga — dinheiro que entrou. Os dois moram em
//     blocos separados, cada card carrega um selo ("Projeção" / "Caixa") e o
//     texto de `notas{}` vem do backend palavra por palavra. Numa reunião de
//     fechamento, é a etiqueta que evita somar os dois.
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Info, Mail, Phone, RefreshCw } from "lucide-react";
import { AlertBlock, Button, Input, Select, StatusBadge } from "../../components/common/Ui";
import { DataView } from "../../components/common/DataView";
import { API } from "../../lib/api";
import { asArray, asNumber, asObject } from "../../lib/utils";
import { whatsappUrl } from "../shared/helpers";
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
function Bloco({ titulo, subtitulo, carregando, erro, onRecarregar, acoes, delegaEstado = false, children }) {
  return (
    <section className="panel fa-bloco">
      <div className="panel-heading">
        <div>
          <h2>{titulo}</h2>
          {subtitulo && <span>{subtitulo}</span>}
        </div>
        <div className="fa-bloco-acoes">
          {acoes}
          <Button variant="ghost" onClick={onRecarregar} disabled={carregando} aria-label={`Recarregar ${titulo}`}>
            <RefreshCw size={15} /> {carregando ? "Carregando…" : "Atualizar"}
          </Button>
        </div>
      </div>
      {!delegaEstado && erro ? (
        <p className="fa-erro" role="alert">
          {erro}
        </p>
      ) : !delegaEstado && carregando ? (
        <p className="empty-state" aria-live="polite">
          Carregando…
        </p>
      ) : (
        children
      )}
    </section>
  );
}

/**
 * Card de um número do resumo.
 *
 * Não usa o `Metric` de components/common porque `Metric` não tem lugar para a
 * ETIQUETA — e a etiqueta ("Projeção" vs. "Caixa") é o ponto desta tela, não um
 * enfeite. O selo em si continua sendo o `StatusBadge` do sistema.
 */
function Cartao({ rotulo, valor, etiqueta, tom, detalhe, nota }) {
  return (
    <article className="fa-cartao" title={nota || undefined}>
      <header>
        <span className="fa-cartao-rotulo">{rotulo}</span>
        <StatusBadge tone={tom}>{etiqueta}</StatusBadge>
      </header>
      <strong>{valor}</strong>
      {detalhe && <small>{detalhe}</small>}
    </article>
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
    <div className="fa-resumo">
      {/*
        Dois grupos, com título: projeção de um lado, dinheiro de verdade do
        outro. Uma grade única com os cinco números lado a lado convidaria a
        somar MRR com recebido — que é a conta errada mais fácil de fazer aqui.
      */}
      <section className="fa-grupo">
        <h3 className="fa-grupo-titulo">
          Projeção · assinaturas ativas
          <span>Preço de tabela do plano. Ainda NÃO entrou em conta.</span>
        </h3>
        <div className="fa-cartoes">
          <Cartao
            rotulo="MRR estimado"
            valor={moeda(resumo.mrr_estimado, resumo.mrr_estimado_centavos)}
            etiqueta="Projeção"
            tom="info"
            detalhe={`${plural(asNumber(clinicas.ativa), "assinatura ativa", "assinaturas ativas")} com cobrança no gateway`}
            nota={notas.mrr_estimado}
          />
          <Cartao
            rotulo="MRR em risco"
            valor={moeda(resumo.mrr_em_risco, resumo.mrr_em_risco_centavos)}
            etiqueta="Projeção"
            tom="warn"
            detalhe={`${plural(asNumber(clinicas.atrasada), "assinatura", "assinaturas")} com pagamento em atraso`}
            nota="Parte do MRR que some se a cobrança dessas clínicas não for resolvida."
          />
        </div>
      </section>

      <section className="fa-grupo">
        <h3 className="fa-grupo-titulo">
          Caixa e cobrança · faturas
          <span>Fatos registrados em fatura, no fuso {resumo.fuso || "America/Sao_Paulo"}.</span>
        </h3>
        <div className="fa-cartoes">
          <Cartao
            rotulo="Recebido no mês"
            valor={moeda(resumo.recebido_mes, resumo.recebido_mes_centavos)}
            etiqueta="Caixa"
            tom="ok"
            detalhe={`${plural(asNumber(resumo.recebido_mes_faturas), "fatura paga", "faturas pagas")} neste mês`}
            nota={notas.recebido_mes}
          />
          <Cartao
            rotulo="A receber no mês"
            valor={moeda(resumo.a_receber_mes, resumo.a_receber_mes_centavos)}
            etiqueta="Em aberto"
            tom="info"
            detalhe={`${plural(asNumber(resumo.a_receber_mes_faturas), "fatura vence", "faturas vencem")} até o fim do mês`}
            nota="Faturas em aberto com vencimento entre a data base e o último dia do mês."
          />
          <Cartao
            rotulo="Vencido"
            valor={moeda(resumo.vencido, resumo.vencido_centavos)}
            etiqueta="Atrasado"
            tom="danger"
            detalhe={`${plural(asNumber(resumo.vencido_faturas), "fatura", "faturas")} · ${plural(asNumber(resumo.vencido_clinicas), "clínica", "clínicas")}`}
            nota={notas.vencido}
          />
        </div>
      </section>

      <section className="fa-grupo">
        <h3 className="fa-grupo-titulo">Movimento do mês</h3>
        <div className="fa-cartoes">
          <Cartao
            rotulo="Assinaturas novas"
            valor={String(asNumber(resumo.assinaturas_novas_mes))}
            etiqueta="Fato"
            tom="ok"
            detalhe="Clínicas cuja primeira fatura paga da história caiu neste mês"
            nota={notas.assinaturas_novas_mes}
          />
          {/*
            `cancelamentos_mes` fica em zero enquanto nenhum fluxo gravar
            canceled_at. Exibir "0" seco viraria "ninguém cancelou este mês", que
            é uma afirmação que o dado não sustenta — daí o selo de ressalva.
          */}
          <Cartao
            rotulo="Cancelamentos"
            valor={String(asNumber(resumo.cancelamentos_mes))}
            etiqueta="Subestimado"
            tom="warn"
            detalhe="Nenhum fluxo do sistema carimba a data de cancelamento ainda"
            nota={notas.cancelamentos_mes}
          />
          {/*
            Churn: `null` de propósito. Nem 0%, nem "—" mudo, nem uma conta
            improvisada com os dados que existem — o motivo vem escrito do
            backend e é ele que aparece.
          */}
          <article className="fa-cartao fa-cartao-indisponivel">
            <header>
              <span className="fa-cartao-rotulo">Churn do mês</span>
              <StatusBadge tone="neutral">Não disponível</StatusBadge>
            </header>
            <strong>Não calculável</strong>
            <p>{notas.churn_mes || "O backend não conseguiu calcular este indicador com os dados de hoje."}</p>
          </article>
        </div>
      </section>

      <section className="fa-grupo">
        <h3 className="fa-grupo-titulo">Clínicas por status de assinatura</h3>
        <div className="fa-status-linha">
          {porStatus.map(([rotulo, valor, tom]) => (
            <span className="fa-status-item" key={rotulo}>
              <StatusBadge tone={tom}>{asNumber(valor)}</StatusBadge>
              {rotulo}
            </span>
          ))}
        </div>
      </section>

      {/*
        As notas do backend, na íntegra. Elas são a diferença entre um painel que
        informa e um painel que engana: cada uma diz o que o número NÃO inclui.
      */}
      <AlertBlock icon={Info} title="Como ler estes números" empty="Sem observações do servidor.">
        {Object.entries(notas).map(([campo, texto]) => (
          <p className="fa-nota" key={campo}>
            <strong>{campo.replace(/_/g, " ")}</strong> — {texto}
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
          render: (linha) => (
            <div className="fa-celula-clinica">
              <strong>{linha.clinica || "—"}</strong>
              <small>{linha.slug}</small>
            </div>
          ),
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
          render: (linha) => (
            <div className="fa-contato">
              {linha.responsavel && <small>{linha.responsavel}</small>}
              {linha.telefone && (
                <a href={`tel:${String(linha.telefone).replace(/[^\d+]/g, "")}`}>
                  <Phone size={13} aria-hidden="true" /> {linha.telefone}
                </a>
              )}
              {linha.email && (
                <a href={`mailto:${linha.email}`}>
                  <Mail size={13} aria-hidden="true" /> {linha.email}
                </a>
              )}
              {!linha.telefone && !linha.email && <small>Sem contato cadastrado</small>}
            </div>
          ),
        },
      ]}
      actions={(linha) => (
        <>
          {linha.telefone && (
            <a
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
            <a href={linha.link_fatura_mais_antiga} target="_blank" rel="noreferrer">
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
    <>
      {/* Com erro o destaque some: um "R$ 0,00" grande ao lado de uma mensagem de
          falha seria lido como "nada vence nesta janela". */}
      {!erro && (
        <div className="fa-destaque">
          <span>Total que vence nos próximos {asNumber(payload.dias) || 7} dias</span>
          <strong>{carregando ? "…" : moeda(payload.valor_total, payload.valor_total_centavos)}</strong>
          <small>
            {plural(asNumber(payload.total), "fatura pendente", "faturas pendentes")} · o que já venceu está na lista de
            inadimplência, não aqui
          </small>
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
            render: (linha) => (
              <div className="fa-celula-clinica">
                <strong>{linha.clinica || "—"}</strong>
                <small>{linha.slug}</small>
              </div>
            ),
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
            render: (linha) => (
              <div className="fa-contato">
                {linha.telefone && (
                  <a href={`tel:${String(linha.telefone).replace(/[^\d+]/g, "")}`}>{linha.telefone}</a>
                )}
                {linha.email && <a href={`mailto:${linha.email}`}>{linha.email}</a>}
                {!linha.telefone && !linha.email && <small>Sem contato cadastrado</small>}
              </div>
            ),
          },
        ]}
        actions={(linha) =>
          linha.invoice_url ? (
            <a href={linha.invoice_url} target="_blank" rel="noreferrer">
              Abrir fatura <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : null
        }
        empty="Nenhuma fatura pendente vence nesta janela."
      />
    </>
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
    <div className="fa-grafico">
      <div className="fa-legenda">
        <span className="fa-legenda-item">
          <i className="fa-swatch fa-swatch-recebido" aria-hidden="true" /> Recebido (caixa)
        </span>
        <span className="fa-legenda-item">
          <i className="fa-swatch fa-swatch-emitido" aria-hidden="true" /> Emitido (competência)
        </span>
        {/* Leitura do mês sob o cursor. Sem ela o gráfico só daria a forma, e o
            valor exato é o que se leva para a reunião. */}
        <span className="fa-legenda-leitura" aria-live="polite">
          {destacado
            ? `${destacado.mes} · recebido ${moeda(destacado.recebido, destacado.recebido_centavos)} · emitido ${moeda(destacado.emitido, destacado.emitido_centavos)}`
            : "Passe o cursor sobre um mês para ver os valores."}
        </span>
      </div>

      <svg
        className="fa-svg"
        viewBox={`0 0 ${largura} ${ALTURA_TOTAL}`}
        role="img"
        aria-label={`Receita mês a mês. Maior valor da série: ${moedaDeCentavos(maximo)}.`}
      >
        <title>Recebido e emitido por mês</title>
        {/* Linha de base e teto: grade discreta, só o suficiente para dar escala. */}
        <line className="fa-eixo" x1="0" y1={ALTURA_PLOT} x2={largura} y2={ALTURA_PLOT} />
        <line className="fa-grade" x1="0" y1="0" x2={largura} y2="0" />
        <text className="fa-escala" x="2" y="-4" dy="10">
          {moedaDeCentavos(maximo)}
        </text>

        {itens.map((item, indice) => {
          const x = MARGEM_ESQ + indice * COLUNA;
          const recebido = alturaDaBarra(item.recebido_centavos);
          const emitido = alturaDaBarra(item.emitido_centavos);
          return (
            <g
              className={`fa-coluna${foco === indice ? " is-foco" : ""}`}
              key={item.mes}
              onMouseEnter={() => setFoco(indice)}
              onMouseLeave={() => setFoco(-1)}
              onFocus={() => setFoco(indice)}
              onBlur={() => setFoco(-1)}
            >
              {/* Alvo do cursor: a coluna inteira, não a barra fina. */}
              <rect className="fa-alvo" x={x} y="0" width={COLUNA} height={ALTURA_PLOT} tabIndex={0}>
                <title>
                  {`${item.mes}: recebido ${moeda(item.recebido, item.recebido_centavos)}, emitido ${moeda(item.emitido, item.emitido_centavos)}`}
                </title>
              </rect>
              <rect
                className="fa-barra fa-barra-recebido"
                x={x + (COLUNA - BARRA * 2 - VAO) / 2}
                y={ALTURA_PLOT - recebido}
                width={BARRA}
                height={recebido}
                rx="2"
              />
              <rect
                className="fa-barra fa-barra-emitido"
                x={x + (COLUNA - BARRA * 2 - VAO) / 2 + BARRA + VAO}
                y={ALTURA_PLOT - emitido}
                width={BARRA}
                height={emitido}
                rx="2"
              />
              <text className="fa-mes" x={x + COLUNA / 2} y={ALTURA_PLOT + 16} textAnchor="middle">
                {mesCurto(item.mes)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* O gráfico dá a forma; a tabela dá o número — e é a versão que funciona
          para quem lê por leitor de tela ou precisa copiar os valores. */}
      <details className="fa-tabela-serie">
        <summary>Ver os números em tabela</summary>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mês</th>
                <th style={{ textAlign: "right" }}>Recebido</th>
                <th style={{ textAlign: "right" }}>Faturas pagas</th>
                <th style={{ textAlign: "right" }}>Emitido</th>
                <th style={{ textAlign: "right" }}>Faturas emitidas</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.mes}>
                  <td data-label="Mês">{item.mes}</td>
                  <td data-label="Recebido" style={{ textAlign: "right" }}>
                    {moeda(item.recebido, item.recebido_centavos)}
                  </td>
                  <td data-label="Faturas pagas" style={{ textAlign: "right" }}>
                    {asNumber(item.faturas_pagas)}
                  </td>
                  <td data-label="Emitido" style={{ textAlign: "right" }}>
                    {moeda(item.emitido, item.emitido_centavos)}
                  </td>
                  <td data-label="Faturas emitidas" style={{ textAlign: "right" }}>
                    {asNumber(item.faturas_emitidas)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            <div className="fa-celula-clinica">
              <strong>{linha.plano || linha.plan_code}</strong>
              <small>
                {linha.plan_code} · {moeda(linha.preco, linha.preco_centavos)}/mês
                {linha.plano_ativo ? "" : " · inativo na vitrine"}
              </small>
            </div>
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
          render: (linha) => (
            <div className="fa-participacao">
              {/* Barra é geometria, não dinheiro: o percentual já vem pronto do
                  backend, calculado sobre os centavos inteiros. */}
              <i style={{ width: `${Math.min(asNumber(linha.participacao_mrr), 100)}%` }} />
              <span>{percentual(linha.participacao_mrr)}</span>
            </div>
          ),
        },
        {
          key: "recebido_mes",
          label: "Recebido no mês (caixa)",
          align: "right",
          value: (linha) => asNumber(linha.recebido_mes_centavos),
          render: (linha) => (
            <>
              {moeda(linha.recebido_mes, linha.recebido_mes_centavos)}
              <small className="fa-sub"> {plural(asNumber(linha.recebido_mes_faturas), "fatura", "faturas")}</small>
            </>
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
    <div className="fa-root">
      <div className="panel fa-intro">
        <div>
          <h2>Financeiro da plataforma</h2>
          <p>
            A saúde da receita da Monitence: quanto entrou, quanto ainda vai entrar, quem está devendo e há quanto
            tempo. Somente leitura — nada aqui cria, altera ou baixa fatura.
          </p>
        </div>
        <div className="fa-controles">
          <Input type="date" label="Data base" value={dataBase} onChange={trocarDataBase} />
          <Button variant="secondary" disabled={!dataBase} onClick={() => trocarDataBase("")}>
            Voltar para hoje
          </Button>
        </div>
      </div>

      <p className="fa-hint">
        {cabecalho.data_base ? (
          <>
            Painel calculado como se hoje fosse <strong>{dataCompleta(cabecalho.data_base)}</strong> · competência{" "}
            <strong>{cabecalho.competencia}</strong> · fuso {cabecalho.fuso}.
          </>
        ) : (
          "Deixe a data base vazia para ver a situação de hoje. Preenchida, ela congela o “hoje” de todos os blocos — é o que permite conferir um fechamento passado."
        )}
      </p>

      <Bloco
        titulo="Resumo"
        subtitulo="Projeção e caixa lado a lado, cada um com sua etiqueta."
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
        acoes={
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
        acoes={
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
