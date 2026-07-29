// Serviço de clientes: enriquecimento da LISTA de clientes em modo BATCH.
//
// Motivação (N+1): a listagem antiga chamava, para CADA cliente, quatro queries
// separadas (history, payments, medicalRecords, loyalty). Com N clientes isso
// gerava ~4N+1 idas ao banco. Aqui buscamos todos os dados de uma vez (algumas
// queries fixas, independente de N) e agrupamos em memória por client_id.
//
// O SHAPE final de cada cliente é IDÊNTICO ao anterior:
//   client.history        -> array (mesmos campos de listAppointments)
//   client.payments       -> array
//   client.medicalRecords -> array (mesmos campos de listMedicalRecords)
//   client.loyalty        -> objeto igual ao getClientLoyalty
import { loyaltyLevel, loyaltyBenefits } from "./utils.js";

// Agrupa um array de linhas em um Map por chave (ex.: client_id).
function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

// Detalhe COMPLETO de um cliente só. É o endpoint GET /api/clients/:id: a
// listagem virou enxuta, então todo o enriquecimento (timeline, prontuários,
// fidelidade...) passou a viver aqui, custando o mesmo que antes só que para
// UM cliente em vez de todos.
export async function getClientWithDetails(db, clientId) {
  const [client] = await listClientsWithDetails(db, clientId);
  return client || null;
}

// Retorna os clientes já enriquecidos usando queries em batch (uma por tabela,
// independente de N). `clientId` restringe o enriquecimento a um único cliente.
export async function listClientsWithDetails(db, clientId = null) {
  const one = clientId !== null && clientId !== undefined;
  // Escopo aplicado em TODA query do enriquecimento: sem ele, o detalhe de um
  // cliente carregaria as onze tabelas inteiras só para descartar quase tudo.
  const scope = (column) => (one ? `WHERE ${column} = ?` : "");
  const scoped = (extra = []) => (one ? [clientId, ...extra] : extra);

  const clients = one
    ? await db.all("SELECT * FROM clients WHERE id = ?", [clientId])
    : await db.all("SELECT * FROM clients ORDER BY full_name");
  if (!clients.length) return clients;

  // ----- history (agendamentos) de todos os clientes, em uma query -----
  // Mesmos JOINs/campos de services/appointments.listAppointments, sem filtro
  // por cliente, ordenado igual (por data/hora). O agrupamento preserva a ordem.
  const appointments = await db.all(`
    SELECT a.*, c.full_name, c.whatsapp, c.instagram, p.name AS professional_name,
      j.name AS jewelry_name, j.photo_url AS jewelry_photo,
      v.variation_name AS jewelry_variation_name, v.sku AS jewelry_variant_sku,
      s.name AS service_name
    FROM appointments a
    JOIN clients c ON c.id = a.client_id
    JOIN professionals p ON p.id = a.professional_id
    LEFT JOIN jewelry_inventory j ON j.id = a.jewelry_id
    LEFT JOIN jewelry_variants v ON v.id = a.jewelry_variant_id
    LEFT JOIN services s ON s.id = a.service_id
    ${scope("a.client_id")}
    ORDER BY a.appointment_date, a.appointment_time
  `, scoped());
  const historyByClient = groupBy(appointments, "client_id");

  // ----- payments de todos os clientes -----
  const payments = await db.all(`SELECT * FROM payments ${scope("client_id")} ORDER BY paid_at DESC`, scoped());
  const paymentsByClient = groupBy(payments, "client_id");

  // ----- medicalRecords de todos os clientes (mesmos JOINs de listMedicalRecords) -----
  const medicalRecords = await db.all(`
    SELECT
      r.*,
      a.procedure,
      a.piercing_region,
      a.appointment_date,
      p.name AS professional_name,
      j.name AS appointment_jewelry
    FROM client_medical_records r
    LEFT JOIN appointments a ON a.id = r.appointment_id
    LEFT JOIN professionals p ON p.id = a.professional_id
    LEFT JOIN jewelry_inventory j ON j.id = a.jewelry_id
    ${scope("r.client_id")}
    ORDER BY r.record_date DESC, r.id DESC
  `, scoped());
  const recordsByClient = groupBy(medicalRecords, "client_id");

  // ----- loyalty (pontos e resgates) de todos os clientes -----
  const loyaltyPoints = await db.all(`SELECT * FROM loyalty_points ${scope("client_id")} ORDER BY created_at DESC, id DESC`, scoped());
  const redemptions = await db.all(`SELECT * FROM loyalty_redemptions ${scope("client_id")} ORDER BY redeemed_at DESC, id DESC`, scoped());
  const pointsByClient = groupBy(loyaltyPoints, "client_id");
  const redemptionsByClient = groupBy(redemptions, "client_id");
  const terms = await db.all(`SELECT id,client_id,appointment_id,procedure,piercing_region,pdf_url,signed_at FROM digital_terms ${scope("client_id")} ORDER BY signed_at DESC`, scoped());
  const followups = await db.all(`SELECT * FROM post_care_followups ${scope("client_id")} ORDER BY due_date DESC,id DESC`, scoped());
  const sales = await db.all(`SELECT * FROM sales_orders ${scope("client_id")} ORDER BY created_at DESC,id DESC`, scoped());
  const couponUses = await db.all(`
    SELECT u.*,c.code,c.internal_name FROM coupon_usages u JOIN coupons c ON c.id=u.coupon_id
    WHERE u.client_id IS NOT NULL ${one ? "AND u.client_id = ?" : ""} ORDER BY u.created_at DESC
  `, scoped());
  const promotionUses = await db.all(`
    SELECT u.*,p.name FROM promotion_usages u JOIN catalog_promotions p ON p.id=u.promotion_id
    WHERE u.client_id IS NOT NULL ${one ? "AND u.client_id = ?" : ""} ORDER BY u.created_at DESC
  `, scoped());
  const termsByClient = groupBy(terms, "client_id");
  const followupsByClient = groupBy(followups, "client_id");
  const salesByClient = groupBy(sales, "client_id");
  const couponsByClient = groupBy(couponUses, "client_id");
  const promotionsByClient = groupBy(promotionUses, "client_id");

  for (const client of clients) {
    client.history = historyByClient.get(client.id) || [];
    client.payments = paymentsByClient.get(client.id) || [];
    client.medicalRecords = recordsByClient.get(client.id) || [];
    client.loyalty = buildLoyalty(pointsByClient.get(client.id) || [], redemptionsByClient.get(client.id) || []);
    client.terms = termsByClient.get(client.id) || [];
    client.followups = followupsByClient.get(client.id) || [];
    client.sales = salesByClient.get(client.id) || [];
    client.couponsUsed = couponsByClient.get(client.id) || [];
    client.promotionsUsed = promotionsByClient.get(client.id) || [];
    client.timeline = [
      ...client.history.map((item) => ({ type: "appointment", date: item.appointment_date, title: item.procedure || "Atendimento", status: item.status, value: item.total_value })),
      ...client.payments.map((item) => ({ type: "payment", date: item.paid_at, title: `Pagamento ${item.payment_type}`, status: item.status, value: item.amount })),
      ...client.medicalRecords.map((item) => ({ type: "medical_record", date: item.record_date, title: "Registro de prontuário", status: "registrado" })),
      ...client.terms.map((item) => ({ type: "term", date: item.signed_at, title: "Termo digital assinado", status: "assinado" })),
      ...client.followups.map((item) => ({ type: "followup", date: item.due_date, title: `Pós-atendimento ${item.reminder_day}d`, status: item.status })),
      ...client.sales.map((item) => ({ type: "sale", date: item.created_at, title: "Venda", status: item.status, value: item.total_value })),
      ...client.couponsUsed.map((item) => ({ type: "coupon", date: item.created_at, title: `Cupom ${item.code}`, status: "usado", value: item.discount_amount })),
      ...client.promotionsUsed.map((item) => ({ type: "promotion", date: item.created_at, title: `Promoção ${item.name}`, status: "usada", value: item.discount_amount }))
    ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }
  return clients;
}

// Reconstrói o objeto de fidelidade a partir das listas já carregadas, com o
// MESMO shape retornado por services/loyalty.getClientLoyalty.
function buildLoyalty(history, redemptions) {
  const totalEarned = history.reduce((sum, item) => sum + Number(item.points || 0), 0);
  const redeemedPoints = redemptions.reduce((sum, item) => sum + Number(item.points_used || 0), 0);
  const availablePoints = totalEarned - redeemedPoints;
  const level = loyaltyLevel(totalEarned);
  return {
    totalEarned,
    availablePoints,
    redeemedPoints,
    level,
    benefits: loyaltyBenefits(level),
    history,
    redemptions
  };
}
