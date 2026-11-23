import { describe, expect, it } from "vitest";
import { dayNorm, periodStats, scheduledWorkdays } from "../lib/work-hours";

describe("factual work-hours model", () => {
  it("uses the production-calendar norm when a day has no manual entry", () => {
    expect(dayNorm(2026, 8, 8)).toBe(8);
    expect(dayNorm(2026, 4, 8)).toBe(7);
    expect(dayNorm(2026, 8, 12)).toBe(0);
  });

  it("derives overtime and underwork from factual hours only when an override exists", () => {
    const stats = periodStats({ "8-1": 10, "8-2": 5, "8-3": 0 }, 2026, 8, 1, 15, 800, 164);
    expect(stats.recordedDays).toBe(3);
    expect(stats.positiveHours).toBe(2);
    expect(stats.underworkHours).toBe(11);
    expect(stats.payableOvertimeHours).toBe(0);
    expect(stats.unpaidHours).toBe(9);
  });

  it("does not turn untouched days into an absence or a payroll deduction", () => {
    const stats = periodStats({}, 2026, 8, 1, 15, 800, 164);
    expect(stats.recordedDays).toBe(0);
    expect(stats.positiveHours).toBe(0);
    expect(stats.underworkHours).toBe(0);
    expect(stats.deduction).toBe(0);
  });
});

describe("vacation days inside the work-hours counters", () => {
  it("counts scheduled workdays of a range, ignoring holidays and weekends", () => {
    expect(scheduledWorkdays(2026, 10, 1, 30)).toBe(20);
    expect(scheduledWorkdays(2026, 10, 1, 15)).toBe(9);
    expect(scheduledWorkdays(2026, 10, 16, 30)).toBe(11);
    expect(scheduledWorkdays(2026, 10, 2, 8)).toBe(4);
    expect(scheduledWorkdays(2026, 7, 1, 31)).toBe(21);
    expect(scheduledWorkdays(2026, 8, 1, 30)).toBe(22);
  });

  it("skips vacation days so they never consume overtime or create a deficit", () => {
    const workHours = { "10-2": 0, "10-3": 4, "10-5": 10 };
    const withVacation = periodStats(workHours, 2026, 10, 1, 15, 800, 164, [2, 3, 5]);
    expect(withVacation.recordedDays).toBe(0);
    expect(withVacation.positiveHours).toBe(0);
    expect(withVacation.underworkHours).toBe(0);
    expect(withVacation.payableOvertimeHours).toBe(0);
    expect(withVacation.deduction).toBe(0);
    expect(withVacation.overtimePay).toBe(0);
  });

  it("keeps the half-month mutual offset for the days that are not vacation", () => {
    const workHours = { "10-2": 0, "10-6": 6, "10-9": 10 };
    const stats = periodStats(workHours, 2026, 10, 1, 15, 800, 164, [2]);
    expect(stats.recordedDays).toBe(2);
    expect(stats.underworkHours).toBe(2);
    expect(stats.positiveHours).toBe(2);
    expect(stats.coveredHours).toBe(2);
    expect(stats.payableOvertimeHours).toBe(0);
    expect(stats.unpaidHours).toBe(0);
  });

  it("leaves counters untouched when no vacation days are passed", () => {
    const workHours = { "10-2": 0, "10-6": 6 };
    const baseline = periodStats(workHours, 2026, 10, 1, 15, 800, 164);
    const explicitEmpty = periodStats(workHours, 2026, 10, 1, 15, 800, 164, []);
    expect(explicitEmpty).toEqual(baseline);
    expect(baseline.underworkHours).toBe(10);
  });
});
