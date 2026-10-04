import { APP_TIMEZONE, dayKey } from "@/lib/day";
import { daysBetweenKeys, shiftKey } from "@/lib/daily-log";
import { makeWindow, type DayWindow } from "@/modules/shared-new/window";
import { MEASURED_DEPTH, WINDOW_DAYS, type Member } from "./score";

/**
 * Turning an organisation into one line per coach. PURE — no Firestore, so the two
 * pieces of tree arithmetic that decide who is counted and for how long can be
 * tested against hand-worked examples rather than against a database.
 *
 * `compute.ts` reads the documents; this decides what they mean.
 */

/** One user, reduced to what the shaping needs. */
export type Person = {
  id: string;
  /** Ordered ancestors, nearest first (D36). */
  uplinePath: string[];
  /** Days of the window this person has been in the line, capped at the window. */
  availableDays: number;
  daysLogged: number;
};

/**
 * The rolling window ending today, in the coach's own zone.
 *
 * E1, restated: the day this window ends on never comes from a bare `new Date()`.
 * India is UTC+5:30, so between 18:30 and midnight UTC it is already tomorrow in
 * Bengaluru — a UTC-based end date would drop the evening logs of the very day the
 * job is reporting on, every single night it ran.
 */
export function currentWindow(now = new Date(), timeZone = APP_TIMEZONE): DayWindow {
  const toKey = dayKey(now, timeZone);
  // Inclusive of both ends: 28 days means today plus the 27 before it.
  return makeWindow(shiftKey(toKey, -(WINDOW_DAYS - 1)), toKey, timeZone);
}

/**
 * How much of the window a person has actually been here for.
 *
 * Somebody who joined a fortnight ago has had a fortnight, not four weeks — and both
 * the tenure rule and the pro-rated activity bar are computed from this one number,
 * so a growing line is never judged as though its newest people had been there all
 * along. Day keys compare as strings because they sort chronologically (D26), so
 * there is no timezone arithmetic here at all.
 */
export function availableDaysFor(joinKey: string, window: DayWindow): number {
  const startKey = joinKey > window.fromKey ? joinKey : window.fromKey;
  const days = daysBetweenKeys(startKey, window.toKey) + 1;
  return Math.min(WINDOW_DAYS, Math.max(0, days));
}

/**
 * Every coach's line, keyed by the coach, from ONE pass over the organisation.
 *
 * `uplinePath` is ordered nearest-ancestor-first, so a person whose path begins
 * `[asha, root]` is at depth 1 below Asha and depth 2 below Root. Every membership
 * in the organisation therefore falls out of a single loop: for each person, their
 * first three ancestors each gain a member at the matching depth. No tree walk, no
 * query per node, and the cost does not grow with how deep the tree is.
 *
 * That `slice(0, MEASURED_DEPTH)` is also where "which depth are we measuring" is
 * decided. The ancestry runs the whole way up — a line can be a hundred deep — and
 * we deliberately read the first three entries only. See score.ts for why: level 4
 * is people no screen in this app will show, and their activity is already counted
 * in the reading of the coach they sit three levels under.
 */
export function membersByCoach(people: Person[]): Map<string, Member[]> {
  const out = new Map<string, Member[]>();
  for (const person of people) {
    person.uplinePath.slice(0, MEASURED_DEPTH).forEach((ancestorId, index) => {
      const member: Member = {
        userId: person.id,
        depth: index + 1,
        availableDays: person.availableDays,
        daysLogged: person.daysLogged,
      };
      const line = out.get(ancestorId);
      if (line) line.push(member);
      else out.set(ancestorId, [member]);
    });
  }
  return out;
}
