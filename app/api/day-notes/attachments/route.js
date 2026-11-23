import crypto from "crypto";
import fs from "fs";
import path from "path";
import { auth } from "../../../../auth";
import { ensureUser, getDb } from "../../../../lib/db";
import { validateDayForMonth, validateMonth, validateYear } from "../../../../lib/validators";
import { NextResponse } from "next/server";

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED = new Set(["pdf", "png", "jpg", "jpeg", "webp", "doc", "docx", "xls", "xlsx", "txt"]);
const ROOT = process.env.UPLOADS_PATH || path.resolve("./data/uploads");
function safeName(name) { return path.basename(name).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 180) || "file"; }
function date(form) { const year = validateYear(form.get("year")); const month = validateMonth(form.get("month")); const day = validateDayForMonth(year, month, form.get("day")); return year === null || month === null || day === null ? null : { year, month, day }; }

export async function POST(request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await request.formData(); const scope = date(form); const file = form.get("file");
  if (!scope || !(file instanceof File)) return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  const originalName = safeName(file.name); const ext = originalName.split(".").pop().toLowerCase();
  if (!ALLOWED.has(ext) || file.size < 1 || file.size > MAX_SIZE) return NextResponse.json({ error: "Разрешены PDF, изображения, офисные документы и TXT до 10 МБ." }, { status: 400 });
  const db = getDb(); ensureUser(db, session.user);
  const count = db.prepare("SELECT COUNT(*) AS count FROM day_attachments WHERE user_id = ? AND year = ? AND month = ? AND day = ?").get(session.user.id, scope.year, scope.month, scope.day).count;
  if (count >= 5) return NextResponse.json({ error: "Не более 5 файлов на день." }, { status: 400 });
  const id = crypto.randomUUID(); const storedName = `${id}.${ext}`; fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(ROOT, storedName), Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  try { db.prepare("INSERT INTO day_attachments (id, user_id, year, month, day, original_name, stored_name, media_type, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, session.user.id, scope.year, scope.month, scope.day, originalName, storedName, file.type || "application/octet-stream", file.size); }
  catch (error) { fs.rmSync(path.join(ROOT, storedName), { force: true }); throw error; }
  return NextResponse.json({ attachment: { id, originalName, size: file.size, mediaType: file.type || "application/octet-stream" } });
}
