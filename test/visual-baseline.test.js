// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(new URL("../app/dashboard/dashboard.css", import.meta.url), "utf8");

describe("accepted visual baseline", () => {
  it("keeps the dark engineering palette and orange accent", () => {
    expect(css).toContain("background:#080c16");
    expect(css).toContain("#ff6b35");
    expect(css).toContain("max-width:960px");
  });

  it("keeps the compact four-column month selector on phones", () => {
    expect(css).toContain("@media(max-width:500px){.mstrip{grid-template-columns:repeat(4,1fr)}}");
  });
});
