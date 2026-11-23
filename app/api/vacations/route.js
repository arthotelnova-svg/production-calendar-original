import { auth } from "../../../auth";
import { ensureUser, getDb } from "../../../lib/db";
import {
  conflictMessage,
  findVacationConflicts,
  hasConflicts,
  insertVacation,
  listVacations,
  normalizeVacationBody,
  SUPPORTED_YEARS,
} from "../../../lib/leave-records";
import { NextResponse } from "next/server";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// The app publishes a single supported calendar year, so a list request without
// `?year=` means "the supported year" — never `Number(null) === 0`.
const DEFAULT_YEAR = 2026;

function readYear(searchParams) {
  const raw = searchParams.get("year");
  if (raw === null || raw.trim() === "") return DEFAULT_YEAR;
  const year = Number(raw);
  if (!Number.isInteger(year) || !SUPPORTED_YEARS.has(year)) return null;
  return year;
}

export async function GET(request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  const year = readYear(new URL(request.url).searchParams);
  if (year === null) {
    return NextResponse.json({ error: "Неподдерживаемый год", supportedYears: [...SUPPORTED_YEARS] }, { status: 400 });
  }

  try {
    const db = getDb();
    ensureUser(db, session.user);
    return NextResponse.json({ year, vacations: listVacations(db, session.user.id, year) });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const normalized = normalizeVacationBody(body);
  if (normalized.error) return NextResponse.json(normalized, { status: 400 });

  try {
    const db = getDb();

    // The owner row, the conflict read and the insert run inside ONE IMMEDIATE
    // transaction: `BEGIN IMMEDIATE` takes the write lock up front, so a second
    // request (or process) cannot pass its own conflict check between our check
    // and our write. A rejected request writes nothing, and a failed write rolls
    // the conflict check back with it.
    const result = db
      .transaction(() => {
        ensureUser(db, session.user);

        const conflicts = findVacationConflicts(db, session.user.id, normalized.value);
        if (hasConflicts(conflicts)) return { conflicts };

        return { vacation: insertVacation(db, session.user.id, normalized.value) };
      })
      .immediate();

    if (result.conflicts) {
      const error = conflictMessage(result.conflicts);
      return NextResponse.json({ error, message: error, conflicts: result.conflicts }, { status: 409 });
    }

    return NextResponse.json({ vacation: result.vacation }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
