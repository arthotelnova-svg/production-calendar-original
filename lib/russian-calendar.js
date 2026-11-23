const HOLIDAYS_2026 = new Set([
  "0-1", "0-2", "0-3", "0-4", "0-5", "0-6", "0-7", "0-8", "0-9",
  "1-23", "2-8", "2-9", "4-1", "4-2", "4-3", "4-9", "4-10", "4-11",
  "5-12", "5-13", "5-14", "10-4", "11-31",
]);

const PRE_HOLIDAYS_2026 = new Set(["3-30", "4-8", "5-11", "10-3"]);

export function isAbsenceEligible(year, month, day) {
  const key = `${month}-${day}`;
  if (year === 2026 && (HOLIDAYS_2026.has(key) || PRE_HOLIDAYS_2026.has(key))) {
    return PRE_HOLIDAYS_2026.has(key);
  }

  const weekday = new Date(year, month, day).getDay();
  return weekday !== 0 && weekday !== 6;
}
