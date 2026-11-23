import { describe, expect, it } from "vitest";
import { formatKopecks, splitKopecks, toKopecks } from "../lib/money";

describe("integer kopecks money model", () => {
  it("converts entered net rubles to integer kopecks without binary float drift", () => {
    expect(toKopecks("26068")).toBe(2606800);
    expect(toKopecks("26068.5")).toBe(2606850);
    expect(toKopecks("26068.55")).toBe(2606855);
    expect(toKopecks(0)).toBe(0);
    expect(toKopecks("0.07")).toBe(7);
  });

  it("rejects amounts that cannot be represented in whole kopecks", () => {
    expect(toKopecks("-1")).toBeNull();
    expect(toKopecks("1.234")).toBeNull();
    expect(toKopecks("abc")).toBeNull();
    expect(toKopecks("")).toBeNull();
    expect(toKopecks(null)).toBeNull();
    expect(toKopecks("10 000")).toBeNull();
    expect(toKopecks(10000001)).toBeNull();
  });

  it("formats integer kopecks back to a net ruble label", () => {
    expect(formatKopecks(2606800)).toBe("26\u00A0068");
    expect(formatKopecks(2606855)).toBe("26\u00A0068,55");
    expect(formatKopecks(0)).toBe("0");
  });

  it("splits an amount by integer weights so the sum is preserved exactly", () => {
    expect(splitKopecks(2606800, [3, 3])).toEqual([1303400, 1303400]);
    expect(splitKopecks(100, [1, 1, 1])).toEqual([34, 33, 33]);
    const parts = splitKopecks(26068, [1, 1, 1]);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(26068);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
  });

  it("returns no allocation when there is nothing to allocate", () => {
    expect(splitKopecks(0, [1, 1])).toEqual([0, 0]);
    expect(splitKopecks(100, [])).toEqual([]);
    expect(splitKopecks(100, [0, 0])).toEqual([0, 0]);
  });
});
