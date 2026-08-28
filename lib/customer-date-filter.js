const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

function bangkokParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function calendarDate(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function shiftCalendar(parts, days) {
  const date = calendarDate(parts);
  date.setUTCDate(date.getUTCDate() + days);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function startOfBangkokDay(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - BANGKOK_OFFSET_MS).toISOString();
}

function range(start, endExclusive) {
  return { from: startOfBangkokDay(start), toExclusive: startOfBangkokDay(endExclusive) };
}

export function getCustomerDateRange(preset, now = new Date()) {
  const today = bangkokParts(now);
  const tomorrow = shiftCalendar(today, 1);
  if (preset === "today") return range(today, tomorrow);
  if (preset === "yesterday") return range(shiftCalendar(today, -1), today);
  if (preset === "last3") return range(shiftCalendar(today, -2), tomorrow);

  const weekday = calendarDate(today).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const thisMonday = shiftCalendar(today, -daysSinceMonday);
  if (preset === "this_week") return range(thisMonday, tomorrow);
  if (preset === "last_week") return range(shiftCalendar(thisMonday, -7), thisMonday);

  const monthStart = { year: today.year, month: today.month, day: 1 };
  const nextMonth = today.month === 12 ? { year: today.year + 1, month: 1, day: 1 } : { year: today.year, month: today.month + 1, day: 1 };
  const previousMonth = today.month === 1 ? { year: today.year - 1, month: 12, day: 1 } : { year: today.year, month: today.month - 1, day: 1 };
  if (preset === "this_month") return range(monthStart, tomorrow);
  if (preset === "last_month") return range(previousMonth, monthStart);

  const yearStart = { year: today.year, month: 1, day: 1 };
  if (preset === "this_year") return range(yearStart, tomorrow);
  if (preset === "last_year") return range({ year: today.year - 1, month: 1, day: 1 }, yearStart);

  if (["7", "30", "90"].includes(String(preset))) {
    return { from: new Date(now.getTime() - Number(preset) * 864e5).toISOString(), toExclusive: null };
  }
  return null;
}
