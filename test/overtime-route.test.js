import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const prepare = vi.fn();

vi.mock("../auth", () => ({ auth }));
vi.mock("../lib/db", () => ({ getDb: () => ({ prepare }) }));

const { POST } = await import("../app/api/overtime/route.js");

describe("overtime API persistence", () => {
  beforeEach(() => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    prepare.mockReset();
    prepare.mockReturnValue({ run: vi.fn() });
  });

  it("stores a negative daily balance in the selected calendar year", async () => {
    const response = await POST(new Request("http://localhost/api/overtime", {
      method: "POST",
      body: JSON.stringify({ year: 2026, month: 8, day: 9, hours: -3 }),
    }));

    expect(response.status).toBe(200);
    expect(prepare).toHaveBeenCalledWith(
      "INSERT OR REPLACE INTO overtime (user_id, year, month, day, hours) VALUES (?, ?, ?, ?, ?)"
    );
    const insert = prepare.mock.results.at(-1).value;
    expect(insert.run).toHaveBeenCalledWith("user-1", 2026, 8, 9, -3);
  });
});
