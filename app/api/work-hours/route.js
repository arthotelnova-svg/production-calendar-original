import { auth } from "../../../auth";
import { ensureUser, getDb } from "../../../lib/db";
import { validateActualHours, validateDayForMonth, validateMonth, validateYear } from "../../../lib/validators";
import { NextResponse } from "next/server";

export async function GET(request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const year = validateYear(new URL(request.url).searchParams.get("year"));
  if (year === null) return NextResponse.json({ error: "Year is required" }, { status: 400 });
  try {
    const db = getDb();
    ensureUser(db, session.user);
    const rows = db.prepare("SELECT month, day, hours FROM work_hours WHERE user_id = ? AND year = ?").all(session.user.id, year);
    return NextResponse.json(Object.fromEntries(rows.map((row) => [`${row.month}-${row.day}`, row.hours])));
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}

export async function POST(request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const year = validateYear(body.year);
  const month = validateMonth(body.month);
  const day = validateDayForMonth(year, month, body.day);
  const hours = validateActualHours(body.hours);
  if (year === null || month === null || day === null || hours === null) return NextResponse.json({ error: "Invalid factual hours" }, { status: 400 });
  try {
    const db = getDb();
    ensureUser(db, session.user);
    db.prepare("INSERT OR REPLACE INTO work_hours (user_id, year, month, day, hours) VALUES (?, ?, ?, ?, ?)").run(session.user.id, year, month, day, hours);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}

export async function DELETE(request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const year = validateYear(params.get("year"));
  const month = validateMonth(params.get("month"));
  const day = validateDayForMonth(year, month, params.get("day"));
  if (year === null || month === null || day === null) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  try {
    const db = getDb();
    ensureUser(db, session.user);
    db.prepare("DELETE FROM work_hours WHERE user_id = ? AND year = ? AND month = ? AND day = ?").run(session.user.id, year, month, day);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
