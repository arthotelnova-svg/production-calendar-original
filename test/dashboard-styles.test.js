import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("factual-hours calendar styling", () => {
  it("uses the orange product accent for entered factual hours regardless of day type", () => {
    const css = fs.readFileSync(path.resolve("app/dashboard/dashboard.css"), "utf8");
    expect(css).toMatch(/\.dc-hours\s*\{[^}]*color:\s*#ff6b35/i);
  });
});
