import { APP_TIMEZONE, dayKey, startOfDayInZone, todayRange } from "./day";

/**
 * Follow-up scheduling (F5). Overdue work surfaces above everything else, because
 * the whole point of the feature is that a coach stops losing people.
 *
 * PURE ONLY — no database import. Client components (the stage controls, the list)
 * import from here, and pulling `./db` in would drag the SQLite driver into the
 * browser bundle. Queries live in followup-queries.ts.
 */

export type FollowupBucket = "overdue" | "today" | "upcoming" | "none";

export function bucketFollowup(
  date: Date | null,
  timeZone: string = APP_TIMEZONE,
  now = new Date()
): FollowupBucket {
  if (!date) return "none";
  const { start, end } = todayRange(timeZone, now);
  if (date < start) return "overdue";
  if (date < end) return "today";
  return "upcoming";
}

/** "Today", "Tomorrow", "3 days late" — plain words, no dates to decode. */
export function describeFollowup(
  date: Date | null,
  timeZone: string = APP_TIMEZONE,
  now = new Date()
): string | null {
  if (!date) return null;
  const todayKeyValue = todayRange(timeZone, now).key;
  const dateKey = dayKey(date, timeZone);
  if (dateKey === todayKeyValue) return "Today";

  const days = daysBetweenKeys(todayKeyValue, dateKey);
  if (days === 1) return "Tomorrow";
  if (days === -1) return "1 day late";
  if (days < 0) return `${Math.abs(days)} days late`;
  if (days < 7) return `In ${days} days`;
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone,
  });
}

/** Whole days from `fromKey` to `toKey`; negative when `toKey` is in the past. */
function daysBetweenKeys(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

/** Presets for the date control — a coach picks, never types a date. */
export const FOLLOWUP_PRESETS = [
  { key: "tomorrow", label: "Tomorrow", days: 1 },
  { key: "3days", label: "In 3 days", days: 3 },
  { key: "week", label: "Next week", days: 7 },
] as const;

/**
 * The morning reminder's wording (F5). Plain counts only — no income promise, no
 * health claim, nothing that reads as pressure.
 */
export function followupNotificationBody(counts: {
  today: number;
  overdue: number;
}): string {
  const due = counts.today + counts.overdue;
  const lead =
    due === 1 ? "You have 1 follow-up today." : `You have ${due} follow-ups today.`;
  if (counts.overdue === 0) return lead;
  const late =
    counts.overdue === 1 ? "1 is from earlier." : `${counts.overdue} are from earlier.`;
  return `${lead} ${late}`;
}

/** Morning, in the coach's own timezone. */
const FOLLOWUP_HOUR = 9;

/** The window counted as "morning" for sending the daily reminder. */
export const MORNING_HOURS = { from: 6, to: 11 };

/**
 * Resolves a preset to an instant: 9am in the coach's zone on the target day, so a
 * follow-up set today for "tomorrow" is due tomorrow morning and not at midnight.
 */
export function presetToDate(
  days: number,
  timeZone: string = APP_TIMEZONE,
  now = new Date()
): Date {
  const targetKey = addDays(todayRange(timeZone, now).key, days);
  const dayStart = startOfDayInZone(targetKey, timeZone);
  return new Date(dayStart.getTime() + FOLLOWUP_HOUR * 3_600_000);
}

/** Calendar-day arithmetic on a "YYYY-MM-DD" key, free of timezone drift. */
function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0)), "UTC");
}
