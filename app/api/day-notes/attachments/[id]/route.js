import fs from "fs";
import path from "path";
import { auth } from "../../../../../auth";
import { getDb } from "../../../../../lib/db";
import { NextResponse } from "next/server";
const ROOT = process.env.UPLOADS_PATH || path.resolve("./data/uploads");

export async function GET(_request, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const row = getDb().prepare("SELECT original_name, stored_name, media_type FROM day_attachments WHERE id = ? AND user_id = ?").get(id, session.user.id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const filePath = path.join(ROOT, row.stored_name);
  if (!fs.existsSync(filePath)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(fs.readFileSync(filePath), { headers: { "Content-Type": row.media_type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.original_name)}`, "X-Content-Type-Options": "nosniff" } });
}
