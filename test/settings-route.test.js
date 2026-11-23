import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, ensureUserMock, prepareMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  ensureUserMock: vi.fn(),
  prepareMock: vi.fn(),
}));

vi.mock("../auth", () => ({ auth: authMock }));
vi.mock("../lib/db", () => ({ getDb: () => ({ prepare: prepareMock }), ensureUser: ensureUserMock }));

import { GET, POST } from "../app/api/settings/route";

describe("settings API automatic overtime rate mode", () => {
  beforeEach(() => {
    authMock.mockReset();
    ensureUserMock.mockReset();
    prepareMock.mockReset();
    authMock.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("returns the persisted automatic-rate flag", async () => {
    const get = vi.fn(() => ({ oklad: 135000, ot_rate: 164, auto_ot_rate: 1, ot_weekday: 2, ot_saturday: 8 }));
    prepareMock.mockReturnValue({ get });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ auto_ot_rate: 1 });
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("auto_ot_rate"));
  });

  it("persists the automatic-rate flag and the separate manual rate", async () => {
    const run = vi.fn();
    prepareMock.mockReturnValue({ run });
    const request = new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        oklad: 135000,
        ot_rate: 250,
        auto_ot_rate: true,
        ot_weekday: 2,
        ot_saturday: 8,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(ensureUserMock).toHaveBeenCalledWith(expect.any(Object), { id: "user-1" });
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("auto_ot_rate"));
    expect(run).toHaveBeenCalledWith("user-1", 135000, 250, 1, 2, 8, 1);
  });

  it("accepts the slim beta settings payload after default overtime fields were removed", async () => {
    const run = vi.fn();
    prepareMock.mockReturnValue({ run });
    const request = new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oklad: 135000, ot_rate: 250, auto_ot_rate: false }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it("preserves automatic mode for legacy clients that omit the new flag", async () => {
    const run = vi.fn();
    prepareMock.mockReturnValue({ run });
    const request = new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oklad: 135000, ot_rate: 250, ot_weekday: 2, ot_saturday: 8 }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT"));
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("settings.auto_ot_rate"));
    expect(run).toHaveBeenCalledWith("user-1", 135000, 250, null, 2, 8, null);
  });
});
