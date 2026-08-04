// Camada fina de acesso ao Postgres: expõe `get` / `all` / `run` SOBRE UM
// CLIENT ESPECÍFICO, mais o helper de transação.
//
// Multi-tenant: cada requisição recebe um client do pool com o search_path
// apontando para o schema da clínica ("tenant_<id>"). Por isso NÃO existe um
// singleton global de `db` — toda query do app DEVE passar pelo objeto criado
// por createDb(client) dentro do withDb (ou de um client dedicado com
// search_path configurado, como no provisionamento).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

// Tabela de conversão padrão do driver (`pg-types`). Só o NUMERIC é
// sobrescrito abaixo; todo o resto continua exatamente como o `pg` entrega.
const pgTypes = pg.types;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Convenção de parâmetro do projeto: as queries são escritas com `?` posicional
// e traduzidas aqui para o `$1, $2, ...` que o driver `pg` espera. A tradução é
// posicional pura (o n-ésimo `?` vira `$n`), o que mantém o SQL legível e
// permite montar cláusulas condicionais sem renumerar nada à mão. Consequência:
// um `?` dentro de literal de string ou de operador jsonb também seria trocado
// — se precisar de um, use `$n` direto e não misture os dois estilos na mesma
// query.
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// OID do NUMERIC/DECIMAL no Postgres. Fixo desde sempre (pg_type.oid = 1700);
// é assim que o próprio `pg-types` o identifica.
const OID_NUMERIC = 1700;

// PONTE ENTRE O NUMERIC DO BANCO E O NUMBER DO JAVASCRIPT.
//
// Com dinheiro migrado de DOUBLE PRECISION para NUMERIC(12,2) (pendência 13),
// o driver `pg` passaria a devolver esses campos como STRING — é o padrão dele,
// e é o padrão CERTO, porque um NUMERIC arbitrário não cabe em `Number` sem
// perda. Só que o app inteiro (rotas, relatórios, dashboard, o frontend) trata
// esses campos como número há anos, e `"10.00" + "5.00"` em JavaScript não é 15:
// é "10.005.00". Seria uma quebra silenciosa em todo somatório do sistema.
//
// A conversão é feita AQUI, na camada de acesso das clínicas, e não com um
// `pg.types.setTypeParser` global, por um motivo concreto: o painel financeiro
// da plataforma (`services/platformFinance.js`) DEPENDE do comportamento padrão
// — ele devolve dinheiro como string decimal ("189.80") de propósito, para não
// passar por ponto flutuante em nenhum momento, e tem teste que exige isso. Um
// parser global quebraria justamente o código que já faz dinheiro do jeito
// certo. O recorte por camada mantém os dois contratos intactos: schema de
// clínica → number; schema `platform` (via `database/connection.js`) → string.
//
// O QUE ISSO GARANTE E O QUE NÃO GARANTE:
//   - GARANTE: a soma/subtração/multiplicação feita pelo POSTGRES (SUM, AVG,
//     amount - paid_amount, revenue * commission/100) é exata em decimal. É ali
//     que mora o erro que a pendência 13 descreve — milhares de linhas somadas.
//   - NÃO GARANTE: aritmética feita em JavaScript sobre o valor já convertido
//     continua sendo IEEE-754. Portanto SOMATÓRIO GRANDE SE FAZ EM SQL, nunca
//     com `reduce` sobre as linhas. Um `Number` representa exatamente qualquer
//     valor de NUMERIC(12,2) individual (10^10 reais = 10^12 centavos < 2^53);
//     o que ele não representa exatamente é a SOMA acumulada de muitos deles.
const TIPOS_TENANT = {
  getTypeParser(oid, format) {
    if (oid === OID_NUMERIC && format !== "binary") return numericParaNumber;
    return pgTypes.getTypeParser(oid, format);
  }
};

function numericParaNumber(value) {
  return value === null ? null : Number(value);
}

// Comandos de transação escritos "na mão" (`db.run("BEGIN")`) espalhados pelas
// rotas antigas. São interceptados para passarem pelo MESMO controle de
// profundidade do helper `transaction`: sem isso, um BEGIN dentro de uma
// transação já aberta vira apenas um warning do Postgres e o COMMIT interno
// encerraria a transação externa antes da hora.
const TX_COMMAND = /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK)(\s+(WORK|TRANSACTION))?\s*;?\s*$/i;

function transactionCommand(sql) {
  const match = TX_COMMAND.exec(String(sql));
  if (!match) return null;
  const verb = match[1].toUpperCase();
  if (verb === "BEGIN" || verb.startsWith("START")) return "BEGIN";
  return verb === "ROLLBACK" ? "ROLLBACK" : "COMMIT";
}

// Factory do `db`: executa tudo no client informado (que já deve estar com o
// search_path do tenant).
export function createDb(client) {
  // Pilha de níveis de transação DESTE client (vazia = autocommit). O nível 0 é
  // a transação real (BEGIN/COMMIT); os aninhados viram SAVEPOINT, porque o
  // Postgres não tem transação aninhada de verdade. Guardar isso aqui
  // funciona porque cada requisição tem um client dedicado e o driver serializa
  // as queries de uma conexão — não há duas transações concorrentes aqui.
  const frames = [];
  let savepointSeq = 0;

  async function beginFrame() {
    if (!frames.length) {
      await client.query("BEGIN");
      frames.push(null);
      return;
    }
    const name = `aura_sp_${++savepointSeq}`;
    await client.query(`SAVEPOINT ${name}`);
    frames.push(name);
  }

  async function commitFrame() {
    if (!frames.length) return; // COMMIT solto: mesmo no-op do autocommit anterior.
    const name = frames.pop();
    // RELEASE não confirma nada sozinho — só devolve o controle ao nível de
    // cima, que é exatamente o que um "COMMIT aninhado" deveria fazer.
    await client.query(name ? `RELEASE SAVEPOINT ${name}` : "COMMIT");
  }

  async function rollbackFrame() {
    if (!frames.length) return;
    const name = frames.pop();
    if (!name) {
      await client.query("ROLLBACK");
      return;
    }
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
  }

  // Ponto ÚNICO por onde passa toda query de clínica. Vai no formato de
  // objeto (e não `query(texto, valores)`) porque é o único jeito de anexar
  // `types` a uma query específica — é ele que aplica TIPOS_TENANT e mantém a
  // conversão de NUMERIC restrita a esta camada. Comandos de transação
  // (BEGIN/SAVEPOINT/…) seguem crus: não devolvem linha nenhuma.
  function executar(sql, params) {
    return client.query({ text: toPg(sql), values: params, types: TIPOS_TENANT });
  }

  const db = {
    async get(sql, params = []) {
      const result = await executar(sql, params);
      return result.rows[0];
    },
    async all(sql, params = []) {
      const result = await executar(sql, params);
      return result.rows;
    },
    // Para escritas. `changes` é o número de linhas afetadas; `rows` e
    // `returnedId` só vêm preenchidos se a query trouxer um RETURNING explícito
    // (quem precisa do id de um INSERT escreve `RETURNING id` na própria query).
    async run(sql, params = []) {
      const command = transactionCommand(sql);
      if (command) {
        if (command === "BEGIN") await beginFrame();
        else if (command === "COMMIT") await commitFrame();
        else await rollbackFrame();
        return { returnedId: undefined, changes: 0, rows: [] };
      }
      const result = await executar(sql, params);
      return { returnedId: result.rows?.[0]?.id, changes: result.rowCount, rows: result.rows || [] };
    },

    // Executa `fn` dentro de uma transação e devolve o que ela retornar.
    // Commit no fim, ROLLBACK em qualquer erro (o erro original é repropagado).
    // O `tx` recebido é o PRÓPRIO `db`: reusa o client da requisição, que é
    // quem carrega o search_path do tenant — pegar outro client do pool jogaria
    // a escrita no schema errado.
    // Aninhamento: se já houver transação em curso, este nível vira SAVEPOINT.
    // Assim um serviço transacional pode chamar outro sem que o COMMIT interno
    // encerre a transação externa; a falha do interno desfaz só a parte dele.
    async transaction(fn) {
      const base = frames.length;
      await beginFrame();
      try {
        const result = await fn(db);
        // Fecha também o que o callback tenha deixado aberto (BEGIN legado sem
        // COMMIT), sempre voltando à profundidade em que entramos.
        while (frames.length > base) await commitFrame();
        return result;
      } catch (error) {
        try {
          while (frames.length > base) await rollbackFrame();
        } catch (rollbackError) {
          // Conexão já perdida: o erro original é o que interessa ao chamador.
          console.error("Falha ao desfazer transação:", rollbackError);
        }
        throw error;
      }
    },

    inTransaction() {
      return frames.length > 0;
    },

    // Rede de segurança do withDb: garante que nenhum client volte ao pool com
    // transação pendurada (seguraria locks e vazaria escritas para o próximo uso).
    async abortOpenTransaction() {
      if (!frames.length) return false;
      try {
        while (frames.length) await rollbackFrame();
      } catch (error) {
        frames.length = 0;
        console.error("Falha ao abortar transação pendente:", error);
      }
      return true;
    },
  };

  return db;
}

// Aplica o schema unificado das clínicas (idempotente: CREATE TABLE IF NOT
// EXISTS) no client informado. O chamador é responsável por definir o
// search_path para o schema do tenant ANTES (apenas o schema do tenant, sem
// "public", para os IF NOT EXISTS não serem enganados por tabelas homônimas).
export async function applySchemaSql(client) {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await client.query(sql);
}
