import { NextResponse } from "next/server";
import { checkCronSecret } from "@/modules/shared-new/cron";
import { runSilenceCheck } from "@/modules/silence/run";

/**
 * The silence check (session 4, feature 3). Called by a scheduler, never a browser.
 *
 * Meant to run ONCE A DAY, in the morning. Twice would not double-notify — the stored
 * alert row makes every run after the first a no-op for the same episode — but it would
 * read the whole organisation to discover that, which is the cost this schedule exists
 * to bound.
 *
 * `?dryRun=1` reports exactly which legs qualified, which would be notified, and the
 * sentence each would carry, while writing and sending nothing. That is how the copy of
 * a notification about somebody's quiet fortnight gets reviewed before it is ever
 * delivered to a real upline — and how the whole feature is verifiable on a machine
 * with no push keys configured.
 */
export async function POST(req: Request) {
  const guard = checkCronSecret(req, "Silence alerts");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const report = await runSilenceCheck(new Date(), dryRun);
  return NextResponse.json({ ok: true, ...report });
}
