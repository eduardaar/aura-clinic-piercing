import assert from "node:assert/strict";
import test from "node:test";
import { createTenant, deleteTenant, loginTenant, platformLogin, req } from "./helpers.mjs";
import { resolveBookingSelection } from "../src/services/bookingSelection.js";

test("seleção soma durações e usa as regras mais restritivas, sem duplicar ids", async () => {
  const services = [
    { id: 1, duration_minutes: 45, minimum_advance_minutes: 60, scheduling_interval_minutes: 5 },
    { id: 2, duration_minutes: 30, minimum_advance_minutes: 120, scheduling_interval_minutes: 15 },
  ];
  const db = {
    async get() {
      return { id: 7 };
    },
    async all(sql) {
      return sql.includes("FROM services") ? services : [{ service_id: 1 }, { service_id: 2 }];
    },
  };
  const selected = await resolveBookingSelection(db, { service_ids: "2,1,2" }, 7);
  assert.equal(selected.id, 2);
  assert.equal(selected.duration_minutes, 75);
  assert.equal(selected.minimum_advance_minutes, 120);
  assert.equal(selected.scheduling_interval_minutes, 15);
  for (const service_ids of ["", "1,", "1,abc", "-1", "1.5", "0", Array(101).fill("1").join(",")]) {
    await assert.rejects(resolveBookingSelection(db, { service_ids }, 7), /serviços válidos/);
  }
});

test("datas, horários e envio consideram todos os serviços e respeitam disponibilidade e habilitação", async () => {
  const platformToken = await platformLogin();
  const clinic = await createTenant("qa-horarios-multi");
  try {
    const { token } = await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword);
    const api = (path, options = {}) => req(path, { tenant: clinic.slug, token, ...options });
    const publicApi = (path, options = {}) => req(path, { tenant: clinic.slug, ...options });
    const services = [];
    for (const [name, duration_minutes] of [
      ["Perfuração", 45],
      ["Anodização", 30],
    ]) {
      const created = await api("/services", {
        method: "POST",
        body: { name, duration_minutes, price: 100, deposit_value: 0, active_online_booking: true },
      });
      assert.equal(created.status, 201, JSON.stringify(created.json));
      services.push(created.json);
    }
    const professional = await api("/professionals", {
      method: "POST",
      body: { name: "Profissional habilitada", service_ids: services.map((service) => service.id) },
    });
    assert.equal(professional.status, 201, JSON.stringify(professional.json));
    const id = professional.json.id;
    assert.equal(
      (
        await api("/availability/generate-weekly", {
          method: "POST",
          body: {
            professional_id: id,
            weekdays: [0, 1, 2, 3, 4, 5, 6],
            start_time: "09:00",
            end_time: "18:00",
            buffer_minutes: 0,
          },
        })
      ).status,
      201,
    );
    const future = new Date();
    future.setMonth(future.getMonth() + 2, 1);
    const month = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}`;
    const shortDay = `${month}-10`;
    const fullDay = `${month}-11`;
    assert.equal(
      (
        await api(`/availability/public/${id}`, {
          method: "PUT",
          body: {
            restricted: true,
            windows: [
              { from: shortDay, to: shortDay, weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: "09:00", end_time: "10:00" },
              { from: fullDay, to: fullDay, weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: "09:00", end_time: "12:00" },
            ],
          },
        })
      ).status,
      200,
    );
    const primary = `service_id=${services[0].id}&professional_id=${id}`;
    const combined = `${primary}&service_ids=${services.map((service) => service.id).join(",")}`;
    assert.deepEqual(
      (await publicApi(`/booking/dates?${primary}&month=${month}`)).json.dates,
      [shortDay, fullDay],
      "consulta antiga de um serviço permanece compatível",
    );
    const dates = await publicApi(`/booking/dates?${combined}&month=${month}`);
    assert.equal(dates.status, 200, JSON.stringify(dates.json));
    assert.deepEqual(dates.json.dates, [fullDay], "dia com apenas uma hora livre não comporta 75 minutos");
    assert.deepEqual((await publicApi(`/booking/slots?${combined}&date=${shortDay}`)).json.slots, []);
    const slots = await publicApi(`/booking/slots?${combined}&date=${fullDay}`);
    assert.deepEqual(
      slots.json.slots.map(({ time, end_time }) => [time, end_time]),
      [
        ["09:00", "10:15"],
        ["10:15", "11:30"],
      ],
    );
    const payload = {
      service_id: services[0].id,
      professional_id: id,
      appointment_date: fullDay,
      appointment_time: "10:15",
      full_name: "Cliente de dois serviços",
      whatsapp: "11988887777",
      items: services.map((service) => ({ item_type: "service", service_id: service.id, quantity: 1 })),
    };
    const booked = await publicApi("/booking/requests", { method: "POST", body: payload });
    assert.equal(booked.status, 201, JSON.stringify(booked.json));
    assert.equal(booked.json.end_time, "11:30");
    assert.equal(Number(booked.json.total_value), 200);
    assert.equal(booked.json.items.length, 2);
    assert.deepEqual(
      (await publicApi(`/booking/slots?${combined}&date=${fullDay}`)).json.slots.map((slot) => slot.time),
      ["09:00"],
    );
    const occupied = await publicApi("/booking/requests", {
      method: "POST",
      body: { ...payload, full_name: "Outra cliente", whatsapp: "11977776666" },
    });
    assert.equal(occupied.status, 409);
    const rejectedClient = await api("/clients?search=11977776666");
    assert.equal(rejectedClient.status, 200);
    assert.equal(rejectedClient.json.length, 0, "horário recusado não cria cadastro de cliente");
    const limited = await api("/professionals", {
      method: "POST",
      body: { name: "Somente perfuração", service_ids: [services[0].id] },
    });
    const selection = `service_ids=${services.map((service) => service.id).join(",")}&professional_id=${limited.json.id}`;
    for (const path of [`/booking/slots?${selection}&date=${fullDay}`, `/booking/dates?${selection}&month=${month}`]) {
      assert.equal((await publicApi(path)).status, 409, "todas as consultas validam todos os vínculos");
    }
    await api(`/services/${services[1].id}`, { method: "PATCH", body: { minimum_advance_minutes: 525600 } });
    assert.deepEqual(
      (await publicApi(`/booking/slots?${combined}&date=${fullDay}`)).json.slots,
      [],
      "antecedência do segundo serviço é respeitada",
    );
    await api(`/services/${services[1].id}`, { method: "PATCH", body: { active_online_booking: false } });
    assert.equal((await publicApi(`/booking/slots?${combined}&date=${fullDay}`)).status, 404);
    assert.equal((await publicApi(`/booking/dates?${combined}&month=${month}`)).status, 404);
    assert.equal((await publicApi(`/booking/slots?${primary}&service_ids=1,abc&date=${fullDay}`)).status, 400);
  } finally {
    await deleteTenant(platformToken, clinic.tenant.id, clinic.slug);
  }
});
