import { describe, expect, it } from "vitest";
import {
  findOverlappingVacation,
  findWorkHourConflicts,
  validateHours,
  validateVacationDate,
  validateVacationNet,
  validateVacationRange,
} from "../lib/validators";

describe("daily hours validation", () => {
  it("accepts signed daily work deltas in the allowed range", () => {
    expect(validateHours(-8)).toBe(-8);
    expect(validateHours(-0.5)).toBe(-0.5);
    expect(validateHours(0)).toBe(0);
    expect(validateHours(24)).toBe(24);
  });

  it("rejects daily deltas outside the allowed range", () => {
    expect(validateHours(-8.5)).toBeNull();
    expect(validateHours(24.5)).toBeNull();
    expect(validateHours("not-a-number")).toBeNull();
  });
});

describe("vacation date and range validation", () => {
  it("accepts dates inside the supported 2026 calendar only", () => {
    expect(validateVacationDate({ year: 2026, month: 10, day: 2 })).toEqual({ year: 2026, month: 10, day: 2 });
    expect(validateVacationDate({ year: 2025, month: 10, day: 2 })).toBeNull();
    expect(validateVacationDate({ year: 2027, month: 0, day: 1 })).toBeNull();
  });

  it("rejects impossible calendar dates", () => {
    expect(validateVacationDate({ year: 2026, month: 10, day: 31 })).toBeNull();
    expect(validateVacationDate({ year: 2026, month: 12, day: 1 })).toBeNull();
    expect(validateVacationDate({ year: 2026, month: 0, day: 0 })).toBeNull();
    expect(validateVacationDate(null)).toBeNull();
    expect(validateVacationDate({ year: "2026", month: 1, day: "3" })).toBeNull();
  });

  it("accepts an inclusive range that starts on or before it ends", () => {
    expect(validateVacationRange({ year: 2026, month: 10, day: 2 }, { year: 2026, month: 10, day: 8 }))
      .toEqual({ start: { year: 2026, month: 10, day: 2 }, end: { year: 2026, month: 10, day: 8 } });
    const crossMonth = validateVacationRange({ year: 2026, month: 10, day: 30 }, { year: 2026, month: 11, day: 5 });
    expect(crossMonth).not.toBeNull();
    expect(crossMonth.start.month).toBe(10);
    expect(crossMonth.end.month).toBe(11);
  });

  it("rejects reversed, equal-broken and unsupported-year ranges", () => {
    expect(validateVacationRange({ year: 2026, month: 10, day: 8 }, { year: 2026, month: 10, day: 2 })).toBeNull();
    expect(validateVacationRange({ year: 2026, month: 10, day: 2 }, { year: 2027, month: 0, day: 5 })).toBeNull();
    expect(validateVacationRange({ year: 2026, month: 10, day: 2 }, null)).toBeNull();
  });
});

describe("vacation net amount validation", () => {
  it("parses entered net rubles into positive integer kopecks", () => {
    expect(validateVacationNet("26068")).toBe(2606800);
    expect(validateVacationNet("26068.55")).toBe(2606855);
    expect(validateVacationNet(100)).toBe(10000);
  });

  it("rejects zero, negative, fractional-kopeck and over-cap amounts", () => {
    expect(validateVacationNet("0")).toBeNull();
    expect(validateVacationNet("-5")).toBeNull();
    expect(validateVacationNet("1.234")).toBeNull();
    expect(validateVacationNet("")).toBeNull();
    expect(validateVacationNet(undefined)).toBeNull();
    expect(validateVacationNet(10000001)).toBeNull();
  });
});

describe("vacation overlap and work-record conflict detection", () => {
  const range = (sm, sd, em, ed) => ({
    start: { year: 2026, month: sm, day: sd },
    end: { year: 2026, month: em, day: ed },
  });

  it("finds an overlapping existing vacation instead of silently allowing it", () => {
    const existing = [range(10, 2, 10, 8), range(0, 12, 0, 16)];
    expect(findOverlappingVacation(existing, range(10, 6, 10, 12))).toBe(existing[0]);
    expect(findOverlappingVacation(existing, range(0, 14, 0, 20))).toBe(existing[1]);
  });

  it("treats adjacent ranges as non-overlapping", () => {
    const existing = [range(10, 2, 10, 8)];
    expect(findOverlappingVacation(existing, range(10, 9, 10, 12))).toBeNull();
    expect(findOverlappingVacation(existing, range(10, 0, 10, 1))).toBeNull();
    expect(findOverlappingVacation([], range(10, 2, 10, 8))).toBeNull();
  });

  it("lists explicit daily work records inside the vacation range as warnings, not deletions", () => {
    const workHours = { "10-2": 8, "10-4": 9, "10-9": 8, "9-31": 8 };
    expect(findWorkHourConflicts(range(10, 2, 10, 8), workHours)).toEqual(["10-2", "10-4"]);
    expect(findWorkHourConflicts(range(10, 2, 10, 8), {})).toEqual([]);
  });
});
