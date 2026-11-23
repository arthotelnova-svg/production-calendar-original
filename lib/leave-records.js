// Vacation records: date-range persistence for the production calendar app.
//
// A vacation is stored as an inclusive ISO date range plus the NET amount in
// whole kopecks. It is a separate entity from `work_hours` on purpose: a
// vacation is an absence with its own money, not a day of zero hours, so it
// must never be deleted by, or silently delete, recorded hours.
//
// This module is intentionally self-contained: it owns its own date/amount
// validation instead of borrowing the per-day validators, because vacations
// are ranges with money and have stricter rules than a single day entry.

export const SUPPORTED_YEARS = new Set([2026]);

// 10 000 000 ₽ net — the same ceiling the money model uses.
export const MAX_AMOUNT_KOPECKS = 1_000_000_000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(value) {
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function toVacation(row) {
  return {
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    year: row.year,
    amountKopecks: row.amount_kopecks,
    paid: row.paid === 1,
    paidDate: row.paid_date ?? null,
  };
}

export function readVacation(db, userId, id) {
  const row = db
    .prepare("SELECT * FROM vacations WHERE id = ? AND user_id = ?")
    .get(id, userId);
  return row ? toVacation(row) : null;
}

export function insertVacation(db, userId, value) {
  const info = db
    .prepare(
      `INSERT INTO vacations (user_id, start_date, end_date, year, amount_kopecks, paid, paid_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      value.startDate,
      value.endDate,
      value.start.year,
      value.amountKopecks,
      value.paid ? 1 : 0,
      value.paidDate
    );
  return readVacation(db, userId, info.lastInsertRowid);
}

export function listVacations(db, userId, year) {
  return db
    .prepare("SELECT * FROM vacations WHERE user_id = ? AND year = ? ORDER BY start_date, id")
    .all(userId, year)
    .map(toVacation);
}

// Strict request normalization for vacation records.
//
// Every rejection carries a stable machine-readable `error` string so the
// client can tell a bad date from a bad amount, plus the offending `fields`
// when the problem is a missing property.
export function normalizeVacationBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Invalid payload" };
  }

  const missing = ["startDate", "endDate", "amountKopecks", "paid"].filter((field) => !(field in body));
  if (missing.length > 0) return { error: "Missing required fields", fields: missing };

  const start = parseIsoDate(body.startDate);
  const end = parseIsoDate(body.endDate);
  if (!start || !end || end.year * 10_000 + end.month * 100 + end.day <
    start.year * 10_000 + start.month * 100 + start.day) {
    return { error: "Invalid vacation dates" };
  }

  if (!SUPPORTED_YEARS.has(start.year) || !SUPPORTED_YEARS.has(end.year)) {
    return { error: "Unsupported vacation year" };
  }

  const amountKopecks = body.amountKopecks;
  if (!Number.isInteger(amountKopecks) || amountKopecks <= 0 || amountKopecks > MAX_AMOUNT_KOPECKS) {
    return { error: "Invalid vacation amount" };
  }

  if (typeof body.paid !== "boolean") return { error: "Invalid paid flag" };

  let paidDate = null;
  if (body.paidDate !== undefined && body.paidDate !== null) {
    if (!parseIsoDate(body.paidDate)) return { error: "Invalid payment date" };
    if (!body.paid) return { error: "Payment date without a payment" };
    paidDate = body.paidDate;
  }

  return {
    value: {
      startDate: body.startDate,
      endDate: body.endDate,
      start,
      end,
      amountKopecks,
      paid: body.paid,
      paidDate,
    },
  };
}

// --- Conflict queries --------------------------------------------------------
//
// A vacation must never silently overwrite other calendar facts. Two things can
// contradict a vacation range and both are reported instead of resolved:
//   * another vacation of the same user whose inclusive range touches it;
//   * work_hours rows the user explicitly entered with a NON-ZERO value inside
//     the range. A stored 0 is "explicitly no hours that day" and does not
//     contradict a vacation; an absent row is simply not recorded.
// Nothing is deleted here: the caller gets the conflicts and decides.

// parseIsoDate yields a 1-BASED month, while work_hours stores a 0-based one;
// both sides are folded into yyyymmdd so the range stays a single scan.
function dayKey(date) {
  return date.year * 10_000 + date.month * 100 + date.day;
}

export function findOverlappingVacations(db, userId, value, excludeId = null) {
  const rows = excludeId === null
    ? db
      .prepare(
        `SELECT id, start_date, end_date FROM vacations
         WHERE user_id = ? AND start_date <= ? AND end_date >= ?
         ORDER BY start_date, id`
      )
      .all(userId, value.endDate, value.startDate)
    : db
      .prepare(
        `SELECT id, start_date, end_date FROM vacations
         WHERE user_id = ? AND id <> ? AND start_date <= ? AND end_date >= ?
         ORDER BY start_date, id`
      )
      .all(userId, excludeId, value.endDate, value.startDate);

  return rows.map((row) => ({ id: row.id, startDate: row.start_date, endDate: row.end_date }));
}

// work_hours stores a 0-based `month`, so the date is rebuilt as yyyymmdd to be
// ranged in a single indexed scan instead of a per-day lookup.
export function findWorkHourConflicts(db, userId, value) {
  const rows = db
    .prepare(
      `SELECT year, month, day, hours FROM work_hours
       WHERE user_id = ?
         AND hours <> 0
         AND (year * 10000 + (month + 1) * 100 + day) BETWEEN ? AND ?
       ORDER BY year, month, day`
    )
    .all(userId, dayKey(value.start), dayKey(value.end));

  return rows.map((row) => ({
    date: isoDate(row.year, row.month + 1, row.day),
    hours: row.hours,
  }));
}

export function findVacationConflicts(db, userId, value, excludeId = null) {
  return {
    vacations: findOverlappingVacations(db, userId, value, excludeId),
    workHours: findWorkHourConflicts(db, userId, value),
  };
}

export function hasConflicts(conflicts) {
  return conflicts.vacations.length > 0 || conflicts.workHours.length > 0;
}

// Russian, user-facing summary of merged conflicts. Kept next to the query so
// the wording cannot drift from what is actually detected.
export function conflictMessage(conflicts) {
  const parts = [];
  if (conflicts.vacations.length > 0) {
    const ranges = conflicts.vacations.map((item) => `${item.startDate} — ${item.endDate}`).join(", ");
    parts.push(`период пересекается с другим отпуском (${ranges})`);
  }
  if (conflicts.workHours.length > 0) {
    const days = conflicts.workHours.map((item) => item.date).join(", ");
    parts.push(`в период отпуска уже отмечены часы работы (${days})`);
  }
  return `Отпуск не сохранён: ${parts.join("; ")}.`;
}

// --- Ownership-scoped mutations ---------------------------------------------
//
// Every write is filtered by `user_id` as well as `id`, so an id belonging to
// another user is indistinguishable from a missing id (no existence leak) and
// can never be updated or deleted through this API.

export function updateVacation(db, userId, id, value) {
  const info = db
    .prepare(
      `UPDATE vacations
       SET start_date = ?, end_date = ?, year = ?, amount_kopecks = ?, paid = ?, paid_date = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    )
    .run(
      value.startDate,
      value.endDate,
      value.start.year,
      value.amountKopecks,
      value.paid ? 1 : 0,
      value.paidDate,
      id,
      userId
    );
  return info.changes === 0 ? null : readVacation(db, userId, id);
}

export function deleteVacation(db, userId, id) {
  const info = db.prepare("DELETE FROM vacations WHERE id = ? AND user_id = ?").run(id, userId);
  return info.changes > 0;
}
