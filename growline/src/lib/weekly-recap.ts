import { Timestamp } from "firebase-admin/firestore";
import { dailyLogs, prospects } from "./collections";
import { APP_TIMEZONE, startOfDayInZone } from "./day";
import { shiftKey, todayKey } from "./daily-log";

/**
 * The Weekly Recap (v2 §4, dopamine map #6) — "the brag loop".
 *
 * A shareable summary of the week, so the coach's own pride becomes Growline's
 * marketing. The numbers are counts of work done, never earnings: RULES L4 and
 * D30 apply here exactly as they do on the targets screen, and a "your week was
 * worth ₹X" card would be the single most shareable violation the app could
 * produce.
 */

export type WeeklyRecap = {
  from: string;
  to: string;
  peopleMet: number;
  invites: number;
  memberships: number;
  sessions: number;
  streak: number;
  /** True when the week is empty — there is nothing to brag about yet. */
  empty: boolean;
};

export async function getWeeklyRecap(
  userId: string,
  streak: number,
  timeZone: string = APP_TIMEZONE,
  now = new Date()
): Promise<WeeklyRecap> {
  const to = todayKey(timeZone, now);
  const from = shiftKey(to, -6); // seven days inclusive

  const [logSnap, metSnap] = await Promise.all([
    dailyLogs()
      .where("userId", "==", userId)
      .where("dayKey", ">=", from)
      .where("dayKey", "<=", to)
      .get(),
    // Prospects carry a timestamp rather than a day key, so this one is a range
    // on createdAt — built from the local day boundary, not `new Date()` (E1).
    prospects()
      .where("coachId", "==", userId)
      .where("createdAt", ">=", Timestamp.fromDate(startOfDayInZone(from, timeZone)))
      .count()
      .get(),
  ]);

  let invites = 0;
  let memberships = 0;
  let sessions = 0;
  for (const doc of logSnap.docs) {
    const d = doc.data();
    invites += d.invites ?? 0;
    memberships += d.memberships ?? 0;
    sessions += d.sessions ?? 0;
  }
  const peopleMet = metSnap.data().count;

  return {
    from,
    to,
    peopleMet,
    invites,
    memberships,
    sessions,
    streak,
    empty: peopleMet === 0 && invites === 0 && memberships === 0 && sessions === 0,
  };
}

/*
 * There WAS a private `startOfLocalDay` here, whose comment claimed it was "the D26
 * rule, reused". It was not reused — it was a second implementation, and it was wrong
 * in a way that only shows up on some machines:
 *
 *   const asLocal = new Date(guess.toLocaleString("en-US", { timeZone }));
 *
 * `toLocaleString` renders the wall clock in `timeZone`; `new Date(string)` then parses
 * that back in the HOST PROCESS's timezone. The two only agree when the host is UTC. On
 * an IST host it returned 2026-08-10T00:00:00Z for "2026-08-10" instead of the correct
 * 2026-08-09T18:30:00Z — five and a half hours late.
 *
 * That instant is the lower bound of the `prospects.createdAt` range below, so the
 * Weekly Recap silently dropped every prospect captured between midnight and 05:30 IST
 * on the first day of the week — under-reporting the number on the card a coach shares
 * to WhatsApp Status.
 *
 * This is exactly what RULES E1 exists to prevent, reintroduced in a private copy. The
 * lesson is the rule as written: go through `day.ts`. A duplicate that is "obviously
 * equivalent" is how the first one got in.
 */
/**
 * The share text.
 *
 * Counts and a streak. No currency, no rank, no company name (L1, L4) — this
 * string is the one piece of the app most likely to be screenshotted and
 * forwarded, so it is also the one most likely to be read by a regulator.
 */
export function recapShareText(r: WeeklyRecap): string {
  const parts: string[] = [];
  if (r.peopleMet) parts.push(`${r.peopleMet} people met`);
  if (r.invites) parts.push(`${r.invites} invited`);
  if (r.memberships) parts.push(`${r.memberships} joined`);
  if (r.sessions) parts.push(`${r.sessions} sessions`);
  if (r.streak) parts.push(`streak ${r.streak} 🔥`);
  return `My week: ${parts.join(" · ")}`;
}
