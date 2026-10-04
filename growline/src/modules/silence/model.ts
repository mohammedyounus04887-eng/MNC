/**
 * The silence alert (session 4, feature 3) — constants, shapes and document ids.
 *
 * PURE. `detect.ts` and `copy.ts` import from here and are unit-tested against fixed
 * dates; nothing in this file touches `firebase-admin`.
 *
 * ## What the feature is, stated carefully
 *
 * When nobody in one of an upline's legs has logged for a week, the upline is told.
 * That is the accountability loop v1 §6 F6 describes, closed at the point it actually
 * breaks: not when a coach misses a day, but when a whole branch of a team goes quiet
 * and nobody upstream notices for a month.
 *
 * ## The failure mode this is designed around
 *
 * An alert that fires while a coach is on holiday, and reads as an accusation, is worse
 * than no alert at all. It costs the upline's trust in the app AND the downline's trust
 * in the upline, and the second one is not recoverable by a bug fix. Four things follow,
 * and each is implemented rather than merely intended:
 *
 *   1. **The copy never states or implies fault** (`copy.ts`, with a test that greps
 *      for accusatory language). The app knows nobody logged. It does not know nobody
 *      worked, and it says so.
 *   2. **It never repeats quickly.** One alert per episode, and a fortnight before the
 *      same continuing silence is mentioned again — so even a wrong alert is a single
 *      remark rather than a drumbeat.
 *   3. **A leg with no history is not assessable.** A team that has existed for three
 *      days cannot have been quiet for seven, and is silently skipped.
 *   4. **Only the DIRECT upline hears it.** Not the whole ancestry. A coach's quiet
 *      fortnight becoming their grandparent-upline's business is how an alert turns
 *      into a report card, and the person who should ring them is the person who knows
 *      them.
 */

/** A week. Long enough that a busy stretch is not an event; short enough to act on. */
export const QUIET_DAYS = 7;

/**
 * How far back logs are read. Beyond this the answer is "not in a long time", which is
 * a different message and does not need a precise number attached to it.
 */
export const LOOKBACK_DAYS = 60;

/**
 * The same continuing silence is not mentioned again for a fortnight.
 *
 * A weekly repeat is how an upline learns to swipe the notification away, and they
 * cannot swipe away only this one — muting it costs them the follow-up reminders too.
 */
export const REALERT_DAYS = 14;

/**
 * At most two of an upline's legs are mentioned in one run.
 *
 * An upline with twelve direct downlines and six quiet legs would otherwise get six
 * notifications in one morning. Two names is somebody to ring; six is a report, and a
 * report arriving as six lock-screen buzzes gets the whole channel muted — which costs
 * them the follow-up reminder too, because a coach cannot mute one Growline
 * notification and keep another.
 *
 * The two chosen are the ones quiet for the SHORTEST time, which is the opposite of
 * what a dashboard would rank. A leg quiet for eight days is a conversation that can
 * still be picked up; one quiet for fifty is a different problem that a call this
 * morning will not solve. The rest are not recorded as alerted, so they surface on
 * later runs rather than being swallowed.
 */
export const MAX_ALERTS_PER_RUN = 2;

/**
 * The collection. New; written ONLY by the scheduled route through the Admin SDK, and
 * readable by no client at all (see the rule for why).
 *
 * Deviation recorded: this is a sixth collection beyond the four these branches were
 * scoped to, and the second added by session 4. A scheduled alert with no memory of
 * what it has already said would send the same notification every morning, which is the
 * failure this whole module is written to avoid — so the memory is not optional.
 */
export const SILENCE_ALERTS = "silenceAlerts";

/** One row per (upline, leg). The pair IS the identity, so it is the id (D35). */
export function silenceAlertDocId(uplineId: string, legOwnerId: string): string {
  if (!uplineId || !legOwnerId || uplineId.includes("/") || legOwnerId.includes("/")) {
    throw new Error("Invalid silenceAlert document id");
  }
  return `${uplineId}__${legOwnerId}`;
}

/**
 * What a leg is doing, as far as the logs can tell.
 *
 *   active   somebody logged inside the window. Nothing to say.
 *   quiet    nobody has logged for a known number of days, and somebody did before.
 *   dormant  nobody has logged in the whole lookback. The number is not worth stating.
 *   tooNew   the leg has not existed long enough to have been quiet. Not assessable.
 */
export const LEG_STATES = ["active", "quiet", "dormant", "tooNew"] as const;
export type LegState = (typeof LEG_STATES)[number];

/** The stored memory of what was already said about one leg. */
export type SilenceAlertDoc = {
  uplineId: string;
  legOwnerId: string;
  /** The day the alert was last sent, in the app timezone. */
  lastAlertedKey: string;
  /**
   * The first day of the silence the alert was about — the episode's identity.
   *
   * Null for a dormant leg, where there is no known first day. Comparing this rather
   * than the alert date is what lets a leg that came back to life and went quiet again
   * be told about immediately, while a continuing silence waits out the cooldown.
   */
  quietSinceKey: string | null;
  lastState: LegState;
  legSize: number;
};
