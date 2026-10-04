import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getUserById } from "@/lib/users";
import { markSeenMany } from "@/lib/threads-queries";

/**
 * "These arrived on my screen" — one request for the whole inbox page (F8).
 *
 * Batched rather than one call per card: opening the Threads tab on a 3G connection
 * must not fire thirty requests to move a counter somebody else is watching.
 *
 * Each id is still authorized individually inside `recordReceipt`, so sending ids for
 * threads that were never addressed to this coach records nothing and reports nothing
 * — the response is a count, never which ids were accepted, so this cannot be used to
 * test whether a given thread exists.
 */
export async function POST(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const reader = await getUserById(uid);
  if (!reader) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const raw = (body ?? {})?.ids;
  const ids = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  if (ids.length === 0) return NextResponse.json({ ok: true, recorded: 0 });

  const recorded = await markSeenMany(reader, ids);
  return NextResponse.json({ ok: true, recorded });
}
