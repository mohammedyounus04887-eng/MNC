import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { acceptLineRequest, respondNegative } from "@/lib/line-requests";

/**
 * Answering a link request: accept, decline, or cancel your own.
 *
 * Authorisation is re-derived inside the library from the request document — the approver
 * must be the party who did NOT ask — because this route is reachable directly and a
 * disabled button proves nothing.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const action = (raw ?? {})?.action;

  if (action === "accept") {
    const result = await acceptLineRequest(id, uid);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    // The counts say what moved. Worth returning: a coach accepting a line of 40 people
    // should see that 40 people moved, not a bare "done".
    return NextResponse.json({ ok: true, moved: result.moved });
  }

  if (action === "decline" || action === "cancel") {
    const result = await respondNegative(
      id,
      uid,
      action === "decline" ? "declined" : "cancelled"
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
