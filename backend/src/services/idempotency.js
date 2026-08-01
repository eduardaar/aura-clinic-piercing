// Idempotência PERSISTENTE de requisições que movem dinheiro.
//
// Antes isto era um Map por processo em routes/billing.js. Com mais de uma
// instância atrás do balanceador o mapa não protegia nada: as duas metades de um
// duplo-clique caem em processos diferentes e viram duas assinaturas recorrentes
// e duas cobranças no cartão. A garantia agora vem do índice único
// ux_idempotency_keys_scope — não de um SELECT antes do INSERT, que perderia a
// corrida exatamente no caso que interessa (duas requisições simultâneas).
//
// O QUE NUNCA ENTRA NESTA TABELA: o corpo da requisição.
// A única rota que usa este serviço é o checkout de cartão, cujo corpo carrega
// número do cartão e CVV. Guardar o corpo para comparar repetições
// transformaria esta tabela num repositório de dados de cartão — o pior
// artefato que este sistema poderia criar. Comparamos um SHA-256 do corpo, que
// responde "é a mesma requisição?" sem guardar nada legível.
//
// Vive no schema `platform` (global, com `query()` e placeholders $1) porque a
// chave é escopada por clínica mas o dado não pertence ao schema de nenhuma —
// mesma razão de platform.webhook_events.
import crypto from "crypto";
import { query } from "../database/connection.js";

// 24h: janela generosa o suficiente para cobrir a repetição por timeout de rede
// e curta o suficiente para a chave voltar a ser reutilizável um dia depois.
const TTL_HOURS = 24;

// Reserva órfã: o processo morreu DEPOIS de reivindicar a chave e antes de
// concluir. Sem esta janela a clínica ficaria 24h impedida de repetir aquele
// checkout por causa de um deploy no instante errado. 15 minutos é ordens de
// grandeza acima do tempo real de um checkout (segundos) e abaixo de qualquer
// timeout de HTTP — não há risco de "roubar" uma requisição ainda viva.
const STALE_IN_PROGRESS_MINUTES = 15;

// Nomes de campo que jamais podem ser persistidos, checados na resposta guardada.
const CARD_FIELD_REGEX = /(card|number|ccv|cvv|cvc|holder|security|token|secret)/i;

/**
 * Conflito de idempotência. Sempre 409: a requisição é legítima em forma, mas
 * executá-la agora cobraria errado (ou cobraria duas vezes).
 */
export class IdempotencyError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "IdempotencyError";
    this.statusCode = 409;
    this.code = code;
  }
}

// Hash estável do corpo: chaves ordenadas recursivamente para que a MESMA
// requisição reenviada não vire "corpo diferente" só porque o JSON chegou com
// os campos em outra ordem. O valor de retorno é o único vestígio do corpo que
// sai desta função.
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function hashRequest(body) {
  return crypto.createHash("sha256").update(stableStringify(body), "utf8").digest("hex");
}

// Rede de segurança para a resposta guardada.
//
// Hoje `startSubscriptionCheckout` devolve só ids, o tipo de cobrança, a URL da
// fatura e o status — nada de cartão, conferido campo a campo. Este filtro não
// existe para o hoje: existe para o dia em que alguém acrescentar um campo ao
// retorno sem lembrar que ele passa a ser gravado aqui. Descartar em silêncio
// seria pior que o problema, então o descarte é logado.
function withoutCardData(value, path = "") {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item, i) => withoutCardData(item, `${path}[${i}]`));
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (CARD_FIELD_REGEX.test(key)) {
      console.error(
        `[idempotency] campo "${path}${key}" descartado da resposta guardada: parece dado de cartão.`
      );
      continue;
    }
    clean[key] = withoutCardData(item, `${path}${key}.`);
  }
  return clean;
}

// Limpeza preguiçosa, na própria chamada — igual ao que o mapa em memória fazia
// varrendo as entradas vencidas. Não vale um job novo: a tabela tem uma linha
// por checkout de cartão e some sozinha.
async function purgeExpired() {
  await query(
    `DELETE FROM platform.idempotency_keys
      WHERE expires_at <= now()
         OR (status = 'in_progress'
             AND created_at < now() - ($1 || ' minutes')::interval)`,
    [String(STALE_IN_PROGRESS_MINUTES)]
  );
}

/**
 * Executa `run` no máximo uma vez por (tenant, endpoint, chave).
 *
 * @param {{ tenantId: number, endpoint: string, key: string, body: unknown }} scope
 *   `body` é usado APENAS para calcular o hash de comparação; não é gravado.
 * @param {() => Promise<object>} run
 * @returns {Promise<{ result: object, replayed: boolean }>}
 * @throws {IdempotencyError} corpo diferente para a mesma chave, ou execução
 *   ainda em voo em qualquer instância.
 */
export async function runIdempotent({ tenantId, endpoint, key, body }, run) {
  // Corte de tamanho antes de tocar o banco: a chave vem de um header, e um
  // header de megabytes não pode virar linha (nem chave de índice) aqui.
  const scopedKey = String(key || "").trim().slice(0, 200);
  if (!scopedKey) {
    throw new IdempotencyError("Chave de idempotência ausente.", "idempotency_key_ausente");
  }

  await purgeExpired();

  const requestHash = hashRequest(body);

  // Reivindicação atômica: quem consegue inserir executa, quem colide já sabe
  // que alguém chegou antes. O DO NOTHING não devolve linha na colisão — é
  // assim que distinguimos os dois papéis sem uma leitura prévia condenada.
  const claimed = await query(
    `INSERT INTO platform.idempotency_keys
       (tenant_id, endpoint, idempotency_key, request_hash, status, expires_at)
     VALUES ($1, $2, $3, $4, 'in_progress', now() + ($5 || ' hours')::interval)
     ON CONFLICT (tenant_id, endpoint, idempotency_key) DO NOTHING
     RETURNING id`,
    [tenantId, endpoint, scopedKey, requestHash, String(TTL_HOURS)]
  );

  const claim = claimed.rows[0];
  if (!claim) return replay({ tenantId, endpoint, key: scopedKey, requestHash });

  let result;
  try {
    result = await run();
  } catch (error) {
    // Falha NÃO fica memorizada. Cartão recusado é o caso comum: o admin
    // corrige o número e reenvia — normalmente com a mesma chave, porque o
    // formulário é o mesmo. Guardar o erro obrigaria a esperar o TTL para
    // conseguir pagar.
    await query("DELETE FROM platform.idempotency_keys WHERE id = $1", [claim.id]).catch(
      (cleanupError) =>
        console.error(
          `[idempotency] falha ao liberar a chave ${claim.id} após erro: ${cleanupError.message}`
        )
    );
    throw error;
  }

  await query(
    `UPDATE platform.idempotency_keys
        SET status = 'completed', response = $1::jsonb, completed_at = now()
      WHERE id = $2`,
    [JSON.stringify(withoutCardData(result ?? {})), claim.id]
  );

  return { result, replayed: false };
}

// Caminho de quem colidiu na reivindicação: decide entre devolver o resultado
// guardado e recusar.
async function replay({ tenantId, endpoint, key, requestHash }) {
  const found = await query(
    `SELECT request_hash, status, response
       FROM platform.idempotency_keys
      WHERE tenant_id = $1 AND endpoint = $2 AND idempotency_key = $3`,
    [tenantId, endpoint, key]
  );
  const row = found.rows[0];

  // A linha sumiu entre o INSERT e este SELECT (a outra requisição falhou e
  // apagou a reserva, ou o TTL a levou). É uma chave livre de novo, mas
  // reexecutar aqui exigiria refazer a reivindicação e abriria espaço para um
  // laço. Recusar com 409 devolve a decisão a quem tem o cartão na mão.
  if (!row) {
    throw new IdempotencyError(
      "Não foi possível confirmar o estado desta requisição. Tente novamente.",
      "idempotency_indefinida"
    );
  }

  // Mesma chave, corpo diferente: o cliente reusou a chave para OUTRA coisa.
  // Executar cobraria um plano (ou um cartão) que não é o que a chave
  // representa; devolver o resultado antigo responderia sobre outra requisição.
  // As duas saídas são erradas — a única honesta é recusar.
  if (row.request_hash !== requestHash) {
    throw new IdempotencyError(
      "Esta chave de idempotência já foi usada para outra requisição. Gere uma nova chave.",
      "idempotency_key_reutilizada"
    );
  }

  // Ainda em voo, possivelmente em outra instância. É o duplo-clique. Não dá
  // para esperar a promessa da outra requisição (ela vive em outro processo), e
  // executar em paralelo cobraria duas vezes — então respondemos o que é
  // verdade: está processando.
  if (row.status === "in_progress") {
    throw new IdempotencyError(
      "Pagamento em processamento. Aguarde alguns instantes antes de tentar de novo.",
      "pagamento_em_processamento"
    );
  }

  return { result: row.response ?? {}, replayed: true };
}
