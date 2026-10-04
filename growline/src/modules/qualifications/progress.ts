import {
  CRITERION_SPECS,
  formatAmount,
  type Criterion,
  type CriterionSpec,
  type CriterionType,
} from "./criteria";
import type { CriterionCounts, CriterionDropOff } from "./docs";

/**
 * Scoring: raw counts in, "what does this coach still need" out.
 *
 * PURE — no Firestore, no clock, no `new Date()`. Everything here is a function of
 * its arguments, which is what lets tests/qualifications.test.ts pin the two claims
 * this module makes that could quietly become untrue:
 *
 *   "one step away"  means EXACTLY ONE criterion is still unmet. Not "close on all
 *                    of them", not "nearly there", not a threshold somebody tuned.
 *                    The brief calls this out because it is what drives the last-week
 *                    surge, and a padded version of it is a lie told to the person
 *                    with the most at stake.
 *
 *   the label never   a coach with four conditions met and zero of two thousand
 *   travels alone     points is, by that definition, one step away — and is not
 *                     close. So the number ALWAYS travels with the label: every
 *                     place this app says "one step away" it also says how far, in
 *                     the criterion's own units. That is the honest fix, rather than
 *                     an arbitrary percentage that would decide for the reader.
 *
 * ## No money, ever (RULES L4)
 *
 * Counts and gaps. Nothing here multiplies a count by anything, projects a finish
 * date, or converts a point into an amount.
 */

export type CriterionState = {
  spec: CriterionSpec;
  target: number;
  /** What counts towards the target: the raw value less any baseline, never below 0. */
  done: number;
  /** Still needed. 0 once met. */
  remaining: number;
  met: boolean;
  /** Claimed but nobody has checked it. Never counted towards `done` (N4). */
  unchecked: number;
  /** How far along, 0–1. Used to order criteria across different units. */
  fraction: number;
};

export function stateOf(
  criterion: Criterion,
  values: CriterionCounts,
  baseline: CriterionCounts,
  unchecked: CriterionCounts
): CriterionState {
  const spec = CRITERION_SPECS[criterion.type];
  const raw = values[criterion.type] ?? 0;
  const base = baseline[criterion.type] ?? 0;
  /**
   * A cumulative criterion is measured from where the coach stood when they entered
   * (see criteria.ts). Clamped at zero because a validated total can legitimately go
   * DOWN — an upline asking for fresh proof puts an approved target back in the
   * unchecked column — and "-40 points" on a tracker is a number nobody can act on.
   */
  const done = Math.max(0, raw - base);
  const remaining = Math.max(0, criterion.target - done);
  return {
    spec,
    target: criterion.target,
    done,
    remaining,
    met: done >= criterion.target,
    unchecked: unchecked[criterion.type] ?? 0,
    fraction: criterion.target > 0 ? Math.min(1, done / criterion.target) : 1,
  };
}

export type Standing = {
  states: CriterionState[];
  metCount: number;
  /** Criteria still unmet. 0 = qualified, 1 = one step away. */
  stepsAway: number;
  qualified: boolean;
};

export function standingOf(
  criteria: Criterion[],
  values: CriterionCounts,
  baseline: CriterionCounts = {},
  unchecked: CriterionCounts = {}
): Standing {
  const states = criteria.map((c) => stateOf(c, values, baseline, unchecked));
  const metCount = states.filter((s) => s.met).length;
  return {
    states,
    metCount,
    stepsAway: states.length - metCount,
    // An empty criteria list would make everybody qualified on creation, which is
    // why `checkCriteria` refuses one. Belt and braces: no criteria, no qualification.
    qualified: states.length > 0 && metCount === states.length,
  };
}

/**
 * The unmet criterion this coach is nearest to clearing.
 *
 * Compared by FRACTION, not by the raw gap: 600 points and 2 members are not
 * comparable numbers, and picking the smaller of them would tell a coach who is 95%
 * of the way to a volume target that their nearest job is the members they have not
 * started. Ties go to the earlier criterion, so the sentence is stable between loads.
 */
export function closestUnmet(standing: Standing): CriterionState | null {
  let best: CriterionState | null = null;
  for (const s of standing.states) {
    if (s.met) continue;
    if (!best || s.fraction > best.fraction) best = s;
  }
  return best;
}

export type Nudge = {
  /** One line, in the words this audience uses (S6). */
  headline: string;
  /** A second line only when there is something specific to act on. */
  hint: string | null;
};

/**
 * The plain-language nudge — "2 members away".
 *
 * `daysLeft` counts today, so 1 means the last day and 0 means it has closed. The
 * copy names effort and never an outcome anybody was promised (L4): no earnings, no
 * "at this rate", and nothing that describes qualifying as income.
 */
export function nudgeFor(standing: Standing, daysLeft: number): Nudge {
  if (standing.qualified) {
    return {
      headline: "You are in.",
      hint: "Your name is on the qualifier list.",
    };
  }
  if (daysLeft <= 0) {
    return {
      headline: "This one has closed.",
      hint: "The next one starts from zero for everybody.",
    };
  }

  const closest = closestUnmet(standing);
  if (!closest) {
    // Unreachable while `qualified` is metCount === states.length, but a nudge that
    // throws is worse than one that says nothing useful.
    return { headline: "Keep going.", hint: null };
  }

  const gap = closest.spec.remaining(closest.remaining);
  const headline =
    standing.stepsAway === 1
      ? `${gap} and you are in.`
      : `${standing.stepsAway} conditions left — closest is ${gap}.`;

  /**
   * The unchecked hint exists because it is the one nudge that names a job somebody
   * else has to do. A coach sitting on 400 claimed-but-unapproved points is not
   * behind on the work, they are behind on the checking — and telling them to go and
   * meet more people would be the wrong instruction (G6: a mechanic that does not
   * drive the right behaviour is decoration).
   */
  if (closest.unchecked > 0) {
    return {
      headline,
      hint: `${formatAmount(closest.spec, closest.unchecked)} of yours are waiting to be checked. Ask your upline to look.`,
    };
  }
  return { headline, hint: closest.spec.howTo };
}

/**
 * The middle value, taking the LOWER of the two middles on an even count.
 *
 * Deliberately not a mean: one coach who has not started at all drags an average
 * towards a gap nobody actually has, and the number is being used to decide which
 * condition to talk about at a meeting. The lower middle is also a real participant's
 * gap rather than an invented half-a-member.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export type DropOffRow = { type: CriterionType; drop: CriterionDropOff };

/**
 * Per-criterion drop-off — which condition is actually blocking people.
 *
 * This is the point of the creator's dashboard, and a total-only summary ("14
 * qualified, 9 close") cannot answer it. `soleBlocker` is the number an upline acts
 * on: how many people would qualify TODAY if this one condition moved. A criterion
 * with a high `blocked` and a low `soleBlocker` is not the bottleneck — those people
 * are stuck on several things — and treating it as one wastes the meeting.
 */
export function dropOff(
  criteria: Criterion[],
  standings: Standing[]
): DropOffRow[] {
  return criteria.map((c) => {
    let met = 0;
    let soleBlocker = 0;
    const gaps: number[] = [];
    for (const standing of standings) {
      const state = standing.states.find((s) => s.spec.id === c.type);
      if (!state) continue;
      if (state.met) {
        met++;
        continue;
      }
      gaps.push(state.remaining);
      if (standing.stepsAway === 1) soleBlocker++;
    }
    return {
      type: c.type,
      drop: {
        met,
        blocked: gaps.length,
        soleBlocker,
        medianRemaining: median(gaps),
      },
    };
  });
}
