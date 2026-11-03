import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

for (const timezone of ["UTC", "America/Sao_Paulo", "Asia/Tokyo"]) {
  test(`agenda e antecedência usam horário da clínica com servidor em ${timezone}`, () => {
    const script = `
      import { availableBookingSlots } from './backend/src/services/appointments.js';
      import { validateAppointmentTimingRules } from './backend/src/services/serviceRules.js';
      const now = new Date('2026-11-03T12:01:00Z');
      const slots = await availableBookingSlots({}, {
        professionalId: 1, date: '2026-11-03', now,
        service: { id: 1, duration_minutes: 20, minimum_advance_minutes: 30 },
        calendarContext: { availability: [{ weekday: 2, start_time: '09:00', end_time: '12:00', buffer_minutes: 0 }], appointments: [], blocks: [], publicAvailability: { restricted: false, windows: [] } }
      });
      const valid = validateAppointmentTimingRules({ rules: [{ minimum_advance_minutes: 30 }], appointmentDate: '2026-11-03', appointmentTime: '10:00', now });
      const tooEarly = validateAppointmentTimingRules({ rules: [{ minimum_advance_minutes: 60 }], appointmentDate: '2026-11-03', appointmentTime: '09:30', now });
      console.log(JSON.stringify({ times: slots.map(s => s.time), valid, tooEarly }));
    `;
    const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: new URL("../../", import.meta.url), encoding: "utf8", env: { ...process.env, TZ: timezone, NODE_ENV: "test" }
    });
    const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
    assert.deepEqual(result.times, ["09:40", "10:00", "10:20", "10:40", "11:00", "11:20", "11:40"]);
    assert.equal(result.valid, "");
    assert.match(result.tooEarly, /60 minutos/);
  });
}
