import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { createLineRequest, findByCode } from "@/lib/line-requests";

/**
 * Asks to link two coaches who are already a team in real life (F1, after the fact).
 *
 * `direction` says which way round:
 *   "under" — the other coach is MY upline; I become their downline
 *   "over"  — the other coach is in MY line; they become my downline
 *
 * Either way the other party must accept. See lib/line-requests.ts for why that is a
 * privacy requirement rather than a courtesy.
 */
export async function POST(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const body = (raw ?? {}) as Record<string, unknown>;

  const direction = body.direction;
  if (direction !== "under" && direction !== "over") {
    return NextResponse.json({ error: "Choose which way round." }, { status: 400 });
  }

  const other = await findByCode(String(body.code ?? ""));
  /**
   * Deliberately the same message whether the code does not exist or is malformed. A
   * distinguishable "no such code" turns this endpoint into an oracle for testing whether
   * a referral code is real, and codes are short enough to guess at.
   */
  if (!other) {
    return NextResponse.json(
      { error: "No coach found with that code. Check it and try again." },
      { status: 404 }
    );
  }

  const childId = direction === "under" ? uid : other.id;
  const parentId = direction === "under" ? other.id : uid;

  const result = await createLineRequest({ childId, parentId, requestedBy: uid });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, id: result.id, otherName: other.name });
}
