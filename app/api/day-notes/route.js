import fs from "fs";
import path from "path";
import { auth } from "../../../auth";
import { ensureUser, getDb } from "../../../lib/db";
import { validateDayForMonth, validateMonth, validateYear } from "../../../lib/validators";
import { NextResponse } from "next/server";

function dateFrom(source) {
  const year = validateYear(source.get ? source.get("year") : source.year);
  const month = validateMonth(source.get ? source.get("month") : source.month);
  const day = validateDayForMonth(year, month, source.get ? source.get("day") : source.day);
  return year === null || month === null || day === null ? null : { year, month, day };
}

export async function GET(request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const year = validateYear(params.get("year"));
  if (year === null) return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  const monthParam = params.get("month"); const dayParam = params.get("day");
  const db = getDb(); ensureUser(db, session.user);
  if (monthParam === null && dayParam === null) {
    const rows = db.prepare(`SELECT month, day FROM day_notes WHERE user_id = ? AND year = ? AND length(text) > 0
      UNION SELECT month, day FROM day_attachments WHERE user_id = ? AND year = ?`).all(session.user.id, year, session.user.id, year);
    return NextResponse.json(Object.fromEntries(rows.map((row) => [`${row.month}-${row.day}`, { hasNote: true }])));
  }
  const month = validateMonth(monthParam); const day = validateDayForMonth(year, month, dayParam);
  if (month === null || day === null) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  const date = { year, month, day };
  const note = db.prepare("SELECT text FROM day_notes WHERE user_id = ? AND year = ? AND month = ? AND day = ?").get(session.user.id, date.year, date.month, date.day);
  const attachments = db.prepare("SELECT id, original_name AS originalName, size, media_type AS mediaType FROM day_attachments WHERE user_id = ? AND year = ? AND month = ? AND day = ? ORDER BY created_at").all(session.user.id, date.year, date.month, date.day);
  return NextResponse.json({ text: note?.text || "", attachments });
}

export async function POST(request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const date = dateFrom(body);
  if (!date || typeof body.text !== "string" || body.text.length > 5000) return NextResponse.json({ error: "Invalid note" }, { status: 400 });
  const db = getDb(); ensureUser(db, session.user);
  db.prepare("INSERT INTO day_notes (user_id, year, month, day, text) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, year, month, day) DO UPDATE SET text = excluded.text, updated_at = CURRENT_TIMESTAMP").run(session.user.id, date.year, date.month, date.day, body.text.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = dateFrom(new URL(request.url).searchParams);
  if (!date) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  const db = getDb(); ensureUser(db, session.user);
  const files = db.prepare("SELECT stored_name FROM day_attachments WHERE user_id = ? AND year = ? AND month = ? AND day = ?").all(session.user.id, date.year, date.month, date.day);
  db.transaction(() => {
    db.prepare("DELETE FROM day_attachments WHERE user_id = ? AND year = ? AND month = ? AND day = ?").run(session.user.id, date.year, date.month, date.day);
    db.prepare("DELETE FROM day_notes WHERE user_id = ? AND year = ? AND month = ? AND day = ?").run(session.user.id, date.year, date.month, date.day);
  })();
  const root = process.env.UPLOADS_PATH || path.resolve("./data/uploads");
  files.forEach(({ stored_name }) => fs.rmSync(path.join(root, stored_name), { force: true }));
  return NextResponse.json({ ok: true });
}
