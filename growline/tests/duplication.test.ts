import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVE_DAYS,
  MEASURED_DEPTH,
  MIN_TENURE_DAYS,
  WINDOW_DAYS,
  isActive,
  isEligible,
  requiredActiveDays,
  scoreLine,
  type Member,
} from "@/modules/duplication/score";
import {
  WHAT_IT_IS_NOT,
  WHAT_IT_MEANS,
  WHY_THE_BARS_DIFFER,
  anyoneActive,
  levelLabel,
  levelSentence,
  nextLevelCopy,
  noScoreCopy,
  peopleWord,
  readingOf,
  whereItStops,
} from "@/modules/duplication/reading";
import { duplicationScoreDocId } from "@/modules/duplication/docs";
import {
  availableDaysFor,
  currentWindow,
  membersByCoach,
  type Person,
} from "@/modules/duplication/line";

/**
 * Unit tests for the duplication score (F20).
 *
 * ## What these are defending
 *
 * The maths IS the feature here, and four of its properties would look completely
 * fine in review while being wrong in the way that matters:
 *
 *   scale       a score of 70 has to mean the same thing to a line of 6 and a line
 *               of 600. The exact guarantee is stated and tested below: an evenly
 *               active line scores its own activity rate exactly, at any size and
 *               any depth. Everything else about scale follows from that.
 *
 *   the         a line one level deep cannot duplicate, and must NOT be scored as
 *   beginner    though it failed at it. A coach whose four direct downlines all log
 *               scores 100. Anything else tells somebody in their first month that
 *               they have failed at something they have not started.
 *
 *   growth      a new joiner must not lower their upline's score. Without the
 *               tenure rule every referral arrives as an inactive body in a
 *               denominator, and the number that is supposed to reward growth
 *               punishes it instead.
 *
 *   the top     the coach's own logging cannot move their own duplication score. If
 *               it could, the one question this number answers stops being
 *               answerable, and the hardest-working coach in a dead line reads as
 *               the healthiest.
 *
 * The degenerate cases the brief names — a one-person line, a line where only the
 * root logs, a perfectly even line — are each worked by hand below with their
 * arithmetic written out, so a future change to the formula fails loudly rather
 * than quietly moving everybody's number.
 */

/** A member who has been in the line all window and logged `days` of it. */
const m = (userId: string, depth: number, days: number): Member => ({
  userId,
  depth,
  availableDays: WINDOW_DAYS,
  daysLogged: days,
});

/** `count` members at `depth`, of whom `active` are logging. */
function level(depth: number, count: number, active: number): Member[] {
  return Array.from({ length: count }, (_, i) =>
    m(`d${depth}_${i}`, depth, i < active ? ACTIVE_DAYS : 0)
  );
}

describe("the active bar", () => {
  test("a full window asks for roughly one day a week", () => {
    assert.equal(requiredActiveDays(WINDOW_DAYS), ACTIVE_DAYS);
    assert.equal(ACTIVE_DAYS, 4);
    assert.equal(WINDOW_DAYS, 28);
  });

  /**
   * Somebody who joined eight days ago has had eight days to find four in — twice
   * the rate everybody else is asked for. Pro-rating is what stops the newest people
   * in a line failing a harder test than the oldest.
   */
  test("the bar is pro-rated for somebody who has not been here the whole window", () => {
    assert.equal(requiredActiveDays(21), 3);
    assert.equal(requiredActiveDays(14), 2);
    assert.equal(requiredActiveDays(8), 1);
  });

  test("the bar never falls to zero, so nobody is active without logging", () => {
    assert.equal(requiredActiveDays(7), 1);
    assert.equal(requiredActiveDays(1), 1);
    assert.equal(requiredActiveDays(0), 1);
  });

  test("logging more than the bar counts the same as meeting it", () => {
    // Breadth, not intensity — the boards (F13) already rank how hard somebody goes.
    assert.equal(isActive(m("a", 1, ACTIVE_DAYS)), true);
    assert.equal(isActive(m("b", 1, WINDOW_DAYS)), true);
    assert.equal(isActive(m("c", 1, ACTIVE_DAYS - 1)), false);
  });

  test("a week in the line is the point at which somebody starts being counted", () => {
    assert.equal(isEligible({ ...m("a", 1, 0), availableDays: MIN_TENURE_DAYS }), true);
    assert.equal(
      isEligible({ ...m("a", 1, 0), availableDays: MIN_TENURE_DAYS - 1 }),
      false
    );
  });
});

describe("the degenerate lines named in the brief", () => {
  test("a one-person line has no score at all — never a zero", () => {
    const result = scoreLine([]);
    // A zero is a verdict on a line that exists. This is an absence of one, and the
    // screen teaches instead. Rendering null as 0 would tell a brand-new coach they
    // had failed at something they have not started.
    assert.equal(result.score, null);
    assert.equal(result.reason, "noLine");
    assert.deepEqual(result.levels, []);
    assert.equal(result.deepestLevel, null);
  });

  /**
   * The case the feature is named after. Four direct downlines, none of them
   * logging: pooled rate 0, so the shrinkage has nothing to pull toward and the
   * score is exactly 0. That sharpness is deliberate — "nobody below you logged"
   * deserves the one unambiguous number on the scale.
   */
  test("a line where only the root logs scores exactly zero", () => {
    const result = scoreLine(level(1, 4, 0));
    assert.equal(result.score, 0);
    assert.equal(result.reason, "ok");
    assert.equal(result.deepestActiveLevel, null);
  });

  test("a perfectly even line — everybody logging, every level — scores 100", () => {
    const result = scoreLine([...level(1, 3, 3), ...level(2, 6, 6), ...level(3, 9, 9)]);
    assert.equal(result.score, 100);
    assert.equal(result.deepestActiveLevel, 3);
    assert.equal(result.lineSize, 18);
  });

  /**
   * THE beginner case. One level, everybody on it working. Of the line that exists,
   * all of it is working, so the score says so. Capping by depth reached was
   * considered and rejected in score.ts: it would hand a coach in their first month
   * a 33 for a line that is doing everything it can.
   */
  test("a one-level line that is fully active scores 100, not a third of it", () => {
    const result = scoreLine(level(1, 4, 4));
    assert.equal(result.score, 100);
    assert.equal(result.deepestLevel, 1);
    // The depth reached is reported separately — real information, not a judgement.
    assert.equal(nextLevelCopy(result.deepestLevel),
      "Your line reaches 1 level today. Level 2 appears when somebody at level 1 brings in their own first person.");
  });
});

describe("scale — what makes 70 mean the same for a line of 6 and a line of 600", () => {
  /**
   * The exact invariant. When every depth has the same rate r, the pooled rate is
   * also r, so each shrunk rate is (n·r + α·r)/(n + α) = r identically and the
   * weights cancel. The score is 100r whatever the size and whatever the depth.
   */
  test("an evenly active line scores its own rate exactly, at any size", () => {
    const small = scoreLine([...level(1, 2, 1), ...level(2, 4, 2)]);
    const large = scoreLine([...level(1, 200, 100), ...level(2, 400, 200)]);
    const deep = scoreLine([...level(1, 2, 1), ...level(2, 6, 3), ...level(3, 10, 5)]);

    assert.equal(small.score, 50);
    assert.equal(large.score, 50);
    assert.equal(deep.score, 50);
  });

  test("the same holds at other rates, so the whole scale is size-stable", () => {
    assert.equal(scoreLine([...level(1, 4, 3), ...level(2, 8, 6)]).score, 75);
    assert.equal(scoreLine([...level(1, 400, 300), ...level(2, 800, 600)]).score, 75);
  });

  /**
   * Where size DOES matter, and why that is the honest answer rather than a defect.
   *
   * Four out of four at level 1 and none of four at level 2 scores 39; the same
   * rates over 400 people each score 33, which is the unshrunk depth-weighted mean.
   * The small line is pulled toward its own average because four people failing to
   * log is not yet evidence that a level has stopped. Promising exact equality here
   * would mean trusting one person out of one as much as four hundred out of four
   * hundred.
   */
  test("differing depths converge on the unshrunk mean as the line grows", () => {
    const unshrunk = (1 * 1 + 2 * 0) / 3; // 0.3333…
    const small = scoreLine([...level(1, 4, 4), ...level(2, 4, 0)]).score!;
    const large = scoreLine([...level(1, 400, 400), ...level(2, 400, 0)]).score!;

    assert.equal(small, 39);
    assert.equal(large, 33);
    assert.ok(
      Math.abs(large - unshrunk * 100) < Math.abs(small - unshrunk * 100),
      "a bigger line's structure should be trusted more, not less"
    );
  });

  /**
   * The shrinkage's EXACT LIMIT, pinned because score.ts once claimed the opposite.
   *
   * The prior is estimated from the same data as the observation, so with only one
   * populated depth m = k/n and â = (k + α·k/n)/(n + α) = k(n+α)/(n(n+α)) = k/n — the
   * raw rate, exactly, for every n and k. A one-level line is therefore scored
   * unshrunk, and a coach with a single downline can only ever score 0 or 100.
   *
   * This is a real property of the formula, not a defect to fix here: shrinking
   * toward anything other than the line's own pooled rate would break the exact
   * size-invariance above, which the whole scale rests on. It is pinned so that a
   * future change to α or to the prior fails loudly instead of quietly moving every
   * small line's number.
   */
  test("with only one populated depth the shrinkage is an exact no-op", () => {
    for (const n of [1, 2, 3, 5, 10, 37, 100]) {
      for (let k = 0; k <= n; k++) {
        const [only] = scoreLine(level(1, n, k)).levels;
        // The identity is exact in algebra; IEEE-754 evaluates the two sides by
        // different routes, so they can differ in the last bit (n=5, k=1 gives
        // 0.19999999999999998 against 0.2). A tolerance of one part in 10^12 is
        // twelve orders of magnitude tighter than the rounding to a whole score, so
        // it still fails loudly if a real prior is ever introduced.
        assert.ok(
          Math.abs(only.weighted - only.rate) < 1e-12,
          `n=${n} k=${k}: shrunk ${only.weighted} against raw ${only.rate}`
        );
      }
    }
  });

  test("so a single-downline line is all-or-nothing, and that is the common case", () => {
    assert.equal(scoreLine(level(1, 1, 0)).score, 0);
    assert.equal(scoreLine(level(1, 1, 1)).score, 100);
    // In the line the minimum tenure and no more, logging the one day the pro-rated
    // bar asks for: their upline reads 100.
    const barelyThere = scoreLine([
      { userId: "one", depth: 1, availableDays: MIN_TENURE_DAYS, daysLogged: 1 },
    ]);
    assert.equal(barelyThere.score, 100);
    assert.equal(barelyThere.lineSize, 1);
  });

  /**
   * Without shrinkage a single unlucky person at a small deep level would halve the
   * score of a line that is otherwise working everywhere. 50 → 80 is the whole
   * reason the pseudo-count exists — BETWEEN depths, which is the only place it acts.
   */
  test("one quiet person at a thin deep level cannot crater the score", () => {
    const result = scoreLine([
      ...level(1, 10, 10),
      ...level(2, 4, 4),
      ...level(3, 1, 0),
    ]);
    const unshrunk = Math.round((100 * (1 * 1 + 2 * 1 + 3 * 0)) / 6); // 50
    assert.equal(unshrunk, 50);
    assert.equal(result.score, 80);
  });
});

describe("depth — deeper counts for more, and only three levels are measured", () => {
  /**
   * The same overall activity, arranged two ways. Bottom-heavy scores higher because
   * work three levels down cannot be explained by the coach personally chasing
   * everybody, which is the one thing this number is trying to detect.
   */
  test("a bottom-heavy line outscores a top-heavy line with the same activity", () => {
    const topHeavy = scoreLine([...level(1, 4, 4), ...level(2, 4, 0)]);
    const bottomHeavy = scoreLine([...level(1, 4, 0), ...level(2, 4, 4)]);

    assert.equal(topHeavy.score, 39);
    assert.equal(bottomHeavy.score, 61);
    assert.ok(bottomHeavy.score! > topHeavy.score!);
  });

  test("levels below the third are not measured — they belong to their own upline", () => {
    const withFourth = scoreLine([
      ...level(1, 2, 2),
      ...level(2, 2, 2),
      ...level(3, 2, 2),
      ...level(4, 50, 0),
    ]);
    assert.equal(withFourth.score, 100);
    assert.equal(withFourth.lineSize, 6);
    assert.equal(withFourth.deepestLevel, MEASURED_DEPTH);
  });

  /**
   * The coach's own logging is not a parameter of `scoreLine`, and a depth of 0
   * passed in by mistake is ignored — so no future caller can quietly let a coach
   * lift their own duplication score by logging more themselves.
   */
  test("the coach's own row cannot enter their own score", () => {
    const line = level(1, 4, 0);
    const withSelf = scoreLine([...line, m("self", 0, WINDOW_DAYS)]);
    assert.equal(withSelf.score, 0);
    assert.equal(withSelf.lineSize, 4);
  });
});

describe("growth must never lower the score", () => {
  test("somebody who joined this week is waiting, not failing", () => {
    const settled = scoreLine(level(1, 4, 4));
    const withNewJoiner = scoreLine([
      ...level(1, 4, 4),
      { userId: "new", depth: 1, availableDays: 2, daysLogged: 0 },
    ]);

    assert.equal(settled.score, 100);
    assert.equal(withNewJoiner.score, 100);
    assert.equal(withNewJoiner.pendingCount, 1);
    assert.equal(withNewJoiner.lineSize, 4);
  });

  test("a line made entirely of this week's joiners has no score yet", () => {
    const result = scoreLine([
      { userId: "a", depth: 1, availableDays: 3, daysLogged: 0 },
      { userId: "b", depth: 1, availableDays: 1, daysLogged: 1 },
    ]);
    assert.equal(result.score, null);
    assert.equal(result.reason, "allTooNew");
    // Reported, not hidden: the coach can see two people are waiting.
    assert.equal(result.pendingCount, 2);
    assert.equal(result.deepestLevel, 1);
  });

  test("a new joiner who is already logging is still not counted early", () => {
    // Fairness runs both ways: the rule is about evidence, not about generosity.
    const result = scoreLine([
      ...level(1, 2, 0),
      { userId: "keen", depth: 1, availableDays: 3, daysLogged: 3 },
    ]);
    assert.equal(result.score, 0);
    assert.equal(result.pendingCount, 1);
  });
});

describe("the breakdown", () => {
  test("every level that holds anybody is reported, waiting people included", () => {
    const result = scoreLine([
      ...level(1, 3, 2),
      ...level(2, 2, 0),
      { userId: "new", depth: 3, availableDays: 1, daysLogged: 0 },
    ]);

    assert.deepEqual(
      result.levels.map((l) => [l.depth, l.people, l.active, l.pending]),
      [
        [1, 3, 2, 0],
        [2, 2, 0, 0],
        [3, 0, 0, 1],
      ]
    );
    // A level of nothing but new joiners does not enter the score, but it does
    // count toward how deep the line reaches.
    assert.equal(result.deepestLevel, 3);
    assert.equal(result.deepestActiveLevel, 1);
  });

  test("the stored weighted rate is the one that entered the score", () => {
    const result = scoreLine([...level(1, 4, 4), ...level(2, 4, 0)]);
    const weightSum = result.levels.reduce((s, l) => s + l.weight, 0);
    const recomputed = Math.round(
      (100 * result.levels.reduce((s, l) => s + l.weight * l.weighted, 0)) / weightSum
    );
    assert.equal(recomputed, result.score);
  });

  test("a score is always a whole number between 0 and 100", () => {
    for (const [n, active] of [[1, 0], [1, 1], [7, 3], [99, 98], [2, 1]]) {
      const s = scoreLine([...level(1, n, active), ...level(2, n, n - active)]).score!;
      assert.ok(Number.isInteger(s) && s >= 0 && s <= 100, `score ${s} out of range`);
    }
  });
});

describe("what the coach is told", () => {
  test("zero gets its own sentence — it is a different statement", () => {
    assert.equal(readingOf(0).band, "none");
    assert.equal(readingOf(1).band, "topHeavy");
    assert.equal(readingOf(33).band, "topHeavy");
    assert.equal(readingOf(34).band, "spreading");
    assert.equal(readingOf(66).band, "spreading");
    assert.equal(readingOf(67).band, "through");
    assert.equal(readingOf(100).band, "through");
  });

  /**
   * REGRESSION. The score is rounded to a whole number, so it reaches 0 whenever the
   * shrunk depth-weighted mean lands under 0.5 — which a large, nearly-dormant line
   * does with people still logging. Reading the "nobody logged" band off `score <= 0`
   * printed that sentence directly above a bar saying "1 of 300 people logged.", and
   * above a "where to look" line saying 299 of them had not. The band is a fact about
   * the levels now, not an inference from a rounded number.
   */
  test("a line that rounds to zero with somebody still logging is NOT told nobody logged", () => {
    const result = scoreLine(level(1, 300, 1));
    assert.equal(result.score, 0, "1 of 300 rounds to zero — that part is correct");
    assert.equal(result.deepestActiveLevel, 1, "somebody IS active");

    const reading = readingOf(result.score!, anyoneActive(result.levels));
    assert.equal(reading.band, "topHeavy");
    assert.doesNotMatch(reading.headline, /nobody/i);

    // ...and the breakdown printed underneath agrees with it rather than contradicting.
    assert.equal(levelSentence(result.levels[0]), "1 of 300 people logged.");
  });

  test("the same holds several levels down, where only a deep level is alive", () => {
    const result = scoreLine([
      ...level(1, 400, 0),
      ...level(2, 400, 3),
      ...level(3, 400, 0),
    ]);
    assert.equal(result.score, 0);
    assert.equal(anyoneActive(result.levels), true);
    assert.notEqual(readingOf(result.score!, anyoneActive(result.levels)).band, "none");
  });

  test("a genuinely dead line still gets the sentence that band exists for", () => {
    const result = scoreLine([...level(1, 4, 0), ...level(2, 4, 0)]);
    assert.equal(result.score, 0);
    assert.equal(anyoneActive(result.levels), false);
    const reading = readingOf(result.score!, anyoneActive(result.levels));
    assert.equal(reading.band, "none");
    assert.match(reading.headline, /Nobody in your line logged/);
  });

  /**
   * Nobody active always scores exactly 0 — every shrunk rate is (0 + α·0)/(n+α) — so
   * the one-argument default can never disagree with the fact. That is what makes it
   * safe for a caller that only has the number.
   */
  test("the default agrees with the fact whenever the fact is unavailable", () => {
    for (const [n, k] of [[1, 0], [4, 0], [30, 0], [300, 0]] as const) {
      const s = scoreLine(level(1, n, k)).score!;
      assert.equal(readingOf(s).band, "none");
    }
  });

  test("the shallowest level where nobody logged is the one named", () => {
    const result = scoreLine([...level(1, 3, 0), ...level(2, 3, 0)]);
    const stop = whereItStops(result.levels)!;
    // Level 2 is also dead, but the people who can reach it are at level 1 — so the
    // level to act on is the shallowest break, not the deepest.
    assert.equal(stop.depth, 1);
    assert.match(stop.sentence, /direct line/i);
  });

  test("with no hard break, the thinnest level is named with its shortfall", () => {
    const result = scoreLine([...level(1, 4, 4), ...level(2, 10, 3)]);
    const stop = whereItStops(result.levels)!;
    assert.equal(stop.depth, 2);
    assert.match(stop.sentence, /7 people/);
  });

  /** REGRESSION: this read "1 person there have not logged." */
  test("the shortfall sentence is grammatical at exactly one person", () => {
    const result = scoreLine([...level(1, 4, 4), ...level(2, 3, 2)]);
    const stop = whereItStops(result.levels)!;
    assert.match(stop.sentence, /1 person there has not logged\./);
    assert.doesNotMatch(stop.sentence, /person there have/);
  });

  test("a fully active line is told there is nothing to fix, not given a worry", () => {
    const result = scoreLine([...level(1, 3, 3), ...level(2, 3, 3)]);
    assert.equal(whereItStops(result.levels), null);
  });

  test("levels read correctly at one person", () => {
    assert.equal(peopleWord(1), "person");
    assert.equal(peopleWord(2), "people");
    assert.equal(
      levelSentence({
        depth: 1, people: 1, active: 1, pending: 0, rate: 1, weighted: 1, weight: 1,
      }),
      "1 of 1 person logged."
    );
    assert.match(levelLabel(1), /direct line/);
    assert.equal(levelLabel(3), "Level 3");
  });

  test("neither no-score case reads as a failure", () => {
    const banned = /fail|behind|poor|weak|bad|nobody cares/i;
    for (const reason of ["noLine", "allTooNew"] as const) {
      const copy = noScoreCopy(reason);
      assert.ok(!banned.test(`${copy.headline} ${copy.body}`), copy.headline);
    }
    assert.match(noScoreCopy("noLine").body, /invite link/i);
    assert.match(noScoreCopy("allTooNew").body, new RegExp(`${MIN_TENURE_DAYS} days`));
  });

  test("a line already three deep is not told about a fourth level", () => {
    // v1 §11 caps the tree at three, so promising a level 4 would promise a screen
    // that does not exist.
    assert.equal(nextLevelCopy(3), null);
    assert.equal(nextLevelCopy(null), null);
    assert.match(nextLevelCopy(2)!, /Level 3 appears/);
  });

  /**
   * RULES L4. A duplication score sitting beside a rupee figure or a trajectory is
   * an income projection with the arithmetic left to the reader, and this is one of
   * the two easiest screens in the app to break that on (the boards being the other).
   */
  test("no money, no earnings and no projection in any sentence this module says", () => {
    // Word-boundaried: an unanchored `rs\s` matches the tail of "appears", and a
    // check that fires on innocent prose is a check somebody deletes.
    const banned =
      /₹|\brs\.?\s|rupee|\bearn|income|salary|payout|commission|at this rate|on track to/i;
    const sentences = [
      WHAT_IT_MEANS,
      WHAT_IT_IS_NOT,
      WHY_THE_BARS_DIFFER,
      ...[0, 20, 50, 90].map((s) => readingOf(s).headline),
      readingOf(0, true).headline,
      noScoreCopy("noLine").headline,
      noScoreCopy("noLine").body,
      noScoreCopy("allTooNew").headline,
      noScoreCopy("allTooNew").body,
      nextLevelCopy(1)!,
      whereItStops(scoreLine([...level(1, 3, 0), ...level(2, 3, 1)]).levels)!.sentence,
      whereItStops(scoreLine([...level(1, 4, 4), ...level(2, 10, 3)]).levels)!.sentence,
      levelLabel(1),
      levelLabel(2),
    ];
    for (const text of sentences) {
      assert.ok(!banned.test(text), `"${text}" reads as money or a projection`);
    }
  });
});

describe("the window, and who is inside it", () => {
  /**
   * E1. India is UTC+5:30, so from 18:30 UTC it is already tomorrow in Bengaluru.
   * A window ending on the UTC day would drop the evening logs of the very day the
   * job is reporting on — every night it ran.
   */
  test("the window ends on the coach's today, not on UTC's", () => {
    const morning = currentWindow(new Date("2026-08-12T00:30:00Z")); // 06:00 IST
    const lateEvening = currentWindow(new Date("2026-08-11T19:00:00Z")); // 00:30 IST, 12th

    assert.equal(morning.toKey, "2026-08-12");
    assert.equal(lateEvening.toKey, "2026-08-12");
    assert.equal(morning.timeZone, "Asia/Kolkata");
  });

  test("the window is 28 days counting today, so both ends are included", () => {
    const w = currentWindow(new Date("2026-08-12T06:00:00Z"));
    assert.equal(w.fromKey, "2026-07-16");
    assert.equal(w.toKey, "2026-08-12");
    assert.equal(availableDaysFor(w.fromKey, w), WINDOW_DAYS);
  });

  test("somebody who joined before the window gets the whole window, never more", () => {
    const w = currentWindow(new Date("2026-08-12T06:00:00Z"));
    assert.equal(availableDaysFor("2024-01-01", w), WINDOW_DAYS);
  });

  test("somebody who joined inside it gets the days they were actually here", () => {
    const w = currentWindow(new Date("2026-08-12T06:00:00Z"));
    assert.equal(availableDaysFor("2026-08-05", w), 8);
    assert.equal(availableDaysFor("2026-08-12", w), 1);
  });

  test("a join date after the window closes counts as no days at all", () => {
    // Clock skew rather than a real case, but zero must fall out rather than a
    // negative day count quietly making somebody eligible.
    const w = currentWindow(new Date("2026-08-12T06:00:00Z"));
    assert.equal(availableDaysFor("2026-09-01", w), 0);
  });
});

describe("turning an organisation into one line per coach", () => {
  const person = (id: string, uplinePath: string[]): Person => ({
    id,
    uplinePath,
    availableDays: WINDOW_DAYS,
    daysLogged: ACTIVE_DAYS,
  });

  /**
   * `uplinePath` is nearest-ancestor-first (D36), so one person contributes to
   * several coaches' lines at once, at a different depth in each. One pass over the
   * organisation fills every line — no tree walk, no query per node.
   */
  test("one person lands in every ancestor's line at the right depth", () => {
    const lines = membersByCoach([person("chan", ["asha", "root"])]);

    assert.deepEqual(lines.get("asha")?.map((m) => m.depth), [1]);
    assert.deepEqual(lines.get("root")?.map((m) => m.depth), [2]);
  });

  test("only the first three ancestors are measured", () => {
    const lines = membersByCoach([person("deep", ["l1", "l2", "l3", "l4", "l5"])]);

    assert.equal(lines.get("l3")?.[0].depth, 3);
    // l4 and l5 are further up than the team tree ever renders. This person is
    // already counted — in l1's, l2's and l3's readings.
    assert.equal(lines.has("l4"), false);
    assert.equal(lines.has("l5"), false);
  });

  test("a coach with nobody below them has no line at all, not an empty one", () => {
    // `compute.ts` turns the absence into a DELETE, so a coach whose line moved away
    // stops reading a breakdown of a team that is no longer theirs.
    const lines = membersByCoach([person("root", []), person("asha", ["root"])]);
    assert.equal(lines.has("asha"), false);
    assert.equal(lines.get("root")?.length, 1);
  });

  test("the whole shape of a three-level tree comes out of one pass", () => {
    const lines = membersByCoach([
      person("asha", ["root"]),
      person("bhav", ["root"]),
      person("chan", ["asha", "root"]),
      person("dev", ["chan", "asha", "root"]),
    ]);

    assert.deepEqual(
      lines.get("root")!.map((m) => [m.userId, m.depth]),
      [["asha", 1], ["bhav", 1], ["chan", 2], ["dev", 3]]
    );
    assert.deepEqual(
      lines.get("asha")!.map((m) => [m.userId, m.depth]),
      [["chan", 1], ["dev", 2]]
    );
    // And the score that shape produces is a full house — everybody is logging.
    assert.equal(scoreLine(lines.get("root")!).score, 100);
  });
});

describe("document ids", () => {
  test("one document per coach, so a rerun overwrites rather than duplicating", () => {
    assert.equal(duplicationScoreDocId("usr_asha"), duplicationScoreDocId("usr_asha"));
    assert.notEqual(duplicationScoreDocId("usr_asha"), duplicationScoreDocId("usr_bhav"));
  });

  test("the id carries the uid, so the rule can name its subject", () => {
    assert.match(duplicationScoreDocId("usr_asha"), /usr_asha/);
  });
});
