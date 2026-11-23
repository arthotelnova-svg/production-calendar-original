import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("../auth", () => ({ auth: authMock }));

const { ensureUser, getDb } = await import("../lib/db");
const { GET, POST } = await import("../app/api/vacations/route.js");
const { PATCH, DELETE } = await import("../app/api/vacations/[id]/route.js");

const OWNER = { id: "owner-1", email: "owner@example.test", name: "Owner" };
const OTHER = { id: "owner-2", email: "other@example.test", name: "Other" };

const BODY = {
  startDate: "2026-11-02",
  endDate: "2026-11-08",
  amountKopecks: 2606855,
  paid: false,
  paidDate: null,
};

let tempDir;

function freshDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-vacations-scope-"));
  process.env.DATABASE_PATH = path.join(tempDir, "calendar.db");
  delete globalThis._db;
  const db = getDb();
  ensureUser(db, OWNER);
  ensureUser(db, OTHER);
  return db;
}

const post = (body) =>
  new Request("http://localhost/api/vacations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const get = (query) => new Request(`http://localhost/api/vacations${query}`);

const patch = (body) =>
  new Request("http://localhost/api/vacations/1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const del = () => new Request("http://localhost/api/vacations/1", { method: "DELETE" });

const ctx = (id) => ({ params: Promise.resolve({ id: String(id) }) });

const countVacations = () => getDb().prepare("SELECT COUNT(*) AS count FROM vacations").get().count;

/** Seed a vacation directly for `user` (bypasses the API on purpose). */
function seedVacation(user, body = BODY) {
  const info = getDb()
    .prepare(
      `INSERT INTO vacations (user_id, start_date, end_date, year, amount_kopecks, paid, paid_date)
       VALUES (?, ?, ?, 2026, ?, 0, NULL)`
    )
    .run(user.id, body.startDate, body.endDate, body.amountKopecks);
  return Number(info.lastInsertRowid);
}

/** `month` is 1-based here; work_hours stores it 0-based. */
function seedHours(user, day, month, hours) {
  getDb()
    .prepare("INSERT INTO work_hours (user_id, year, month, day, hours) VALUES (?, 2026, ?, ?, ?)")
    .run(user.id, month - 1, day, hours);
}

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue({ user: OWNER });
  freshDb();
});

afterEach(() => {
  if (globalThis._db) {
    globalThis._db.close();
    delete globalThis._db;
  }
  delete process.env.DATABASE_PATH;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("vacations list", () => {
  it("returns only the caller's vacations for the requested year", async () => {
    const mine = seedVacation(OWNER, BODY);
    seedVacation(OTHER, { ...BODY, startDate: "2026-12-01", endDate: "2026-12-05" });

    const response = await GET(get("?year=2026"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.year).toBe(2026);
    expect(payload.vacations).toHaveLength(1);
    expect(payload.vacations[0]).toMatchObject({ id: mine, startDate: "2026-11-02", endDate: "2026-11-08" });
    expect(payload.vacations.some((row) => row.user_id !== undefined)).toBe(false);
  });

  it("defaults to the supported year 2026 instead of Number(null) === 0", async () => {
    seedVacation(OWNER);

    for (const query of ["", "?year=", "?year=%20"]) {
      const response = await GET(get(query));
      const payload = await response.json();
      expect(response.status, query).toBe(200);
      expect(payload.year, query).toBe(2026);
      expect(payload.vacations, query).toHaveLength(1);
    }
  });

  it("rejects an unsupported or malformed year", async () => {
    for (const year of ["2025", "2027", "abc", "-1", "2026.5", "0"]) {
      const response = await GET(get(`?year=${year}`));
      expect(response.status, year).toBe(400);
      expect(await response.json()).toMatchObject({ error: "Неподдерживаемый год" });
    }
  });

  it("lists nothing for the other user's year scope", async () => {
    seedVacation(OTHER);
    authMock.mockResolvedValue({ user: OTHER });

    const mine = await (await GET(get("?year=2026"))).json();
    authMock.mockResolvedValue({ user: { id: "owner-3" } });
    const stranger = await (await GET(get("?year=2026"))).json();

    expect(mine.vacations).toHaveLength(1);
    expect(stranger.vacations).toHaveLength(0);
  });
});

describe("vacations creation conflicts", () => {
  it("refuses an inclusive overlap and leaves the existing row untouched", async () => {
    const existingId = seedVacation(OWNER);
    const before = getDb().prepare("SELECT * FROM vacations WHERE id = ?").get(existingId);

    // 11-08 is the last day of the existing range: ranges are inclusive, so this
    // single shared day is already a conflict.
    const response = await POST(post({ ...BODY, startDate: "2026-11-08", endDate: "2026-11-12" }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain("Отпуск не сохранён");
    expect(payload.conflicts.vacations).toEqual([
      { id: existingId, startDate: "2026-11-02", endDate: "2026-11-08" },
    ]);
    expect(payload.conflicts.workHours).toEqual([]);
    expect(countVacations()).toBe(1);
    expect(getDb().prepare("SELECT * FROM vacations WHERE id = ?").get(existingId)).toEqual(before);
  });

  it("allows a range that only touches the neighbouring day", async () => {
    seedVacation(OWNER);
    const response = await POST(post({ ...BODY, startDate: "2026-11-09", endDate: "2026-11-12" }));
    expect(response.status).toBe(201);
    expect(countVacations()).toBe(2);
  });

  it("refuses a range covering an explicitly entered non-zero work day and keeps the hours", async () => {
    seedHours(OWNER, 5, 11, 8);

    const response = await POST(post(BODY));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.conflicts.workHours).toEqual([{ date: "2026-11-05", hours: 8 }]);
    expect(payload.error).toContain("2026-11-05");
    expect(countVacations()).toBe(0);
    expect(getDb().prepare("SELECT hours FROM work_hours WHERE user_id = ? AND month = 10 AND day = 5").get(OWNER.id))
      .toMatchObject({ hours: 8 });
  });

  it("does not treat an explicit zero hours day as a conflict", async () => {
    seedHours(OWNER, 3, 11, 0);
    const response = await POST(post(BODY));
    expect(response.status).toBe(201);
  });

  it("ignores work hours outside the range and other users' rows", async () => {
    seedHours(OWNER, 1, 11, 8); // the day before the range
    seedHours(OWNER, 9, 11, 8); // the day after the range
    seedHours(OTHER, 4, 11, 8); // inside the range, different user

    const response = await POST(post(BODY));
    expect(response.status).toBe(201);
  });

  it("does not conflict with another user's overlapping vacation", async () => {
    seedVacation(OTHER);
    const response = await POST(post(BODY));
    expect(response.status).toBe(201);
    expect(countVacations()).toBe(2);
  });
});

describe("vacations update scope", () => {
  it("updates the caller's own vacation", async () => {
    const id = seedVacation(OWNER);

    const response = await PATCH(patch({ ...BODY, amountKopecks: 3000000, paid: true, paidDate: "2026-10-30" }), ctx(id));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.vacation).toMatchObject({
      id,
      amountKopecks: 3000000,
      paid: true,
      paidDate: "2026-10-30",
    });
  });

  it("does not conflict with the record being edited", async () => {
    const id = seedVacation(OWNER);
    const response = await PATCH(patch({ ...BODY, amountKopecks: 111111 }), ctx(id));
    expect(response.status).toBe(200);
  });

  it("cannot update another user's vacation", async () => {
    const id = seedVacation(OTHER);
    const before = getDb().prepare("SELECT * FROM vacations WHERE id = ?").get(id);

    const response = await PATCH(patch({ ...BODY, amountKopecks: 999999 }), ctx(id));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Not found" });
    expect(getDb().prepare("SELECT * FROM vacations WHERE id = ?").get(id)).toEqual(before);
  });

  it("refuses to move a vacation onto another one and keeps both rows", async () => {
    const first = seedVacation(OWNER);
    const second = seedVacation(OWNER, { ...BODY, startDate: "2026-12-01", endDate: "2026-12-05" });
    const before = getDb().prepare("SELECT * FROM vacations ORDER BY id").all();

    const response = await PATCH(patch({ ...BODY, startDate: "2026-11-07", endDate: "2026-11-09" }), ctx(second));

    expect(response.status).toBe(409);
    expect((await response.json()).conflicts.vacations).toHaveLength(1);
    expect(getDb().prepare("SELECT * FROM vacations ORDER BY id").all()).toEqual(before);
    expect(first).not.toBe(second);
  });

  it("validates the payload and the id before writing", async () => {
    const id = seedVacation(OWNER);
    const before = getDb().prepare("SELECT * FROM vacations WHERE id = ?").get(id);

    const invalidAmount = await PATCH(patch({ ...BODY, amountKopecks: "26068" }), ctx(id));
    const invalidDate = await PATCH(patch({ ...BODY, endDate: "2026-02-30" }), ctx(id));
    const badId = await PATCH(patch(BODY), ctx("abc"));
    const missing = await PATCH(patch(BODY), ctx(9999));

    expect(invalidAmount.status).toBe(400);
    expect(invalidDate.status).toBe(400);
    expect(badId.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(getDb().prepare("SELECT * FROM vacations WHERE id = ?").get(id)).toEqual(before);
  });

  it("requires authentication", async () => {
    const id = seedVacation(OWNER);
    authMock.mockResolvedValue(null);

    const response = await PATCH(patch(BODY), ctx(id));
    expect(response.status).toBe(401);
  });
});

describe("vacations delete scope", () => {
  it("deletes the caller's own vacation only, keeping recorded work hours", async () => {
    const id = seedVacation(OWNER);
    seedHours(OWNER, 5, 11, 8);

    const response = await DELETE(del(), ctx(id));

    expect(response.status).toBe(200);
    expect(countVacations()).toBe(0);
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM work_hours WHERE user_id = ?").get(OWNER.id).count).toBe(1);

    const again = await DELETE(del(), ctx(id));
    expect(again.status).toBe(404);
  });

  it("cannot delete another user's vacation", async () => {
    const id = seedVacation(OTHER);

    const response = await DELETE(del(), ctx(id));

    expect(response.status).toBe(404);
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM vacations WHERE id = ?").get(id).count).toBe(1);
  });

  it("requires authentication and a numeric id", async () => {
    const id = seedVacation(OWNER);
    authMock.mockResolvedValue(null);
    expect((await DELETE(del(), ctx(id))).status).toBe(401);

    authMock.mockResolvedValue({ user: OWNER });
    expect((await DELETE(del(), ctx("nope"))).status).toBe(404);
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM vacations WHERE id = ?").get(id).count).toBe(1);
  });
});
