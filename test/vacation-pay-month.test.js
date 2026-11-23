import { describe, expect, it } from "vitest";
import { allocateVacationPay, buildVacation, computeMonthPay, vacationFromRecord } from "../lib/vacation-pay";

// 135 000 ₽ salary, 164 ₽/hour overtime rate, November 2026 (month 10).
// November 2026 has 20 scheduled workdays: 9 in the first half (1-15), 11 in the
// second (16-30). One hour therefore costs 13 500 000 / (20 * 8) = 84 375 kopecks.
const SALARY = 13500000;
const OT_RATE = 16400;
const base = { salaryKopecks: SALARY, overtimeRateKopecks: OT_RATE, year: 2026, month: 10 };

const vacation = (over = {}) => ({
  id: 1,
  startDate: "2026-11-02",
  endDate: "2026-11-08",
  amountKopecks: 2606800,
  paid: true,
  paidDate: "2026-11-01",
  ...over,
});

describe("computeMonthPay without vacations", () => {
  it("pays the untouched salary and keeps the workday-based halves adding up", () => {
    const pay = computeMonthPay({ ...base });
    expect(pay.monthWorkdays).toBe(20);
    expect(pay.halves.map((half) => half.baseKopecks)).toEqual([6075000, 7425000]);
    expect(pay.halves.map((half) => half.totalKopecks)).toEqual([6075000, 7425000]);
    expect(pay.workPayKopecks).toBe(SALARY);
    expect(pay.overtimePayKopecks).toBe(0);
    expect(pay.vacationPayKopecks).toBe(0);
    expect(pay.vacationPaidKopecks).toBe(0);
    expect(pay.outstandingKopecks).toBe(0);
    expect(pay.totalKopecks).toBe(SALARY);
    expect(pay.stats).toMatchObject({
      monthWorkdays: 20,
      workdaysFirstHalf: 9,
      workdaysSecondHalf: 11,
      recordedDays: 0,
      positiveHours: 0,
      underworkHours: 0,
      deductionKopecks: 0,
      vacationHours: 0,
      vacationReductionKopecks: 0,
    });
  });

  it("keeps the existing overtime offset and underwork deduction for recorded hours", () => {
    // Mon 10: 10 h (+2), Fri 14 is empty, Tue 13 is not recorded, Wed 14 ...
    // day 10 -> +2 overtime hours, day 12 -> 4 h (-4): 2 covered, 2 unpaid.
    const pay = computeMonthPay({ ...base, workHours: { "10-10": 10, "10-12": 4 } });
    expect(pay.stats).toMatchObject({
      recordedDays: 2,
      positiveHours: 2,
      underworkHours: 4,
      coveredHours: 2,
      payableOvertimeHours: 0,
      unpaidHours: 2,
      deductionKopecks: 168750,
      overtimePayKopecks: 0,
    });
    expect(pay.halves[0].workPayKopecks).toBe(6075000 - 168750);
    expect(pay.workPayKopecks).toBe(SALARY - 168750);
    expect(pay.totalKopecks).toBe(SALARY - 168750);
  });

  it("pays overtime at the configured rate", () => {
    // Tue 17: 11 h -> 3 payable overtime hours over the 8 h norm.
    const pay = computeMonthPay({ ...base, workHours: { "10-17": 11 } });
    expect(pay.stats.payableOvertimeHours).toBe(3);
    expect(pay.overtimePayKopecks).toBe(3 * OT_RATE);
    expect(pay.halves[1].overtimePayKopecks).toBe(3 * OT_RATE);
    expect(pay.workPayKopecks).toBe(SALARY);
    expect(pay.totalKopecks).toBe(SALARY + 3 * OT_RATE);
  });
});

describe("computeMonthPay salary reduction for vacation days", () => {
  it("reduces the half by the day norm of each covered day, holiday 0 h and preholiday 7 h", () => {
    // 2026-11-02 Mon 8 h, 11-03 Tue preholiday 7 h, 11-04 Wed public holiday 0 h,
    // 11-05 Thu 8 h, 11-06 Fri 8 h -> 31 h of the norm, nothing else.
    const pay = computeMonthPay({ ...base, vacations: [vacation()] });
    expect(pay.stats.vacationHours).toBe(31);
    expect(pay.stats.vacationReductionKopecks).toBe(2615625);
    expect(pay.halves[0].baseKopecks).toBe(6075000); // denominator untouched
    expect(pay.halves[0].vacationHours).toBe(31);
    expect(pay.halves[0].vacationReductionKopecks).toBe(2615625);
    expect(pay.halves[1].vacationReductionKopecks).toBe(0);
    expect(pay.baseKopecks).toBe(SALARY);
    expect(pay.workPayKopecks).toBe(SALARY - 2615625);
    // A vacation never creates a deficit on its own.
    expect(pay.stats.underworkHours).toBe(0);
    expect(pay.stats.deductionKopecks).toBe(0);
  });

  it("drops vacation days from the hour counters but keeps the rest of the half", () => {
    const pay = computeMonthPay({
      ...base,
      vacations: [vacation()],
      workHours: { "10-3": 4, "10-10": 10, "10-12": 4 },
    });
    // Day 3 sits inside the vacation: it must not become underwork.
    expect(pay.stats.recordedDays).toBe(2);
    expect(pay.stats.underworkHours).toBe(4);
    expect(pay.stats.unpaidHours).toBe(2);
    expect(pay.stats.deductionKopecks).toBe(168750);
    expect(pay.halves[0].workPayKopecks).toBe(6075000 - 2615625 - 168750);
  });

  it("leaves overtime outside the vacation untouched", () => {
    const withoutVacation = computeMonthPay({ ...base, workHours: { "10-17": 11 } });
    const withVacation = computeMonthPay({ ...base, workHours: { "10-17": 11 }, vacations: [vacation()] });
    expect(withVacation.halves[1]).toMatchObject({ overtimePayKopecks: 3 * OT_RATE, baseKopecks: 7425000 });
    expect(withVacation.overtimePayKopecks).toBe(withoutVacation.overtimePayKopecks);
    expect(withVacation.workPayKopecks).toBe(withoutVacation.workPayKopecks - 2615625);
  });

  it("ignores a record with no paid day or an unsupported amount", () => {
    expect(vacationFromRecord({ startDate: "2026-01-01", endDate: "2026-01-08", amountKopecks: 1000, paid: false })).toBeNull();
    expect(vacationFromRecord({ startDate: "2026-11-02", endDate: "2026-11-08", amountKopecks: 0, paid: false })).toBeNull();
    const pay = computeMonthPay({
      ...base,
      vacations: [{ id: 9, startDate: "2026-01-01", endDate: "2026-01-08", amountKopecks: 1000, paid: false }],
    });
    expect(pay.stats.vacationHours).toBe(0);
    expect(pay.vacationPayKopecks).toBe(0);
    expect(pay.totalKopecks).toBe(SALARY);
  });
});

describe("computeMonthPay vacation income", () => {
  it("includes earned vacation money once regardless of payment status", () => {
    const unpaid = computeMonthPay({ ...base, vacations: [vacation({ paid: false, paidDate: null })] });
    expect(unpaid.vacationPayKopecks).toBe(2606800);
    expect(unpaid.vacationPaidKopecks).toBe(0);
    expect(unpaid.outstandingKopecks).toBe(2606800);
    expect(unpaid.totalKopecks).toBe(SALARY - 2615625 + 2606800);
    expect(unpaid.totalKopecks - unpaid.vacationPaidKopecks).toBe(SALARY - 2615625 + 2606800);

    const paid = computeMonthPay({ ...base, vacations: [vacation()] });
    expect(paid.vacationPayKopecks).toBe(2606800);
    expect(paid.vacationPaidKopecks).toBe(2606800);
    expect(paid.outstandingKopecks).toBe(0);
    expect(paid.totalKopecks).toBe(SALARY - 2615625 + 2606800);
  });

  it("lands every kopeck of a cross-month vacation in the right month and half", () => {
    // 2026-11-28 Sat .. 2026-12-05 Sat, 1000 ₽: 3 paid days in November (half 2)
    // and 5 in December (half 1), allocated by paid days.
    const cross = { id: 2, startDate: "2026-11-28", endDate: "2026-12-05", amountKopecks: 100000, paid: false, paidDate: null };
    const november = computeMonthPay({ ...base, vacations: [cross] });
    const december = computeMonthPay({ ...base, month: 11, vacations: [cross] });

    expect(november.halves.map((half) => half.vacationPayKopecks)).toEqual([0, 37500]);
    expect(november.vacationPayKopecks).toBe(37500);
    expect(november.outstandingKopecks).toBe(37500);
    expect(november.stats.vacationHours).toBe(8); // Mon 30 only: Sat/Sun carry no norm

    expect(december.halves.map((half) => half.vacationPayKopecks)).toEqual([62500, 0]);
    expect(december.stats.vacationHours).toBe(32); // Tue 1 .. Fri 4 plus no weekend norm
    expect(november.vacationPayKopecks + december.vacationPayKopecks).toBe(cross.amountKopecks);
  });

  it("reports per-half money that adds up to the month, and a paid record adds income once", () => {
    const pay = computeMonthPay({ ...base, workHours: { "10-17": 11 }, vacations: [vacation()] });
    const halves = pay.halves;
    expect(halves.reduce((sum, half) => sum + half.workPayKopecks, 0)).toBe(pay.workPayKopecks);
    expect(halves.reduce((sum, half) => sum + half.overtimePayKopecks, 0)).toBe(pay.overtimePayKopecks);
    expect(halves.reduce((sum, half) => sum + half.vacationPayKopecks, 0)).toBe(pay.vacationPayKopecks);
    expect(pay.totalKopecks).toBe(pay.workPayKopecks + pay.overtimePayKopecks + pay.vacationPaidKopecks);
    expect(pay.totalKopecks).toBe(SALARY - 2615625 + 3 * OT_RATE + 2606800);
    expect(pay.outstandingKopecks).toBe(pay.vacationPayKopecks - pay.vacationPaidKopecks);
    expect(halves.reduce((sum, half) => sum + half.totalKopecks, 0)).toBe(pay.totalKopecks);
  });

  it("keeps both halves' base money equal to the salary for every month of 2026", () => {
    for (let month = 0; month < 12; month += 1) {
      const pay = computeMonthPay({ ...base, month });
      expect(pay.baseKopecks).toBe(SALARY);
      expect(pay.totalKopecks).toBe(SALARY);
    }
  });

  it("refuses a payload without an integer year and month", () => {
    expect(() => computeMonthPay({ ...base, month: 12 })).toThrow(TypeError);
    expect(() => computeMonthPay({ ...base, month: 10.5 })).toThrow(TypeError);
    expect(() => computeMonthPay({ ...base, year: "2026" })).toThrow(TypeError);
  });
});

describe("allocation stays deterministic when reused by the month calculation", () => {
  it("gives the same buckets from the record and from the priced absence", () => {
    const priced = vacationFromRecord(vacation());
    expect(priced).not.toBeNull();
    expect(allocateVacationPay(priced)).toEqual([
      { year: 2026, month: 10, half: 1, paidDays: 6, kopecks: 2606800 },
    ]);
    expect(buildVacation({ start: { year: 2026, month: 10, day: 2 }, end: { year: 2026, month: 10, day: 8 }, net: "26068" })).toMatchObject({
      netKopecks: 2606800,
      paidDays: 6,
      months: [{ month: 10, paidDays: 6, workdays: 4 }],
    });
  });
});
