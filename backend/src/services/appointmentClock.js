// Horários da agenda são civis em São Paulo (UTC-3), independentes do servidor.
export function appointmentDateTime(item) {
  const time = String(item.appointment_time || "00:00").slice(0, 8);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item.appointment_date)) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return null;
  const value = new Date(`${item.appointment_date}T${time.length === 5 ? `${time}:00` : time}-03:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

export function appointmentCountdown(item, now = new Date()) {
  const date = appointmentDateTime(item);
  if (!date) return "";
  const difference = date.getTime() - now.getTime();
  const minutes = Math.ceil(Math.abs(difference) / 60000);
  if (difference < 0) return `Atrasado há ${minutes} min`;
  if (minutes < 60) return `Em ${minutes} min`;
  return `Em ${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

export function upcomingAppointmentsAt(appointments, now = new Date()) {
  return appointments.filter((item) => ["pendente", "awaiting_deposit_proof", "confirmado", "chegou"].includes(item.status)
    && appointmentDateTime(item)?.getTime() >= now.getTime())
    .sort((a, b) => appointmentDateTime(a).getTime() - appointmentDateTime(b).getTime() || Number(a.id) - Number(b.id));
}
