import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getSheetForUpline } from "@/modules/goals/queries";
import { getRecentActivity } from "@/modules/goals/activity";
import { talkingPoints } from "@/modules/goals/queries";

/**
 * A downline's sheet, as their DIRECT upline is allowed to see it (A2), plus the
 * talking-points card A3 wants in front of them before they set a number.
 *
 * This route is what makes "an upline cannot open target-setting without seeing the goal
 * sheet" true rather than aspirational: the set-target control fetches it and cannot show
 * its number field until it resolves.
 *
 * The relationship is re-derived from the database — direct upline only, not the chain —
 * and the private half is merged in only when the coach's own switch says so. A
 * non-upline gets 404, not 403, so this cannot be used to discover who reports to whom.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ coachId: string }> }
) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { coachId } = await params;
  const view = await getSheetForUpline(coachId, uid);
  if (!view.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const activity = await getRecentActivity(coachId);

  return NextResponse.json({
    sheet: view.sheet,
    sawPrivate: view.sawPrivate,
    activity,
    talkingPoints: talkingPoints(view.sheet, activity),
  });
}
