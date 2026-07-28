// Adaptador que expõe a mesma interface do driver `sqlite` (get/all/run com
// placeholders `?`) porém executando no Postgres SOBRE UM CLIENT ESPECÍFICO.
//
// Multi-tenant: cada requisição recebe um client do pool com o search_path
// apontando para o schema da clínica ("tenant_<id>"). Por isso NÃO existe mais
// um singleton global de `db` — toda query do app DEVE passar pelo adaptador
// criado por createDbAdapter(client) dentro do withDb (ou de um client
// dedicado com search_path configurado, como no provisionamento).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Converte placeholders posicionais `?` (SQLite) em `$1, $2, ...` (Postgres).
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Tabelas cuja PK não é `id` (não devem receber RETURNING id automático).
const NO_RETURNING_ID = /^\s*INSERT\s+INTO\s+(catalog_settings|catalog_theme)\b/i;

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

// Factory do adaptador: executa tudo no client informado (que já deve estar
// com o search_path do tenant). Mesma semântica do antigo singleton.
export function createDbAdapter(client) {
  // Pilha de níveis de transação DESTE client (vazia = autocommit). O nível 0 é
  // a transação real (BEGIN/COMMIT); os aninhados viram SAVEPOINT, porque o
  // Postgres não tem transação aninhada de verdade. Guardar isso no adaptador
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

  const adapter = {
    async get(sql, params = []) {
      const result = await client.query(toPg(sql), params);
      return result.rows[0];
    },
    async all(sql, params = []) {
      const result = await client.query(toPg(sql), params);
      return result.rows;
    },
    async run(sql, params = []) {
      const command = transactionCommand(sql);
      if (command) {
        if (command === "BEGIN") await beginFrame();
        else if (command === "COMMIT") await commitFrame();
        else await rollbackFrame();
        return { lastID: undefined, changes: 0 };
      }
      let text = toPg(sql);
      const isInsert = /^\s*INSERT\s+INTO/i.test(text);
      if (isInsert && !/\bRETURNING\b/i.test(text) && !NO_RETURNING_ID.test(text)) {
        text += " RETURNING id";
      }
      const result = await client.query(text, params);
      return { lastID: result.rows[0]?.id, changes: result.rowCount };
    },

    // Executa `fn` dentro de uma transação e devolve o que ela retornar.
    // Commit no fim, ROLLBACK em qualquer erro (o erro original é repropagado).
    // O `tx` recebido é o PRÓPRIO adaptador: reusa o client da requisição, que é
    // quem carrega o search_path do tenant — pegar outro client do pool jogaria
    // a escrita no schema errado.
    // Aninhamento: se já houver transação em curso, este nível vira SAVEPOINT.
    // Assim um serviço transacional pode chamar outro sem que o COMMIT interno
    // encerre a transação externa; a falha do interno desfaz só a parte dele.
    async transaction(fn) {
      const base = frames.length;
      await beginFrame();
      try {
        const result = await fn(adapter);
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

  return adapter;
}

// Aplica o schema unificado das clínicas (idempotente: CREATE TABLE IF NOT
// EXISTS) no client informado. O chamador é responsável por definir o
// search_path para o schema do tenant ANTES (apenas o schema do tenant, sem
// "public", para os IF NOT EXISTS não serem enganados por tabelas homônimas).
export async function applySchemaSql(client) {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await client.query(sql);
}
