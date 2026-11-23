// Vacation absence model for the production calendar app.
//
// Two distinct calendar concepts are kept apart on purpose:
//   * statutory non-working public holidays (ТК РФ ст. 112) — they are NOT
//     included in calendar days of vacation (ТК РФ ст. 120);
//   * transferred days off and ordinary weekends — they ARE included in
//     calendar days of vacation and are paid as vacation days.
// The app's own `dayNorm` keeps returning 0 for all of them; that is the work
// norm, which is a different question from what a vacation day costs.

const PUBLIC_HOLIDAYS_2026 = new Set([
  "0-1", "0-2", "0-3", "0-4", "0-5", "0-6", "0-7", "0-8",
  "1-23", "2-8", "4-1", "4-9", "5-12", "10-4",
]);

// Days off granted by transfer, not holidays in the sense of ст. 112.
const TRANSFERRED_DAYS_OFF_2026 = new Set(["0-9", "2-9", "4-11", "11-31"]);

const PRE_HOLIDAYS_2026 = new Set(["3-30", "4-8", "5-11", "10-3"]);

function key(month, day) {
  return `${month}-${day}`;
}

export function isPublicHoliday(year, month, day) {
  return year === 2026 && PUBLIC_HOLIDAYS_2026.has(key(month, day));
}

export function isTransferredDayOff(year, month, day) {
  return year === 2026 && TRANSFERRED_DAYS_OFF_2026.has(key(month, day));
}

export function dayKind(year, month, day) {
  if (isPublicHoliday(year, month, day)) return "public-holiday";
  if (isTransferredDayOff(year, month, day)) return "transferred-day-off";
  if (year === 2026 && PRE_HOLIDAYS_2026.has(key(month, day))) return "preholiday";
  const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
  return weekday === 0 || weekday === 6 ? "weekend" : "workday";
}

function dayNumber(year, month, day) {
  return Date.UTC(year, month, day) / 86_400_000;
}

export function enumerateDates(start, end) {
  const first = dayNumber(start.year, start.month, start.day);
  const last = dayNumber(end.year, end.month, end.day);
  const dates = [];
  for (let cursor = first; cursor <= last; cursor += 1) {
    const date = new Date(cursor * 86_400_000);
    dates.push({ year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() });
  }
  return dates;
}

export function countPaidVacationDays(start, end) {
  return enumerateDates(start, end).filter((date) => !isPublicHoliday(date.year, date.month, date.day)).length;
}
