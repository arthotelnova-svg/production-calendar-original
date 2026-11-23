import { auth } from "../../../auth";
import { ensureUser, getDb } from "../../../lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    ensureUser(db, session.user);
    const settings = db.prepare("SELECT oklad, ot_rate, auto_ot_rate, ot_weekday, ot_saturday FROM settings WHERE user_id = ?").get(session.user.id);
    return NextResponse.json(settings || { oklad: 135000, ot_rate: 164, auto_ot_rate: 0, ot_weekday: 2, ot_saturday: 8 });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { oklad, ot_rate, auto_ot_rate, ot_weekday, ot_saturday } = body;
    const persistedWeekdayDefault = ot_weekday ?? 2;
    const persistedSaturdayDefault = ot_saturday ?? 8;

    if (
      typeof oklad !== "number" || !isFinite(oklad) || oklad < 0 || oklad > 10_000_000 ||
      typeof ot_rate !== "number" || !isFinite(ot_rate) || ot_rate < 0 || ot_rate > 100_000 ||
      (auto_ot_rate !== undefined && typeof auto_ot_rate !== "boolean") ||
      (ot_weekday !== undefined && (typeof ot_weekday !== "number" || !isFinite(ot_weekday) || ot_weekday < 0 || ot_weekday > 24)) ||
      (ot_saturday !== undefined && (typeof ot_saturday !== "number" || !isFinite(ot_saturday) || ot_saturday < 0 || ot_saturday > 24))
    ) {
      return NextResponse.json({ error: "Invalid settings data" }, { status: 400 });
    }

    const db = getDb();
    ensureUser(db, session.user);
    const persistedAutoOtRate = auto_ot_rate === undefined ? null : (auto_ot_rate ? 1 : 0);
    db.prepare(`
      INSERT INTO settings (user_id, oklad, ot_rate, auto_ot_rate, ot_weekday, ot_saturday)
      VALUES (?, ?, ?, COALESCE(?, 0), ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        oklad = excluded.oklad,
        ot_rate = excluded.ot_rate,
        auto_ot_rate = CASE WHEN ? IS NULL THEN settings.auto_ot_rate ELSE excluded.auto_ot_rate END,
        ot_weekday = excluded.ot_weekday,
        ot_saturday = excluded.ot_saturday
    `).run(session.user.id, oklad, ot_rate, persistedAutoOtRate, persistedWeekdayDefault, persistedSaturdayDefault, persistedAutoOtRate);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
