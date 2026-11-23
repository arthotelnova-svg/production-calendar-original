import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("../auth", () => ({ auth: authMock }));

const { ensureUser, getDb } = await import("../lib/db");
const { POST } = await import("../app/api/vacations/route.js");
const { PATCH } = await import("../app/api/vacations/[id]/route.js");

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-vacations-tx-"));
  process.env.DATABASE_PATH = path.join(tempDir, "calendar.db");
  delete globalThis._db;
  const db = getDb();
  ensureUser(db, OWNER);
  ensureUser(db, OTHER);
  return db;
}

/**
 * Instrument the connection so every statement executed against the vacation
 * tables records whether a SQLite transaction was already open at execution
 * time, and every transaction records which BEGIN mode was used.
 */
function instrument(db) {
  const executed = [];
  const modes = [];

  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const stmt = originalPrepare(sql);
    const watched = /vacations|work_hours/.test(sql);
    const wrap = (name) => (...args) => {
      if (watched) executed.push({ sql: sql.replace(/\s+/g, " ").trim(), inTransaction: db.inTransaction });
      return stmt[name](...args);
    };
    return {
      get: wrap("get"),
      all: wrap("all"),
      run: wrap("run"),
      iterate: wrap("iterate"),
      columns: stmt.columns.bind(stmt),
      pluck: stmt.pluck.bind(stmt),
      expand: stmt.expand.bind(stmt),
      raw: stmt.raw.bind(stmt),
      safeIntegers: stmt.safeIntegers.bind(stmt),
      reader: stmt.reader,
      database: stmt.database,
      source: stmt.source,
    };
  };

  const originalTransaction = db.transaction.bind(db);
  db.transaction = (fn) => {
    const txn = originalTransaction(fn);
    const relay = (...args) => txn(...args);
    relay.deferred = (...args) => {
      modes.push("deferred");
      return txn.deferred(...args);
    };
    relay.immediate = (...args) => {
      modes.push("immediate");
      return txn.immediate(...args);
    };
    relay.exclusive = (...args) => {
      modes.push("exclusive");
      return txn.exclusive(...args);
    };
    return relay;
  };

  return { executed, modes };
}

const post = (body) =>
  new Request("http://localhost/api/vacations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const patch = (id, body) =>
  new Request(`http://localhost/api/vacations/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const ctx = (id) => ({ params: Promise.resolve({ id: String(id) }) });

function seedVacation(body = BODY) {
  const info = getDb()
    .prepare(
      `INSERT INTO vacations (user_id, start_date, end_date, year, amount_kopecks, paid, paid_date)
       VALUES (?, ?, ?, 2026, ?, 0, NULL)`
    )
    .run(OWNER.id, body.startDate, body.endDate, body.amountKopecks);
  return Number(info.lastInsertRowid);
}

function seedHours(day, month, hours) {
  getDb()
    .prepare("INSERT INTO work_hours (user_id, year, month, day, hours) VALUES (?, 2026, ?, ?, ?)")
    .run(OWNER.id, month - 1, day, hours);
}

const countVacations = () => getDb().prepare("SELECT COUNT(*) AS count FROM vacations").get().count;

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

describe("vacation POST runs check-and-write inside one immediate transaction", () => {
  it("detects conflicts and inserts with the transaction already open", async () => {
    const db = getDb();
    const { executed, modes } = instrument(db);

    const response = await POST(post(BODY));
    expect(response.status).toBe(201);

    const conflictChecks = executed.filter((e) => /SELECT .* FROM vacations/i.test(e.sql));
    const inserts = executed.filter((e) => /INSERT INTO vacations/i.test(e.sql));

    expect(conflictChecks.length).toBeGreaterThan(0);
    expect(inserts).toHaveLength(1);

    // The whole read-then-write window must be serialized: no statement may run
    // outside the transaction once the check has started.
    for (const entry of [...conflictChecks, ...inserts]) {
      expect(entry.inTransaction, `statement ran outside a transaction: ${entry.sql}`).toBe(true);
    }

    // A DEFERRED transaction would take the write lock only at INSERT time,
    // leaving a window for a concurrent writer to slip in between check and write.
    expect(modes).toContain("immediate");
    expect(modes).not.toContain("deferred");
    expect(db.inTransaction).toBe(false);
  });

  it("keeps the work-hours conflict read and the absence of a write atomic on 409", async () => {
    const db = getDb();
    seedHours(3, 11, 8);
    const { executed } = instrument(db);

    const response = await POST(post(BODY));
    expect(response.status).toBe(409);

    const workHourChecks = executed.filter((e) => /FROM work_hours/i.test(e.sql));
    expect(workHourChecks.length).toBeGreaterThan(0);
    for (const entry of workHourChecks) expect(entry.inTransaction).toBe(true);

    expect(executed.filter((e) => /INSERT INTO vacations/i.test(e.sql))).toHaveLength(0);
    expect(countVacations()).toBe(0);
    expect(db.inTransaction).toBe(false);
  });
});

describe("vacation PATCH runs ownership, conflicts and update inside one immediate transaction", () => {
  it("checks ownership, conflicts and update inside the transaction", async () => {
    const id = seedVacation();
    const db = getDb();
    const { executed, modes } = instrument(db);

    seedHours(20, 11, 8);
    const response = await PATCH(patch(id, { ...BODY, startDate: "2026-11-16", endDate: "2026-11-20" }), ctx(id));
    expect(response.status).toBe(409);

    const ownership = executed.filter((e) => /WHERE id = \? AND user_id = \?/i.test(e.sql));
    const checks = executed.filter((e) => /FROM vacations/i.test(e.sql));
    expect(ownership.length).toBeGreaterThan(0);
    expect(checks.length).toBeGreaterThan(0);

    for (const entry of [...ownership, ...checks]) {
      expect(entry.inTransaction, `statement ran outside a transaction: ${entry.sql}`).toBe(true);
    }

    expect(modes).toContain("immediate");
    expect(db.inTransaction).toBe(false);
  });

  it("applies the update inside the transaction after a clean check", async () => {
    const id = seedVacation();
    const db = getDb();
    const { executed, modes } = instrument(db);

    const response = await PATCH(patch(id, { ...BODY, paid: true, paidDate: "2026-11-09" }), ctx(id));
    expect(response.status).toBe(200);

    const updates = executed.filter((e) => /UPDATE vacations/i.test(e.sql));
    expect(updates).toHaveLength(1);
    for (const entry of updates) expect(entry.inTransaction).toBe(true);
    for (const entry of executed.filter((e) => /FROM vacations/i.test(e.sql))) expect(entry.inTransaction).toBe(true);

    expect(modes).toContain("immediate");
    expect(db.inTransaction).toBe(false);
  });

  it("does not open a transaction when the row is not owned by the caller", async () => {
    const id = seedVacation();
    const db = getDb();
    const { executed } = instrument(db);

    authMock.mockResolvedValue({ user: OTHER });
    const response = await PATCH(patch(id, { ...BODY, paid: true, paidDate: "2026-11-09" }), ctx(id));
    expect(response.status).toBe(404);

    expect(executed.filter((e) => /UPDATE vacations/i.test(e.sql))).toHaveLength(0);
    expect(db.inTransaction).toBe(false);
  });
});
