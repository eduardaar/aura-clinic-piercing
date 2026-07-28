// Contrato da camada `db` (backend/src/db/postgres.js), sobre um client de
// mentira: o que sai daqui é exatamente o SQL que o autor escreveu, traduzido
// só nos placeholders. Nada é acrescentado à query.
import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/db/postgres.js";

function fakeClient(rows = [{ id: 42 }], rowCount = 1) {
  const executed = [];
  return {
    executed,
    async query(text, params) {
      executed.push({ text: String(text).trim(), params });
      return { rows, rowCount };
    },
  };
}

test("o n-ésimo `?` vira `$n`, na ordem em que aparece", async () => {
  const client = fakeClient();
  const db = createDb(client);
  await db.all("SELECT * FROM clients WHERE a = ? AND b = ? ORDER BY id LIMIT ? OFFSET ?", [1, 2, 3, 4]);
  assert.equal(client.executed[0].text, "SELECT * FROM clients WHERE a = $1 AND b = $2 ORDER BY id LIMIT $3 OFFSET $4");
});

test("cláusulas montadas em partes continuam numeradas na ordem dos parâmetros", async () => {
  const client = fakeClient();
  const db = createDb(client);
  const clauses = ["a.status = ?", "a.professional_id = ?", "(c.full_name ILIKE ? OR c.whatsapp ILIKE ?)"];
  await db.all(`SELECT 1 FROM a WHERE ${clauses.join(" AND ")}`, ["x", 2, "%z%", "%z%"]);
  assert.equal(
    client.executed[0].text,
    "SELECT 1 FROM a WHERE a.status = $1 AND a.professional_id = $2 AND (c.full_name ILIKE $3 OR c.whatsapp ILIKE $4)",
  );
});

test("run NÃO acrescenta RETURNING a um INSERT — a query vai como foi escrita", async () => {
  const client = fakeClient([], 1);
  const db = createDb(client);
  const resultado = await db.run("INSERT INTO clients (full_name) VALUES (?)", ["Ana"]);
  assert.equal(client.executed[0].text, "INSERT INTO clients (full_name) VALUES ($1)");
  assert.equal(resultado.returnedId, undefined, "sem RETURNING explícito não existe id para devolver");
  assert.equal(resultado.changes, 1);
});

test("run devolve returnedId quando a query traz RETURNING id explícito", async () => {
  const client = fakeClient([{ id: 42 }], 1);
  const db = createDb(client);
  const resultado = await db.run("INSERT INTO clients (full_name) VALUES (?) RETURNING id", ["Ana"]);
  assert.equal(client.executed[0].text, "INSERT INTO clients (full_name) VALUES ($1) RETURNING id");
  assert.equal(resultado.returnedId, 42);
  assert.equal(resultado.changes, 1);
  assert.deepEqual(resultado.rows, [{ id: 42 }]);
});

test("run em tabela sem coluna `id` não quebra (nada é acrescentado à query)", async () => {
  const client = fakeClient([], 1);
  const db = createDb(client);
  const resultado = await db.run(
    "INSERT INTO catalog_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ["brand_name", "Aura"],
  );
  assert.ok(!/RETURNING/i.test(client.executed[0].text));
  assert.equal(resultado.returnedId, undefined);
});

test("get e all devolvem a primeira linha e todas as linhas", async () => {
  const db = createDb(fakeClient([{ id: 1 }, { id: 2 }], 2));
  assert.deepEqual(await db.get("SELECT * FROM x"), { id: 1 });
  assert.deepEqual(await db.all("SELECT * FROM x"), [{ id: 1 }, { id: 2 }]);
});
