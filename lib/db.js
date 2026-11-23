import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import dbMigrations from "./db-migrations.cjs";

const { migrateDatabase } = dbMigrations;

// Use global to survive hot reload in dev without leaking connections
const g = globalThis;

export function ensureUser(db, user) {
  if (!user?.id) throw new Error("Authenticated user id is required");
  db.prepare(`
    INSERT INTO users (id, email, name, avatar) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = COALESCE(excluded.email, users.email),
      name = COALESCE(excluded.name, users.name),
      avatar = COALESCE(excluded.avatar, users.avatar)
  `).run(user.id, user.email ?? null, user.name ?? null, user.image ?? null);
}

export function getDb() {
  if (g._db) return g._db;

  const dbPath = path.resolve(process.env.DATABASE_PATH || "./data/calendar.db");
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  g._db = new Database(dbPath);
  const db = g._db;
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      avatar TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      oklad REAL DEFAULT 135000,
      ot_rate REAL DEFAULT 164,
      ot_weekday REAL DEFAULT 2,
      ot_saturday REAL DEFAULT 8
    );

    CREATE TABLE IF NOT EXISTS overtime (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id),
      year INTEGER NOT NULL,
      month INTEGER,
      day INTEGER,
      hours REAL,
      UNIQUE(user_id, year, month, day)
    );

    CREATE TABLE IF NOT EXISTS absences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id),
      year INTEGER NOT NULL,
      month INTEGER,
      day INTEGER,
      UNIQUE(user_id, year, month, day)
    );

    CREATE TABLE IF NOT EXISTS work_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id),
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      day INTEGER NOT NULL,
      hours REAL NOT NULL CHECK(hours >= 0 AND hours <= 24),
      UNIQUE(user_id, year, month, day)
    );
    CREATE TABLE IF NOT EXISTS day_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      day INTEGER NOT NULL,
      text TEXT NOT NULL DEFAULT '' CHECK(length(text) <= 5000),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, year, month, day)
    );

    CREATE TABLE IF NOT EXISTS day_attachments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      day INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      media_type TEXT NOT NULL,
      size INTEGER NOT NULL CHECK(size >= 0 AND size <= 10485760),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_day_notes_user_date ON day_notes(user_id, year, month, day);
    CREATE INDEX IF NOT EXISTS idx_day_attachments_user_date ON day_attachments(user_id, year, month, day);
  `);
  migrateDatabase(db);

  const settingsColumns = db.prepare("PRAGMA table_info(settings)").all();
  if (!settingsColumns.some((column) => column.name === "auto_ot_rate")) {
    db.exec("ALTER TABLE settings ADD COLUMN auto_ot_rate INTEGER NOT NULL DEFAULT 0 CHECK (auto_ot_rate IN (0, 1))");
  }

  return g._db;
}
