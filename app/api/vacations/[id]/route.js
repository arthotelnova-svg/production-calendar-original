import { auth } from "../../../../auth";
import { ensureUser, getDb } from "../../../../lib/db";
import {
  conflictMessage,
  deleteVacation,
  findVacationConflicts,
  hasConflicts,
  normalizeVacationBody,
  readVacation,
  updateVacation,
} from "../../../../lib/leave-records";
import { NextResponse } from "next/server";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

// Route ids are positive integers; anything else can never address a row.
function readId(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// A single vacation owned by the caller, or null. Scoped by `user_id`, so another
// user's id is reported exactly like a missing one.
function ownVacation(db, userId, id) {
  return readVacation(db, userId, id);
}

export async function PATCH(request, { params }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  const id = readId((await params)?.id);
  if (id === null) return notFound();

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

    // Ownership, the conflict read and the update share one IMMEDIATE
    // transaction, so nothing can be inserted into the edited range between the
    // check and the write (and the row cannot vanish underneath us).
    const result = db
      .transaction(() => {
        ensureUser(db, session.user);

        if (!ownVacation(db, session.user.id, id)) return { missing: true };

        // The record's own range is excluded, otherwise every edit would conflict
        // with itself as soon as the dates are unchanged.
        const conflicts = findVacationConflicts(db, session.user.id, normalized.value, id);
        if (hasConflicts(conflicts)) return { conflicts };

        const vacation = updateVacation(db, session.user.id, id, normalized.value);
        return vacation ? { vacation } : { missing: true };
      })
      .immediate();

    if (result.missing) return notFound();
    if (result.conflicts) {
      const error = conflictMessage(result.conflicts);
      return NextResponse.json({ error, message: error, conflicts: result.conflicts }, { status: 409 });
    }
    return NextResponse.json({ vacation: result.vacation });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  const id = readId((await params)?.id);
  if (id === null) return notFound();

  try {
    const db = getDb();
    ensureUser(db, session.user);
    // Deleting a vacation deletes only the vacation: work_hours recorded inside
    // the range stay exactly as the user entered them.
    if (!deleteVacation(db, session.user.id, id)) return notFound();
    return NextResponse.json({ ok: true, id });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
