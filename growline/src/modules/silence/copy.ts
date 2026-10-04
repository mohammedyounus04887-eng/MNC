import type { Assessment } from "./detect";

/**
 * What the silence alert actually says (session 4, feature 3).
 *
 * This file is the feature. The detection is arithmetic anyone could write; the reason
 * this is a good idea rather than a bad one is entirely in these sentences.
 *
 * ## The sentence has to survive being wrong
 *
 * Assume the alert is misfired. The coach was on their honeymoon, or in hospital, or
 * their phone was stolen — all of which look identical to "nobody logged". The upline
 * reads the notification anyway and rings them. Every sentence below is written so that
 * conversation starts well: the app reports a fact about its own records, states the
 * limit of what it knows, and suggests warmth rather than pressure.
 *
 * What that rules out, concretely:
 *
 *   - No fault language. Not "failed to log", not "inactive", not "dropped off".
 *   - No imperative. The upline is not instructed to do anything; "worth a call" is an
 *     observation they can ignore.
 *   - No exclamation marks. Urgency punctuation on somebody else's quiet week is the
 *     tonal difference between concern and a summons.
 *   - No number of days when the number is not known precisely (a dormant leg).
 *   - No income framing of any kind (L4). A quiet leg is quiet, never "costing" anyone
 *     anything — that sentence would be an income claim and a guilt trip at once.
 *
 * ## "A call, not a chase"
 *
 * The clause the whole feature turns on. Without it the notification is a productivity
 * dashboard telling a manager who is behind, which is a different product for a
 * different relationship. This audience's teams are built on people who already know
 * each other, and the app's job is to notice, not to enforce.
 */

/** One person's name in the possessive. "your team" when there is somehow no name. */
function possessive(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `${trimmed}'s` : "your";
}

function firstName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.split(/\s+/)[0] : "They";
}

/**
 * The notification body.
 *
 * Four variants, because two distinctions genuinely change the message.
 *
 * **One person or a team.** A single downline going quiet is about a person and reads
 * as such; a whole branch going quiet is about a team. Saying "nobody in Bhavana's
 * team" when Bhavana IS the team is the kind of small wrongness that makes an app feel
 * like it is talking about strangers.
 *
 * **A known number of days, or a long time.** A precise count is useful and actionable
 * at nine days. At four months it is false precision attached to something that needs a
 * different response entirely, so the number is dropped rather than stretched.
 *
 * Kept under ~100 characters: Android truncates a notification body, and a sentence cut
 * in half loses the second clause — which here is the clause that stops it reading as
 * an accusation.
 */
export function silenceBody(assessment: Assessment): string {
  const alone = assessment.legSize <= 1;
  const who = alone
    ? `${firstName(assessment.ownerName)} hasn't logged`
    : `Nobody in ${possessive(assessment.ownerName)} team has logged`;

  if (assessment.state === "dormant" || assessment.daysQuiet === null) {
    return `${who} in a long time. No pressure to act — just so you know.`;
  }

  const days = `${assessment.daysQuiet} days`;
  const nudge = alone ? "worth a hello, not a chase" : "worth a call, not a chase";
  return `${who} for ${days}. Might be nothing at all — ${nudge}.`;
}

/** Matches the existing morning reminder, so a coach's notifications look like one app. */
export const NOTIFICATION_TITLE = "Growline";

/**
 * Where tapping it lands: the team tree, which already shows who logged today and how
 * many times this month. No new screen, and nothing there names a prospect.
 */
export const NOTIFICATION_URL = "/team";

/** One tag per leg, so two quiet legs are two notifications rather than one replacing the other. */
export function notificationTag(legOwnerId: string): string {
  return `quiet-${legOwnerId}`;
}

/* ── Sentences for the record, and for anywhere this is explained ──────────── */

/**
 * The limit of what the app knows, stated in the app's own words.
 *
 * Kept as an export rather than a comment because the day this gets a settings toggle
 * or a help line, this is the sentence that goes next to it — and because a test can
 * read an export.
 */
export const WHAT_THE_APP_KNOWS =
  "Growline knows nobody logged. It does not know nobody worked — people travel, phones break, and a quiet week is not a difficult one.";

export const WHO_HEARS_IT =
  "Only you hear this. It does not travel further up the line, and the person it is about is not told they were mentioned.";

/** P1, in one line: what the alert carries and what it never could. */
export const WHAT_IT_CARRIES =
  "A name and a number of days. Nothing about anybody's prospects — those never leave the phone that captured them.";

export const HOW_OFTEN =
  "Once per quiet spell, and not again for a fortnight. A team that has been quiet for months is mentioned once, not every other week.";
