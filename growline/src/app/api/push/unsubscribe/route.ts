import { NextResponse } from "next/server";
import { COLLECTIONS } from "@/lib/collections";
import { db } from "@/lib/firebase-admin";
import { getSessionUserId } from "@/lib/session";

/** Turning reminders off must actually delete the subscription, not just hide a toggle. */
export async function POST(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const endpoint = String((body as Record<string, unknown>)?.endpoint ?? "");

  // Scoped to this coach so one person cannot delete another's subscription by
  // guessing an endpoint. Querying by userId first is what enforces that — the
  // endpoint hash alone would delete whoever owns it.
  let q = db.collection(COLLECTIONS.pushSubscriptions).where("userId", "==", uid);
  if (endpoint) q = q.where("endpoint", "==", endpoint);
  const snap = await q.get();
  // Deleting nothing is success, not an error: turning reminders off twice must
  // not report a failure.
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
  return NextResponse.json({ ok: true });
}
