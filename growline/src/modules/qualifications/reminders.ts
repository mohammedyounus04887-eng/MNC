import type { Nudge } from "./progress";

/**
 * Escalating reminders (F14). PURE — bands and copy only; the sending loop is in
 * `send-reminders.ts` so this file can be unit-tested with no environment.
 *
 * ## What "escalating" means here, and what it does not
 *
 * It means the gaps get shorter as the deadline gets closer: a coach hears about a
 * qualification once when it is a fortnight away, again at a week, again at three
 * days, and again on the last day. Four messages over two weeks.
 *
 * It does NOT mean the tone gets louder. There is no "you are running out of time!",
 * no countdown timer, and nothing that implies a loss — RULES G2 bans fake scarcity,
 * and this is precisely the screen where scarcity would be easy and dishonest. The
 * urgency is carried by a true fact ("Last day") and a true number ("2 members away").
 *
 * ## Why the band is only a schedule, and the words come from the real number
 *
 * A band is a threshold for WHEN to send, never a label. Sending the band's own words
 * would tell a coach "3 days left" on a day when two remain, because the 3-day band
 * covers everything at or under three. So the lead line is derived from the actual
 * days left and is therefore always true.
 *
 * ## Nobody who has already qualified is reminded
 *
 * They have nothing left to do, and a notification that arrives after the good news
 * reads as the app not knowing. The celebration is the last thing a qualified coach
 * hears from this feature.
 *
 * ## RULES L4
 *
 * A reminder is the most forwarded, most screenshotted text this feature produces.
 * There is no currency in it, no earnings word, and no projection of what qualifying
 * is worth — only what is left to do.
 */

/**
 * Days-left thresholds, largest first.
 *
 * A band fires the first time `daysLeft` drops to or below it. Because days only
 * decrease, a band that has been passed can never become due again, so no bookkeeping
 * is needed beyond "have we sent this one".
 */
export const REMINDER_BANDS = [14, 7, 3, 1] as const;

export type ReminderBand = (typeof REMINDER_BANDS)[number];

export function bandId(band: ReminderBand): string {
  return `d${band}`;
}

/**
 * The band due at this many days left, or null when none is.
 *
 * Null above the widest band (too early to be nagging anybody) and at zero or below
 * (it has closed — the last thing a coach needs is a reminder about a deadline that
 * has passed).
 */
export function dueBand(daysLeft: number): ReminderBand | null {
  if (daysLeft <= 0) return null;
  let due: ReminderBand | null = null;
  for (const band of REMINDER_BANDS) {
    if (daysLeft <= band) due = band;
  }
  return due;
}

/** Always true of the day it is sent, whichever band scheduled it. */
export function leadFor(daysLeft: number): string {
  if (daysLeft <= 1) return "Last day";
  if (daysLeft === 7) return "1 week left";
  if (daysLeft === 14) return "2 weeks left";
  return `${daysLeft} days left`;
}

export type ReminderMessage = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

/**
 * The notification itself.
 *
 * `tag` is per qualification, so a later reminder REPLACES the earlier one on the
 * lock screen instead of stacking four near-identical cards — the same discipline the
 * follow-up reminder uses for the same reason.
 */
export function reminderMessage(
  qualificationId: string,
  title: string,
  daysLeft: number,
  nudge: Nudge
): ReminderMessage {
  return {
    title: "Growline",
    body: `${leadFor(daysLeft)} — ${title}. ${nudge.headline}`,
    url: `/qualifications/${qualificationId}`,
    tag: `qualification_${qualificationId}`,
  };
}
