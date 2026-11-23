function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

function hasYearColumn(db, table) {
  return columns(db, table).includes("year");
}

function migrateTimeTable(db, table, valueColumn = null) {
  if (hasYearColumn(db, table)) return;

  const next = `${table}_year_migration`;
  db.exec(`DROP TABLE IF EXISTS ${next}`);
  if (valueColumn) {
    db.exec(`
      CREATE TABLE ${next} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT REFERENCES users(id),
        year INTEGER NOT NULL,
        month INTEGER,
        day INTEGER,
        ${valueColumn} REAL,
        UNIQUE(user_id, year, month, day)
      );
      INSERT INTO ${next} (id, user_id, year, month, day, ${valueColumn})
      SELECT id, user_id, 2026, month, day, ${valueColumn} FROM ${table};
    `);
  } else {
    db.exec(`
      CREATE TABLE ${next} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT REFERENCES users(id),
        year INTEGER NOT NULL,
        month INTEGER,
        day INTEGER,
        UNIQUE(user_id, year, month, day)
      );
      INSERT INTO ${next} (id, user_id, year, month, day)
      SELECT id, user_id, 2026, month, day FROM ${table};
    `);
  }
  db.exec(`DROP TABLE ${table}; ALTER TABLE ${next} RENAME TO ${table};`);
}

function migrateVacations(db) {
  // Vacations are stored as inclusive ISO date ranges so a vacation is never
  // confused with a per-day hours edit. `amount_kopecks` is the NET amount in
  // whole kopecks (never a float), `paid` is explicit, and `paid_date` stays
  // NULL while the payment date is unknown.
  db.exec(`
    CREATE TABLE IF NOT EXISTS vacations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      start_date TEXT NOT NULL CHECK(start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      end_date TEXT NOT NULL CHECK(end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      year INTEGER NOT NULL,
      amount_kopecks INTEGER NOT NULL CHECK(amount_kopecks > 0),
      paid INTEGER NOT NULL DEFAULT 0 CHECK(paid IN (0, 1)),
      paid_date TEXT CHECK(paid_date IS NULL OR paid_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CHECK(end_date >= start_date),
      CHECK(paid_date IS NULL OR paid = 1)
    );
    CREATE INDEX IF NOT EXISTS idx_vacations_user_year ON vacations(user_id, year);
    CREATE INDEX IF NOT EXISTS idx_vacations_user_range ON vacations(user_id, start_date, end_date);
  `);
}

function migrateDatabase(db) {
  const migrate = db.transaction(() => {
    migrateTimeTable(db, "overtime", "hours");
    migrateTimeTable(db, "absences");
    migrateVacations(db);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_overtime_user_year_month ON overtime(user_id, year, month);
      CREATE INDEX IF NOT EXISTS idx_absences_user_year_month ON absences(user_id, year, month);

      -- A calendar day can be either an absence or a signed time balance, never both.
      CREATE TRIGGER IF NOT EXISTS absence_replaces_overtime
      AFTER INSERT ON absences
      FOR EACH ROW
      BEGIN
        DELETE FROM overtime
        WHERE user_id = NEW.user_id AND year = NEW.year AND month = NEW.month AND day = NEW.day;
      END;

      CREATE TRIGGER IF NOT EXISTS overtime_replaces_absence
      AFTER INSERT ON overtime
      FOR EACH ROW
      BEGIN
        DELETE FROM absences
        WHERE user_id = NEW.user_id AND year = NEW.year AND month = NEW.month AND day = NEW.day;
      END;
    `);
  });
  migrate();
}

module.exports = { migrateDatabase };
