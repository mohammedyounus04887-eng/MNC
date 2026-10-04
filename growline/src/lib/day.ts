/**
 * Day boundaries in a named timezone.
 *
 * "You have 6 follow-ups today" has to mean the coach's today. A server in UTC is
 * 5.5 hours behind India, so a naive `new Date()` comparison puts every follow-up
 * between 00:00 and 05:30 IST on the wrong day and sends the morning reminder in
 * the middle of the night. Everything that asks "which day is this?" goes through
 * here.
 */

/** This audience is in India (Section 1). Kept as a constant, not scattered. */
export const APP_TIMEZONE = "Asia/Kolkata";

const partsInZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Intl can render midnight as hour 24; normalise it.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
};

/** Offset of `timeZone` from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - date.getTime();
}

/** "2026-08-09" for the given instant, as seen in `timeZone`. */
export function dayKey(date: Date, timeZone: string = APP_TIMEZONE): string {
  const p = partsInZone(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The UTC instant at which the given local day begins. */
export function startOfDayInZone(
  key: string,
  timeZone: string = APP_TIMEZONE
): Date {
  const [year, month, day] = key.split("-").map(Number);
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0);
  // Two passes so zones that observe DST land on the right instant even when the
  // offset differs either side of local midnight. Asia/Kolkata never shifts.
  const firstGuess = naive - zoneOffsetMs(new Date(naive), timeZone);
  const refined = naive - zoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(refined);
}

/** Start of today, and the start of tomorrow, both as UTC instants. */
export function todayRange(timeZone: string = APP_TIMEZONE, now = new Date()) {
  const key = dayKey(now, timeZone);
  const start = startOfDayInZone(key, timeZone);
  const [year, month, day] = key.split("-").map(Number);
  const nextKey = dayKey(
    new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0)),
    "UTC"
  );
  return { key, start, end: startOfDayInZone(nextKey, timeZone) };
}

/** Local hour (0-23) in the zone — used to decide if it is morning there. */
export function hourInZone(date: Date, timeZone: string = APP_TIMEZONE): number {
  return partsInZone(date, timeZone).hour;
}
