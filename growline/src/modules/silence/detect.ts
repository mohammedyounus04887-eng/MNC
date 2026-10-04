import { daysBetweenKeys, shiftKey } from "@/lib/daily-log";
import {
  LOOKBACK_DAYS,
  MAX_ALERTS_PER_RUN,
  QUIET_DAYS,
  REALERT_DAYS,
  type LegState,
  type SilenceAlertDoc,
} from "./model";

/**
 * Deciding whether a leg is quiet, and whether that is worth saying again (feature 3).
 *
 * PURE, and the whole judgement of the feature lives here. The scheduled route reads
 * documents and sends notifications; every decision about what counts as silence and
 * what counts as nagging is made by these two functions, against fixed day keys, under
 * unit test.
 *
 * ## Day keys, never instants (E1)
 *
 * Everything below compares "YYYY-MM-DD" strings in the coach's own zone. IST is
 * UTC+5:30, so a log written at 11pm on the 12th is a UTC instant on the 13th, and a
 * lookback computed from raw timestamps would count a day of silence that did not
 * happen — then say so to somebody's upline.
 */

/** One leg: a direct downline, and everyone below them. */
export type Leg = {
  ownerId: string;
  ownerName: string;
  /** The owner plus every descendant. Never their prospects — counts only (P1). */
  memberIds: string[];
  /** Day key of the earliest join in the leg. How long the leg has existed. */
  earliestJoinKey: string;
  /** Most recent day ANYBODY in the leg logged, within the lookback. Null if none. */
  lastLoggedKey: string | null;
};

export type Assessment = {
  ownerId: string;
  ownerName: string;
  state: LegState;
  legSize: number;
  /** Days since the last log. Null when nothing was found in the lookback. */
  daysQuiet: number | null;
  /** First day of this silence — the episode's identity. Null when dormant. */
  quietSinceKey: string | null;
};

/**
 * What a leg is doing.
 *
 * ## `tooNew` comes first, deliberately
 *
 * A leg whose earliest member joined four days ago cannot have been silent for seven,
 * and reporting it as quiet would be the app inventing a problem out of its own
 * arithmetic. This is checked BEFORE the log lookup so that a brand-new team — the most
 * fragile relationship an upline has, and the one most damaged by a misfired alert — is
 * never assessable at all.
 *
 * ## `dormant` is separated from `quiet` because they are different conversations
 *
 * "Nobody has logged for nine days" is a nudge. "Nobody has logged in months" is a
 * different fact about a different situation, and stating it with a precise day count
 * pretends to a precision the lookback does not have. It also gets different treatment
 * downstream: a dormant leg is mentioned once, not every fortnight forever.
 */
export function assessLeg(leg: Leg, todayKey: string): Assessment {
  const base = {
    ownerId: leg.ownerId,
    ownerName: leg.ownerName,
    legSize: leg.memberIds.length,
  };

  const legAgeDays = daysBetweenKeys(leg.earliestJoinKey, todayKey);
  if (legAgeDays < QUIET_DAYS) {
    return { ...base, state: "tooNew", daysQuiet: null, quietSinceKey: null };
  }

  if (leg.lastLoggedKey === null) {
    return { ...base, state: "dormant", daysQuiet: null, quietSinceKey: null };
  }

  const daysQuiet = daysBetweenKeys(leg.lastLoggedKey, todayKey);
  if (daysQuiet < QUIET_DAYS) {
    return { ...base, state: "active", daysQuiet, quietSinceKey: null };
  }

  // Beyond the lookback the exact number stops being meaningful, and the copy stops
  // quoting one. Both halves of that decision are made here so they cannot diverge.
  if (daysQuiet > LOOKBACK_DAYS) {
    return { ...base, state: "dormant", daysQuiet: null, quietSinceKey: null };
  }

  return {
    ...base,
    state: "quiet",
    daysQuiet,
    // The day AFTER the last log is the first day of the silence.
    quietSinceKey: shiftKey(leg.lastLoggedKey, 1),
  };
}

export type AlertDecision =
  | { send: true; reason: "first" | "newEpisode" | "cooldownPassed" }
  | { send: false; reason: "notQuiet" | "tooNew" | "alreadySaid" | "dormantAlreadySaid" };

/**
 * Whether this assessment is worth a notification right now.
 *
 * Three ways an alert is allowed out, and two ways it is held back. The held-back cases
 * are the ones that matter: a scheduled job with no memory sends the same sentence
 * every morning, and an upline who mutes Growline to stop it also loses the follow-up
 * reminder — so the nagging costs a feature that was working.
 *
 * **A new episode always gets through.** If the leg logged since the last alert and has
 * gone quiet again, that is a different fact and the fortnight cooldown does not apply
 * to it. Comparing the episode's first day rather than the alert's date is what makes
 * that distinction available at all.
 *
 * **A dormant leg is told once, and then only if it comes back to life.** A team that
 * has not logged in months does not become news again every fortnight; repeating it is
 * how the whole channel gets muted. The upline was told, and the team tree — which the
 * notification opens — shows the state whenever they choose to look.
 */
export function shouldAlert(
  assessment: Assessment,
  previous: SilenceAlertDoc | null,
  todayKey: string
): AlertDecision {
  if (assessment.state === "tooNew") return { send: false, reason: "tooNew" };
  if (assessment.state === "active") return { send: false, reason: "notQuiet" };

  if (!previous) return { send: true, reason: "first" };

  // Same episode? For a dormant leg both sides are null, which is what makes "still
  // dormant" indistinguishable from "dormant again" — correctly, since nothing changed.
  const sameEpisode = previous.quietSinceKey === assessment.quietSinceKey;
  if (!sameEpisode) return { send: true, reason: "newEpisode" };

  if (assessment.state === "dormant") {
    return { send: false, reason: "dormantAlreadySaid" };
  }

  const sinceLast = daysBetweenKeys(previous.lastAlertedKey, todayKey);
  return sinceLast >= REALERT_DAYS
    ? { send: true, reason: "cooldownPassed" }
    : { send: false, reason: "alreadySaid" };
}

/**
 * Which of one upline's eligible legs are actually mentioned this morning.
 *
 * Shortest silence first — see `MAX_ALERTS_PER_RUN` for why that is the right way
 * round. Dormant legs, which have no day count, sort last: they are the least
 * recoverable and the least urgent to raise today.
 *
 * Pure and generic over the carrier so the route can hand it whatever it is holding,
 * and so the choice itself is unit-tested rather than being an incidental `.slice()`
 * buried in a loop.
 */
export function pickForOneRun<T extends { assessment: Assessment }>(
  eligible: T[],
  max: number = MAX_ALERTS_PER_RUN
): T[] {
  return [...eligible]
    .sort((a, b) => {
      const av = a.assessment.daysQuiet ?? Number.POSITIVE_INFINITY;
      const bv = b.assessment.daysQuiet ?? Number.POSITIVE_INFINITY;
      // Stable by owner id when the counts tie, so two runs on one morning agree.
      return av - bv || a.assessment.ownerId.localeCompare(b.assessment.ownerId);
    })
    .slice(0, max);
}
