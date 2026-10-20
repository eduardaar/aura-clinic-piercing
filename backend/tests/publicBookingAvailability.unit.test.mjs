import test from "node:test";
import assert from "node:assert/strict";
import { availableBookingSlots } from "../src/services/appointments.js";
import {
  normalizePublicAvailability,
  getPublicAvailability,
  validBookingDate,
} from "../src/services/publicBookingAvailability.js";

const date = "2030-11-04";
const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
const release = { from: date, to: "2030-11-30", weekdays: [weekday], start_time: "10:00", end_time: "15:00" };
const config = { restricted: true, windows: [release] };
const availability = [
  { weekday, start_time: "09:00", end_time: "18:00", lunch_start: "12:00", lunch_end: "13:00", buffer_minutes: 0 },
];

function slots(context = {}, overrides = {}) {
  return availableBookingSlots(
    {},
    {
      service: { id: 1, duration_minutes: 30 },
      professionalId: 1,
      date,
      now: new Date("2030-01-01T00:00:00Z"),
      calendarContext: { availability, appointments: [], blocks: [], publicAvailability: config, ...context },
      ...overrides,
    },
  );
}

test("libera somente datas, dias e horários escolhidos, descontando almoço e ocupações", async () => {
  const result = await slots({
    appointments: [{ appointment_date: date, appointment_time: "10:30", end_time: "11:00" }],
    blocks: [{ start_datetime: `${date}T14:00:00`, end_datetime: `${date}T15:00:00` }],
  });
  assert.deepEqual(
    result.map((slot) => slot.time),
    ["10:00", "11:00", "11:30", "13:00", "13:30"],
  );
  assert.deepEqual(await slots({}, { date: "2030-12-02" }), []);
  assert.deepEqual(await slots({}, { date: "2030-11-05" }), []);
});

test("faixas pontuais começam no horário liberado e nunca ultrapassam o expediente", async () => {
  const result = await slots({
    publicAvailability: {
      restricted: true,
      windows: [
        { ...release, start_time: "09:10", end_time: "10:10" },
        { ...release, start_time: "17:30", end_time: "20:00" },
      ],
    },
  });
  assert.deepEqual(
    result.map((slot) => slot.time),
    ["09:10", "09:40", "17:30"],
  );
});

test("modo restrito vazio fecha a agenda; modo semanal preserva a disponibilidade existente", async () => {
  assert.deepEqual(await slots({ publicAvailability: { restricted: true, windows: [] } }), []);
  assert.equal((await slots({ publicAvailability: { restricted: false, windows: [] } }))[0].time, "09:00");
  assert.deepEqual(await slots({ availability: [] }), []);
  assert.deepEqual(
    await slots({ blocks: [{ start_datetime: `${date}T00:00:00`, end_datetime: `${date}T23:59:00`, is_full_day: 1 }] }),
    [],
  );
});

test("duração inteira, antecedência e intervalo obrigatório permanecem respeitados", async () => {
  const result = await slots({}, { service: { id: 1, duration_minutes: 60, scheduling_interval_minutes: 30 } });
  assert.deepEqual(
    result.map((slot) => slot.time),
    ["10:00", "13:00"],
  );
  const now = new Date(`${date}T13:00:00`);
  const future = await slots({}, { now, service: { id: 1, duration_minutes: 30, minimum_advance_minutes: 60 } });
  assert.deepEqual(
    future.map((slot) => slot.time),
    ["14:00", "14:30"],
  );
});

test("bloqueios que atravessam a meia-noite cobrem o dia intermediário inteiro", async () => {
  assert.deepEqual(
    await slots({ blocks: [{ start_datetime: "2030-11-03T16:00:00", end_datetime: "2030-11-05T10:00:00" }] }),
    [],
  );
});

test("configuração inválida é rejeitada e configuração corrompida falha com agenda fechada", async () => {
  for (const window of [
    { ...release, from: "2030-02-30" },
    { ...release, to: "2030-01-01" },
    { ...release, start_time: "25:00" },
    { ...release, start_time: "16:00" },
    { ...release, weekdays: [] },
    { ...release, weekdays: [7] },
  ]) {
    assert.throws(() => normalizePublicAvailability({ restricted: true, windows: [window] }));
  }
  assert.equal(validBookingDate("2030-02-30"), false);
  assert.deepEqual(await getPublicAvailability({ get: async () => ({ value: "invalid json" }) }, 1), {
    restricted: true,
    windows: [],
  });
  assert.deepEqual(await getPublicAvailability({ get: async () => null }, 1), { restricted: false, windows: [] });
});
