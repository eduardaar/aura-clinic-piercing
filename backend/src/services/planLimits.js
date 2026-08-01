// Cotas de plano: quanto a clínica JÁ usa e se ela ainda pode CRIAR mais.
//
// Três decisões governam o arquivo inteiro, e nenhuma é detalhe de implementação:
//
//  1. COTA NUNCA APAGA NEM ESCONDE DADO. Ela só impede criar. Uma clínica que
//     baixou de plano e ficou acima da cota continua enxergando e editando tudo
//     que já cadastrou — o contrário seria destruir dado de cliente pagante por
//     causa de uma decisão comercial. Por isso este arquivo só expõe um guard de
//     ESCRITA (`requireWithinLimit`) e nenhum filtro de leitura: não existe aqui
//     nada que possa ser plugado num SELECT.
//
//  2. MEDIÇÃO BARATA. Estes contadores rodam no caminho de criação de registro.
//     Duas escolhas seguram o custo:
//       - plano SEM aquela cota (o caso comum hoje: todo `limits` é `{}`) não
//         faz consulta NENHUMA ao schema da clínica — sai antes de medir;
//       - o resultado é cacheado por 15s, mas o cache só é confiado enquanto
//         houver folga (< 90% da cota). Perto do teto a medição é sempre fresca,
//         que é justamente onde o número precisa estar certo.
//     A janela de 15s com folga de 10% significa que, para furar a cota, a
//     clínica teria de criar 10% do próprio limite em 15 segundos. É o risco
//     assumido — e ele custa "um registro a mais", não uma cobrança errada.
//
//  3. FALHA DE MEDIÇÃO LIBERA. Banco lento, tabela ausente, schema estranho:
//     qualquer erro de contagem devolve `allowed: true` e registra no log.
//     Trancar uma clínica pagante por causa de um bug nosso de contagem é pior
//     do que deixar passar um registro além da cota.
import { withTenantSchema } from "../db/tenantSession.js";
import { LIMIT_CATALOG, LIMIT_KEYS, planByCode, planLimit } from "./plans.js";
import { tenantSubscription } from "./subscriptions.js";

const USAGE_CACHE_TTL_MS = 15 * 1000;

// Acima desta fração da cota o cache é ignorado e a contagem é refeita. Abaixo
// dela, um número de até 15s atrás não muda a decisão: para 200 clientes, a
// folga confiada é de 20 cadastros.
const NEAR_LIMIT_RATIO = 0.9;

// Cache por (clínica, cota): `${tenantId}:${limitKey}` -> { value, expiresAt }.
// Por chave, e não por clínica inteira, porque o caminho quente mede UMA cota —
// invalidar/renovar as cinco juntas custaria cinco consultas para responder uma.
const usageCache = new Map();

function cacheKey(tenantId, limitKey) {
  return `${Number(tenantId)}:${limitKey}`;
}

function cacheGet(tenantId, limitKey) {
  const entry = usageCache.get(cacheKey(tenantId, limitKey));
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    usageCache.delete(cacheKey(tenantId, limitKey));
    return undefined;
  }
  return entry.value;
}

function cacheSet(tenantId, limitKey, value) {
  usageCache.set(cacheKey(tenantId, limitKey), { value, expiresAt: Date.now() + USAGE_CACHE_TTL_MS });
}

/**
 * Descarta a medição cacheada. Chame depois de qualquer operação em massa
 * (importação de joias, exclusão de clientes) para o painel não mostrar um
 * número velho por 15s.
 * @param {number} [tenantId] sem argumento, limpa tudo.
 */
export function invalidateUsageCache(tenantId) {
  if (tenantId == null) {
    usageCache.clear();
    return;
  }
  const prefix = `${Number(tenantId)}:`;
  for (const key of usageCache.keys()) {
    if (key.startsWith(prefix)) usageCache.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Medidores
// ---------------------------------------------------------------------------
//
// Um por cota, e cada um roda a SUA consulta. Juntar as cinco num SELECT único
// economizaria round-trips, mas uma subconsulta quebrada (tabela ausente num
// schema antigo) derrubaria as outras quatro medições junto — e o caminho
// quente mede uma cota de cada vez de qualquer forma.
//
// Custo de cada um (medido pelo plano de execução, sem índice dedicado):
//   users              COUNT(*) em `users`     — dezenas de linhas. Irrisório.
//   clients            COUNT(*) em `clients`   — seq scan; ~3k linhas na base
//                      de demonstração (<2ms). Cresce linearmente.
//   appointments_month COUNT(*) com filtro em `created_at` (TEXT, sem índice) —
//                      seq scan da tabela inteira. É o mais caro dos quatro, e
//                      o que mais se beneficiaria de um índice (ver o README da
//                      entrega: idx_appointments_created).
//   jewelry_items      COUNT(*) em `jewelry_inventory` — seq scan.
//   storage_mb         APROXIMADO; ver o comentário do medidor.
const MEASURERS = {
  async users(db) {
    const row = await db.get("SELECT COUNT(*)::int AS total FROM users");
    return Number(row?.total || 0);
  },

  async clients(db) {
    const row = await db.get("SELECT COUNT(*)::int AS total FROM clients");
    return Number(row?.total || 0);
  },

  // "Agendamentos criados no mês corrente" (o texto do LIMIT_CATALOG), e não
  // agendamentos COM DATA no mês: a cota mede o volume de trabalho lançado no
  // sistema, e marcar hoje um horário para dezembro consome a cota de hoje.
  //
  // Os limites do mês são calculados em SQL de propósito. `created_at` é TEXT
  // gravado por `to_char(now(), ...)`, ou seja, no fuso do BANCO; montá-los com
  // um `new Date()` do processo Node erraria o começo do mês sempre que os dois
  // relógios estivessem em fusos diferentes.
  async appointments_month(db) {
    const row = await db.get(
      `SELECT COUNT(*)::int AS total
         FROM appointments
        WHERE created_at >= to_char(date_trunc('month', now()), 'YYYY-MM-DD HH24:MI:SS')
          AND created_at < to_char(date_trunc('month', now()) + INTERVAL '1 month', 'YYYY-MM-DD HH24:MI:SS')`
    );
    return Number(row?.total || 0);
  },

  async jewelry_items(db) {
    const row = await db.get("SELECT COUNT(*)::int AS total FROM jewelry_inventory");
    return Number(row?.total || 0);
  },

  // APROXIMAÇÃO ASSUMIDA, e não um número exato disfarçado.
  //
  // Hoje é impossível medir o espaço real de uma clínica: os arquivos são
  // gravados num diretório ÚNICO no disco (src/data/uploads), com nome aleatório
  // e sem prefixo de tenant, e nenhuma tabela guarda o tamanho em bytes. Somar
  // de verdade exigiria um `stat` por arquivo — I/O de disco no caminho de
  // criação de registro, que é exatamente o que a regra da medição barata
  // proíbe.
  //
  // Então contamos os arquivos que a clínica REFERENCIA e multiplicamos por uma
  // média por tipo. O resultado é uma ordem de grandeza honesta para a tela do
  // super-admin — e é por isso que `storage_mb` é a última cota que se deveria
  // usar para bloquear criação (ver a recomendação de aplicação dos guards).
  //
  // Subestima de propósito em um ponto: `gallery_urls` guarda uma LISTA de
  // imagens por joia num TEXT, e abri-la linha a linha custaria mais do que a
  // precisão ganha. Contamos uma imagem por joia.
  async storage_mb(db) {
    const row = await db.get(
      `SELECT
         (SELECT COUNT(*)::int FROM private_files) AS documentos,
         (SELECT COUNT(*)::int FROM jewelry_inventory
           WHERE COALESCE(NULLIF(image_url, ''), NULLIF(photo_url, '')) IS NOT NULL) AS imagens,
         (SELECT COUNT(*)::int FROM digital_terms WHERE COALESCE(pdf_url, '') <> '') AS termos`
    );
    const imagens = Number(row?.imagens || 0);
    const documentos = Number(row?.documentos || 0) + Number(row?.termos || 0);
    // Médias observadas nos uploads já processados pelo sharp (foto de produto)
    // e nos PDFs de anamnese/termo gerados pelo pdfkit.
    const totalKb = imagens * 250 + documentos * 120;
    return Math.round(totalKb / 1024);
  }
};

// Executa `fn(db)` no schema da clínica. Reusa o `db` da requisição quando ele
// vem — o handler já está com o search_path certo, e pegar um segundo client do
// pool a cada criação de registro dobraria a pressão sobre ele à toa.
async function withClinicDb(db, tenantId, fn) {
  if (db) return fn(db);
  return withTenantSchema(tenantId, fn);
}

// Mede UMA cota, sem cache. Devolve `null` se a medição falhar — e `null` aqui
// significa "não sei", que os chamadores traduzem em liberado.
async function measureOne(db, tenantId, limitKey) {
  const measurer = MEASURERS[limitKey];
  if (!measurer) return null;
  try {
    const value = await withClinicDb(db, tenantId, (clinicDb) => measurer(clinicDb));
    const total = Number(value);
    if (!Number.isFinite(total) || total < 0) return null;
    cacheSet(tenantId, limitKey, total);
    return total;
  } catch (error) {
    // Não relança: quem chama precisa poder LIBERAR a operação.
    console.error(`[planLimits] falha ao medir "${limitKey}" da clínica ${tenantId}: ${error.message}`);
    return null;
  }
}

/**
 * Uso atual de TODAS as cotas do catálogo. Uma consulta por cota, sempre fresca:
 * é a chamada do painel do super-admin, feita ao abrir a tela de uma conta, e
 * não vale a pena mostrar número velho para quem está decidindo troca de plano.
 *
 * @param {number} tenantId
 * @param {{ db?: any, keys?: string[] }} [options]
 * @returns {Promise<Record<string, number|null>>} `null` numa chave = medição
 *   falhou (nunca zero: zero é uma afirmação, e aqui não sabemos).
 */
export async function measureTenantUsage(tenantId, { db = null, keys = LIMIT_KEYS } = {}) {
  const usage = {};
  for (const key of keys) {
    if (!MEASURERS[key]) continue;
    usage[key] = await measureOne(db, tenantId, key);
  }
  return usage;
}

// Leitura com cache. O cache só é aceito com folga: perto do teto a decisão
// precisa do número de agora, e é lá que o custo extra se justifica.
async function readUsage(db, tenantId, limitKey, limit) {
  const cached = cacheGet(tenantId, limitKey);
  if (cached !== undefined && cached < Math.floor(limit * NEAR_LIMIT_RATIO)) {
    return { used: cached, fresh: false };
  }
  return { used: await measureOne(db, tenantId, limitKey), fresh: true };
}

/**
 * A clínica ainda pode criar mais um registro desta cota?
 *
 * @param {any} db `db` da requisição (já no schema da clínica) ou null/undefined
 *   para abrir uma conexão própria via withTenantSchema.
 * @param {number} tenantId
 * @param {string} limitKey chave do LIMIT_CATALOG.
 * @returns {Promise<{ allowed: boolean, used: number|null, limit: number|null }>}
 *   `limit === null` = ILIMITADO (e então nada foi medido, nem consultado).
 */
export async function checkLimit(db, tenantId, limitKey) {
  const key = String(limitKey || "");
  const base = { allowed: true, used: null, limit: null, limit_key: key, plan_code: null, measured: false };

  // Cota que não existe no catálogo é bug nosso, e bug nosso não bloqueia
  // ninguém: registra e libera.
  if (!LIMIT_KEYS.includes(key)) {
    console.error(`[planLimits] cota desconhecida: "${limitKey}"`);
    return base;
  }

  let subscription = null;
  try {
    subscription = await tenantSubscription(tenantId);
  } catch (error) {
    console.error(`[planLimits] falha ao ler a assinatura da clínica ${tenantId}: ${error.message}`);
    return base;
  }

  // Sem assinatura não há plano, e sem plano não há cota. Quem decide se essa
  // clínica pode operar é `requireFeature` (402), não o contador de cotas.
  const planCode = subscription?.plan_code || null;
  const limit = planCode ? planLimit(planCode, key) : null;
  // ILIMITADO: sai daqui sem tocar no schema da clínica. É o caminho da imensa
  // maioria das chamadas e o que torna o guard barato o bastante para ficar numa
  // rota de criação.
  if (limit === null) return { ...base, plan_code: planCode };

  const { used } = await readUsage(db, tenantId, key, limit);
  // Medição falhou: libera (regra 3 do cabeçalho).
  if (used === null) return { ...base, plan_code: planCode, limit };

  return { allowed: used < limit, used, limit, limit_key: key, plan_code: planCode, measured: true };
}

function limitMeta(limitKey) {
  return LIMIT_CATALOG.find((item) => item.key === limitKey) || { key: limitKey, label: limitKey, unit: "" };
}

/**
 * Guard inline, no mesmo formato de `requireFeature`: devolve `true` se a
 * criação pode seguir e, quando não pode, JÁ RESPONDE 409 e devolve `false`.
 *
 * 409 (e não 403) porque não é falta de permissão nem de feature: o recurso
 * está no plano, o que acabou foi a cota — um conflito com o estado atual da
 * conta, que a clínica resolve apagando registros ou fazendo upgrade.
 *
 * Uso:
 *   router.post(path, withDb(async (req, res, db) => {
 *     if (!(await requireWithinLimit(req, res, "clients", db))) return;
 *     ...
 *   }));
 *
 * @param {any} req precisa de `req.tenant.id` (o withDb já resolveu).
 * @param {any} res
 * @param {string} limitKey
 * @param {any} [db] `db` da requisição; passe-o sempre que existir para
 *   reaproveitar a conexão em vez de tirar outra do pool.
 */
export async function requireWithinLimit(req, res, limitKey, db = null) {
  const outcome = await checkLimit(db, req.tenant?.id, limitKey);
  if (outcome.allowed) return true;

  const meta = limitMeta(limitKey);
  const plan = planByCode(outcome.plan_code);
  res.status(409).json({
    error:
      `Seu plano (${plan.name}) permite até ${outcome.limit} ${meta.unit || meta.label.toLowerCase()} ` +
      `e você já tem ${outcome.used}. Faça upgrade para cadastrar mais — nada do que já existe será removido.`,
    code: "plan_limit_reached",
    limit_key: meta.key,
    limit_label: meta.label,
    limit: outcome.limit,
    used: outcome.used,
    plan_code: outcome.plan_code
  });
  return false;
}

/**
 * Uso x cota de todas as chaves, pronto para a tela do super-admin.
 *
 * `over_limit` é informativo: existe para o painel avisar "esta clínica está
 * acima da cota depois do downgrade", NUNCA para esconder ou apagar o excedente.
 *
 * @param {number} tenantId
 * @param {string} planCode plano vigente da clínica.
 */
export async function tenantUsageReport(tenantId, planCode) {
  const usage = await measureTenantUsage(tenantId);
  return LIMIT_CATALOG.map((item) => {
    const limit = planLimit(planCode, item.key);
    const used = usage[item.key];
    return {
      key: item.key,
      label: item.label,
      unit: item.unit,
      used,
      limit,
      unlimited: limit === null,
      // Só é possível afirmar que estourou quando a medição funcionou.
      over_limit: limit !== null && used !== null && used > limit,
      // Sem cota não há percentual; com cota 0 qualquer uso já é 100%.
      percent: limit === null || used === null ? null : limit === 0 ? 100 : Math.round((used / limit) * 100),
      // O painel precisa dizer "≈" no armazenamento em vez de fingir precisão.
      approximate: item.key === "storage_mb",
      measured: used !== null
    };
  });
}
