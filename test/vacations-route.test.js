import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("../auth", () => ({ auth: authMock }));

const { ensureUser, getDb } = await import("../lib/db");
const { GET, POST } = await import("../app/api/vacations/route.js");

const OWNER = { id: "owner-1", email: "owner@example.test", name: "Owner" };
const OTHER = { id: "owner-2", email: "other@example.test", name: "Other" };
const VACATION_BODY = {
  startDate: "2026-11-02",
  endDate: "2026-11-08",
  amountKopecks: 2606855,
  paid: false,
  paidDate: null,
};

let tempDir;

function freshDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-vacations-api-"));
  process.env.DATABASE_PATH = path.join(tempDir, "calendar.db");
  delete globalThis._db;
  const db = getDb();
  ensureUser(db, OWNER);
  ensureUser(db, OTHER);
  return db;
}

function postRequest(body) {
  return new Request("http://localhost/api/vacations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function getRequest(query) {
  return new Request(`http://localhost/api/vacations${query}`);
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

describe("vacations API access control", () => {
  it("refuses list and create without an authenticated user", async () => {
    authMock.mockResolvedValue(null);

    const list = await GET(getRequest("?year=2026"));
    const create = await POST(postRequest(VACATION_BODY));

    expect(list.status).toBe(401);
    expect(create.status).toBe(401);
    expect(await list.json()).toMatchObject({ error: "Unauthorized" });
    expect(await create.json()).toMatchObject({ error: "Unauthorized" });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM vacations").get().count).toBe(0);
  });
});

describe("vacations API creation", () => {
  it("stores an inclusive date range with net kopecks and explicit unpaid state", async () => {
    const response = await POST(postRequest(VACATION_BODY));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.vacation).toMatchObject({
      startDate: "2026-11-02",
      endDate: "2026-11-08",
      year: 2026,
      amountKopecks: 2606855,
      paid: false,
      paidDate: null,
    });
    expect(typeof payload.vacation.id).toBe("number");

    const row = getDb().prepare("SELECT * FROM vacations WHERE id = ?").get(payload.vacation.id);
    expect(row).toMatchObject({
      user_id: OWNER.id,
      start_date: "2026-11-02",
      end_date: "2026-11-08",
      year: 2026,
      amount_kopecks: 2606855,
      paid: 0,
      paid_date: null,
    });
  });
});

describe("vacations API input validation", () => {
  const countVacations = () => getDb().prepare("SELECT COUNT(*) AS count FROM vacations").get().count;

  it("rejects a malformed JSON body without writing anything", async () => {
    const response = await POST(postRequest("{not json"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid JSON" });
    expect(countVacations()).toBe(0);
  });

  it("rejects missing required fields and names them", async () => {
    const response = await POST(postRequest({ startDate: "2026-11-02", endDate: "2026-11-08" }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.fields).toEqual(["amountKopecks", "paid"]);
    expect(countVacations()).toBe(0);
  });

  it("rejects dates that are not ISO calendar dates", async () => {
    for (const [startDate, endDate] of [
      ["02.11.2026", "2026-11-08"],
      ["2026-13-01", "2026-12-01"],
      ["2026-02-30", "2026-03-02"],
      ["2026-11-02", "not-a-date"],
      ["", "2026-11-08"],
      [20261102, "2026-11-08"],
    ]) {
      const response = await POST(postRequest({ ...VACATION_BODY, startDate, endDate }));
      const payload = await response.json();
      expect(response.status, `${startDate}..${endDate}`).toBe(400);
      expect(payload).toMatchObject({ error: "Invalid vacation dates" });
    }
    expect(countVacations()).toBe(0);
  });

  it("rejects a range that ends before it starts", async () => {
    const response = await POST(postRequest({ ...VACATION_BODY, startDate: "2026-11-08", endDate: "2026-11-02" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid vacation dates" });
    expect(countVacations()).toBe(0);
  });

  it("rejects a range outside the supported year", async () => {
    for (const [startDate, endDate] of [
      ["2025-12-29", "2026-01-04"],
      ["2026-12-28", "2027-01-05"],
      ["2027-01-11", "2027-01-17"],
    ]) {
      const response = await POST(postRequest({ ...VACATION_BODY, startDate, endDate }));
      expect(response.status, `${startDate}..${endDate}`).toBe(400);
      expect(await response.json()).toMatchObject({ error: "Unsupported vacation year" });
    }
    expect(countVacations()).toBe(0);
  });

  it("rejects amounts that are not a positive whole kopeck value", async () => {
    for (const amountKopecks of [0, -100, 10.5, "26068", null, true, 1_000_000_001]) {
      const response = await POST(postRequest({ ...VACATION_BODY, amountKopecks }));
      expect(response.status, String(amountKopecks)).toBe(400);
      expect(await response.json()).toMatchObject({ error: "Invalid vacation amount" });
    }
    expect(countVacations()).toBe(0);
  });

  it("requires the paid flag to be an explicit boolean", async () => {
    for (const paid of ["false", 1, null, undefined]) {
      const response = await POST(postRequest({ ...VACATION_BODY, paid }));
      expect(response.status, String(paid)).toBe(400);
    }
    expect(countVacations()).toBe(0);
  });

  it("rejects a payment date that is malformed or contradicts the paid flag", async () => {
    const malformed = await POST(postRequest({ ...VACATION_BODY, paid: true, paidDate: "30.10.2026" }));
    const unpaid = await POST(postRequest({ ...VACATION_BODY, paid: false, paidDate: "2026-10-30" }));

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: "Invalid payment date" });
    expect(unpaid.status).toBe(400);
    expect(await unpaid.json()).toMatchObject({ error: "Payment date without a payment" });
    expect(countVacations()).toBe(0);
  });

  it("keeps an unknown payment date NULL while storing an explicitly paid vacation", async () => {
    const response = await POST(postRequest({ ...VACATION_BODY, paid: true, paidDate: null }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.vacation).toMatchObject({ paid: true, paidDate: null });
    expect(getDb().prepare("SELECT paid, paid_date FROM vacations WHERE id = ?").get(payload.vacation.id))
      .toMatchObject({ paid: 1, paid_date: null });
  });

  it("stores a known payment date in ISO form", async () => {
    const response = await POST(postRequest({ ...VACATION_BODY, paid: true, paidDate: "2026-10-30" }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.vacation).toMatchObject({ paid: true, paidDate: "2026-10-30" });
  });
});
