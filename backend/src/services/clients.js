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

// Retorna todos os clientes já enriquecidos (mesmo shape da versão por-cliente),
// porém usando queries em batch em vez de loop por-cliente.
export async function listClientsWithDetails(db) {
  const clients = await db.all("SELECT * FROM clients ORDER BY full_name");
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
    ORDER BY a.appointment_date, a.appointment_time
  `);
  const historyByClient = groupBy(appointments, "client_id");

  // ----- payments de todos os clientes -----
  const payments = await db.all("SELECT * FROM payments ORDER BY paid_at DESC");
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
    ORDER BY r.record_date DESC, r.id DESC
  `);
  const recordsByClient = groupBy(medicalRecords, "client_id");

  // ----- loyalty (pontos e resgates) de todos os clientes -----
  const loyaltyPoints = await db.all("SELECT * FROM loyalty_points ORDER BY created_at DESC, id DESC");
  const redemptions = await db.all("SELECT * FROM loyalty_redemptions ORDER BY redeemed_at DESC, id DESC");
  const pointsByClient = groupBy(loyaltyPoints, "client_id");
  const redemptionsByClient = groupBy(redemptions, "client_id");

  for (const client of clients) {
    client.history = historyByClient.get(client.id) || [];
    client.payments = paymentsByClient.get(client.id) || [];
    client.medicalRecords = recordsByClient.get(client.id) || [];
    client.loyalty = buildLoyalty(pointsByClient.get(client.id) || [], redemptionsByClient.get(client.id) || []);
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
