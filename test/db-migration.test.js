import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { ensureUser, getDb } from "../lib/db";

let tempDir;

afterEach(() => {
  if (globalThis._db) {
    globalThis._db.close();
    delete globalThis._db;
  }
  delete process.env.DATABASE_PATH;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("settings database migration", () => {
  it("adds automatic-rate mode to an existing database without losing settings", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-db-migration-"));
    const dbPath = path.join(tempDir, "calendar.db");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE settings (
        user_id TEXT PRIMARY KEY REFERENCES users(id),
        oklad REAL DEFAULT 135000,
        ot_rate REAL DEFAULT 164,
        ot_weekday REAL DEFAULT 2,
        ot_saturday REAL DEFAULT 8
      );
      INSERT INTO users (id) VALUES ('user-1');
      INSERT INTO settings (user_id, oklad, ot_rate, ot_weekday, ot_saturday)
      VALUES ('user-1', 150000, 250, 3, 9);
    `);
    legacy.close();

    process.env.DATABASE_PATH = dbPath;
    const migrated = getDb();
    const columns = migrated.prepare("PRAGMA table_info(settings)").all().map((column) => column.name);
    const settings = migrated.prepare("SELECT * FROM settings WHERE user_id = ?").get("user-1");

    expect(columns).toContain("auto_ot_rate");
    expect(settings).toMatchObject({ oklad: 150000, ot_rate: 250, auto_ot_rate: 0, ot_weekday: 3, ot_saturday: 9 });
  });

  it("provisions a current authenticated user in a fresh beta database before settings are stored", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-beta-user-"));
    process.env.DATABASE_PATH = path.join(tempDir, "calendar.db");
    const db = getDb();

    ensureUser(db, { id: "existing-session-user", email: "user@example.test", name: "Existing Session" });
    db.prepare("INSERT INTO settings (user_id) VALUES (?)").run("existing-session-user");

    expect(db.prepare("SELECT id, email, name FROM users WHERE id = ?").get("existing-session-user"))
      .toMatchObject({ id: "existing-session-user", email: "user@example.test", name: "Existing Session" });
  });
});
