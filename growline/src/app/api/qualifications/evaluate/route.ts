import { NextResponse } from "next/server";
import { checkCronSecret } from "@/modules/shared-new/cron";
import { evaluateOpenQualifications } from "@/modules/qualifications/evaluate";

/**
 * Recomputes every open qualification (F14). Called by a scheduler, never a browser.
 *
 * The aggregation lives in the app rather than inside the Cloud Function, for the
 * reason `morningReminder` established and `/api/leaderboards/rebuild` followed: one
 * home for the logic, and it stays runnable by hand against the emulator without
 * deploying anything.
 *
 * A tracker does not depend on this having run. The create path evaluates
 * synchronously, and a page whose numbers have aged out refreshes them itself
 * (`ensureFresh`), so a server with no scheduler still shows current figures — this
 * route exists to keep them current for the reminders and for coaches who never open
 * the screen.
 */
export async function POST(req: Request) {
  const guard = checkCronSecret(req, "Qualifications");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const results = await evaluateOpenQualifications();
  return NextResponse.json({
    ok: true,
    evaluated: results.length,
    results: results.map((r) => ({
      qualificationId: r.qualificationId,
      audienceSize: r.audienceSize,
      qualifiedCount: r.qualifiedCount,
      oneStepCount: r.oneStepCount,
      removed: r.removed,
    })),
  });
}
