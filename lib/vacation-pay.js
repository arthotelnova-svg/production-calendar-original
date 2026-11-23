// Vacation pay calculation for the production calendar app.
//
// Two layers live here:
//   * `buildVacation` / `allocateVacationPay` — price an absence and spread its
//     net amount across deterministic month/half buckets;
//   * `computeMonthPay` — one month of money: salary work pay, overtime pay and
//     vacation pay, per pay half and in total.
//
// Every returned amount is an integer number of kopecks. Nothing is stored or
// rendered here: this module is pure so the dashboard, the API and the tests all
// read the same numbers.
//
// Money rules implemented below:
//   * the monthly base keeps its full denominator: the cost of one hour is
//     `salary / (monthWorkdays * 8)`, and a vacation only removes the day norm
//     hours of the days it actually covers (a public holiday removes nothing, a
//     pre-holiday removes 7 hours);
//   * each half's base is the salary share of that half's scheduled workdays, so
//     the two halves always add back up to the untouched monthly salary;
//   * recorded hours keep their existing meaning (underwork deduction, overtime
//     offset against the same half) — vacation days are simply dropped from the
//     half so they neither create a deficit nor absorb overtime;
//   * vacation money is included in projected income once, regardless of payment;
//     `vacationPaidKopecks` records the received portion and `outstandingKopecks`
//     refers only to unpaid vacation money (salary payment history is not tracked).

import { MAX_KOPECKS, splitKopecks, toKopecks } from "./money";
import { parseIsoDate, isoDate } from "./leave-records";
import { dayNorm, periodStats, scheduledWorkdays } from "./work-hours";
import { enumerateDates, isPublicHoliday } from "./vacation";

export const SUPPORTED_YEARS = new Set([2026]);

const DAY_MS = 86_400_000;

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function dayNumber(date) {
  return Date.UTC(date.year, date.month, date.day) / DAY_MS;
}

function normalizeDate(value) {
  if (!value || typeof value !== "object") return null;
  const { year, month, day } = value;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 0 || month > 11) return null;
  if (day < 1 || day > lastDayOfMonth(year, month)) return null;
  return { year, month, day };
}

function halfOf(day) {
  return day <= 15 ? 1 : 2;
}

function halfBounds(year, month, half) {
  return half === 1 ? [1, 15] : [16, lastDayOfMonth(year, month)];
}

// Counters for one month/half bucket: calendar days include public holidays,
// paid days do not (ТК РФ ст. 120), workdays are the scheduled ones.
function bucketCounts(year, month, days) {
  let calendarDays = 0;
  let paidDays = 0;
  let workdays = 0;
  for (const date of days) {
    calendarDays += 1;
    if (isPublicHoliday(year, month, date.day)) continue;
    paidDays += 1;
    if (dayNorm(year, month, date.day) > 0) workdays += 1;
  }
  return { calendarDays, paidDays, workdays };
}

// Prices an absence range. Returns null for anything the app must reject: a bad
// range, an unsupported year, a non-positive amount or a range without a single
// paid day (a vacation that is only public holidays buys no paid day).
export function buildVacation({ start, end, net, amountKopecks, paid = false, paidDate = null, id = null } = {}) {
  const from = normalizeDate(start);
  const to = normalizeDate(end);
  if (!from || !to) return null;
  if (dayNumber(to) < dayNumber(from)) return null;
  if (!SUPPORTED_YEARS.has(from.year) || !SUPPORTED_YEARS.has(to.year)) return null;

  let netKopecks = null;
  if (Number.isInteger(amountKopecks)) {
    netKopecks = amountKopecks > 0 && amountKopecks <= MAX_KOPECKS ? amountKopecks : null;
  } else {
    netKopecks = toKopecks(net);
  }
  if (netKopecks === null || netKopecks <= 0) return null;

  const dates = enumerateDates(from, to);
  const paidDates = dates.filter((date) => !isPublicHoliday(date.year, date.month, date.day));
  if (paidDates.length === 0) return null;

  const byMonth = new Map();
  for (const date of dates) {
    const groupKey = `${date.year}-${date.month}`;
    if (!byMonth.has(groupKey)) byMonth.set(groupKey, []);
    byMonth.get(groupKey).push(date);
  }

  const months = [...byMonth.values()]
    .map((monthDates) => {
      const { year, month } = monthDates[0];
      const totals = bucketCounts(year, month, monthDates);
      const halves = [1, 2].map((half) => {
        const [fromDay, toDay] = halfBounds(year, month, half);
        const inHalf = monthDates.filter((date) => halfOf(date.day) === half);
        return {
          half,
          fromDay,
          toDay,
          ...bucketCounts(year, month, inHalf),
        };
      });
      return { year, month, ...totals, halves, days: monthDates.map((date) => date.day) };
    })
    .sort((a, b) => (a.year - b.year) || (a.month - b.month));

  return {
    id,
    startDate: isoDate(from.year, from.month + 1, from.day),
    endDate: isoDate(to.year, to.month + 1, to.day),
    start: from,
    end: to,
    netKopecks,
    calendarDays: dates.length,
    paidDays: paidDates.length,
    workdays: months.reduce((sum, monthEntry) => sum + monthEntry.workdays, 0),
    months,
    paid: Boolean(paid),
    paidDate: paid ? paidDate : null,
  };
}

// Spreads the net amount over the month/half buckets by paid vacation days.
// Whole kopecks only: integer shares plus the deterministic largest-remainder
// step from the money model, so the parts always add back up to the amount.
export function allocateVacationPay(vacation) {
  if (!vacation || !Array.isArray(vacation.months)) return [];
  const buckets = [];
  for (const monthEntry of vacation.months) {
    for (const halfEntry of monthEntry.halves ?? []) {
      if (halfEntry.paidDays <= 0) continue;
      buckets.push({
        year: monthEntry.year,
        month: monthEntry.month,
        half: halfEntry.half,
        paidDays: halfEntry.paidDays,
      });
    }
  }
  if (buckets.length === 0) return [];

  const parts = splitKopecks(vacation.netKopecks, buckets.map((bucket) => bucket.paidDays));
  return buckets.map((bucket, index) => ({ ...bucket, kopecks: parts[index] }));
}

// Vacation records come from the store as ISO dates plus integer kopecks; this
// is the single bridge from that API shape to the priced absence model.
export function vacationFromRecord(record) {
  if (!record || typeof record !== "object") return null;
  const start = parseIsoDate(record.startDate);
  const end = parseIsoDate(record.endDate);
  if (!start || !end) return null;
  return buildVacation({
    start: { year: start.year, month: start.month - 1, day: start.day },
    end: { year: end.year, month: end.month - 1, day: end.day },
    amountKopecks: record.amountKopecks,
    paid: record.paid === true,
    paidDate: record.paidDate ?? null,
    id: record.id ?? null,
  });
}

// One month of money.
//
// `vacations` is the API shape (id/startDate/endDate/amountKopecks/paid/paidDate).
// `workHours` is the recorded hours map keyed `${month}-${day}`.
export function computeMonthPay({
  salaryKopecks = 0,
  overtimeRateKopecks = 0,
  workHours = {},
  year,
  month,
  vacations = [],
} = {}) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) {
    throw new TypeError("computeMonthPay needs an integer year and a 0-based month");
  }

  const salary = Number.isInteger(salaryKopecks) && salaryKopecks > 0 ? salaryKopecks : 0;
  const overtimeRate = Number.isFinite(overtimeRateKopecks) ? overtimeRateKopecks : 0;
  const lastDay = lastDayOfMonth(year, month);
  const monthWorkdays = scheduledWorkdays(year, month, 1, lastDay);
  const hourlyRate = monthWorkdays > 0 ? salary / (monthWorkdays * 8) : 0;

  const priced = vacations.map(vacationFromRecord).filter(Boolean);

  // Days of this month covered by any absence, plus the vacation money bucket
  // of each half of this month.
  const vacationDays = new Set();
  const monthBuckets = [1, 2].map(() => ({ payKopecks: 0, paidKopecks: 0 }));
  const details = [];
  for (const vacation of priced) {
    for (const monthEntry of vacation.months) {
      if (monthEntry.year !== year || monthEntry.month !== month) continue;
      for (const day of monthEntry.days) vacationDays.add(day);
    }
    for (const part of allocateVacationPay(vacation)) {
      if (part.year !== year || part.month !== month) continue;
      const bucket = monthBuckets[part.half - 1];
      bucket.payKopecks += part.kopecks;
      if (vacation.paid) bucket.paidKopecks += part.kopecks;
    }
    details.push({ id: vacation.id, netKopecks: vacation.netKopecks, paid: vacation.paid, paidDate: vacation.paidDate });
  }

  const bounds = [[1, 15], [16, lastDay]];
  const halfWorkdays = bounds.map(([from, to]) => scheduledWorkdays(year, month, from, to));

  // Base share by scheduled workdays; the kopecks lost to integer rounding stay
  // on the second half, so both halves always add back up to the full salary.
  const firstHalfBase = monthWorkdays > 0 ? Math.round((salary * halfWorkdays[0]) / monthWorkdays) : 0;
  const halves = bounds.map(([fromDay, toDay], index) => {
    const half = index + 1;
    const baseKopecks = half === 1 ? firstHalfBase : salary - firstHalfBase;

    let vacationHours = 0;
    for (let day = fromDay; day <= toDay; day += 1) {
      if (vacationDays.has(day)) vacationHours += dayNorm(year, month, day);
    }
    const vacationReductionKopecks = monthWorkdays > 0
      ? Math.round((vacationHours * salary) / (monthWorkdays * 8))
      : 0;

    // Vacation days are dropped from the half: no deficit, no overtime absorbed.
    const stats = periodStats(workHours, year, month, fromDay, toDay, hourlyRate, overtimeRate, vacationDays);
    const deductionKopecks = Math.round(stats.deduction);
    const overtimePayKopecks = Math.round(stats.overtimePay);
    const workPayKopecks = baseKopecks - vacationReductionKopecks - deductionKopecks;

    const bucket = monthBuckets[index];
    const vacationPayKopecks = bucket.payKopecks;
    const vacationPaidKopecks = bucket.paidKopecks;
    const outstandingKopecks = vacationPayKopecks - vacationPaidKopecks;

    return {
      half,
      fromDay,
      toDay,
      workdays: halfWorkdays[index],
      baseKopecks,
      vacationHours,
      vacationReductionKopecks,
      deductionKopecks,
      overtimePayKopecks,
      workPayKopecks,
      vacationPayKopecks,
      vacationPaidKopecks,
      outstandingKopecks,
      totalKopecks: workPayKopecks + overtimePayKopecks + vacationPayKopecks,
      stats,
    };
  });

  const sum = (pick) => halves.reduce((total, entry) => total + pick(entry), 0);
  const vacationPayKopecks = sum((entry) => entry.vacationPayKopecks);
  const vacationPaidKopecks = sum((entry) => entry.vacationPaidKopecks);

  return {
    year,
    month,
    monthWorkdays,
    hourlyRateKopecks: hourlyRate,
    baseKopecks: sum((entry) => entry.baseKopecks),
    vacationHours: sum((entry) => entry.vacationHours),
    vacationReductionKopecks: sum((entry) => entry.vacationReductionKopecks),
    workPayKopecks: sum((entry) => entry.workPayKopecks),
    overtimePayKopecks: sum((entry) => entry.overtimePayKopecks),
    vacationPayKopecks,
    vacationPaidKopecks,
    outstandingKopecks: vacationPayKopecks - vacationPaidKopecks,
    totalKopecks: sum((entry) => entry.totalKopecks),
    vacations: details,
    halves,
    stats: {
      monthWorkdays,
      workdaysFirstHalf: halfWorkdays[0],
      workdaysSecondHalf: halfWorkdays[1],
      recordedDays: sum((entry) => entry.stats.recordedDays),
      positiveHours: sum((entry) => entry.stats.positiveHours),
      underworkHours: sum((entry) => entry.stats.underworkHours),
      coveredHours: sum((entry) => entry.stats.coveredHours),
      payableOvertimeHours: sum((entry) => entry.stats.payableOvertimeHours),
      unpaidHours: sum((entry) => entry.stats.unpaidHours),
      deductionKopecks: sum((entry) => entry.deductionKopecks),
      overtimePayKopecks: sum((entry) => entry.overtimePayKopecks),
      vacationHours: sum((entry) => entry.vacationHours),
      vacationReductionKopecks: sum((entry) => entry.vacationReductionKopecks),
    },
  };
}
