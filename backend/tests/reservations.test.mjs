import test from "node:test";
import assert from "node:assert/strict";
import { availableStock, reserveAppointmentItems } from "../src/services/reservations.js";

test("estoque disponível desconta reservas ativas", async () => {
  const db = {
    run: async () => ({ changes: 0 }),
    get: async (sql) => sql.includes("FROM jewelry_inventory") ? { quantity: 5 } : { quantity: 2 }
  };
  assert.equal(await availableStock(db, 1), 3);
});

test("reserva falha e faz rollback quando não há estoque", async () => {
  const commands = [];
  const db = {
    run: async (sql) => {
      commands.push(sql);
      return { changes: 0, lastID: 1 };
    },
    get: async (sql) => {
      if (sql.includes("FOR UPDATE")) return { id: 1 };
      if (sql.includes("FROM jewelry_inventory")) return { quantity: 1 };
      return { quantity: 0 };
    }
  };
  await assert.rejects(
    reserveAppointmentItems(db, { appointmentId: 1, clientId: 1, reservationKey: "abc", items: [{ jewelry_id: 1, quantity: 2 }] }),
    /Estoque insuficiente/
  );
  assert.equal(commands[0], "BEGIN");
  assert.equal(commands.at(-1), "ROLLBACK");
});

test("reserva válida é confirmada atomicamente", async () => {
  const commands = [];
  const db = {
    run: async (sql) => {
      commands.push(sql);
      return { changes: 1, lastID: 9 };
    },
    get: async (sql) => {
      if (sql.includes("FOR UPDATE")) return { id: 1 };
      if (sql.includes("FROM jewelry_inventory")) return { quantity: 3 };
      return { quantity: 0 };
    }
  };
  const ids = await reserveAppointmentItems(db, { appointmentId: 1, clientId: 1, reservationKey: "abc", items: [{ jewelry_id: 1, quantity: 2 }] });
  assert.deepEqual(ids, [9]);
  assert.equal(commands.at(-1), "COMMIT");
});
