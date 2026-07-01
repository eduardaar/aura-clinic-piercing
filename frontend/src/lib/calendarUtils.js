import { asArray, formatDate } from "./utils";

export function buildCalendar(items, mode, currentDate) {
  const safeItems = asArray(items);
  const base = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  const days = mode === "mensal" ? buildMonthDays(base) : mode === "semanal" ? buildWeekDays(base) : [base];
  const mappedDays = days.map((date) => {
    const key = dateKey(date);
    return {
      date,
      key,
      isOutside: mode === "mensal" && date.getMonth() !== base.getMonth(),
      isToday: key === dateKey(new Date()),
      items: safeItems
        .filter((item) => item?.appointment_date === key)
        .sort((a, b) => String(a?.appointment_time || "").localeCompare(String(b?.appointment_time || "")))
    };
  });
  return { title: calendarTitle(base, mode), days: mappedDays };
}

export function buildMonthDays(date) {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = addDays(firstDay, -firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export function buildWeekDays(date) {
  const start = addDays(date, -date.getDay());
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function buildTimeSlots(items) {
  const safeItems = asArray(items);
  const baseHours = Array.from({ length: 11 }, (_, index) => `${String(index + 8).padStart(2, "0")}:00`);
  const eventHours = safeItems.map((item) => `${String(item?.appointment_time || "00").slice(0, 2)}:00`);
  return [...new Set([...baseHours, ...eventHours])].sort().map((hour) => ({
    hour,
    items: safeItems.filter((item) => String(item?.appointment_time || "").slice(0, 2) === hour.slice(0, 2))
  }));
}

export function movePeriod(date, mode, direction) {
  if (mode === "mensal") return new Date(date.getFullYear(), date.getMonth() + direction, 1);
  if (mode === "semanal") return addDays(date, direction * 7);
  return addDays(date, direction);
}

export function calendarTitle(date, mode) {
  if (mode === "mensal") return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  if (mode === "semanal") {
    const week = buildWeekDays(date);
    return `${formatDate(dateKey(week[0]))} - ${formatDate(dateKey(week[6]))}`;
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
