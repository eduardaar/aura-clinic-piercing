import assert from "node:assert/strict";
import test from "node:test";
import { transactionalJson } from "../src/middleware/transactionalJson.js";

function responseRecorder() {
  const calls = [];
  const res = {
    statusCode: 200,
    status(code) {
      calls.push(["status", code]);
      return res;
    },
    json(body) {
      calls.push(["json", body]);
      return res;
    },
  };
  return { res, calls };
}

test("resposta JSON aguarda o COMMIT e preserva status e conteúdo", async () => {
  const { res, calls } = responseRecorder();
  const tx = { id: "transaction" };
  let finishCommit;
  let ready;
  const written = new Promise((resolve) => {
    ready = resolve;
  });
  const commit = new Promise((resolve) => {
    finishCommit = resolve;
  });
  const db = {
    async transaction(callback) {
      await callback(tx);
      ready();
      await commit;
    },
  };
  const response = transactionalJson(db, res, (transaction, pending) => {
    assert.equal(transaction, tx);
    pending.status(201).json({ id: 12, state: "active" });
  });
  await written;
  assert.deepEqual(calls, [], "nenhuma confirmação é enviada enquanto a gravação está pendente");
  finishCommit();
  await response;
  assert.deepEqual(calls, [
    ["status", 201],
    ["json", { id: 12, state: "active" }],
  ]);
});

test("falha no COMMIT não envia o sucesso preparado pela operação", async () => {
  const { res, calls } = responseRecorder();
  const failure = new Error("commit failed");
  const db = {
    async transaction(callback) {
      await callback({});
      throw failure;
    },
  };
  await assert.rejects(
    transactionalJson(db, res, (_tx, pending) => {
      pending.status(201).json({ id: 12 });
    }),
    (error) => error === failure,
  );
  assert.deepEqual(calls, []);
});

test("erro de regra é propagado sem enviar uma resposta antes do rollback", async () => {
  const { res, calls } = responseRecorder();
  const failure = new Error("invalid campaign");
  const db = {
    async transaction(callback) {
      return callback({});
    },
  };
  await assert.rejects(
    transactionalJson(db, res, () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(calls, []);
});
