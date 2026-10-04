import { APP_TIMEZONE, dayKey } from "@/lib/day";
import { shiftKey } from "@/lib/daily-log";

/**
 * Weekly and monthly periods, as day-key strings.
 *
 * ## Why weekly AND monthly, and why they are separate documents
 *
 * F13 asks for both because a board that only ever resets monthly ends somebody's
 * chance on the 4th. A coach who lost a week to a family illness is out of the
 * running for twenty-six more days, and the app has just told them so every time
 * they open it. The weekly board gives the same person a fresh start on Monday.
 * Neither window is the "real" one — they are two different questions ("who is
 * moving right now" and "who has held it together all month"), so they are two
 * different snapshots and never one document with a flag.
 *
 * ## Why the maths is done on strings
 *
 * Day keys are "YYYY-MM-DD" in the coach's own zone (D26, E1), so lexicographic
 * comparison IS chronological comparison and a period is a pair of keys. That is the
 * same property `team.ts` relies on for its month filter. Nothing here asks "what
 * time is it" except `currentPeriod`, which asks `day.ts` — E1 says a day boundary
 * never comes from a bare `new Date()`, and IST is UTC+5:30, so a UTC-based week
 * boundary would roll the board over at 05:30 IST on a Monday morning.
 *
 * `Date.UTC` appears below only to convert a key that ALREADY names a local day into
 * a weekday number and a month name. There is no instant involved and no zone to get
 * wrong: "2026-08-10" is a Monday whichever way you hold it.
 */

export const WINDOWS = ["weekly", "monthly"] as const;
export type WindowId = (typeof WINDOWS)[number];

export function isWindowId(v: string): v is WindowId {
  return (WINDOWS as readonly string[]).includes(v);
}

export type Period = {
  window: WindowId;
  /** Monthly: "2026-08". Weekly: the Monday's day key, "2026-08-10". */
  key: string;
  /** Inclusive day-key bounds. */
  fromKey: string;
  toKey: string;
  label: string;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Day of week for a day key, 0 = Sunday. The key names a local day already. */
function weekdayOf(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The Monday on or before `key`.
 *
 * Monday rather than Sunday because the working week this audience talks about
 * starts on Monday, and the weekly board resetting mid-weekend would land the reset
 * in the middle of the busiest club days.
 */
export function weekStartKey(key: string): string {
  const dow = weekdayOf(key);
  // Sunday (0) belongs to the week that began six days earlier, not the one
  // starting tomorrow.
  return shiftKey(key, -((dow + 6) % 7));
}

/** Last day of the month a "YYYY-MM" key names. */
function monthEndKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  const end = new Date(Date.UTC(y, m, 0));
  return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(
    end.getUTCDate()
  ).padStart(2, "0")}`;
}

function shortLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}

/** The period a given local day falls in. */
export function periodFor(window: WindowId, key: string): Period {
  if (window === "monthly") {
    const monthKey = key.slice(0, 7);
    const [y, m] = monthKey.split("-").map(Number);
    return {
      window,
      key: monthKey,
      fromKey: `${monthKey}-01`,
      toKey: monthEndKey(monthKey),
      label: `${MONTHS[m - 1]} ${y}`,
    };
  }
  const start = weekStartKey(key);
  return {
    window,
    key: start,
    fromKey: start,
    toKey: shiftKey(start, 6),
    label: `Week of ${shortLabel(start)}`,
  };
}

/** The period we are in right now, in the coach's zone. */
export function currentPeriod(
  window: WindowId,
  timeZone: string = APP_TIMEZONE,
  now = new Date()
): Period {
  return periodFor(window, dayKey(now, timeZone));
}

/** Every day key in a period, oldest first — the streak board walks these. */
export function daysInPeriod(period: Period): string[] {
  const out: string[] = [];
  let k = period.fromKey;
  while (k <= period.toKey) {
    out.push(k);
    k = shiftKey(k, 1);
  }
  return out;
}

/**
 * The longest consecutive run of logged days INSIDE a period.
 *
 * Not the coach's live streak. A live streak carried into the board would mean a
 * 200-day streak wins every weekly board forever, which is the "same five people win"
 * failure the four boards exist to avoid — and it would make the weekly reset a lie.
 * The run is measured inside the window, so Monday starts everybody at nothing.
 *
 * The Streak Shield (D67) deliberately does NOT apply here. A shield is personal
 * forgiveness for the flame on the coach's own screen; spending it to claim a day
 * that was not logged, in a ranking against other people, is a different thing
 * entirely. Missing a day breaks the run on a board and the flame still survives.
 */
export function longestRunWithin(loggedKeys: Iterable<string>, period: Period): number {
  const logged = new Set(loggedKeys);
  let best = 0;
  let run = 0;
  for (const key of daysInPeriod(period)) {
    run = logged.has(key) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/** When this period ends, in words. Used to say "resets Monday" without a date. */
export function resetsLabel(window: WindowId): string {
  return window === "weekly" ? "Resets every Monday" : "Resets on the 1st";
}
