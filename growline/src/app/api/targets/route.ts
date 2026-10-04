import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { setTarget } from "@/lib/targets-queries";
import { currentMonth, isMonthKey } from "@/lib/targets";
import { gateLeaderTool } from "@/modules/tiers/queries";

/**
 * An upline sets or changes a direct downline's monthly target (F7).
 *
 * PUT because it is idempotent per (coach, month): sending it twice adjusts the
 * number rather than creating a second target for the same month.
 */
export async function PUT(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  // Leader gate (v2 §8) — standing, and OPEN: while TIERS_ENFORCED is false this
  // returns allowed before any read. It is wired now so the flip is one constant, not
  // a hunt through routes under launch pressure. 402 is the honest code for "this
  // needs a paid tier"; the body names what still works (never lock a user out).
  const gate = await gateLeaderTool(uid, "set-targets");
  if (!gate.allowed) return NextResponse.json({ error: gate.reason }, { status: 402 });

  const body = await req.json().catch(() => null);
  const b = (body ?? {}) as Record<string, unknown>;
  const coachId = typeof b.coachId === "string" ? b.coachId : "";
  const points = Number(b.targetPoints);

  if (!coachId) {
    return NextResponse.json({ error: "Choose who this target is for." }, { status: 400 });
  }

  // An ABSENT month defaults to this month; a month that was sent but is malformed
  // is an error. Coercing it would silently rewrite the current month's target
  // instead of failing, which is the sort of bug nobody notices until a coach's
  // number changes on its own.
  if (b.month !== undefined && b.month !== null && !isMonthKey(b.month)) {
    return NextResponse.json({ error: "That month is not valid." }, { status: 400 });
  }
  const month = isMonthKey(b.month) ? b.month : currentMonth();

  const result = await setTarget(uid, coachId, month, points);
  if (!result.ok) {
    // "Not found" covers both a missing coach and one who is not a direct downline,
    // so this cannot be used to probe the tree.
    const status = result.error === "Not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, id: result.id });
}
