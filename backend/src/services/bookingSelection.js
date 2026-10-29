// Datas e horários usam a mesma composição de serviços exibida no resumo.
export class BookingSelectionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function resolveBookingSelection(db, query, professionalId) {
  const raw = query.service_ids ?? query.service_id;
  const entries = typeof raw === "string" || typeof raw === "number" ? String(raw).split(",") : [];
  if (
    !entries.length ||
    entries.length > 100 ||
    entries.some((value) => !/^[1-9]\d*$/.test(value.trim()) || !Number.isSafeInteger(Number(value)))
  ) {
    throw new BookingSelectionError("Selecione serviços válidos para consultar a disponibilidade.");
  }
  const ids = [...new Set(entries.map(Number))];
  const placeholders = ids.map(() => "?").join(",");
  const services = await db.all(
    `SELECT * FROM services WHERE id IN (${placeholders}) AND is_active=true AND active_online_booking=1`,
    ids,
  );
  if (services.length !== ids.length)
    throw new BookingSelectionError("Um dos serviços selecionados não está disponível.", 404);
  const professional = await db.get("SELECT id FROM professionals WHERE id=? AND active=1", [professionalId]);
  if (!professional) throw new BookingSelectionError("Profissional não encontrado ou inativo.", 404);
  const links = await db.all(
    `SELECT service_id FROM professional_services WHERE professional_id=? AND service_id IN (${placeholders})`,
    [professionalId, ...ids],
  );
  if (new Set(links.map((link) => Number(link.service_id))).size !== ids.length) {
    throw new BookingSelectionError("Este profissional não realiza todos os serviços selecionados.", 409);
  }
  return {
    ...services.find((service) => Number(service.id) === ids[0]),
    duration_minutes: services.reduce((total, service) => total + Number(service.duration_minutes || 40), 0),
    minimum_advance_minutes: Math.max(0, ...services.map((service) => Number(service.minimum_advance_minutes || 0))),
    scheduling_interval_minutes: Math.max(
      0,
      ...services.map((service) => Number(service.scheduling_interval_minutes || 0)),
    ),
  };
}
