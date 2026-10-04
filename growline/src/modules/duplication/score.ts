/**
 * The duplication score (F20) — the maths, and nothing else.
 *
 * PURE. No Firestore, no Node built-ins, no `new Date()` (E1, E2). Everything here
 * takes day counts that somebody else worked out in the coach's own timezone, so this
 * file can be unit-tested against hand-worked examples and imported by a client
 * component without dragging firebase-admin into the browser bundle.
 *
 * ============================================================================
 * THE QUESTION
 * ============================================================================
 *
 * One number, answering one thing: **is the work happening only at the top, or
 * genuinely three levels deep?**
 *
 * It is built from the SHARE OF ACTIVE LOGGERS AT EACH DEPTH of a line, over a
 * rolling window, and it is deliberately not built from anything else. The
 * per-depth breakdown that produced it is stored beside it and rendered with it —
 * a score with no breakdown is a number nobody can act on, and this feature exists
 * to be acted on.
 *
 * ============================================================================
 * THE FORMULA
 * ============================================================================
 *
 * For each depth d below the coach (d = 1, 2, 3):
 *
 *     n_d  people at that depth who have been in the line long enough to count
 *     k_d  how many of those are ACTIVE (see "Active", below)
 *
 * The line's own pooled rate, across every depth:
 *
 *     m = (Σ k_d) / (Σ n_d)
 *
 * Each depth's rate is then SHRUNK toward that pooled rate by a pseudo-count α:
 *
 *     â_d = (k_d + α·m) / (n_d + α)                          α = SHRINKAGE = 2
 *
 * And the score is the depth-weighted mean of those, over the depths that EXIST:
 *
 *     score = 100 · ( Σ d·â_d ) / ( Σ d )      over every d where n_d > 0
 *
 * ----------------------------------------------------------------------------
 * Why the weight is the depth itself
 * ----------------------------------------------------------------------------
 *
 * Activity at level 1 can be explained by the coach personally chasing every one of
 * their direct downlines. Activity at level 3 cannot — those are people the coach
 * has very likely never rung. So the deeper the level, the more it counts, in the
 * simplest ratio that says so: level 3 activity is worth three times level 1
 * activity. A top-heavy line and a bottom-heavy line with the same overall activity
 * therefore do NOT score the same, which is the entire point of the number.
 *
 * ----------------------------------------------------------------------------
 * Why the shrinkage, and what makes 70 mean the same for a line of 6 and of 600
 * ----------------------------------------------------------------------------
 *
 * Four things, in order of how much work they do:
 *
 * 1. **Every input is a RATE, never a count.** A line of 600 has more active loggers
 *    than a line of 6 by construction, so any score built on counts would just be a
 *    size ranking wearing a different name.
 *
 * 2. **The divisor is the depths that exist, not the people.** Σd over the present
 *    depths is 1, 3 or 6 — it never touches line size, so one enormous level 1
 *    cannot drown out a small level 3, and a small line is not scored against a
 *    denominator built for a big one.
 *
 * 3. **Shrinkage stops one thin level from swinging the score — BETWEEN depths only.**
 *    Pulling each depth toward the line's OWN pooled rate says the honest thing: one
 *    person having a bad month is not evidence that a level has stopped duplicating.
 *    A line that is 10-of-10, 4-of-4 and 0-of-1 scores 80 rather than the 50 the raw
 *    depth-weighted mean would give it, and that is the whole reason α exists.
 *
 *    **Its exact limit, because it is not obvious and was once written down wrong
 *    here:** when only ONE depth is populated, the shrinkage is an algebraic no-op.
 *    The prior is estimated from the same data as the observation, so with a single
 *    depth m = k₁/n₁ and
 *
 *        â₁ = (k₁ + α·k₁/n₁)/(n₁ + α) = k₁(n₁ + α) / (n₁(n₁ + α)) = k₁/n₁
 *
 *    — the raw rate, exactly, for every α, every n₁ and every k₁. So a one-level line
 *    is scored on its unshrunk rate, and a coach with a single downline can only ever
 *    score 0 or 100. A downline in the line seven days who logged one single day
 *    scores their upline 100.
 *
 *    That is a real consequence and most coaches in a pilot club are one level deep,
 *    so it is the common case, not a corner. It is left as it is rather than papered
 *    over: the alternative — shrinking toward a fixed constant, or toward the whole
 *    ORGANISATION's rate — would destroy the exact size-invariance in point 4 below,
 *    which is the property the whole scale is built on, and would judge a small line
 *    against other people's numbers. The honest fix is in the words, not the formula:
 *    the screen states how many people the reading covers, and a 100 over one person
 *    is a 100 over one person.
 *
 * 4. **The exact invariant.** If every depth has the same rate r, then m = r and
 *    every â_d = r identically — so the score is exactly 100r, at any line size and
 *    any number of depths. A line that is uniformly half active scores 50 whether it
 *    holds 6 people or 600. That is the guarantee, and it is what "the same thing"
 *    means here.
 *
 * What this deliberately does NOT promise: that two lines with the same per-depth
 * rates but different sizes score identically when those rates DIFFER between
 * depths. They converge as the line grows — a big line's structure is trusted, a
 * small one's is pulled toward its own average. Promising exact equality there would
 * mean trusting one person out of one as much as two hundred out of two hundred.
 *
 * Note what that does NOT buy, since the two are easy to confuse: it damps a thin
 * level against the OTHER levels of the same line, and it does nothing whatever to
 * the overall level of a line that has only one depth. See point 3 above — a single
 * coach who logged once still hands their upline a 100. Shrinking toward a
 * self-estimated prior cannot prevent that, and this file used to claim it did.
 *
 * ----------------------------------------------------------------------------
 * A line that is only one level deep
 * ----------------------------------------------------------------------------
 *
 * It is scored on the levels it HAS. A coach with four direct downlines who are all
 * logging scores 100, and that is not a bug: of the line that exists, all of it is
 * working. The alternative — capping the score by depth reached, so one level can
 * never beat 33 — was considered and rejected outright. It would tell a coach in
 * their first month that they have failed at something they have not had the chance
 * to start, which is exactly the reading this number must never produce.
 *
 * The depth a line actually reaches is reported SEPARATELY and prominently
 * (`deepestLevel`), because that is real information — it just is not a judgement.
 *
 * ----------------------------------------------------------------------------
 * Three levels, not the whole ancestry
 * ----------------------------------------------------------------------------
 *
 * `uplinePath` (D36) carries every ancestor, so measuring ten levels down would cost
 * nothing extra. We measure exactly THREE, for two reasons:
 *
 *   - v1 §11 caps the team tree at three levels, so level 4 is people the coach
 *     cannot see on any screen in this app. A number that moves because of people a
 *     coach cannot look up is a number they cannot act on.
 *   - the question is literally "is it three levels deep". Level 4 activity is
 *     already counted — in the score belonging to the coach it sits three levels
 *     under. Every coach's own line is measured once, by them.
 *
 * ----------------------------------------------------------------------------
 * No money, ever (RULES L4)
 * ----------------------------------------------------------------------------
 *
 * Every quantity in this file is a count of people or a count of days. Nothing is
 * multiplied by a rupee figure, converted, extrapolated or projected forward. There
 * is no "at this rate" anywhere, and there must never be: a duplication score sitting
 * next to a growth curve is an income projection with the arithmetic left to the
 * reader.
 */

/**
 * The rolling window: four whole weeks.
 *
 * 28 rather than 30 because it contains exactly four of every weekday. This audience
 * works to a weekly rhythm — clubs on the same evenings, the walk on the same
 * mornings — and a 30-day window holds five Mondays and four Tuesdays, so the score
 * would rise and fall with which day the job happened to run. 28 makes consecutive
 * runs comparable.
 */
export const WINDOW_DAYS = 28;

/**
 * Days logged in a full window before a coach counts as active: roughly one a week.
 *
 * Deliberately a LOW bar. This number measures whether the work is happening at
 * depth, not how hard anybody is going — and the boards (F13) already rank
 * intensity. A coach who logged 4 days and one who logged 28 count exactly the same
 * here, so a line cannot lift its duplication score by having one heroic person at
 * the top do more; only by having MORE PEOPLE doing something.
 */
export const ACTIVE_DAYS = 4;

/**
 * How long somebody must have been in the line before they are counted at all.
 *
 * A full week. Judging a person's habit on their third day measures our onboarding,
 * not their duplication — and without this rule every new joiner would arrive as an
 * inactive body in a denominator and drag their upline's score down. Growth would
 * lower the number that is supposed to reward it, which would make the score
 * actively harmful to look at.
 *
 * They are not hidden: the breakdown reports them as waiting, so the coach can see
 * that three people joined this week and none of them are being judged yet.
 */
export const MIN_TENURE_DAYS = 7;

/** v1 §11 caps the tree at three levels; see the header. */
export const MEASURED_DEPTH = 3;

/**
 * The shrinkage pseudo-count, in people.
 *
 * Two, meaning a level of two people is weighted half on what those two did and half
 * on the rest of the line. Two is the smallest group where "both did / neither did"
 * is not one person's bad fortnight, which is exactly where the line between noise
 * and evidence belongs.
 */
export const SHRINKAGE = 2;

/**
 * The bar for a coach who has not been in the line for the whole window.
 *
 * Pro-rated, with a floor of one day. Somebody who joined eight days ago has had
 * eight days to find four in, which is twice the rate the bar asks of everyone else
 * — so without this, the newest people in a line would fail a harder test than the
 * oldest, and a growing line would score worse than a static one.
 */
export function requiredActiveDays(availableDays: number): number {
  const capped = Math.min(WINDOW_DAYS, Math.max(0, availableDays));
  return Math.max(1, Math.round((ACTIVE_DAYS * capped) / WINDOW_DAYS));
}

/** One person in somebody's line, reduced to the four numbers the score needs. */
export type Member = {
  userId: string;
  /** Levels below the coach this score is about. 1 = their direct line. */
  depth: number;
  /** Days of the window this person has actually been in the line, capped at it. */
  availableDays: number;
  /** Distinct days they logged inside the window. */
  daysLogged: number;
};

/** Long enough in the line to be judged. See MIN_TENURE_DAYS. */
export function isEligible(m: Member): boolean {
  return m.availableDays >= MIN_TENURE_DAYS;
}

/** Working, by the low bar this score uses. See ACTIVE_DAYS. */
export function isActive(m: Member): boolean {
  return m.daysLogged >= requiredActiveDays(m.availableDays);
}

export type LevelResult = {
  depth: number;
  /** Eligible people at this depth. */
  people: number;
  /** How many of them are active. */
  active: number;
  /** People at this depth who joined too recently to be counted yet. */
  pending: number;
  /** The plain share, `active / people`. What the breakdown renders. */
  rate: number;
  /** The shrunk rate that actually entered the score. Stored so it is auditable. */
  weighted: number;
  /** The depth weight applied to it. */
  weight: number;
};

/**
 * Why there is no score, when there is none.
 *
 *   ok         there is one
 *   noLine     nobody below this coach at all — nothing has started, so nothing is
 *              being judged. Never a zero: a zero is a verdict, and this is an
 *              absence.
 *   allTooNew  there are people, and every one of them joined in the last week.
 */
export type ScoreReason = "ok" | "noLine" | "allTooNew";

export type ScoreResult = {
  /** 0–100, or null. Null is never rendered as zero — see ScoreReason. */
  score: number | null;
  reason: ScoreReason;
  /** Every depth that holds anybody, counted or waiting. Shallowest first. */
  levels: LevelResult[];
  /** Eligible people across the measured depths. */
  lineSize: number;
  /** People excluded for having joined in the last week. */
  pendingCount: number;
  /** How many levels the line reaches, counting waiting people. */
  deepestLevel: number | null;
  /** The deepest level anybody is active at — how far down the work reaches. */
  deepestActiveLevel: number | null;
};

/**
 * The score for one coach's line.
 *
 * Takes ONLY the people below them. The coach's own logging is not a parameter and
 * cannot be: a coach who logs every day of the month has done nothing about their
 * duplication, and letting their own diligence lift this number would make the one
 * question it answers unanswerable. Their own activity is shown beside the score as
 * context and is kept out of the arithmetic.
 *
 * Anything outside depths 1..MEASURED_DEPTH is ignored — including a depth of 0, so
 * passing the subject in by mistake cannot quietly change their own score.
 */
export function scoreLine(members: Member[]): ScoreResult {
  const tally = new Map<number, { people: number; active: number; pending: number }>();
  for (const m of members) {
    if (m.depth < 1 || m.depth > MEASURED_DEPTH) continue;
    const row = tally.get(m.depth) ?? { people: 0, active: 0, pending: 0 };
    if (!isEligible(m)) row.pending += 1;
    else {
      row.people += 1;
      if (isActive(m)) row.active += 1;
    }
    tally.set(m.depth, row);
  }

  const depths = [...tally.keys()].sort((a, b) => a - b);
  let lineSize = 0;
  let activeTotal = 0;
  let pendingCount = 0;
  for (const d of depths) {
    const row = tally.get(d)!;
    lineSize += row.people;
    activeTotal += row.active;
    pendingCount += row.pending;
  }

  // The prior each depth is pulled toward: the line's own overall rate, not a
  // constant. A quiet line is not shrunk toward some imagined healthy average.
  const pooled = lineSize > 0 ? activeTotal / lineSize : 0;

  const levels: LevelResult[] = depths.map((depth) => {
    const row = tally.get(depth)!;
    return {
      depth,
      people: row.people,
      active: row.active,
      pending: row.pending,
      rate: row.people > 0 ? row.active / row.people : 0,
      weighted:
        row.people > 0
          ? (row.active + SHRINKAGE * pooled) / (row.people + SHRINKAGE)
          : 0,
      weight: depth,
    };
  });

  const deepestLevel = depths.length > 0 ? depths[depths.length - 1] : null;
  const activeDepths = levels.filter((l) => l.active > 0).map((l) => l.depth);
  const deepestActiveLevel =
    activeDepths.length > 0 ? activeDepths[activeDepths.length - 1] : null;

  const counted = levels.filter((l) => l.people > 0);
  if (counted.length === 0) {
    return {
      score: null,
      reason: pendingCount > 0 ? "allTooNew" : "noLine",
      levels,
      lineSize,
      pendingCount,
      deepestLevel,
      deepestActiveLevel,
    };
  }

  const weightSum = counted.reduce((sum, l) => sum + l.weight, 0);
  const weighted = counted.reduce((sum, l) => sum + l.weight * l.weighted, 0);
  const score = Math.min(100, Math.max(0, Math.round((100 * weighted) / weightSum)));

  return {
    score,
    reason: "ok",
    levels,
    lineSize,
    pendingCount,
    deepestLevel,
    deepestActiveLevel,
  };
}
