import { APP_TIMEZONE, dayKey, startOfDayInZone } from "@/lib/day";
import { daysBetweenKeys, shiftKey } from "@/lib/daily-log";

/**
 * A window of days, named by its two end keys.
 *
 * ## Why this exists next to `period.ts` rather than inside it
 *
 * A period is a calendar box — this week, this month — and it is chosen by the
 * calendar. A qualification's window is chosen by a person: it starts the moment an
 * upline creates it and ends on the date they typed. Both are "a run of local days",
 * and both have to turn into real instants before Firestore can be asked about
 * anything, so that conversion lives here once instead of in each module.
 *
 * ## Day keys, not Dates — and the timezone travels with the window
 *
 * E1, restated: a day boundary never comes from a bare `new Date()`. India is
 * UTC+5:30, so a deadline of "31 August" evaluated in UTC closes at 05:30 on the 31st
 * for the coach holding the phone — it would take the last day of a qualification
 * away from everybody who works in the evening, which is when this audience works.
 *
 * The window therefore stores `timeZone` alongside its keys rather than assuming
 * `APP_TIMEZONE` at the point of use. Today that value is always Asia/Kolkata; the
 * field exists so that the day a coach outside India is onboarded, the deadline they
 * were shown is the deadline that is enforced, and nothing has to be migrated.
 *
 * ## The end is INCLUSIVE
 *
 * `toKey` is the last day that counts, not the first day that does not. A deadline of
 * "31 August" means work done on the 31st counts, which is what a person means when
 * they say it. The exclusive instant needed for a Firestore range query is derived
 * (`untilExclusive`), never stored, so the two can never disagree.
 */

export type DayWindow = {
  /** First local day that counts, "YYYY-MM-DD". */
  fromKey: string;
  /** LAST local day that counts, inclusive. */
  toKey: string;
  /** The zone the two keys name days in. */
  timeZone: string;
};

export function makeWindow(
  fromKey: string,
  toKey: string,
  timeZone: string = APP_TIMEZONE
): DayWindow {
  return { fromKey, toKey, timeZone };
}

export function isDayKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)
  );
}

/**
 * The real instants a `createdAt` range query needs: `[from, untilExclusive)`.
 *
 * Half-open deliberately. A `<=` bound on the last day's midnight would exclude
 * everything captured during the last day, which is the day that matters most.
 */
export function windowInstants(w: DayWindow): { from: Date; untilExclusive: Date } {
  return {
    from: startOfDayInZone(w.fromKey, w.timeZone),
    untilExclusive: startOfDayInZone(shiftKey(w.toKey, 1), w.timeZone),
  };
}

/** The instant the window closes — the first moment after its last day. */
export function closesAt(w: DayWindow): Date {
  return windowInstants(w).untilExclusive;
}

/** Day keys sort lexicographically, so containment is two string comparisons. */
export function containsKey(w: DayWindow, key: string): boolean {
  return key >= w.fromKey && key <= w.toKey;
}

/** Today, in the window's own zone. Never the server's idea of today. */
export function todayKeyIn(w: DayWindow, now = new Date()): string {
  return dayKey(now, w.timeZone);
}

/**
 * Whole days remaining, counting today as one.
 *
 * A coach on the last day is told "1 day left", not "0" — zero reads as "it is over"
 * while they can still act, and the whole point of a deadline countdown is the hours
 * that are left rather than the ones that are gone. Past the deadline it is 0.
 */
export function daysLeft(w: DayWindow, now = new Date()): number {
  return Math.max(0, daysBetweenKeys(todayKeyIn(w, now), w.toKey) + 1);
}

export function isOpen(w: DayWindow, now = new Date()): boolean {
  return todayKeyIn(w, now) <= w.toKey;
}

/** "31 Aug 2026" — short enough for a card, unambiguous about which August. */
export function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  // The key already names a local day, so there is no instant here and no zone to
  // get wrong (period.ts makes the same argument for the same reason).
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    month: "short",
    timeZone: "UTC",
  });
  return `${d} ${month} ${y}`;
}

/** Every "YYYY-MM" the window touches, in order — what a monthly figure is read by. */
export function monthsInWindow(w: DayWindow): string[] {
  const out: string[] = [];
  let month = w.fromKey.slice(0, 7);
  const last = w.toKey.slice(0, 7);
  while (month <= last) {
    out.push(month);
    const [y, m] = month.split("-").map(Number);
    month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  return out;
}
