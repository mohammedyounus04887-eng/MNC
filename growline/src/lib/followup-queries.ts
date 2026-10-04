import { Timestamp } from "firebase-admin/firestore";
import { prospects } from "./collections";
import { APP_TIMEZONE, todayRange } from "./day";

/**
 * Database side of follow-ups. Split from followup.ts so client components can use
 * the date and copy helpers without pulling the server data layer into the browser
 * bundle (D25).
 */

/**
 * In Firestore's type ordering, **null sorts before every timestamp**. So a plain
 * `where("nextFollowupAt", "<", start)` matches every prospect with NO follow-up
 * date at all, and the overdue count silently becomes "everyone the coach has
 * ever met".
 *
 * Prisma expressed this as `{ not: null, lt: start }`. The Firestore equivalent is
 * a lower bound above null — two inequalities on the same field, which is allowed.
 */
const NOT_NULL = Timestamp.fromMillis(0);

/**
 * Counts for the home screen and the morning reminder.
 *
 * Overdue and today are counted separately but summed into `due`: the coach sees one
 * number to act on, and the overdue part is named so the total can never read as
 * "all caught up" when last week's people are still waiting.
 */
export async function followupCounts(
  coachId: string,
  timeZone: string = APP_TIMEZONE,
  now = new Date()
) {
  const { start, end } = todayRange(timeZone, now);
  const base = prospects().where("coachId", "==", coachId);

  const [overdue, today] = await Promise.all([
    base
      .where("nextFollowupAt", ">=", NOT_NULL)
      .where("nextFollowupAt", "<", Timestamp.fromDate(start))
      .count()
      .get(),
    base
      .where("nextFollowupAt", ">=", Timestamp.fromDate(start))
      .where("nextFollowupAt", "<", Timestamp.fromDate(end))
      .count()
      .get(),
  ]);

  const o = overdue.data().count;
  const t = today.data().count;
  return { overdue: o, today: t, due: o + t };
}
