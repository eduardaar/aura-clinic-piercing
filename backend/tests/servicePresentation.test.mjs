import { test } from "node:test";
import assert from "node:assert/strict";
import { req, createTenant, loginTenant, platformLogin, deleteTenant } from "./helpers.mjs";
import { normalizePublicInfoSections, serviceAcknowledgementHash } from "../src/services/servicePresentation.js";

test("seções das informações completas: chaves conhecidas, coluna sem texto e título obrigatório no personalizado", () => {
  assert.deepEqual(
    normalizePublicInfoSections([
      { key: "warranty", body: "  Troca em 30 dias.  " },
      { key: "aftercare", body: "ignorado: o texto mora na coluna" },
      { key: "warranty", body: "duplicada" },
      { key: "custom", title: "Duração do resultado", body: "Varia com o uso." },
      { key: "custom", title: "Outra", body: "" }
    ]),
    [
      { key: "warranty", body: "Troca em 30 dias." },
      { key: "aftercare" },
      { key: "custom", title: "Duração do resultado", body: "Varia com o uso." },
      { key: "custom", title: "Outra", body: "" }
    ]
  );
  assert.throws(() => normalizePublicInfoSections([{ key: "script", body: "x" }]), /desconhecida/);
  assert.throws(() => normalizePublicInfoSections([{ key: "custom", body: "sem título" }]), /título/);
  assert.throws(() => normalizePublicInfoSections("{}"), /formato inválido/);
  const base = { name: "Lóbulo", description: "Texto", public_info_sections: [{ key: "warranty", body: "30 dias" }] };
  assert.notEqual(serviceAcknowledgementHash(base), serviceAcknowledgementHash({ ...base, public_info_sections: [{ key: "warranty", body: "60 dias" }] }));
  assert.equal(serviceAcknowledgementHash(base), serviceAcknowledgementHash({ ...base }));
});

test("apresentação do serviço é salva, chega ao agendamento público e a ciência é exigida e registrada", async () => {
  const platformToken = await platformLogin();
  const clinic = await createTenant("qapresent");
  try {
    const { token } = await loginTenant(clinic.slug, clinic.adminEmail, clinic.adminPassword);
    const api = (path, options = {}) => req(path, { token, tenant: clinic.slug, ...options });
    const publicApi = (path, options = {}) => req(path, { tenant: clinic.slug, ...options });

    const invalid = await api("/services", { method: "POST", body: { name: "Inválido", public_info_sections: [{ key: "html", body: "<b>" }] } });
    assert.equal(invalid.status, 400, JSON.stringify(invalid.json));
    const badImage = await api("/services", { method: "POST", body: { name: "Imagem", image_url: "javascript:alert(1)" } });
    assert.equal(badImage.status, 400, JSON.stringify(badImage.json));
    const tooLong = await api("/services", { method: "POST", body: { name: "Longo", short_description: "a".repeat(241) } });
    assert.equal(tooLong.status, 400, JSON.stringify(tooLong.json));

    const lobulo = await api("/services", {
      method: "POST",
      body: {
        name: "Perfuração de lóbulo", description: "Descrição completa existente.", duration_minutes: 25, price: 120, deposit_value: 40,
        active_online_booking: true, short_description: "Perfuração com joia de titânio inclusa.",
        image_url: "https://cdn.exemplo.test/lobulo.webp", image_alt: "Lóbulo", requires_evaluation: true, requires_acknowledgement: true,
        pre_service_notes: "Venha alimentado.", aftercare_instructions: "Limpe com soro.",
        public_info_sections: [{ key: "aftercare" }, { key: "warranty", body: "Troca em 30 dias." }, { key: "pre_service" }]
      }
    });
    assert.equal(lobulo.status, 201, JSON.stringify(lobulo.json));
    assert.equal(lobulo.json.short_description, "Perfuração com joia de titânio inclusa.");
    assert.equal(lobulo.json.requires_acknowledgement, true);
    assert.deepEqual(lobulo.json.public_info_sections, [{ key: "aftercare" }, { key: "warranty", body: "Troca em 30 dias." }, { key: "pre_service" }]);

    // Edição parcial preserva o que não veio no corpo (descrição, imagem, seções).
    const patched = await api(`/services/${lobulo.json.id}`, { method: "PATCH", body: { short_description: "Resumo novo." } });
    assert.equal(patched.status, 200, JSON.stringify(patched.json));
    assert.equal(patched.json.short_description, "Resumo novo.");
    assert.equal(patched.json.description, "Descrição completa existente.");
    assert.equal(patched.json.image_url, "https://cdn.exemplo.test/lobulo.webp");
    assert.equal(patched.json.public_info_sections.length, 3);
    assert.equal(Number(patched.json.price), 120);

    const anodizacao = await api("/services", {
      method: "POST",
      body: { name: "Anodização", duration_minutes: 15, price: 60, deposit_value: 0, active_online_booking: true }
    });
    assert.equal(anodizacao.status, 201, JSON.stringify(anodizacao.json));
    assert.equal(anodizacao.json.short_description, "");
    assert.deepEqual(anodizacao.json.public_info_sections, []);

    const professional = await api("/professionals", {
      method: "POST",
      body: { name: "Profissional", whatsapp: "11977776666", service_ids: [lobulo.json.id, anodizacao.json.id] }
    });
    assert.equal(professional.status, 201, JSON.stringify(professional.json));
    const weekly = await api("/availability/generate-weekly", {
      method: "POST",
      body: { professional_id: professional.json.id, weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: "09:00", end_time: "18:00", buffer_minutes: 0 }
    });
    assert.equal(weekly.status, 201, JSON.stringify(weekly.json));

    const config = await publicApi("/booking/config");
    assert.equal(config.status, 200, JSON.stringify(config.json));
    const publicService = config.json.services.find((item) => item.id === lobulo.json.id);
    assert.equal(publicService.short_description, "Resumo novo.");
    assert.equal(publicService.image_url, "https://cdn.exemplo.test/lobulo.webp");
    assert.equal(publicService.aftercare_instructions, "Limpe com soro.");

    const future = new Date();
    future.setDate(future.getDate() + 20);
    const date = future.toISOString().slice(0, 10);
    const slots = await publicApi(`/booking/slots?service_id=${lobulo.json.id}&professional_id=${professional.json.id}&date=${date}`);
    assert.equal(slots.status, 200, JSON.stringify(slots.json));
    assert.ok(slots.json.slots.length, "a agenda de teste precisa oferecer horários");
    const body = {
      service_id: lobulo.json.id,
      professional_id: professional.json.id,
      appointment_date: date,
      appointment_time: slots.json.slots[0].time,
      full_name: "Cliente Ciência",
      whatsapp: "11988887777",
      items: JSON.stringify([{ item_type: "service", service_id: lobulo.json.id }, { item_type: "service", service_id: anodizacao.json.id }])
    };
    const missing = await publicApi("/booking/requests", { method: "POST", body });
    assert.equal(missing.status, 400, JSON.stringify(missing.json));
    assert.equal(missing.json.code, "acknowledgement_required");

    const booked = await publicApi("/booking/requests", {
      method: "POST",
      body: { ...body, acknowledged_service_ids: JSON.stringify([lobulo.json.id]) }
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.json));
    // Sinal = soma dos sinais dos serviços (40 + 0), igual ao exibido na tela.
    assert.equal(Number(booked.json.deposit_value), 40);
    assert.equal(Number(booked.json.total_value), 180);
    // A mensagem à profissional lista os dois serviços, não só o primeiro.
    assert.match(decodeURIComponent(booked.json.professional_whatsapp_url), /Serviços: Perfuração de lóbulo, Anodização/);
    const acknowledgements = booked.json.public_acknowledgements;
    assert.equal(acknowledgements.length, 1);
    assert.equal(acknowledgements[0].service_id, lobulo.json.id);
    assert.match(acknowledgements[0].content_hash, /^[a-f0-9]{64}$/);

    const requests = await api(`/appointments?status=awaiting_deposit_proof`);
    assert.equal(requests.status, 200, JSON.stringify(requests.json));
    const listed = (requests.json.items || requests.json).find((item) => item.id === booked.json.id);
    assert.ok(listed, "a solicitação precisa aparecer para a equipe");
    assert.deepEqual(listed.items.map((item) => item.service_name), ["Perfuração de lóbulo", "Anodização"]);
    assert.equal(listed.public_acknowledgements[0].service_name, "Perfuração de lóbulo");
  } finally {
    await deleteTenant(platformToken, clinic.tenant.id, clinic.slug);
  }
});
