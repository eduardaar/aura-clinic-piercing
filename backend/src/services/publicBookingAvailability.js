// Public releases restrict the working schedule; they never create working hours.
export function validBookingDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}

const validTime = (value) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function normalizePublicAvailability(body) {
  if (!body || typeof body.restricted !== "boolean" || !Array.isArray(body.windows) || body.windows.length > 100) {
    throw new Error("Informe o modo da agenda e até 100 períodos de liberação.");
  }
  const windows = body.windows.map((window) => {
    if (
      !window ||
      !validBookingDate(window.from) ||
      !validBookingDate(window.to) ||
      window.from > window.to ||
      !validTime(window.start_time) ||
      !validTime(window.end_time) ||
      window.start_time >= window.end_time ||
      !Array.isArray(window.weekdays) ||
      !window.weekdays.length ||
      window.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    ) {
      throw new Error("Confira as datas, os dias da semana e os horários de cada período.");
    }
    return {
      from: window.from,
      to: window.to,
      start_time: window.start_time,
      end_time: window.end_time,
      weekdays: [...new Set(window.weekdays)],
    };
  });
  return { restricted: body.restricted, windows };
}

export async function getPublicAvailability(db, professionalId) {
  const row = await db.get("SELECT value FROM catalog_settings WHERE key = ?", [
    `public_booking_availability_${professionalId}`,
  ]);
  if (!row) return { restricted: false, windows: [] };
  try {
    return normalizePublicAvailability(JSON.parse(row.value));
  } catch {
    return { restricted: true, windows: [] };
  }
}

export function publicSlotIsReleased(config, date, start, end) {
  if (!config.restricted) return true;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return config.windows.some(
    (window) =>
      date >= window.from &&
      date <= window.to &&
      window.weekdays.includes(weekday) &&
      start >= window.start_time &&
      end <= window.end_time,
  );
}
