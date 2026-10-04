import { APP_TIMEZONE, dayKey, startOfDayInZone, todayRange } from "./day";

/**
 * The daily log (F6) — the habit engine.
 *
 * Six fields exactly, which is the Section 5.6 ceiling: five counts and one note.
 * Nothing else may be added here; a seventh field would break the rule and the
 * 30-second evening entry it protects.
 *
 * PURE ONLY — no database import, because the log form is a client component.
 * Queries live in daily-log-queries.ts.
 */

export const LOG_FIELDS = [
  { key: "servings", label: "Shakes / servings", hint: "made or served today" },
  { key: "memberships", label: "New members", hint: "joined today" },
  { key: "sessions", label: "Sessions or parties", hint: "you ran today" },
  { key: "invites", label: "Invites given", hint: "people you invited" },
  { key: "followupsDone", label: "Follow-ups done", hint: "people you contacted" },
] as const;

export type LogFieldKey = (typeof LOG_FIELDS)[number]["key"];

export type DailyLogValues = Record<LogFieldKey, number> & { note: string | null };

export const EMPTY_LOG: DailyLogValues = {
  servings: 0,
  memberships: 0,
  sessions: 0,
  invites: 0,
  followupsDone: 0,
  note: null,
};

/** A day's counts are small; anything larger is a typo or a stuck button. */
export const MAX_COUNT = 999;
/** F6 says "one-line note". */
export const MAX_NOTE = 140;

/**
 * How far back a log may be dated. Offline captures can be days old by the time
 * they sync, but unlimited backfill would let a streak be manufactured after the
 * fact — and the streak is only worth anything if it reflects real days.
 */
export const MAX_BACKFILL_DAYS = 14;

/**
 * The canonical instant for a local day, used as `log_date`.
 *
 * Storing local midnight as a UTC instant is what makes `unique(user_id, log_date)`
 * mean "one log per coach per day in their own timezone". A raw `new Date()` would
 * give a UTC day and split an Indian evening across two rows.
 */
export function logDateFor(key: string, timeZone: string = APP_TIMEZONE): Date {
  return startOfDayInZone(key, timeZone);
}

export function todayKey(timeZone: string = APP_TIMEZONE, now = new Date()): string {
  return todayRange(timeZone, now).key;
}

/** Calendar-day arithmetic on a day key, free of timezone drift. */
export function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0)), "UTC");
}

export function daysBetweenKeys(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000
  );
}

/**
 * The Streak Shield (v2 §4, dopamine map #1): one automatic grace day per calendar
 * month, so a single miss does not kill a habit the coach has been keeping.
 *
 * ## Three rules, and why each is where the line sits
 *
 * **One day, per calendar month, keyed to the month of the day that was MISSED** —
 * not to the month the coach is standing in. A miss on 28 July and a miss on 3
 * August are two different months' allowances and both are absorbed; two misses in
 * August are not.
 *
 * **A shield covers a single isolated day, never two in a row.** "One auto grace-day
 * so a single miss doesn't kill motivation" is about the day somebody was ill or
 * travelling. Bridging a two-day gap — even across a month boundary, where two
 * allowances are technically available — would make the mechanic unpredictable, and
 * a streak nobody can predict stops being worth keeping.
 *
 * **A shielded day does not COUNT, it only fails to break.** This is Duolingo's
 * freeze, which v2 §4 cites by name: the run survives, but the number is still the
 * number of days the coach actually logged. Crediting a day they did not log would
 * put a figure on the home screen that their own memory contradicts, and this app
 * asks them to trust its numbers about their business.
 *
 * Derived from the logged days every time — there is no stored allowance and nothing
 * to migrate, reset, or get out of step with the logs themselves.
 */
export const SHIELD_DAYS_PER_MONTH = 1;

export type StreakState = {
  /** Days actually logged in the current unbroken run. Shielded days are not in it. */
  days: number;
  /** True when THIS calendar month's shield has already been spent. */
  shieldUsed: boolean;
  /** The run is intact. False once a gap the shield could not cover has passed. */
  live: boolean;
  /** The days the shield absorbed, newest first. */
  shieldedKeys: string[];
};

/**
 * The streak, and what the shield had to do to keep it.
 *
 * If today has no log yet the run is measured from yesterday (D27), so a coach who
 * logged for ten days straight still sees "10" at 4pm rather than a zero that
 * implies they already lost it.
 */
export function streakState(loggedKeys: string[], today: string): StreakState {
  const idle: StreakState = { days: 0, shieldUsed: false, live: false, shieldedKeys: [] };
  if (loggedKeys.length === 0) return idle;

  const set = new Set(loggedKeys);
  const spentMonths = new Set<string>();
  const shieldedKeys: string[] = [];

  // D27: today is not held against the coach until it is over.
  let cursor = set.has(today) ? today : shiftKey(today, -1);
  let days = 0;

  for (;;) {
    if (set.has(cursor)) {
      days++;
      cursor = shiftKey(cursor, -1);
      continue;
    }

    const month = cursor.slice(0, 7);
    if (spentMonths.has(month)) break;

    // One shield, one day. If the day before the gap is also missing, this is not a
    // single miss and no allowance covers it.
    const before = shiftKey(cursor, -1);
    if (!set.has(before)) break;

    spentMonths.add(month);
    shieldedKeys.push(cursor);
    cursor = before;
  }

  if (days === 0) return idle;
  return {
    days,
    shieldUsed: spentMonths.has(today.slice(0, 7)),
    live: true,
    shieldedKeys,
  };
}

/** Just the number, for the many call sites that only want that. */
export function streakFromKeys(loggedKeys: string[], today: string): number {
  return streakState(loggedKeys, today).days;
}

/** Whether today itself is logged — what the team view shows as a live signal. */
export function loggedToday(loggedKeys: string[], today: string): boolean {
  return loggedKeys.includes(today);
}

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365] as const;

export function milestoneFor(streak: number): number | null {
  return STREAK_MILESTONES.includes(streak as (typeof STREAK_MILESTONES)[number])
    ? streak
    : null;
}

/**
 * Milestone copy. Celebrates the habit, never earnings — no income promise may
 * ever appear here (Section 5.3).
 */
export function milestoneMessage(days: number): string {
  switch (days) {
    case 3:
      return "Three days in a row. This is how a habit starts.";
    case 7:
      return "A full week logged. Most people never get this far.";
    case 14:
      return "Two weeks straight. Your line can see this.";
    case 30:
      return "Thirty days. This is who you are now.";
    case 60:
      return "Sixty days without a gap. Remarkable discipline.";
    case 100:
      return "One hundred days. A hundred days of showing up.";
    case 200:
      return "Two hundred days. Very few people reach this.";
    default:
      return "A full year of showing up every single day.";
  }
}

export function totalActivity(values: DailyLogValues): number {
  return LOG_FIELDS.reduce((sum, f) => sum + (values[f.key] || 0), 0);
}
