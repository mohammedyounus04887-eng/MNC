import { NextResponse } from "next/server";
import { checkCronSecret } from "@/modules/shared-new/cron";
import { computeAllDuplicationScores } from "@/modules/duplication/compute";

/**
 * Rebuilds every coach's duplication reading (F20). Called by a scheduler, never by
 * a browser.
 *
 * The aggregation lives in the app rather than inside the Cloud Function, for the
 * reason `morningReminder` established and `/api/leaderboards/rebuild` repeated: the
 * logic keeps one home, it is runnable by hand against the emulator, and `functions/`
 * is a separate build that cannot import from `src/` without a second copy of an
 * aggregation whose entire job is to agree with itself.
 *
 * Guarded by `CRON_SECRET` through the shared check, and FAILS CLOSED without one.
 * Open, this endpoint would let anybody make the server read every user and four
 * weeks of every log in the organisation, as often as they liked.
 */
export async function POST(req: Request) {
  const check = checkCronSecret(req, "Duplication readings");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const result = await computeAllDuplicationScores();
  return NextResponse.json({
    ok: true,
    scored: result.scored,
    cleared: result.cleared,
    fromKey: result.window.fromKey,
    toKey: result.window.toKey,
    generatedAt: result.generatedAt.toISOString(),
  });
}
