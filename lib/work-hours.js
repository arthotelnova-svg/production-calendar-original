const HOLIDAYS_2026 = new Set([
  "0-1", "0-2", "0-3", "0-4", "0-5", "0-6", "0-7", "0-8", "0-9",
  "1-23", "2-8", "2-9", "4-1", "4-2", "4-3", "4-9", "4-10", "4-11",
  "5-12", "5-13", "5-14", "10-4", "11-31",
]);
const PRE_HOLIDAYS_2026 = new Set(["3-30", "4-8", "5-11", "10-3"]);

export function dayNorm(year, month, day) {
  const key = `${month}-${day}`;
  if (year === 2026 && HOLIDAYS_2026.has(key)) return 0;
  if (year === 2026 && PRE_HOLIDAYS_2026.has(key)) return 7;
  const weekday = new Date(year, month, day).getDay();
  return weekday === 0 || weekday === 6 ? 0 : 8;
}

// Scheduled workdays of an inclusive in-month range (holidays/weekends excluded).
export function scheduledWorkdays(year, month, fromDay, toDay) {
  let count = 0;
  for (let day = fromDay; day <= toDay; day += 1) {
    if (dayNorm(year, month, day) > 0) count += 1;
  }
  return count;
}

// `vacationDays` (optional) lists day numbers inside `fromDay..toDay` that are
// covered by a vacation absence. Those days are dropped from the counters
// entirely: a vacation must not create a deficit nor absorb overtime. The
// half-month mutual offset keeps working for every remaining day.
export function periodStats(workHours, year, month, fromDay, toDay, hourlyRate, overtimeRate, vacationDays = []) {
  const skipped = vacationDays instanceof Set ? vacationDays : new Set(vacationDays);
  let positiveHours = 0;
  let underworkHours = 0;
  let recordedDays = 0;

  for (let day = fromDay; day <= toDay; day += 1) {
    if (skipped.has(day)) continue;
    const key = `${month}-${day}`;
    if (!Object.hasOwn(workHours, key)) continue;
    recordedDays += 1;
    const delta = workHours[key] - dayNorm(year, month, day);
    if (delta > 0) positiveHours += delta;
    if (delta < 0) underworkHours += Math.abs(delta);
  }

  const coveredHours = Math.min(positiveHours, underworkHours);
  const payableOvertimeHours = Math.max(0, positiveHours - underworkHours);
  const unpaidHours = Math.max(0, underworkHours - positiveHours);
  return {
    recordedDays,
    positiveHours,
    underworkHours,
    coveredHours,
    payableOvertimeHours,
    unpaidHours,
    deduction: unpaidHours * hourlyRate,
    overtimePay: payableOvertimeHours * overtimeRate,
  };
}
