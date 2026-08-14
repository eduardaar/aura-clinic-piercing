// Rotas publicas de agendamento online.
import { Router } from "express";
import { createHash } from "crypto";
import { withDb, withFeature } from "../middleware/withDb.js";
import { parseUpload, privateUpload, registerPrivateFiles } from "../middleware/upload.js";
import { addMinutesToTime } from "../services/utils.js";
import { availableBookingSlots, upsertClient, listAppointments } from "../services/appointments.js";
import { getStoreName, queueProfessionalBookingNotification, whatsappLink } from "../services/notifications.js";
import { quotePromotions } from "../services/promotions.js";
import { validateCoupon } from "../services/discounts.js";
import { reserveAppointmentItems } from "../services/reservations.js";
import { createPaymentIntent, publicPaymentIntent } from "../services/payments.js";
import { tenantClient } from "../services/asaas/credentials.js";
import { createAppointmentDepositCharge } from "../services/tenantCharges.js";
import { bookingTaxId } from "../services/taxId.js";
import { scheduleAppointmentClientAutomations } from "../services/communications.js";

const router = Router();

// Falha de reserva de estoque: precisa virar 409 para o cliente, mas sem deixar
// de abortar a transação da solicitação inteira. Por isso é uma classe própria —
// no catch dá para separá-la de um erro real de banco (que continua virando 500).
class ReservationConflict extends Error {}

function publicBookingKey(req, body) {
  const provided = String(req.get("Idempotency-Key") || body.idempotency_key || body.public_booking_token || "").trim();
  if (provided) return provided.slice(0, 180);
  return createHash("sha256")
    .update([
      req.tenant?.slug || "",
      body.service_id || "",
      body.professional_id || "",
      body.appointment_date || "",
      body.appointment_time || "",
      String(body.whatsapp || "").replace(/\D/g, ""),
      String(body.full_name || "").trim().toLowerCase()
    ].join("|"))
    .digest("hex");
}

function parseItems(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function bookingReadiness(db) {
  const activeServices = await db.get("SELECT COUNT(*) AS count FROM services WHERE active_online_booking = 1");
  const activeProcedures = await db.get(`
    SELECT COUNT(*) AS count
    FROM procedures p
    JOIN services s ON s.id = p.service_id
    WHERE p.is_active = 1 AND s.active_online_booking = 1
  `);
  const activeProfessionals = await db.get("SELECT COUNT(*) AS count FROM professionals WHERE active = 1");
  const weeklyAvailability = await db.get(`
    SELECT COUNT(*) AS count
    FROM professional_availability a
    JOIN professionals p ON p.id = a.professional_id
    WHERE a.is_active = 1 AND p.active = 1
  `);
  const linkedProfessionals = await db.get(`
    SELECT COUNT(*) AS count
    FROM professional_services ps
    JOIN professionals p ON p.id = ps.professional_id
    JOIN services s ON s.id = ps.service_id
    WHERE p.active = 1 AND s.active_online_booking = 1
  `);
  const checklist = [
    { key: "services", label: "Serviços cadastrados", done: Number(activeServices.count || 0) > 0 },
    { key: "procedures", label: "Procedimentos cadastrados", done: Number(activeProcedures.count || 0) > 0 },
    { key: "professionals", label: "Profissionais cadastrados", done: Number(activeProfessionals.count || 0) > 0 },
    { key: "weeklySchedule", label: "Agenda semanal configurada", done: Number(weeklyAvailability.count || 0) > 0 },
    { key: "links", label: "Profissionais vinculados aos serviços", done: Number(linkedProfessionals.count || 0) > 0 }
  ];
  return {
    ready: checklist.every((item) => item.done),
    checklist,
    missing: checklist.filter((item) => !item.done).map((item) => item.label),
    counts: {
      activeServices: Number(activeServices.count || 0),
      activeProcedures: Number(activeProcedures.count || 0),
      activeProfessionals: Number(activeProfessionals.count || 0),
      weeklyAvailability: Number(weeklyAvailability.count || 0),
      linkedProfessionals: Number(linkedProfessionals.count || 0)
    }
  };
}

router.get("/api/booking/readiness", withDb(async (_req, res, db) => {
  res.json(await bookingReadiness(db));
}));

router.get("/api/booking/config", withFeature("online_booking", async (req, res, db) => {
  console.info("[booking-config] tenant recebido", req.tenant);
  const services = await db.all("SELECT * FROM services WHERE active_online_booking = 1 ORDER BY name");
  const professionalsRows = await db.all(`
    SELECT DISTINCT p.*
    FROM professionals p
    JOIN professional_services ps ON ps.professional_id = p.id
    JOIN services s ON s.id = ps.service_id
    WHERE p.active = 1 AND s.active_online_booking = 1
    ORDER BY p.name
  `);
  const links = await db.all(`
    SELECT ps.professional_id, ps.service_id
    FROM professional_services ps
    JOIN professionals p ON p.id = ps.professional_id
    JOIN services s ON s.id = ps.service_id
    WHERE p.active = 1 AND s.active_online_booking = 1
  `);
  const professionals = professionalsRows.map((professional) => ({
    ...professional,
    service_ids: links
      .filter((link) => Number(link.professional_id) === Number(professional.id))
      .map((link) => link.service_id)
  }));
  // Booleano, nunca a credencial. É o que permite ao formulário saber se o CPF
  // é obrigatório (há gateway: o sinal vira link de pagamento e o Asaas exige
  // documento) ou apenas recomendado (sem gateway: comprovante por WhatsApp).
  // Sem essa informação a tela só teria duas saídas ruins: exigir CPF de todo
  // mundo, ou nunca exigir e deixar o sinal online quebrar depois do envio.
  const gatewayEnabled = Boolean(await tenantClient(db));
  res.json({
    services,
    professionals,
    payment: {
      gateway_enabled: gatewayEnabled,
      tax_id_required: gatewayEnabled
    },
    rules: {
      cancellation: "Remarcações e cancelamentos devem ser solicitados com antecedência.",
      payment: gatewayEnabled
        ? "O sinal é pago por link online e confirma o horário automaticamente."
        : "O sinal obrigatório reserva o horário após conferência manual do comprovante pela equipe."
    }
  });
}));

router.get("/api/booking/slots", withFeature("online_booking", async (req, res, db) => {
  const serviceId = Number(req.query.service_id || 0);
  const professionalId = Number(req.query.professional_id || 0);
  const date = String(req.query.date || "");
  console.info("[booking-slots] request recebido", { tenant: req.tenant, serviceId, professionalId, date });
  if (!serviceId || !professionalId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Servico, profissional e data sao obrigatorios." });
  }
  const service = await db.get("SELECT * FROM services WHERE id = ? AND active_online_booking = 1", [serviceId]);
  if (!service) return res.status(404).json({ error: "Servico nao encontrado." });
  const linked = await db.get("SELECT id FROM professional_services WHERE professional_id = ? AND service_id = ?", [professionalId, serviceId]);
  if (!linked) return res.status(409).json({ error: "Este profissional nao realiza o servico selecionado." });
  const slots = await availableBookingSlots(db, { service, professionalId, date });
  res.json({ date, slots });
}));

router.post("/api/booking/requests", withFeature("online_booking", async (req, res, db) => {
  await parseUpload(privateUpload.fields([{ name: "reference_photo", maxCount: 1 }, { name: "payment_proof", maxCount: 1 }]), req, res);
  await registerPrivateFiles(db, Object.values(req.files || {}).flat(), "public_booking", null);
  const body = req.body || {};
  console.info("[booking-request] request recebido", { tenant: req.tenant, service_id: body.service_id, professional_id: body.professional_id, appointment_date: body.appointment_date, appointment_time: body.appointment_time });

  const bookingKey = publicBookingKey(req, body);
  const existing = await listAppointments(db, "WHERE a.public_booking_key = ?", [bookingKey]).then((rows) => rows[0]);
  if (existing) return res.status(200).json({ ...existing, idempotent: true });

  const service = await db.get("SELECT * FROM services WHERE id = ? AND active_online_booking = 1", [body.service_id]);
  if (!service) return res.status(404).json({ error: "Servico nao encontrado." });

  const professionalId = Number(body.professional_id || 0);
  const professional = await db.get("SELECT * FROM professionals WHERE id = ? AND active = 1", [professionalId]);
  if (!professional) return res.status(404).json({ error: "Profissional nao encontrado ou inativo." });

  const linked = await db.get("SELECT id FROM professional_services WHERE professional_id = ? AND service_id = ?", [professionalId, service.id]);
  if (!linked) return res.status(409).json({ error: "Este profissional nao realiza o servico selecionado." });

  const date = String(body.appointment_date || "");
  const time = String(body.appointment_time || "");
  const slots = await availableBookingSlots(db, { service, professionalId, date });
  if (!slots.some((slot) => slot.time === time)) return res.status(409).json({ error: "Este horario nao esta mais disponivel." });
  if (!body.full_name?.trim() || !body.whatsapp?.trim()) return res.status(400).json({ error: "Nome e WhatsApp sao obrigatorios." });

  const jewelryId = Number(body.jewelry_id || 0) || null;
  const variantId = Number(body.jewelry_variant_id || 0) || null;
  const jewelry = jewelryId ? await db.get("SELECT * FROM jewelry_inventory WHERE id = ? AND is_catalog_active = 1 AND status != 'arquivado'", [jewelryId]) : null;
  if (jewelryId && !jewelry) return res.status(404).json({ error: "Joia selecionada não encontrada no catálogo." });
  const variant = variantId ? await db.get("SELECT * FROM jewelry_variants WHERE id = ? AND jewelry_id = ? AND is_active = 1", [variantId, jewelryId]) : null;
  if (variantId && !variant) return res.status(404).json({ error: "Variação selecionada não encontrada." });
  const requestedItems = parseItems(body.items);
  const bookingItems = [];
  if (!requestedItems.length || !requestedItems.some((item) => item.item_type === "service")) {
    bookingItems.push({ item_type: "service", service_id: service.id, name: service.name, quantity: 1, unit_price: Number(service.price || service.base_price || 0), duration_minutes: Number(service.duration_minutes || 40), deposit_value: Number(service.deposit_value || 25) });
  }
  for (const requested of requestedItems) {
    const quantity = Math.max(Number(requested.quantity || requested.qty || 1), 1);
    if (requested.item_type === "service" || requested.service_id) {
      const itemService = await db.get("SELECT * FROM services WHERE id=? AND active_online_booking=1", [requested.service_id]);
      if (!itemService) return res.status(404).json({ error: "Um dos serviços selecionados não está disponível." });
      const itemLinked = await db.get("SELECT id FROM professional_services WHERE professional_id=? AND service_id=?", [professionalId, itemService.id]);
      if (!itemLinked) return res.status(409).json({ error: "O profissional selecionado não realiza todos os serviços escolhidos." });
      bookingItems.push({ item_type: "service", service_id: itemService.id, name: itemService.name, quantity, unit_price: Number(itemService.price || itemService.base_price || 0), duration_minutes: Number(itemService.duration_minutes || 40), deposit_value: Number(itemService.deposit_value || 25), notes: requested.notes || "" });
    } else if (requested.jewelry_id || requested.product_id) {
      const itemJewelryId = Number(requested.jewelry_id || requested.product_id);
      const itemVariantId = Number(requested.jewelry_variant_id || requested.variation_id || 0) || null;
      const itemJewelry = await db.get("SELECT * FROM jewelry_inventory WHERE id=? AND is_catalog_active=1 AND status!='arquivado'", [itemJewelryId]);
      if (!itemJewelry) return res.status(404).json({ error: "Uma das joias selecionadas não está disponível." });
      const itemVariant = itemVariantId ? await db.get("SELECT * FROM jewelry_variants WHERE id=? AND jewelry_id=? AND is_active=1", [itemVariantId, itemJewelryId]) : null;
      if (itemVariantId && !itemVariant) return res.status(404).json({ error: "Uma das variações selecionadas não está disponível." });
      bookingItems.push({ item_type: "jewelry", jewelry_id: itemJewelryId, jewelry_variant_id: itemVariantId, product_id: itemJewelryId, variation_id: itemVariantId, name: itemJewelry.name, category: itemJewelry.category, color: requested.selected_color || itemVariant?.color || itemJewelry.color, material: itemVariant?.material || itemJewelry.material, stone: itemJewelry.stone, quantity, unit_price: Number(itemVariant?.sale_value || itemJewelry.sale_value || 0), notes: requested.notes || "" });
    }
  }
  if (!requestedItems.length && jewelry) bookingItems.push({ item_type: "jewelry", jewelry_id: jewelry.id, jewelry_variant_id: variant?.id || null, product_id: jewelry.id, variation_id: variant?.id || null, name: jewelry.name, category: jewelry.category, color: body.selected_color || variant?.color || jewelry.color, material: variant?.material || jewelry.material, stone: jewelry.stone, quantity: 1, unit_price: Number(variant?.sale_value || jewelry.sale_value || 0), notes: body.notes || "" });
  const serviceValue = bookingItems.filter((item) => item.item_type === "service").reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const jewelryValue = bookingItems.filter((item) => item.item_type === "jewelry").reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const promotionQuote = await quotePromotions(db, { items: bookingItems });
  let totalValue = promotionQuote.final_amount;
  let couponQuote = null;
  if (body.coupon_code) {
    couponQuote = await validateCoupon(db, body.coupon_code, { amount: totalValue, items: bookingItems });
    if (!couponQuote.valid) return res.status(400).json(couponQuote);
    const canStack = promotionQuote.promotions.every((promotion) => promotion.stackable_with_coupon);
    totalValue = promotionQuote.promotions.length && !canStack
      ? Math.min(promotionQuote.final_amount, couponQuote.final_amount)
      : couponQuote.final_amount;
  }
  const depositValue = Math.min(bookingItems.filter((item) => item.item_type === "service").reduce((sum, item) => sum + Number(item.deposit_value || 0), 0), totalValue);
  const remainingValue = Math.max(totalValue - depositValue, 0);

  // A clínica tem gateway configurado? A checagem é só uma leitura do cofre
  // (sem rede) e precisa acontecer ANTES da transação, porque decide duas
  // coisas: se o CPF é obrigatório nesta solicitação e se o intent nasce como
  // `manual` lá dentro ou como cobrança do Asaas aqui fora.
  //
  // Sem gateway, tudo segue exatamente como antes: comprovante por WhatsApp e
  // conferência manual. A maioria das clínicas opera assim.
  const onlinePayment = depositValue > 0 && Boolean(await tenantClient(db));

  // O backend é a autoridade sobre o CPF: a tela valida para dar erro no campo,
  // mas quem garante o dado é aqui — a rota é pública e recebe qualquer corpo.
  const taxId = bookingTaxId({ value: body.cpf || body.tax_id, requiresOnlineCharge: onlinePayment });
  if (!taxId.ok) return res.status(400).json({ error: taxId.error });

  const client = await upsertClient(db, {
    full_name: body.full_name,
    whatsapp: body.whatsapp,
    instagram: body.instagram || "",
    birth_date: "",
    client_notes: body.notes || "",
    // Normalizado para dígitos: é o formato que o Asaas aceita e o que evita o
    // mesmo documento gravado de três jeitos conforme a máscara do formulário.
    tax_id: taxId.value,
    email: body.email || ""
  });
  const referencePhoto = req.files?.reference_photo?.[0] ? `/api/private-files/${req.files.reference_photo[0].filename}` : "";
  const paymentProof = req.files?.payment_proof?.[0] ? `/api/private-files/${req.files.payment_proof[0].filename}` : "";
  const durationMinutes = bookingItems.filter((item) => item.item_type === "service").reduce((sum, item) => sum + Number(item.duration_minutes || 0) * Number(item.quantity || 1), 0) || Number(service.duration_minutes || 40);
  const multiItemSlots = await availableBookingSlots(db, { service: { ...service, duration_minutes: durationMinutes }, professionalId, date });
  if (!multiItemSlots.some((slot) => slot.time === time)) return res.status(409).json({ error: "O horário não comporta a duração total dos serviços selecionados." });
  const endTime = addMinutesToTime(time, durationMinutes);

  // Joia reservada = peça física presa. Manda a cobrança ser PIX com janela
  // curta, para não segurar estoque contra um boleto de dois dias.
  const reservesStock = bookingItems.some((item) => item.item_type === "jewelry" && item.jewelry_id);

  // Agendamento público: agendamento, sinal, itens, reserva de estoque e
  // intenção de pagamento entram juntos ou não entram. Antes, quando a reserva
  // falhava, o código apagava na mão o que já tinha gravado — compensação que
  // deixava lixo se o próprio DELETE falhasse. Agora é o ROLLBACK que desfaz.
  let outcome;
  try {
    outcome = await db.transaction(async (tx) => {
      const result = await tx.run(
        `INSERT INTO appointments
          (client_id, professional_id, service_id, jewelry_id, jewelry_variant_id, procedure, description, piercing_region, appointment_date, appointment_time, end_time, duration_minutes, total_value, deposit_value, remaining_value, deposit_payment_method, remaining_payment_method, status, source, public_booking_key, notes, reference_photo_url, payment_proof_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [
          client.id,
          professionalId,
          service.id,
          jewelryId,
          variantId,
          service.name,
          service.description || "",
          service.name,
          date,
          time,
          endTime,
          durationMinutes,
          totalValue,
          depositValue,
          remainingValue,
          "Pix",
          "Pix",
          "awaiting_deposit_proof",
          "public_booking",
          bookingKey,
          [body.notes || "", body.selected_color ? `Observação de cor: ${body.selected_color}` : ""].filter(Boolean).join("\n"),
          referencePhoto,
          paymentProof
        ]
      );
      if (depositValue > 0) {
        await tx.run(
          "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, 'sinal', 'Pix', 'pendente', ?)",
          [result.returnedId, client.id, depositValue, `${date}T${time}:00`]
        );
      }
      for (const item of bookingItems) {
        await tx.run(
          `INSERT INTO appointment_items
            (appointment_id, service_id, jewelry_id, jewelry_variant_id, quantity, procedure_price, jewelry_unit_price, duration_minutes, subtotal, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            result.returnedId, item.service_id || null, item.jewelry_id || null, item.jewelry_variant_id || null,
            item.quantity, item.item_type === "service" ? item.unit_price : 0,
            item.item_type === "jewelry" ? item.unit_price : 0, item.duration_minutes || 0,
            item.unit_price * item.quantity, item.notes || ""
          ]
        );
      }
      try {
        // reserveAppointmentItems abre a própria transação (BEGIN/COMMIT
        // legado): aninhada aqui ela vira SAVEPOINT, então não fecha esta.
        await reserveAppointmentItems(tx, {
          appointmentId: result.returnedId,
          clientId: client.id,
          reservationKey: bookingKey,
          items: bookingItems,
          minutes: 30
        });
      } catch (error) {
        throw new ReservationConflict(error.message);
      }
      // Com gateway configurado o intent NÃO nasce aqui: quem o cria é o
      // `createAppointmentDepositCharge`, depois da transação, porque ele
      // precisa falar com o Asaas e chamada de rede não pode rodar dentro de
      // uma transação aberta (seguraria o lock das reservas pelo tempo do
      // round-trip, e um timeout do gateway desfaria o agendamento inteiro).
      const intent =
        depositValue > 0 && !onlinePayment
          ? await createPaymentIntent(tx, {
              appointmentId: result.returnedId,
              clientId: client.id,
              amount: depositValue,
              provider: "manual",
              idempotencyKey: `booking:${bookingKey}:deposit`
            })
          : null;
      return { appointmentId: result.returnedId, paymentIntent: intent };
    });
  } catch (error) {
    if (error instanceof ReservationConflict) return res.status(409).json({ error: error.message });
    throw error;
  }
  const { appointmentId } = outcome;
  let paymentIntent = outcome.paymentIntent;

  // Cobrança online FORA da transação, e best-effort.
  //
  // O agendamento já está gravado e as joias já estão reservadas: uma falha do
  // Asaas a esta altura não pode desfazer nada disso. O serviço devolve o
  // intent vivo com `online_payment_available: false` e a clínica cobra pelo
  // caminho manual de sempre — trocar o agendamento de um cliente por uma
  // indisponibilidade do gateway seria péssimo negócio.
  if (onlinePayment) {
    try {
      paymentIntent = await createAppointmentDepositCharge(db, {
        appointmentId,
        clientId: client.id,
        amount: depositValue,
        description: `Sinal - ${service.name}`,
        // Mesma chave do caminho manual: o reenvio do formulário (F5, clique
        // duplo) reaproveita o intent em vez de emitir uma segunda fatura.
        idempotencyKey: `booking:${bookingKey}:deposit`,
        reservesStock
      });
    } catch (error) {
      console.error(`[Asaas] sinal do agendamento ${appointmentId}: ${error.message}`);
      paymentIntent = null;
    }
  }

  const appointment = await listAppointments(db, "WHERE a.id = ?", [appointmentId]).then((rows) => rows[0]);
  const proofMessage = [
    `Olá, ${professional.name}. Tudo bem?`,
    `Sou ${client.full_name || body.full_name} e acabei de solicitar meu agendamento na Aura Clinic.`,
    `Serviço: ${service.name}`,
    jewelry ? `Joia: ${jewelry.name}${variant ? ` - ${variant.variation_name}` : ""}` : "",
    `Data: ${date} às ${time}`,
    `Sinal: R$ ${depositValue.toFixed(2).replace(".", ",")}`,
    "Segue o comprovante do sinal para conferência."
  ].filter(Boolean).join("\n");
  const professionalWhatsappUrl = whatsappLink(professional.whatsapp || professional.phone, proofMessage);
  // Fila de notificações fica FORA da transação: é entrega best-effort e não
  // pode fazer o agendamento já confirmado voltar atrás.
  await queueProfessionalBookingNotification(db, {
    appointmentId,
    professionalId,
    client,
    service,
    appointment,
    storeName: await getStoreName(db, req.tenant?.name)
  });
  await scheduleAppointmentClientAutomations(db, appointmentId);
  res.status(201).json({
    ...appointment,
    service_value: serviceValue,
    jewelry_value: jewelryValue,
    discount_value: Number((serviceValue + jewelryValue - totalValue).toFixed(2)),
    items: bookingItems,
    payment_intent: publicPaymentIntent(paymentIntent),
    professional_whatsapp_url: professionalWhatsappUrl,
    // Link da fatura hospedada pelo Asaas. É o que a tela abre para o cliente
    // pagar; `null` quando não há gateway ou quando ele falhou na criação.
    payment_url: paymentIntent?.invoice_url || null,
    online_payment_available: Boolean(paymentIntent?.online_payment_available),
    // A instrução muda com o caminho disponível: mandar o cliente enviar
    // comprovante quando existe link de pagamento é ruído, e o contrário é pior
    // ainda — ele ficaria esperando um link que nunca vem.
    payment_instructions: paymentIntent?.online_payment_available
      ? "Pague o sinal pelo link para confirmar seu horário. A confirmação é automática assim que o pagamento cair."
      : "Envie o comprovante do sinal pelo WhatsApp. A Aura confirma o horário após conferência manual."
  });
}));

export default router;
