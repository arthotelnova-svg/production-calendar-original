import { auth } from "../../../auth";
import { getDb } from "../../../lib/db";
import { validateMonth, validateDayForMonth, validateTimeBalance, validateYear } from "../../../lib/validators";
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
      ? getDb().prepare("SELECT month, day, hours FROM overtime WHERE user_id = ? AND year = ?").all(session.user.id, year)
      : getDb().prepare("SELECT month, day, hours FROM overtime WHERE user_id = ? AND year = ? AND month = ?").all(session.user.id, year, month);
    return NextResponse.json(Object.fromEntries(rows.map((row) => [`${row.month}-${row.day}`, row.hours])));
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
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
      const items = body.items.map((item) => ({ day: validateDayForMonth(year, month, item.day), hours: validateTimeBalance(item.hours) }));
      if (items.some((item) => item.day === null || item.hours === null)) return NextResponse.json({ error: "Invalid item data" }, { status: 400 });
      db.transaction(() => {
        db.prepare("DELETE FROM overtime WHERE user_id = ? AND year = ? AND month = ?").run(session.user.id, year, month);
        const insert = db.prepare("INSERT INTO overtime (user_id, year, month, day, hours) VALUES (?, ?, ?, ?, ?)");
        items.filter((item) => item.hours !== 0).forEach((item) => insert.run(session.user.id, year, month, item.day, item.hours));
      })();
      return NextResponse.json({ ok: true });
    }

    const day = validateDayForMonth(year, month, body.day);
    const hours = validateTimeBalance(body.hours);
    if (day === null || hours === null) return NextResponse.json({ error: "Invalid time balance" }, { status: 400 });
    if (hours === 0) db.prepare("DELETE FROM overtime WHERE user_id = ? AND year = ? AND month = ? AND day = ?").run(session.user.id, year, month, day);
    else db.prepare("INSERT OR REPLACE INTO overtime (user_id, year, month, day, hours) VALUES (?, ?, ?, ?, ?)").run(session.user.id, year, month, day, hours);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = readScope(new URL(request.url).searchParams);
  if (!scope) return NextResponse.json({ error: "Year and month are required" }, { status: 400 });
  try {
    getDb().prepare("DELETE FROM overtime WHERE user_id = ? AND year = ? AND month = ?").run(session.user.id, scope.year, scope.month);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Server error" }, { status: 500 }); }
}
