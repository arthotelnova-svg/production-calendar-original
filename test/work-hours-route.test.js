import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, ensureUser, prepare } = vi.hoisted(() => ({
  auth: vi.fn(),
  ensureUser: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock("../auth", () => ({ auth }));
vi.mock("../lib/db", () => ({ getDb: () => ({ prepare }), ensureUser }));

const { POST } = await import("../app/api/work-hours/route.js");

describe("factual work-hours API", () => {
  beforeEach(() => {
    auth.mockResolvedValue({ user: { id: "beta-user" } });
    ensureUser.mockReset();
    prepare.mockReset();
    prepare.mockReturnValue({ run: vi.fn() });
  });

  it("persists explicit zero factual hours instead of treating them as an empty day", async () => {
    const response = await POST(new Request("http://localhost/api/work-hours", {
      method: "POST",
      body: JSON.stringify({ year: 2026, month: 8, day: 8, hours: 0 }),
    }));

    expect(response.status).toBe(200);
    expect(ensureUser).toHaveBeenCalledWith(expect.any(Object), { id: "beta-user" });
    expect(prepare).toHaveBeenCalledWith(
      "INSERT OR REPLACE INTO work_hours (user_id, year, month, day, hours) VALUES (?, ?, ?, ?, ?)"
    );
    expect(prepare.mock.results.at(-1).value.run).toHaveBeenCalledWith("beta-user", 2026, 8, 8, 0);
  });
});
