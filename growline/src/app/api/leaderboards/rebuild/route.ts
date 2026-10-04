import { NextResponse } from "next/server";
import { computeAllBoards } from "@/modules/leaderboards/compute";
import { checkCronSecret } from "@/modules/shared-new/cron";

/**
 * Rebuilds every board (F13). Called by a scheduler, never by a browser.
 *
 * The aggregation lives here rather than inside the Cloud Function for the reason
 * `morningReminder` already established in functions/src/index.ts: the logic keeps
 * one home, in the app, and the scheduled function is a thin caller. It also means
 * this is runnable by hand against the emulator without deploying anything.
 *
 * Guarded by CRON_SECRET, and FAILS CLOSED without one. An open endpoint here is not
 * a data leak but it is a way to make the server read every log in the organisation
 * on demand, as often as somebody likes.
 */

export async function POST(req: Request) {
  const guard = checkCronSecret(req, "Boards");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const result = await computeAllBoards();
  return NextResponse.json({
    ok: true,
    boardsWritten: result.boardsWritten,
    boardsSkipped: result.boardsSkipped,
    scopes: result.scopes,
    generatedAt: result.generatedAt.toISOString(),
  });
}
