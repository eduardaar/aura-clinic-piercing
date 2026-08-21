// Conciliação periódica com o Asaas: a rede de segurança do webhook perdido.
//
// Quem confirma pagamento é o WEBHOOK — este laço não é o caminho principal e
// não deve tentar ser. Ele existe porque a entrega de webhook falha de formas
// que ninguém percebe na hora: a API estava fora no minuto da entrega, o Asaas
// pausou a fila da conta depois de alguns 500, o deploy derrubou o processo no
// meio do POST. Sem conciliação, o sintoma é uma clínica jurando que pagou e
// uma fatura "pendente" para sempre.
//
// Por isso tudo aqui é BEST-EFFORT e deliberadamente devagar:
//
//   - intervalo longo (default 15 min): atraso de minutos numa confirmação é
//     aceitável; rajada de chamadas ao gateway não é (custo e rate limit);
//   - teto por rodada: preferimos deixar itens para a próxima a estourar o
//     limite do Asaas e perder TAMBÉM as chamadas do caminho principal;
//   - try/catch por item: uma clínica com a chave revogada não pode impedir a
//     conciliação das outras;
//   - sem sobreposição: se uma rodada demora mais que o intervalo, a seguinte é
//     pulada — duas rodadas juntas dobrariam as chamadas e reprocessariam os
//     mesmos itens (idempotentes, mas pagos duas vezes em chamada de API).
//
// `syncInvoice` e `syncIntent` já fazem todo o trabalho e são idempotentes; a
// responsabilidade deste arquivo é só ESCOLHER o que reconciliar e a que ritmo.
import { query } from "../../database/connection.js";
import { withTenantSchema } from "../../db/tenantSession.js";
import { syncInvoice } from "../platformBilling.js";
import { syncIntent } from "../tenantCharges.js";
import { isPlatformEnabled, tenantClient } from "./credentials.js";

// As variáveis moram aqui, e não em config/index.js, porque ninguém mais no
// sistema as consome: são o ajuste fino de UM worker. Se um segundo módulo
// passar a precisar delas, o lugar certo passa a ser o config.

// DESLIGADO POR PADRÃO, inclusive em produção — a ativação é explícita.
// Amarrar ao NODE_ENV seria uma armadilha silenciosa: a suíte de testes sobe o
// servidor de verdade com NODE_ENV=production (ver tests/run-suite.mjs), então
// "ligar em produção" ligaria o worker em toda execução de teste, batendo no
// gateway com as credenciais que estiverem no .env do desenvolvedor.
const ENABLED = String(process.env.ASAAS_RECONCILE_ENABLED || "").trim().toLowerCase() === "true";

function envNumber(name, fallback, min, max) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.trunc(raw), min), max);
}

// Default conservador: 15 min. O piso de 1 min existe só para permitir
// diagnóstico manual; nada abaixo disso faz sentido para uma rede de segurança.
const INTERVAL_MS = envNumber("ASAAS_RECONCILE_INTERVAL_MIN", 15, 1, 24 * 60) * 60_000;

// Teto de itens por rodada, POR LADO (plataforma e clínicas). Cada item é pelo
// menos um GET /payments; 50 + 50 é uma rodada que o Asaas absorve sem
// reclamar, e o excedente sobra para a próxima (com log — ver `relatarSobra`).
const BATCH = envNumber("ASAAS_RECONCILE_BATCH", 50, 1, 500);

// Janela de interesse. Fatura da plataforma é mensal, então 45 dias cobrem o
// ciclo corrente e o anterior; cobrança de cliente final (PIX/boleto/cartão)
// resolve-se em dias, e depois disso o intent já foi abandonado.
const JANELA_FATURAS_DIAS = 45;
const JANELA_INTENTS_DIAS = 7;

// Carência antes de considerar um item "esquecido". Sem ela a conciliação
// competiria com o webhook que está a caminho: toda cobrança recém-criada seria
// consultada no gateway antes de ter chance de ser confirmada sozinha.
const CARENCIA_MIN = 10;

// Aceita o nome novo (derivado do slug) e o formato legado "tenant_<id>"
// usado no fallback de clinicasCandidatas() enquanto schema_name for NULL.
const TENANT_SCHEMA_REGEX = /^tenant_[a-z0-9_]{1,58}$/;

let timer = null;
// Trava de sobreposição. Um booleano de módulo basta: o laço vive num processo
// só, e a coordenação entre instâncias (se um dia houver mais de uma) teria de
// ser um lock no banco, não uma variável.
let rodando = false;

function log(mensagem) {
  console.log(`[Asaas/conciliação] ${mensagem}`);
}

// Truncar em silêncio é o pior desfecho possível: o log diria "conciliei tudo"
// enquanto uma fila cresce sem ninguém saber. Se sobrou, aparece.
function relatarSobra(lado, total, processados) {
  if (total > processados) {
    log(
      `${lado}: ${processados} de ${total} item(ns) nesta rodada; ` +
        `${total - processados} ficaram para a próxima (teto ASAAS_RECONCILE_BATCH=${BATCH}).`
    );
  }
}

// ---------------------------------------------------------------------------
// Lado plataforma (schema `platform`)
// ---------------------------------------------------------------------------

/**
 * Faturas da assinatura das clínicas que continuam em aberto e já passaram da
 * carência. Ordem do mais parado para o mais recente: uma fatura pendente há
 * dias é justamente o caso em que o webhook se perdeu, e a rotação por
 * `updated_at` impede que os mesmos itens monopolizem todas as rodadas.
 */
async function faturasPendentes() {
  const result = await query(
    `WITH candidatas AS (
       SELECT id, updated_at
         FROM platform.tenant_invoices
        WHERE status IN ('pendente', 'atrasada')
          AND asaas_payment_id IS NOT NULL
          AND COALESCE(due_date, created_at::date) >= (now() - make_interval(days => $1))::date
          AND updated_at < now() - make_interval(mins => $2)
     )
     SELECT id, (SELECT count(*) FROM candidatas)::int AS total
       FROM candidatas
      ORDER BY updated_at ASC
      LIMIT $3`,
    [JANELA_FATURAS_DIAS, CARENCIA_MIN, BATCH]
  );
  return { itens: result.rows, total: result.rows[0]?.total ?? 0 };
}

async function conciliarPlataforma() {
  // Sem credencial da Monitence não existe o que conciliar deste lado — e
  // `syncInvoice` lançaria PlatformBillingError em cada item.
  if (!isPlatformEnabled()) return 0;

  const { itens, total } = await faturasPendentes();
  let aplicadas = 0;
  for (const fatura of itens) {
    try {
      const resultado = await syncInvoice(fatura.id);
      if (resultado?.applied) {
        aplicadas += 1;
        log(`fatura ${fatura.id} atualizada pela conciliação (${resultado.detail}).`);
      }
    } catch (error) {
      // Uma fatura com cobrança apagada no painel do Asaas devolve 404 para
      // sempre. Registrar e seguir é melhor que interromper a rodada.
      console.error(`[Asaas/conciliação] falha ao conciliar a fatura ${fatura.id}: ${error.message}`);
    }
  }
  relatarSobra("plataforma", total, itens.length);
  return aplicadas;
}

// ---------------------------------------------------------------------------
// Lado clínica (um schema por clínica)
// ---------------------------------------------------------------------------

/**
 * Clínicas ativas cujo schema já tem as tabelas envolvidas.
 *
 * O `to_regclass` cobre a janela em que uma clínica recém-criada existe em
 * `platform.tenants` mas ainda não recebeu o schema.sql — consultar a tabela
 * direto ali derrubaria a rodada inteira com "relation does not exist".
 */
async function clinicasCandidatas() {
  // COALESCE cobre a janela entre o deploy do schema_name e a migration 0005
  // rodar (ver services/tenants.js) — sem isso, uma clínica provisionada
  // antes dela ficaria fora da conciliação até a migration aplicar.
  const result = await query(
    `SELECT id, COALESCE(schema_name, 'tenant_' || id) AS schema_name
       FROM platform.tenants
      WHERE status = 'ativo'
        AND to_regclass(COALESCE(schema_name, 'tenant_' || id) || '.payment_intents') IS NOT NULL
        AND to_regclass(COALESCE(schema_name, 'tenant_' || id) || '.tenant_integrations') IS NOT NULL
      ORDER BY id`
  );
  return result.rows
    .map((row) => ({ id: Number(row.id), schema: row.schema_name }))
    .filter((tenant) => Number.isInteger(tenant.id) && tenant.id > 0);
}

/**
 * Intents em aberto de TODAS as clínicas, em uma única ida ao banco.
 *
 * CUSTO — vale explicar a escolha. `tenant_integrations` e `payment_intents`
 * são por clínica, então descobrir o que conciliar exige olhar dentro de cada
 * schema. O caminho óbvio (abrir uma sessão por clínica com `withTenantSchema`)
 * custa N conexões do pool e N round-trips POR RODADA, mesmo quando ninguém tem
 * pagamento online — e a maioria das clínicas opera só no presencial. Aqui, uma
 * UNION ALL montada sobre os schemas resolve tudo em um round-trip e devolve
 * apenas as clínicas que realmente têm trabalho; só essas ganham uma sessão de
 * tenant depois.
 *
 * A interpolação do nome do schema é segura pelo mesmo motivo do
 * `withTenantSchema`: o nome nasce de um inteiro vindo do banco e é revalidado
 * contra o regex antes de entrar no SQL — nada de input de usuário chega aqui.
 *
 * O limite disso é o tamanho do statement: com milhares de clínicas a query
 * fica grande demais e a saída passa a ser uma coluna em `platform.tenants`
 * marcando quem tem integração ativa (mantida pela tela de Integrações),
 * eliminando a varredura. Enquanto a base couber em dezenas/centenas de
 * clínicas, o custo de uma query longa é menor que o de N conexões.
 */
async function intentsPendentes(tenants) {
  if (!tenants.length) return { itens: [], total: 0 };

  const ramos = [];
  for (const { id, schema } of tenants) {
    if (!TENANT_SCHEMA_REGEX.test(schema)) continue;
    ramos.push(
      `SELECT ${id} AS tenant_id, i.id AS intent_id, i.created_at
         FROM "${schema}".payment_intents i
        WHERE i.provider = 'asaas'
          AND i.external_id IS NOT NULL
          AND i.status IN ('awaiting_payment', 'under_review')
          AND i.created_at >= now() - make_interval(days => $1)
          AND i.created_at < now() - make_interval(mins => $2)
          AND EXISTS (
                SELECT 1 FROM "${schema}".tenant_integrations t
                 WHERE t.provider = 'asaas' AND t.enabled = 1 AND t.secret_encrypted IS NOT NULL
              )`
    );
  }
  if (!ramos.length) return { itens: [], total: 0 };

  const result = await query(
    `WITH candidatos AS (${ramos.join(" UNION ALL ")})
     SELECT tenant_id, intent_id, (SELECT count(*) FROM candidatos)::int AS total
       FROM candidatos
      ORDER BY created_at ASC
      LIMIT $3`,
    [JANELA_INTENTS_DIAS, CARENCIA_MIN, BATCH]
  );
  return { itens: result.rows, total: result.rows[0]?.total ?? 0 };
}

async function conciliarClinicas() {
  const candidatas = await clinicasCandidatas();
  const { itens, total } = await intentsPendentes(candidatas);
  if (!itens.length) return 0;

  // Agrupa por clínica para abrir UMA sessão de tenant por clínica em vez de
  // uma por intent — cada sessão é uma conexão do pool e dois SET search_path.
  const porClinica = new Map();
  for (const linha of itens) {
    const tenantId = Number(linha.tenant_id);
    if (!porClinica.has(tenantId)) porClinica.set(tenantId, []);
    porClinica.get(tenantId).push(Number(linha.intent_id));
  }

  let aplicados = 0;
  // Clínicas em sequência (não em paralelo) de propósito: segura o número de
  // conexões do pool em uma e espaça as chamadas ao gateway.
  for (const [tenantId, intentIds] of porClinica) {
    try {
      await withTenantSchema(tenantId, async (db) => {
        // Confirma a credencial ANTES de gastar uma chamada por intent: chave
        // ausente/indecifrável faz `tenantClient` devolver null, e sem esta
        // checagem cada `syncIntent` descobriria o mesmo problema sozinho.
        const asaas = await tenantClient(db);
        if (!asaas) return;

        for (const intentId of intentIds) {
          try {
            const resultado = await syncIntent(db, intentId);
            if (resultado?.applied) {
              aplicados += 1;
              log(`clínica ${tenantId}: intent ${intentId} atualizado (${resultado.detail}).`);
            }
          } catch (error) {
            console.error(
              `[Asaas/conciliação] clínica ${tenantId}, intent ${intentId}: ${error.message}`
            );
          }
        }
      });
    } catch (error) {
      // Falha da sessão inteira (schema sumiu, pool esgotado): a próxima
      // clínica ainda tem de ser tentada.
      console.error(`[Asaas/conciliação] falha na clínica ${tenantId}: ${error.message}`);
    }
  }
  relatarSobra("clínicas", total, itens.length);
  return aplicados;
}

// ---------------------------------------------------------------------------
// Laço
// ---------------------------------------------------------------------------

/**
 * Uma rodada completa. Exportada para permitir disparo manual (script de
 * suporte, teste) sem depender do timer.
 *
 * @returns {Promise<{ executou: boolean, plataforma: number, clinicas: number }>}
 *   `executou:false` significa que outra rodada ainda estava em andamento.
 */
export async function runReconcileOnce() {
  if (rodando) {
    log("rodada anterior ainda em andamento; esta foi pulada.");
    return { executou: false, plataforma: 0, clinicas: 0 };
  }
  rodando = true;
  const inicio = Date.now();
  let plataforma = 0;
  let clinicas = 0;
  try {
    // Os dois lados são independentes: o gateway da plataforma fora do ar não
    // pode impedir a conciliação das cobranças das clínicas (contas e chaves
    // diferentes), e vice-versa.
    try {
      plataforma = await conciliarPlataforma();
    } catch (error) {
      console.error(`[Asaas/conciliação] lado plataforma falhou: ${error.message}`);
    }
    try {
      clinicas = await conciliarClinicas();
    } catch (error) {
      console.error(`[Asaas/conciliação] lado clínicas falhou: ${error.message}`);
    }
  } finally {
    rodando = false;
  }

  // Log só quando houve efeito: uma linha a cada 15 min dizendo "nada a fazer"
  // é exatamente o ruído que faz o log deixar de ser lido.
  if (plataforma || clinicas) {
    log(
      `rodada concluída em ${Date.now() - inicio}ms: ` +
        `${plataforma} fatura(s) e ${clinicas} intent(s) atualizados.`
    );
  }
  return { executou: true, plataforma, clinicas };
}

/**
 * Liga o laço. Idempotente: chamar duas vezes não cria dois timers.
 * @returns {boolean} se o worker ficou ativo
 */
export function startReconcileWorker() {
  if (timer) return true;
  if (!ENABLED) {
    // Silêncio em dev é intencional: o boot já tem log demais e "worker
    // desligado" é o estado esperado na máquina do desenvolvedor.
    return false;
  }

  timer = setInterval(() => {
    // O `catch` aqui é o último anteparo: uma rejeição não tratada dentro de um
    // callback de timer derruba o processo no Node 20 — o servidor inteiro cair
    // por causa da rede de segurança seria o oposto do objetivo.
    runReconcileOnce().catch((error) => {
      console.error(`[Asaas/conciliação] rodada falhou: ${error?.message || error}`);
    });
  }, INTERVAL_MS);

  // CRÍTICO: sem `unref` o timer sozinho mantém o event loop vivo e o processo
  // nunca encerra — a suíte de testes sobe o servidor de verdade e ficaria
  // pendurada esperando um `exit` que não vem.
  timer.unref?.();

  // A primeira rodada é a do próximo intervalo, não a do boot: no boot o
  // processo ainda está aplicando schema e servindo as primeiras requisições, e
  // conciliação nenhuma é urgente a esse ponto.
  log(`worker ligado (a cada ${INTERVAL_MS / 60_000} min, até ${BATCH} item(ns) por lado).`);
  return true;
}

/** Para o laço. Idempotente; usado no encerramento e nos testes. */
export function stopReconcileWorker() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
