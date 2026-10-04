import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getUserById } from "@/lib/users";
import { recordReceipt } from "@/lib/threads-queries";

/**
 * "I saw this" and "I acknowledge this" (F8).
 *
 * One route for both because they are the same record — a receipt — and an ack
 * implies a seen. Splitting them would let a client acknowledge without ever
 * recording the seen, and `ackCount` could then exceed `seenCount`, which reads as a
 * bug to the sender watching the two numbers.
 *
 * Idempotent by construction: the receipt id is derived from (thread, reader), so a
 * doubled tap on a flaky connection returns "already" rather than incrementing twice.
 * The sender's count is the whole point of this feature; it has to be exact.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const reader = await getUserById(uid);
  if (!reader) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const ack = (body ?? {})?.ack === true;

  const outcome = await recordReceipt({ reader, threadId: id, ack });

  // "Denied" and "missing" both answer 404, so a thread id in a URL cannot be used to
  // discover whether somebody else's broadcast exists.
  if (outcome === "denied" || outcome === "missing") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, outcome });
}
