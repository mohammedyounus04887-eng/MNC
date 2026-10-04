import { NextResponse } from "next/server";
import { checkCronSecret } from "@/modules/shared-new/cron";
import { sendDueReminders } from "@/modules/qualifications/send-reminders";

/**
 * The escalating deadline reminders (F14). Called by a scheduler, never a browser.
 *
 * Meant to run ONCE A DAY, in the morning, not hourly. The bands are days rather than
 * hours (reminders.ts), so a second run on the same day would find every due coach
 * already marked and do nothing — correct, but it would still read every open
 * qualification's rows to discover that.
 *
 * `?dryRun=1` reports exactly what would be sent and writes nothing, which is how the
 * escalation is verified on a machine with no push keys configured.
 */
export async function POST(req: Request) {
  const guard = checkCronSecret(req, "Reminders");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const run = await sendDueReminders(new Date(), dryRun);
  return NextResponse.json({ ok: true, ...run });
}
