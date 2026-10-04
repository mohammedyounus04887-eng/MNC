import { dailyLogs } from "@/lib/collections";
import { shiftKey, todayKey } from "@/lib/daily-log";
import { APP_TIMEZONE } from "@/lib/day";

/**
 * What a coach has actually been doing lately, for the talking-points card an upline sees
 * before they set a target (A3).
 *
 * This is the half of the conversation the goal sheet cannot supply. The sheet says what
 * somebody WANTS; this says what they have been managing. A target set from the first
 * without the second is how a coach ends up with a number four times their demonstrated
 * pace, agrees to it because their upline is standing there, and quietly stops opening the
 * app — the failure this feature exists to prevent.
 *
 * Two deliberately blunt numbers. "Logged 9 of the last 30 days" and "about 2 invites a
 * day" are things an upline can say out loud in a conversation; a 14-field analytics panel
 * is not, and would be read by nobody.
 */

export const ACTIVITY_WINDOW_DAYS = 30;

export type RecentActivity = {
  loggedDays: number;
  ofDays: number;
  /**
   * Invites per LOGGED day, not per calendar day — null when there is nothing to divide.
   *
   * Averaging over the window instead would conflate two different problems: somebody
   * inviting nobody, and somebody inviting people but not logging it. The first needs a
   * target conversation, the second needs a reminder to log, and an upline given one
   * number for both will give the wrong advice. Days they logged is the honest
   * denominator for "how they work when they are working".
   */
  invitesPerDay: number | null;
};

export async function getRecentActivity(
  userId: string,
  timeZone: string = APP_TIMEZONE,
  now = new Date()
): Promise<RecentActivity> {
  // Day keys sort lexicographically, so the window is a string range — the same shape
  // getLogState already uses, so no new composite index (E1: never `new Date()` for a
  // day boundary; the arithmetic goes through day.ts).
  const today = todayKey(timeZone, now);
  const since = shiftKey(today, -(ACTIVITY_WINDOW_DAYS - 1));

  const snap = await dailyLogs()
    .where("userId", "==", userId)
    .where("dayKey", ">=", since)
    .get();

  let invites = 0;
  for (const d of snap.docs) {
    const v = d.data().invites;
    if (typeof v === "number" && Number.isFinite(v)) invites += v;
  }

  const loggedDays = snap.size;
  return {
    loggedDays,
    ofDays: ACTIVITY_WINDOW_DAYS,
    invitesPerDay: loggedDays > 0 ? Math.round((invites / loggedDays) * 10) / 10 : null,
  };
}
