import { NextResponse } from "next/server";
import { todayKey } from "@/lib/daily-log";
import { checkCronSecret } from "@/modules/shared-new/cron";
import { UNCOUNTED_TTL_DAYS } from "@/modules/voice-log/model";
import { purgeExpiredNotes } from "@/modules/voice-log/queries";

/**
 * Deletes voice notes that were never turned into numbers (session 4, feature 1).
 *
 * Called by a scheduler, never a browser — same guard and same shape as the other
 * scheduled work in these modules, so the logic stays in the app where it is runnable
 * by hand against the emulator and does not exist twice in two packages.
 *
 * A retention rule that arrives after the data does is a retention rule that has
 * already been broken once (the argument `purgeStaleHealthData` makes in
 * `functions/src/index.ts`), so this lands in the same change as the recorder.
 */
export async function POST(req: Request) {
  const guard = checkCronSecret(req, "Voice note purges");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const result = await purgeExpiredNotes(todayKey(), 400, dryRun);
  console.log(JSON.stringify({ job: "purgeVoiceNotes", ...result }));
  return NextResponse.json({
    ok: true,
    ttlDays: UNCOUNTED_TTL_DAYS,
    ...result,
  });
}
