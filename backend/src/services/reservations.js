export async function releaseExpiredReservations(db) {
  const result = await db.run(
    "UPDATE inventory_reservations SET status='expired', released_at=CURRENT_TIMESTAMP WHERE status='active' AND expires_at <= CURRENT_TIMESTAMP"
  );
  return result.changes || 0;
}

export async function availableStock(db, jewelryId, variationId = null) {
  await releaseExpiredReservations(db);
  const stock = variationId
    ? await db.get("SELECT quantity FROM jewelry_variants WHERE id=? AND jewelry_id=? AND is_active=1", [variationId, jewelryId])
    : await db.get("SELECT quantity FROM jewelry_inventory WHERE id=? AND status!='arquivado'", [jewelryId]);
  if (!stock) return null;
  const reserved = variationId
    ? await db.get("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM inventory_reservations WHERE jewelry_id=? AND jewelry_variant_id=? AND status='active' AND expires_at>CURRENT_TIMESTAMP", [jewelryId, variationId])
    : await db.get("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM inventory_reservations WHERE jewelry_id=? AND jewelry_variant_id IS NULL AND status='active' AND expires_at>CURRENT_TIMESTAMP", [jewelryId]);
  return Math.max(Number(stock.quantity || 0) - Number(reserved?.quantity || 0), 0);
}

export async function reserveAppointmentItems(db, { appointmentId, clientId, reservationKey, items, minutes = 30 }) {
  const reservations = [];
  await db.run("BEGIN");
  try {
    await releaseExpiredReservations(db);
    for (const item of items) {
    if (!item.jewelry_id) continue;
    const jewelryId = Number(item.jewelry_id);
    const variationId = Number(item.jewelry_variant_id || 0) || null;
    const quantity = Math.max(Number(item.quantity || 1), 1);
    if (variationId) await db.get("SELECT id FROM jewelry_variants WHERE id=? AND jewelry_id=? FOR UPDATE", [variationId, jewelryId]);
    else await db.get("SELECT id FROM jewelry_inventory WHERE id=? FOR UPDATE", [jewelryId]);
    const available = await availableStock(db, jewelryId, variationId);
    if (available === null || available < quantity) throw new Error("Estoque insuficiente para concluir a reserva.");
    const result = await db.run(
      `INSERT INTO inventory_reservations
        (reservation_key, appointment_id, client_id, jewelry_id, jewelry_variant_id, quantity, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP + (? * INTERVAL '1 minute'))
       ON CONFLICT (reservation_key, jewelry_id, jewelry_variant_id) DO UPDATE SET
         quantity=excluded.quantity, expires_at=excluded.expires_at, status='active'
       RETURNING id`,
      [reservationKey, appointmentId, clientId, jewelryId, variationId, quantity, minutes]
    );
      reservations.push(result.returnedId);
    }
    await db.run("COMMIT");
    return reservations;
  } catch (error) {
    await db.run("ROLLBACK");
    throw error;
  }
}

export async function confirmAppointmentReservations(db, appointmentId) {
  return db.run("UPDATE inventory_reservations SET status='confirmed', confirmed_at=CURRENT_TIMESTAMP WHERE appointment_id=? AND status='active'", [appointmentId]);
}

export async function releaseAppointmentReservations(db, appointmentId, status = "released") {
  return db.run("UPDATE inventory_reservations SET status=?, released_at=CURRENT_TIMESTAMP WHERE appointment_id=? AND status='active'", [status, appointmentId]);
}
