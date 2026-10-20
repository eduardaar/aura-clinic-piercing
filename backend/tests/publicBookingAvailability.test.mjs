import { test } from "node:test";
import assert from "node:assert/strict";
import { req, createTenant, loginTenant, platformLogin, deleteTenant } from "./helpers.mjs";

test("liberações persistem por profissional e restringem datas, slots e envio direto pelo link público", async () => {
  const platformToken = await platformLogin();
  const clinic = await createTenant("qareleases");
  try {
    const { token } = await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword);
    const api = (path, options = {}) => req(path, { token, tenant: clinic.slug, ...options });
    const publicApi = (path, options = {}) => req(path, { tenant: clinic.slug, ...options });
    const service = await api("/services", {
      method: "POST",
      body: { name: "Perfuração", duration_minutes: 30, price: 100, deposit_value: 25, active_online_booking: true },
    });
    assert.equal(service.status, 201, JSON.stringify(service.json));
    const professional = await api("/professionals", {
      method: "POST",
      body: { name: "Profissional", service_ids: [service.json.id] },
    });
    assert.equal(professional.status, 201, JSON.stringify(professional.json));
    const professionalId = professional.json.id;
    const configPath = `/availability/public/${professionalId}`;
    assert.equal((await publicApi(configPath)).status, 401);
    const weekly = await api("/availability/generate-weekly", {
      method: "POST",
      body: {
        professional_id: professionalId,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        start_time: "09:00",
        end_time: "18:00",
        lunch_start: "12:00",
        lunch_end: "13:00",
        buffer_minutes: 0,
      },
    });
    assert.equal(weekly.status, 201, JSON.stringify(weekly.json));

    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 2, 1);
    const month = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;
    const date = `${month}-10`;
    const windows = [{ from: date, to: date, weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: "10:00", end_time: "11:00" }];
    const saved = await api(configPath, { method: "PUT", body: { restricted: true, windows } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual((await api(configPath)).json, { restricted: true, windows });
    const query = `service_id=${service.json.id}&professional_id=${professionalId}`;
    const dates = await publicApi(`/booking/dates?${query}&month=${month}`);
    assert.equal(dates.status, 200, JSON.stringify(dates.json));
    assert.deepEqual(dates.json.dates, [date]);
    const slots = await publicApi(`/booking/slots?${query}&date=${date}`);
    assert.deepEqual(
      slots.json.slots.map((slot) => slot.time),
      ["10:00", "10:30"],
    );
    assert.deepEqual((await publicApi(`/booking/slots?${query}&date=${month}-11`)).json.slots, []);
    assert.equal((await publicApi(`/booking/dates?${query}&month=2030-13`)).status, 400);
    assert.equal((await publicApi(`/booking/slots?${query}&date=2030-02-30`)).status, 400);
    const invalid = await api(configPath, {
      method: "PUT",
      body: { restricted: true, windows: [{ ...windows[0], end_time: "08:00" }] },
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual((await api(configPath)).json, { restricted: true, windows });

    const body = {
      service_id: service.json.id,
      professional_id: professionalId,
      appointment_date: date,
      appointment_time: "09:00",
      full_name: "Cliente da agenda",
      whatsapp: "11988887777",
    };
    assert.equal((await publicApi("/booking/requests", { method: "POST", body })).status, 409);
    const booked = await publicApi("/booking/requests", {
      method: "POST",
      body: { ...body, appointment_time: "10:00" },
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.json));
    const remaining = await publicApi(`/booking/slots?${query}&date=${date}`);
    assert.deepEqual(
      remaining.json.slots.map((slot) => slot.time),
      ["10:30"],
    );
    await api(configPath, { method: "PUT", body: { restricted: true, windows: [] } });
    assert.deepEqual((await publicApi(`/booking/dates?${query}&month=${month}`)).json.dates, []);
    assert.equal(
      (await publicApi("/booking/requests", { method: "POST", body: { ...body, appointment_time: "10:30" } })).status,
      409,
    );
  } finally {
    await deleteTenant(platformToken, clinic.tenant.id, clinic.slug);
  }
});
