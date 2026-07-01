// Serviços do programa de fidelidade (Aura Rewards).
import { loyaltyLevel, loyaltyBenefits } from "./utils.js";

export async function awardLoyaltyForAppointment(db, appointmentId) {
  const appointment = await db.get("SELECT * FROM appointments WHERE id = ?", [appointmentId]);
  if (!appointment || appointment.status !== "atendido") return;
  await db.run(
    `INSERT INTO loyalty_points (client_id, appointment_id, points, event_type, description)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (appointment_id, event_type) DO NOTHING`,
    [appointment.client_id, appointment.id, 10, "procedimento", `Procedimento atendido: ${appointment.procedure}`]
  );
  if (appointment.jewelry_id) {
    const jewelry = await db.get("SELECT name FROM jewelry_inventory WHERE id = ?", [appointment.jewelry_id]);
    await db.run(
      `INSERT INTO loyalty_points (client_id, appointment_id, points, event_type, description)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (appointment_id, event_type) DO NOTHING`,
      [appointment.client_id, appointment.id, 5, "compra_joia", `Compra de joia: ${jewelry?.name || "joia vinculada"}`]
    );
  }
}

export async function getClientLoyalty(db, clientId) {
  const earned = await db.get("SELECT COALESCE(SUM(points), 0) AS total FROM loyalty_points WHERE client_id = ?", [clientId]);
  const redeemed = await db.get("SELECT COALESCE(SUM(points_used), 0) AS total FROM loyalty_redemptions WHERE client_id = ?", [clientId]);
  const history = await db.all("SELECT * FROM loyalty_points WHERE client_id = ? ORDER BY created_at DESC, id DESC", [clientId]);
  const redemptions = await db.all("SELECT * FROM loyalty_redemptions WHERE client_id = ? ORDER BY redeemed_at DESC, id DESC", [clientId]);
  const totalEarned = earned.total || 0;
  const availablePoints = totalEarned - (redeemed.total || 0);
  const level = loyaltyLevel(totalEarned);
  return {
    totalEarned,
    availablePoints,
    redeemedPoints: redeemed.total || 0,
    level,
    benefits: loyaltyBenefits(level),
    history,
    redemptions
  };
}
