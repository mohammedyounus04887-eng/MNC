import { Timestamp } from "firebase-admin/firestore";
import { prospects } from "@/lib/collections";

/**
 * `prospects.lastActivityAt` — the field the 180-day health-data purge is supposed to
 * measure (RULES P5, v2 §5.3).
 *
 * ## Why it had to exist
 *
 * The purge shipped keyed on `createdAt`, so it deleted by RECORD AGE rather than by
 * inactivity. A prospect captured 200 days ago and worked yesterday — moved to
 * "Attended", opening their snapshot every week — had their height, weight and every
 * derived metric nulled anyway, and their reports deleted with them. That is live data
 * destroyed on a healthy relationship, and it contradicts the rule's own words: "180 days
 * of prospect INACTIVITY — no stage change, no report view."
 *
 * ## What counts as activity
 *
 * Exactly what the rule names, and nothing invented on top:
 *
 *   - a stage move (the coach did something with this person)
 *   - the prospect opening their own report (they are still engaged)
 *
 * Deliberately NOT: a coach editing their own notes, or the app reading the row. Neither
 * is contact with the person, and counting them would let a prospect's health data live
 * forever behind activity they never took part in — which is how a retention rule becomes
 * decorative.
 *
 * ## The throttle is the whole design
 *
 * A report view is a public page load. Writing on every one would put an unbounded write
 * on an unauthenticated route — a cost bomb and a trivial way for anybody with the link
 * to run up a bill. So a touch only writes when the stored value is more than a day old.
 *
 * The precision lost is a day; the rule's window is 180. It cannot change any purge
 * decision, and it turns "one write per view forever" into "at most one write per day".
 */

import { TOUCH_THROTTLE_MS } from "./model";

export { RETENTION_DAYS, TOUCH_THROTTLE_MS, isStale } from "./model";

export type ActivityReason = "stage" | "report-view";

/**
 * Records that something happened to this prospect. Never throws.
 *
 * A failure here must not break a stage move or a prospect reading their own snapshot:
 * the cost of a missed touch is at worst an early purge in six months, and the cost of a
 * thrown error is a coach who cannot move somebody to "Member" right now. It is logged
 * rather than swallowed silently so the failure is still visible.
 */
export async function touchProspect(
  prospectId: string,
  reason: ActivityReason,
  now = new Date()
): Promise<void> {
  try {
    const ref = prospects().doc(prospectId);
    const snap = await ref.get();
    if (!snap.exists) return;

    const stored = snap.data()?.lastActivityAt;
    const storedMs = stored instanceof Timestamp ? stored.toMillis() : 0;
    if (now.getTime() - storedMs < TOUCH_THROTTLE_MS) return;

    await ref.update({ lastActivityAt: Timestamp.fromDate(now) });
  } catch (e) {
    console.error(`touchProspect(${prospectId}, ${reason}) failed:`, e);
  }
}

// `isStale` lives in ./model — see the note at the top of that file for why the boundary
// is deliberately kept out of any file that imports the admin SDK.
