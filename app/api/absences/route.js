import { auth } from "../../../auth";
import { getDb } from "../../../lib/db";
import { validateMonth, validateDayForMonth, validateYear } from "../../../lib/validators";
import { isAbsenceEligible } from "../../../lib/russian-calendar";
import { NextResponse } from "next/server";

function readScope(searchParams) {
  const year = validateYear(searchParams.get("year"));
  const month = validateMonth(searchParams.get("month"));
  return year === null || month === null ? null : { year, month };
}

export async function GET(request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const year = validateYear(params.get("year"));
  if (year === null) return NextResponse.json({ error: "Year is required" }, { status: 400 });
  try {
    const month = validateMonth(params.get("month"));
    const rows = month === null
      ? getDb().prepare("SELECT month, day FROM absences WHERE user_id = ? AND year = ?").all(session.user.id, year)
      : getDb().prepare("SELECT month, day FROM absences WHERE user_id = ? AND year = ? AND month = ?").all(session.user.id, year, month);
    return NextResponse.json(Object.fromEntries(rows.map((row) => [`${row.month}-${row.day}`, true])));
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}

export async function POST(request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const year = validateYear(body.year);
  const month = validateMonth(body.month);
  if (year === null || month === null) return NextResponse.json({ error: "Invalid year or month" }, { status: 400 });
  try {
    const db = getDb();
    if (body.bulk) {
      if (!Array.isArray(body.items) || body.items.length > 31) return NextResponse.json({ error: "Invalid items" }, { status: 400 });
      const days = body.items.map((item) => validateDayForMonth(year, month, item.day));
      if (days.some((day) => day === null || !isAbsenceEligible(year, month, day))) return NextResponse.json({ error: "Invalid item data" }, { status: 400 });
      db.transaction(() => {
        db.prepare("DELETE FROM absences WHERE user_id = ? AND year = ? AND month = ?").run(session.user.id, year, month);
        const insert = db.prepare("INSERT INTO absences (user_id, year, month, day) VALUES (?, ?, ?, ?)");
        days.forEach((day) => insert.run(session.user.id, year, month, day));
      })();
    } else {
      const day = validateDayForMonth(year, month, body.day);
      if (day === null || !isAbsenceEligible(year, month, day)) return NextResponse.json({ error: "Invalid day" }, { status: 400 });
      db.prepare("INSERT OR IGNORE INTO absences (user_id, year, month, day) VALUES (?, ?, ?, ?)").run(session.user.id, year, month, day);
    }
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}

export async function DELETE(request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const scope = readScope(params);
  if (!scope) return NextResponse.json({ error: "Year and month are required" }, { status: 400 });
  const dayParam = params.get("day");
  try {
    const db = getDb();
    if (dayParam === null) db.prepare("DELETE FROM absences WHERE user_id = ? AND year = ? AND month = ?").run(session.user.id, scope.year, scope.month);
    else {
      const day = validateDayForMonth(scope.year, scope.month, dayParam);
      if (day === null) return NextResponse.json({ error: "Invalid day" }, { status: 400 });
      db.prepare("DELETE FROM absences WHERE user_id = ? AND year = ? AND month = ? AND day = ?").run(session.user.id, scope.year, scope.month, day);
    }
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
