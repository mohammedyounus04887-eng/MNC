import { prospects } from "@/lib/collections";
import { completion } from "./model";
import { getOwnSheet } from "./queries";

/**
 * When to ask a coach to fill their Goal Sheet (A1).
 *
 * ## Never at signup
 *
 * A1 is explicit about this and it is the most important line in the feature. At signup a
 * coach has no idea what this app is for; asked "why did you join?" before they have used
 * it once, they type something to get past the screen, and the sheet is permanently filled
 * with a throwaway answer nobody will ever revise. That is worse than an empty sheet,
 * because an empty one still asks.
 *
 * After their first prospect, the question means something: they have met somebody, seen
 * the report go out, and have an actual reason to think about where this is going.
 *
 * ## The read cost
 *
 * The sheet is one document read on each home render. The prospect check is a second, and
 * only fires while the sheet is untouched — the moment any step is done, the short-circuit
 * below stops it forever. A nudge that costs a query after it has stopped being shown is
 * a bill for nothing.
 */
export async function shouldNudgeGoalSheet(userId: string): Promise<boolean> {
  const sheet = await getOwnSheet(userId);
  // Any progress at all means they have found it. Stop asking.
  if (completion(sheet).done > 0) return false;

  const snap = await prospects()
    .where("coachId", "==", userId)
    .limit(1)
    .select()
    .get();
  return !snap.empty;
}
