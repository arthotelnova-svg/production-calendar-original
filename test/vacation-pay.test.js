import { describe, expect, it } from "vitest";
import { allocateVacationPay, buildVacation } from "../lib/vacation-pay";

const date = (y, m, d) => ({ year: y, month: m, day: d });

describe("vacation absence record", () => {
  it("prices the 2026-11-02..08 example as 7 calendar days, 6 paid days, 4 scheduled workdays", () => {
    const vacation = buildVacation({ start: date(2026, 10, 2), end: date(2026, 10, 8), net: "26068" });
    expect(vacation).not.toBeNull();
    expect(vacation.netKopecks).toBe(2606800);
    expect(vacation.calendarDays).toBe(7);
    expect(vacation.paidDays).toBe(6);
    expect(vacation.months).toHaveLength(1);
    expect(vacation.months[0]).toMatchObject({ year: 2026, month: 10, calendarDays: 7, paidDays: 6, workdays: 4 });
    expect(vacation.months[0].halves).toEqual([
      { half: 1, fromDay: 1, toDay: 15, calendarDays: 7, paidDays: 6, workdays: 4 },
      { half: 2, fromDay: 16, toDay: 30, calendarDays: 0, paidDays: 0, workdays: 0 },
    ]);
  });

  it("splits a range that crosses a month boundary by month and half", () => {
    const vacation = buildVacation({ start: date(2026, 10, 28), end: date(2026, 11, 5), net: "1000" });
    expect(vacation.calendarDays).toBe(8);
    expect(vacation.paidDays).toBe(8);
    // 2026-11-28 Sat .. 2026-12-05 Sat: November keeps 28-30 (1 workday, Mon 30),
    // December keeps 1-5 (4 workdays, Tue 1 .. Fri 4; Sat 5 is a weekend).
    expect(vacation.months.map((m) => [m.month, m.paidDays, m.workdays])).toEqual([
      [10, 3, 1],
      [11, 5, 4],
    ]);
  });

  it("refuses a range that is invalid, unsupported by the calendar, or has no paid day", () => {
    expect(buildVacation({ start: date(2026, 10, 8), end: date(2026, 10, 2), net: "100" })).toBeNull();
    expect(buildVacation({ start: date(2027, 0, 5), end: date(2027, 0, 9), net: "100" })).toBeNull();
    expect(buildVacation({ start: date(2026, 10, 2), end: date(2026, 10, 8), net: "0" })).toBeNull();
    expect(buildVacation({ start: date(2026, 10, 2), end: date(2026, 10, 8), net: "abc" })).toBeNull();
    // 1..8 January 2026 are all statutory public holidays: nothing is paid.
    expect(buildVacation({ start: date(2026, 0, 1), end: date(2026, 0, 8), net: "100" })).toBeNull();
  });
});

describe("deterministic vacation pay allocation", () => {
  it("keeps the whole amount in a single bucket when the vacation lives in one half", () => {
    const vacation = buildVacation({ start: date(2026, 10, 2), end: date(2026, 10, 8), net: "26068" });
    expect(allocateVacationPay(vacation)).toEqual([
      { year: 2026, month: 10, half: 1, paidDays: 6, kopecks: 2606800 },
    ]);
  });

  it("allocates by paid vacation days across months, preserving the amount exactly", () => {
    const vacation = buildVacation({ start: date(2026, 10, 28), end: date(2026, 11, 5), net: "1000" });
    expect(allocateVacationPay(vacation)).toEqual([
      { year: 2026, month: 10, half: 2, paidDays: 3, kopecks: 37500 },
      { year: 2026, month: 11, half: 1, paidDays: 5, kopecks: 62500 },
    ]);
  });

  it("gives the leftover kopecks deterministically so the parts add back up", () => {
    const vacation = buildVacation({ start: date(2026, 10, 10), end: date(2026, 10, 20), net: "1" });
    const parts = allocateVacationPay(vacation);
    expect(parts.map((p) => [p.month, p.half, p.paidDays])).toEqual([
      [10, 1, 6],
      [10, 2, 5],
    ]);
    expect(parts.reduce((sum, p) => sum + p.kopecks, 0)).toBe(100);
    expect(parts.map((p) => p.kopecks)).toEqual([55, 45]);
    expect(allocateVacationPay(vacation)).toEqual(parts);
  });

  it("returns no allocation for an empty or unpaid record", () => {
    expect(allocateVacationPay(null)).toEqual([]);
  });
});
