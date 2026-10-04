import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { requestProof } from "@/lib/targets-queries";
import { MAX_NOTE } from "@/lib/targets";

/** "Ask for proof" (F7) — the upline requests evidence on claimed progress. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const raw = (body ?? {})?.requestNote;
  const note = raw === undefined || raw === null ? "" : String(raw).trim();
  if (note.length > MAX_NOTE) {
    return NextResponse.json({ error: "That message is too long." }, { status: 400 });
  }

  const result = await requestProof(uid, id, note === "" ? null : note);
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, id: result.id });
}
