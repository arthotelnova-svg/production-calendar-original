import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { ensureUser, getDb } from "../lib/db";

let tempDir;

function closeDb() {
  if (globalThis._db) {
    globalThis._db.close();
    delete globalThis._db;
  }
}

afterEach(() => {
  closeDb();
  delete process.env.DATABASE_PATH;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("vacations table migration", () => {
  it("adds the vacations table to an existing database and keeps recorded data intact", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-vacations-migration-"));
    const dbPath = path.join(tempDir, "calendar.db");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, avatar TEXT);
      CREATE TABLE settings (
        user_id TEXT PRIMARY KEY REFERENCES users(id),
        oklad REAL DEFAULT 135000,
        ot_rate REAL DEFAULT 164,
        ot_weekday REAL DEFAULT 2,
        ot_saturday REAL DEFAULT 8
      );
      CREATE TABLE overtime (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, month INTEGER, day INTEGER, hours REAL);
      CREATE TABLE absences (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, month INTEGER, day INTEGER);
      CREATE TABLE work_hours (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT, year INTEGER NOT NULL, month INTEGER NOT NULL, day INTEGER NOT NULL, hours REAL NOT NULL
      );
      CREATE TABLE day_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL, day INTEGER NOT NULL,
        text TEXT NOT NULL DEFAULT '', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users (id, email, name) VALUES ('legacy-user', 'legacy@example.test', 'Legacy');
      INSERT INTO settings (user_id) VALUES ('legacy-user');
      INSERT INTO work_hours (user_id, year, month, day, hours) VALUES ('legacy-user', 2026, 10, 2, 8);
      INSERT INTO day_notes (user_id, year, month, day, text) VALUES ('legacy-user', 2026, 10, 2, 'черновик');
      INSERT INTO overtime (user_id, month, day, hours) VALUES ('legacy-user', 10, 3, -2);
    `);
    legacy.close();

    process.env.DATABASE_PATH = dbPath;
    const db = getDb();

    const columnNames = db.prepare("PRAGMA table_info(vacations)").all().map((column) => column.name);
    expect(columnNames).toEqual(
      expect.arrayContaining([
        "id",
        "user_id",
        "start_date",
        "end_date",
        "year",
        "amount_kopecks",
        "paid",
        "paid_date",
        "created_at",
        "updated_at",
      ])
    );

    expect(db.prepare("SELECT email, name FROM users WHERE id = ?").get("legacy-user"))
      .toMatchObject({ email: "legacy@example.test", name: "Legacy" });
    expect(db.prepare("SELECT hours FROM work_hours WHERE user_id = ? AND year = 2026 AND month = 10 AND day = 2").get("legacy-user"))
      .toMatchObject({ hours: 8 });
    expect(db.prepare("SELECT text FROM day_notes WHERE user_id = ?").get("legacy-user"))
      .toMatchObject({ text: "черновик" });
    expect(db.prepare("SELECT year, hours FROM overtime WHERE user_id = ?").get("legacy-user"))
      .toMatchObject({ year: 2026, hours: -2 });

    expect(db.prepare("SELECT COUNT(*) AS count FROM vacations").get().count).toBe(0);
  });

  it("keeps vacations rows and their integrity constraints when the database is reopened", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-vacations-reopen-"));
    process.env.DATABASE_PATH = path.join(tempDir, "calendar.db");

    const first = getDb();
    ensureUser(first, { id: "owner-1", email: "owner@example.test", name: "Owner" });
    first.prepare(
      "INSERT INTO vacations (user_id, start_date, end_date, year, amount_kopecks, paid, paid_date) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("owner-1", "2026-11-02", "2026-11-08", 2026, 2606855, 0, null);
    closeDb();

    const reopened = getDb();
    expect(reopened.prepare("SELECT start_date, end_date, amount_kopecks, paid, paid_date FROM vacations WHERE user_id = ?").get("owner-1"))
      .toMatchObject({
        start_date: "2026-11-02",
        end_date: "2026-11-08",
        amount_kopecks: 2606855,
        paid: 0,
        paid_date: null,
      });

    expect(() => reopened.prepare(
      "INSERT INTO vacations (user_id, start_date, end_date, year, amount_kopecks, paid) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("owner-1", "2026-12-01", "2026-12-03", 2026, 0, 0)).toThrow(/CHECK/i);

    expect(() => reopened.prepare(
      "INSERT INTO vacations (user_id, start_date, end_date, year, amount_kopecks, paid) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("owner-1", "2026-12-05", "2026-12-01", 2026, 1000, 0)).toThrow(/CHECK/i);
  });
});
