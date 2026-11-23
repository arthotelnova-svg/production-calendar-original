import { describe, expect, it } from "vitest";
import { countPaidVacationDays, dayKind, enumerateDates, isPublicHoliday } from "../lib/vacation";

const date = (y, m, d) => ({ year: y, month: m, day: d });

describe("vacation calendar days", () => {
  it("counts the 2026-11-02..08 example as 7 calendar days and 6 paid vacation days", () => {
    const range = { start: date(2026, 10, 2), end: date(2026, 10, 8) };
    expect(enumerateDates(range.start, range.end)).toHaveLength(7);
    expect(countPaidVacationDays(range.start, range.end)).toBe(6);
  });

  it("separates statutory public holidays from transferred days off and weekends", () => {
    expect(dayKind(2026, 10, 4)).toBe("public-holiday");
    expect(isPublicHoliday(2026, 10, 4)).toBe(true);
    expect(dayKind(2026, 4, 9)).toBe("public-holiday");
    expect(dayKind(2026, 4, 11)).toBe("transferred-day-off");
    expect(isPublicHoliday(2026, 4, 11)).toBe(false);
    expect(dayKind(2026, 11, 31)).toBe("transferred-day-off");
    expect(dayKind(2026, 10, 7)).toBe("weekend");
    expect(dayKind(2026, 10, 5)).toBe("workday");
    expect(dayKind(2026, 3, 30)).toBe("preholiday");
  });

  it("keeps weekends and transferred days off inside the paid vacation days", () => {
    // 9 May 2026 is Saturday (public holiday), 10 May Sunday, 11 May is the transferred day off.
    expect(countPaidVacationDays(date(2026, 4, 9), date(2026, 4, 11))).toBe(2);
    expect(countPaidVacationDays(date(2026, 11, 31), date(2026, 11, 31))).toBe(1);
    expect(countPaidVacationDays(date(2026, 0, 1), date(2026, 0, 8))).toBe(0);
  });

  it("counts a single day vacation and multi-month ranges", () => {
    expect(countPaidVacationDays(date(2026, 9, 30), date(2026, 9, 30))).toBe(1);
    const octoberToNovember = enumerateDates(date(2026, 9, 30), date(2026, 10, 4));
    expect(octoberToNovember).toHaveLength(6);
    // 31 Oct 2026 is the transferred day off (paid), 4 Nov is a public holiday (not paid).
    expect(countPaidVacationDays(date(2026, 9, 30), date(2026, 10, 4))).toBe(5);
  });
});
