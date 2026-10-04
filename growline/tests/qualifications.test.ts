import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  closesAt,
  dayLabel,
  daysLeft,
  isDayKey,
  makeWindow,
  monthsInWindow,
  windowInstants,
} from "@/modules/shared-new/window";
import { checkText, hasVisibleText } from "@/modules/shared-new/text";
import {
  CRITERION_SPECS,
  CRITERION_TYPES,
  baselineTypes,
  checkCriteria,
  formatAmount,
  isValidTarget,
  needsBaseline,
} from "@/modules/qualifications/criteria";
import {
  MAX_DEADLINE_DAYS,
  checkDefinition,
  inAudience,
} from "@/modules/qualifications/model";
import {
  closestUnmet,
  dropOff,
  median,
  nudgeFor,
  standingOf,
  stateOf,
} from "@/modules/qualifications/progress";
import {
  REMINDER_BANDS,
  bandId,
  dueBand,
  leadFor,
  reminderMessage,
} from "@/modules/qualifications/reminders";
import {
  progressDocId,
  qualificationDocId,
  summaryDocId,
} from "@/modules/qualifications/ids";

/**
 * Unit tests for event qualifications (F14).
 *
 * ## What these are actually defending
 *
 * Four claims, each of which would look fine in review and be quietly wrong:
 *
 *   "one step away"    means EXACTLY ONE condition is unmet, and the number always
 *                      travels with the phrase. The brief singles this out because it
 *                      drives the last-week surge, and the padded version of it is a
 *                      lie told to the person with the most at stake. A coach with
 *                      four conditions met and zero of two thousand points IS one step
 *                      away and is NOT close — so the tests demand the gap, not a
 *                      threshold somebody tuned.
 *
 *   the closest        is chosen by FRACTION, not by the raw gap. 600 points and 2
 *   condition          members are not comparable numbers, and sorting them as numbers
 *                      would send a coach at 95% of a volume target off to do the
 *                      thing they have not started.
 *
 *   the reminder       is scheduled by a band and WORDED from the real day count. The
 *   never lies         three-day band covers everything at or under three, so a
 *                      reminder that used the band's own words would say "3 days left"
 *                      on a day when two remain.
 *
 *   the copy tables    carry RULES L4. A qualification is one of the two easiest
 *                      screens in this app on which to write "₹" or "what this is
 *                      worth", so the strings are asserted rather than reviewed.
 *
 * Fixed dates only, never `Date.now()`. E1 exists because a day boundary has been got
 * wrong in this codebase before, and a deadline is exactly that question.
 */

// ---------------------------------------------------------------------------
// The registry — the property the data model was chosen for
// ---------------------------------------------------------------------------

describe("the criterion registry", () => {
  /**
   * The guard on "adding a sixth criterion is cheap". A type listed in
   * CRITERION_TYPES with a half-written spec would render blank labels and an
   * undefined unit on a screen a whole line is looking at, and nothing else in the
   * module would notice.
   */
  test("every type has a complete spec, so a new one cannot be half-added", () => {
    for (const type of CRITERION_TYPES) {
      const spec = CRITERION_SPECS[type];
      assert.equal(spec.id, type, `${type} spec is filed under the wrong key`);
      for (const [field, value] of Object.entries({
        title: spec.title,
        blurb: spec.blurb,
        source: spec.source,
        howTo: spec.howTo,
        one: spec.unit.one,
        many: spec.unit.many,
      })) {
        assert.ok(value && value.length > 0, `${type} is missing ${field}`);
      }
      assert.ok(["windowed", "cumulative"].includes(spec.measure));
      assert.ok(spec.max >= 1);
      // The gap sentence has to contain the gap, or the label travels alone.
      assert.ok(spec.remaining(2).includes("2"), `${type} drops the number`);
    }
  });

  /**
   * The other half of the same property: nothing downstream branches on a criterion
   * type. If scoring, the nudge or the drop-off ever grew a `switch`, this loop would
   * pass for the five that exist and fail for the sixth — so it runs every type
   * through the whole pipeline generically.
   */
  test("scoring, nudges and drop-off are driven by the list alone", () => {
    for (const type of CRITERION_TYPES) {
      const criteria = [{ type, target: 10 }];
      const standing = standingOf(criteria, { [type]: 4 });
      assert.equal(standing.states.length, 1);
      assert.equal(standing.states[0].remaining, 6);
      assert.equal(standing.stepsAway, 1);
      assert.equal(standing.qualified, false);

      const nudge = nudgeFor(standing, 5);
      assert.ok(nudge.headline.includes("6"), `${type} nudge lost the number`);

      const [row] = dropOff(criteria, [standing]);
      assert.equal(row.type, type);
      assert.equal(row.drop.blocked, 1);
      assert.equal(row.drop.soleBlocker, 1);
      assert.equal(row.drop.medianRemaining, 6);
    }
  });

  /**
   * RULES L4 — no income promises, no money, no projections. This is the screen where
   * "worth ₹5,000" would feel natural to write, which is exactly why it is a test.
   */
  test("no money and no earnings language anywhere in the copy", () => {
    // `\brs` rather than `rs` — without the word boundary this matches the "rs a" in
    // "members away", which is a false positive that would train somebody to weaken
    // the whole check.
    const banned =
      /₹|\brs\.?\s|rupee|earn|income|salary|payout|commission|at this rate|worth/i;
    for (const type of CRITERION_TYPES) {
      const spec = CRITERION_SPECS[type];
      const strings = [
        spec.title,
        spec.blurb,
        spec.source,
        spec.howTo,
        spec.unit.one,
        spec.unit.many,
        spec.remaining(3),
      ];
      for (const text of strings) {
        assert.ok(!banned.test(text), `"${text}" reads as money or earnings`);
      }
    }
  });

  /**
   * RULES L1/L8, D29. This app ships no rank names — not as defaults, not as
   * placeholders, not as examples. The titles here are the five things the app can
   * COUNT, and none of them is anybody's level.
   */
  test("no rank-shaped words are shipped as a criterion title", () => {
    const rankish = /\b(level|rank|pin|tier|grade|star|diamond|president|director)\b/i;
    for (const type of CRITERION_TYPES) {
      assert.ok(!rankish.test(CRITERION_SPECS[type].title));
    }
  });

  test("units read correctly at one", () => {
    assert.equal(formatAmount(CRITERION_SPECS.newMembers, 1), "1 member");
    assert.equal(formatAmount(CRITERION_SPECS.newMembers, 4), "4 members");
    assert.equal(formatAmount(CRITERION_SPECS.volume, 1800), "1,800 points");
    assert.equal(CRITERION_SPECS.newMembers.remaining(1), "1 member away");
    assert.equal(CRITERION_SPECS.daysActive.remaining(1), "1 more day to log");
  });
});

describe("validating a set of conditions", () => {
  test("a qualification with no conditions is refused", () => {
    // Otherwise everybody in the line is told they have qualified the moment it is
    // announced, having done nothing.
    assert.equal(checkCriteria([]).ok, false);
    assert.equal(checkCriteria(undefined).ok, false);
  });

  test("a target of zero is refused — a condition met on announcement is not one", () => {
    assert.equal(checkCriteria([{ type: "newMembers", target: 0 }]).ok, false);
    assert.equal(checkCriteria([{ type: "newMembers", target: -3 }]).ok, false);
    assert.equal(checkCriteria([{ type: "newMembers", target: 2.5 }]).ok, false);
  });

  test("each type keeps its own ceiling", () => {
    assert.equal(isValidTarget(CRITERION_SPECS.volume, 999_999), true);
    assert.equal(isValidTarget(CRITERION_SPECS.volume, 1_000_000), false);
    // A count of people is not a six-figure number, and a typo that makes one should
    // be refused rather than shown to a whole line as a condition.
    assert.equal(isValidTarget(CRITERION_SPECS.newMembers, 10_000), false);
  });

  test("a type this app cannot count is refused", () => {
    assert.equal(checkCriteria([{ type: "vibes", target: 3 }]).ok, false);
  });

  test("conditions are stored in registry order, whatever order they arrived in", () => {
    const checked = checkCriteria([
      { type: "daysActive", target: 10 },
      { type: "volume", target: 500 },
    ]);
    assert.ok(checked.ok);
    // Two qualifications with the same conditions then have the same content, and a
    // diff between them is about the numbers rather than about the order somebody
    // happened to tap.
    assert.deepEqual(checked.criteria.map((c) => c.type), ["volume", "daysActive"]);
  });

  test("a duplicated type collapses instead of being stored twice", () => {
    const checked = checkCriteria([
      { type: "volume", target: 100 },
      { type: "volume", target: 400 },
    ]);
    assert.ok(checked.ok);
    assert.deepEqual(checked.criteria, [{ type: "volume", target: 400 }]);
  });

  /**
   * AUDIT CORRECTION (N13a). The third leg of "adding a sixth criterion is cheap",
   * and the one that was missing.
   *
   * The evaluator used to pick which criteria need a baseline with
   * `c.type === "volume"` — indistinguishable from correct while volume is the only
   * cumulative criterion, and silently wrong the moment a second one is added: with
   * no baseline the difference collapses to the raw lifetime total, which is the
   * exact padding a baseline exists to prevent. Nothing failed, because every test
   * above exercises the PURE scoring path and the baseline is chosen in the
   * database-backed evaluator that no unit test can import.
   *
   * So the choice now lives in a pure function, driven by `measure`, and these
   * assertions run over the whole registry rather than over volume.
   */
  test("N13a: a baseline is decided by `measure`, never by a type name", () => {
    for (const type of CRITERION_TYPES) {
      assert.equal(
        needsBaseline(type),
        CRITERION_SPECS[type].measure === "cumulative",
        `${type} disagrees with its own spec`
      );
    }
    // Every cumulative type in a set is selected, and no windowed one is — stated
    // over the registry so a sixth entry is covered the day it is added.
    const all = CRITERION_TYPES.map((type) => ({ type, target: 1 }));
    assert.deepEqual(
      baselineTypes(all),
      CRITERION_TYPES.filter((t) => CRITERION_SPECS[t].measure === "cumulative")
    );
    assert.deepEqual(baselineTypes([]), []);
  });

  /**
   * The guard that would actually have caught it.
   *
   * The two assertions above are contracts on a pure function; the bug was one file
   * further in, in the database-backed evaluator, which no unit test can import (it
   * pulls firebase-admin, which is why `ids.ts` was split out in the first place). So
   * the anti-pattern is asserted against the source: nothing in the evaluator decides
   * anything by comparing a criterion's TYPE to a literal.
   *
   * Naming a type is fine where a collector genuinely has to — `want("volume")` reads
   * targets and proofs and nothing else can — but `c.type === "…"` over `q.criteria`
   * is always a branch that should have been a lookup in the registry.
   *
   * A source assertion is the house style for a rule no runtime check can reach:
   * report-fonts.test.ts reads the committed TTFs, and the design suite scans the
   * rendered CSS for `backdrop-filter`.
   */
  test("N13a: the evaluator branches on no criterion type", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/qualifications/evaluate.ts"),
      "utf8"
    );
    // Comments explain the correction and are allowed to quote the old expression.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const type of CRITERION_TYPES) {
      assert.ok(
        !new RegExp(`\\.type\\s*===\\s*["']${type}["']`).test(code),
        `evaluate.ts branches on the literal "${type}" — use the registry (N13a)`
      );
    }
    assert.match(code, /baselineTypes\(/, "the baseline is no longer registry-driven");
  });

  /**
   * The companion claim on the same field: only a cumulative criterion can carry an
   * unchecked figure. A windowed one is counted from rows that already happened, so
   * there is nothing pending about it, and a spec claiming otherwise would render a
   * "waiting to be checked" line the evaluator can never populate.
   */
  test("only a cumulative criterion may claim an unchecked figure", () => {
    for (const type of CRITERION_TYPES) {
      const spec = CRITERION_SPECS[type];
      if (spec.hasUnchecked) assert.equal(spec.measure, "cumulative", type);
    }
  });
});

// ---------------------------------------------------------------------------
// Who a qualification applies to
// ---------------------------------------------------------------------------

/**
 * AUDIT ADDITION. The audience predicate decides two separate things — whose progress
 * row the evaluator writes, and who may open the screen — and until an audit those
 * were two copies of one rule in two files that both import firebase-admin, so
 * neither could be reached by a unit test. They are one pure function now, and this
 * is the app-side proof of the property `e2e/qualifications-rules.test.ts` proves at
 * the database: a coach outside the creator's line is never in the audience.
 */
describe("the audience", () => {
  const ROOT = "usr_root";
  const asha = { uplineId: ROOT, uplinePath: [ROOT] }; // ROOT's direct downline
  const chandan = { uplineId: "usr_asha", uplinePath: ["usr_asha", ROOT] }; // grandchild
  const outsider = { uplineId: null, uplinePath: [] };
  const otherLine = { uplineId: "usr_x", uplinePath: ["usr_x"] };

  test("MANDATORY: a coach outside the line is in neither audience", () => {
    for (const audience of ["direct", "all"] as const) {
      assert.equal(inAudience(audience, ROOT, outsider), false);
      assert.equal(inAudience(audience, ROOT, otherLine), false);
    }
  });

  test("'my direct line' means exactly that — a grandchild is not in it", () => {
    assert.equal(inAudience("direct", ROOT, asha), true);
    assert.equal(inAudience("direct", ROOT, chandan), false);
  });

  test("'my whole line' reaches any depth", () => {
    assert.equal(inAudience("all", ROOT, asha), true);
    assert.equal(inAudience("all", ROOT, chandan), true);
  });

  /**
   * A creator is never in their own audience, so the two seats on the detail page
   * cannot both apply to one person and the roles never have to be tie-broken.
   */
  test("a creator is not a participant in their own qualification", () => {
    const root = { uplineId: null, uplinePath: [] };
    assert.equal(inAudience("direct", ROOT, root), false);
    assert.equal(inAudience("all", ROOT, root), false);
  });
});

// ---------------------------------------------------------------------------
// Windows and deadlines — E1
// ---------------------------------------------------------------------------

describe("the window and the deadline", () => {
  const window = makeWindow("2026-08-01", "2026-08-31", "Asia/Kolkata");

  test("the last day counts — the range is half-open at the far end", () => {
    const { from, untilExclusive } = windowInstants(window);
    // 1 August 00:00 IST is 31 July 18:30 UTC.
    assert.equal(from.toISOString(), "2026-07-31T18:30:00.000Z");
    // The window closes at the START of 1 September, so all of 31 August is inside it.
    assert.equal(untilExclusive.toISOString(), "2026-08-31T18:30:00.000Z");
    assert.equal(closesAt(window).getTime(), untilExclusive.getTime());
  });

  /**
   * E1, on the screen it would break. India is UTC+5:30, so a deadline evaluated in
   * UTC closes at 05:30 on its own last day for the person holding the phone — it
   * takes the final evening away from everybody who works in the evening, which is
   * when this audience works.
   */
  test("days left are counted in India, not in UTC", () => {
    const sundayNight = new Date("2026-08-09T23:00:00Z"); // 04:30 Monday, IST
    assert.equal(daysLeft(window, sundayNight), 22); // 10 Aug .. 31 Aug inclusive
    assert.equal(
      daysLeft(makeWindow("2026-08-01", "2026-08-31", "UTC"), sundayNight),
      23 // still 9 August in UTC — a whole day out
    );
  });

  test("the last day says one, and a closed window says zero", () => {
    assert.equal(daysLeft(window, new Date("2026-08-31T06:00:00Z")), 1);
    // Zero would read as "it is over" while a coach can still act, so the last day is
    // never 0 — but the day after really is.
    assert.equal(daysLeft(window, new Date("2026-09-01T06:00:00Z")), 0);
    assert.equal(daysLeft(window, new Date("2026-10-01T06:00:00Z")), 0);
  });

  test("months touched by a window, including across a year boundary", () => {
    assert.deepEqual(monthsInWindow(window), ["2026-08"]);
    assert.deepEqual(
      monthsInWindow(makeWindow("2026-11-15", "2027-02-02", "Asia/Kolkata")),
      ["2026-11", "2026-12", "2027-01", "2027-02"]
    );
  });

  test("day keys are validated, so a hand-written request cannot store rubbish", () => {
    assert.equal(isDayKey("2026-08-31"), true);
    assert.equal(isDayKey("2026-13-01"), false);
    assert.equal(isDayKey("2026-08-32"), false);
    assert.equal(isDayKey("31-08-2026"), false);
    assert.equal(dayLabel("2026-08-31"), "31 Aug 2026");
  });
});

describe("validating a whole qualification", () => {
  // 04:30 on 10 August in India; still 9 August in UTC. Every case below sits on that
  // difference deliberately.
  const now = new Date("2026-08-09T23:00:00Z");
  const good = {
    title: "Summer push",
    criteria: [{ type: "newMembers", target: 2 }],
    audience: "direct",
    deadlineKey: "2026-08-31",
  };

  test("a well-formed one is accepted", () => {
    const checked = checkDefinition(good, "Asia/Kolkata", now);
    assert.ok(checked.ok);
    assert.equal(checked.definition.title, "Summer push");
    assert.equal(checked.definition.timeZone, "Asia/Kolkata");
  });

  test("today in India is a valid closing date even though UTC says yesterday", () => {
    const sameDay = checkDefinition(
      { ...good, deadlineKey: "2026-08-10" },
      "Asia/Kolkata",
      now
    );
    assert.ok(sameDay.ok);
    // The one the UTC reading would have accepted, and India has already passed.
    const yesterday = checkDefinition(
      { ...good, deadlineKey: "2026-08-09" },
      "Asia/Kolkata",
      now
    );
    assert.equal(yesterday.ok, false);
  });

  test("a date beyond a year out is refused", () => {
    assert.equal(
      checkDefinition({ ...good, deadlineKey: "2028-01-01" }, "Asia/Kolkata", now).ok,
      false
    );
    assert.equal(MAX_DEADLINE_DAYS, 365);
  });

  /**
   * `trim()` does not remove zero-width characters — the bug threads.ts records,
   * which delivered a blank card to a whole line. A blank qualification title is the
   * same failure: a thing everybody is measured against and nobody can identify.
   */
  test("a title of invisible characters is refused", () => {
    assert.equal(hasVisibleText("​‍ "), false);
    assert.equal(checkDefinition({ ...good, title: "​" }, "Asia/Kolkata", now).ok, false);
    assert.equal(checkDefinition({ ...good, title: "   " }, "Asia/Kolkata", now).ok, false);
    // A Kannada title is real text and must survive — the zero-width joiner it may
    // contain is meaningful spelling, not padding.
    const kannada = checkText("ಬೆಳಗಿನ ನಡಿಗೆ", 80, { empty: "e", long: "l" });
    assert.ok(kannada.ok);
  });

  test("an audience this app does not have is refused", () => {
    assert.equal(checkDefinition({ ...good, audience: "city" }, "Asia/Kolkata", now).ok, false);
  });
});

// ---------------------------------------------------------------------------
// Scoring, and the honesty of "one step away"
// ---------------------------------------------------------------------------

describe("scoring", () => {
  const criteria = [
    { type: "volume" as const, target: 2000 },
    { type: "newMembers" as const, target: 2 },
    { type: "daysActive" as const, target: 10 },
  ];

  test("a cumulative criterion counts from where the coach started", () => {
    // Volume is a monthly running total, so the qualification measures the
    // DIFFERENCE. Counting the raw figure would credit points earned before it was
    // announced — the padding the brief rules out.
    const state = stateOf(
      { type: "volume", target: 500 },
      { volume: 1400 },
      { volume: 1000 },
      {}
    );
    assert.equal(state.done, 400);
    assert.equal(state.remaining, 100);
    assert.equal(state.met, false);
  });

  test("a validated total that goes backwards clamps at zero, not below", () => {
    // An upline asking for fresh proof puts an approved target back in the unchecked
    // column, so this really happens. "-40 points" is not a number anybody can act on.
    const state = stateOf(
      { type: "volume", target: 500 },
      { volume: 900 },
      { volume: 1000 },
      {}
    );
    assert.equal(state.done, 0);
    assert.equal(state.remaining, 500);
  });

  test("every condition has to be met — three of four is not qualified", () => {
    const standing = standingOf(criteria, { volume: 2000, newMembers: 2, daysActive: 4 });
    assert.equal(standing.metCount, 2);
    assert.equal(standing.stepsAway, 1);
    assert.equal(standing.qualified, false);

    const all = standingOf(criteria, { volume: 2000, newMembers: 2, daysActive: 10 });
    assert.equal(all.stepsAway, 0);
    assert.equal(all.qualified, true);
  });

  /**
   * MANDATORY. "One step away" is EXACTLY ONE unmet condition — never a threshold,
   * never "close on all of them". The brief calls it out because it drives the
   * last-week surge and a padded version is a lie told to the person with the most at
   * stake.
   */
  test("MANDATORY: one step away means exactly one condition unmet", () => {
    const cases: [Record<string, number>, number][] = [
      [{ volume: 2000, newMembers: 2, daysActive: 10 }, 0],
      [{ volume: 2000, newMembers: 2, daysActive: 9 }, 1],
      [{ volume: 2000, newMembers: 1, daysActive: 9 }, 2],
      [{}, 3],
    ];
    for (const [values, expected] of cases) {
      assert.equal(standingOf(criteria, values).stepsAway, expected);
    }
  });

  /**
   * MANDATORY, and the reason the phrase is safe to use at all.
   *
   * A coach with two conditions met and ZERO of two thousand points is one step away
   * by the definition above, and is nowhere near. The app does not pretend otherwise
   * and it does not invent a percentage to decide for the reader: it prints the gap
   * beside the phrase, every time.
   */
  test("MANDATORY: the label never travels without the number", () => {
    const standing = standingOf(criteria, { volume: 0, newMembers: 2, daysActive: 10 });
    assert.equal(standing.stepsAway, 1);
    const nudge = nudgeFor(standing, 6);
    assert.ok(nudge.headline.includes("2,000"), nudge.headline);
    assert.ok(nudge.headline.includes("you are in"), nudge.headline);
  });

  /**
   * Fraction, not raw gap. Sorting "600 points" against "2 members" as numbers would
   * tell a coach who is 95% of the way to their volume target that their nearest job
   * is the members they have not started.
   */
  test("the closest condition is the one furthest ALONG, not the smallest number", () => {
    const standing = standingOf(criteria, { volume: 1900, newMembers: 0, daysActive: 0 });
    const closest = closestUnmet(standing)!;
    assert.equal(closest.spec.id, "volume"); // 100 short of 2000 — 95% there
    assert.equal(closest.remaining, 100);
  });

  test("the nudge changes shape with how much is left", () => {
    const many = nudgeFor(standingOf(criteria, {}), 9);
    assert.ok(many.headline.startsWith("3 conditions left"), many.headline);

    const done = nudgeFor(
      standingOf(criteria, { volume: 2000, newMembers: 2, daysActive: 10 }),
      9
    );
    assert.equal(done.headline, "You are in.");

    // A closed qualification does not tell somebody to hurry.
    const closed = nudgeFor(standingOf(criteria, {}), 0);
    assert.equal(closed.headline, "This one has closed.");
  });

  /**
   * The one nudge that names a job somebody else has to do. A coach sitting on
   * claimed-but-unapproved points is not behind on the work, and "go and meet more
   * people" would be the wrong instruction (G6).
   */
  test("unchecked points are pointed at the upline, not at more work", () => {
    const standing = standingOf(
      [{ type: "volume", target: 2000 }],
      { volume: 0 },
      {},
      { volume: 400 }
    );
    const nudge = nudgeFor(standing, 4);
    assert.ok(nudge.hint);
    assert.ok(/waiting to be checked/i.test(nudge.hint!), nudge.hint!);
    assert.ok(nudge.hint!.includes("400"));
  });

  test("no money in any nudge (RULES L4)", () => {
    const banned = /₹|rupee|earn|income|payout|commission|at this rate|worth/i;
    for (const values of [{}, { volume: 2000 }, { volume: 2000, newMembers: 2, daysActive: 10 }]) {
      for (const days of [0, 1, 9]) {
        const nudge = nudgeFor(standingOf(criteria, values), days);
        assert.ok(!banned.test(nudge.headline), nudge.headline);
        if (nudge.hint) assert.ok(!banned.test(nudge.hint), nudge.hint);
      }
    }
  });
});

describe("per-criterion drop-off", () => {
  const criteria = [
    { type: "volume" as const, target: 1000 },
    { type: "newMembers" as const, target: 2 },
  ];

  /**
   * The number the dashboard is FOR. A condition blocking many people of whom few are
   * sole-blocked is not the bottleneck — those people are stuck on several things and
   * moving this one changes nothing for them. Reporting only `blocked` would send an
   * upline at the wrong condition, which is the whole failure mode this screen exists
   * to avoid.
   */
  test("sole blockers are counted apart from everyone who is merely short", () => {
    const standings = [
      standingOf(criteria, { volume: 1000, newMembers: 0 }), // members is the only thing left
      standingOf(criteria, { volume: 1000, newMembers: 1 }), // ditto, closer
      standingOf(criteria, { volume: 200, newMembers: 0 }), // short on both
      standingOf(criteria, { volume: 1000, newMembers: 2 }), // in
    ];
    const rows = dropOff(criteria, standings);
    const members = rows.find((r) => r.type === "newMembers")!.drop;
    const volume = rows.find((r) => r.type === "volume")!.drop;

    assert.equal(members.blocked, 3);
    assert.equal(members.soleBlocker, 2); // the third coach is short on volume too
    assert.equal(members.met, 1);

    assert.equal(volume.blocked, 1);
    assert.equal(volume.soleBlocker, 0); // nobody is blocked ONLY by volume
    assert.equal(volume.met, 3);
  });

  /**
   * A median rather than a mean, and the lower of two middles. One coach who has not
   * started drags an average towards a gap nobody actually has, and this number is
   * used to decide which condition gets talked about at a meeting.
   */
  test("the typical gap is a real coach's gap", () => {
    assert.equal(median([]), 0);
    assert.equal(median([5]), 5);
    assert.equal(median([1, 2, 3]), 2);
    assert.equal(median([1, 2, 3, 100]), 2); // a mean would say 26.5
  });
});

// ---------------------------------------------------------------------------
// Escalating reminders
// ---------------------------------------------------------------------------

describe("reminder escalation", () => {
  test("the gaps get shorter as the deadline nears", () => {
    assert.deepEqual([...REMINDER_BANDS], [14, 7, 3, 1]);
  });

  test("nothing is sent too early, and nothing after it closes", () => {
    assert.equal(dueBand(30), null);
    assert.equal(dueBand(15), null);
    // A reminder about a deadline that has passed is the least useful notification
    // this app could send.
    assert.equal(dueBand(0), null);
    assert.equal(dueBand(-3), null);
  });

  test("each band fires once, and a passed band never becomes due again", () => {
    // Walking a qualification down day by day, remembering what has been sent — the
    // exact loop send-reminders.ts runs.
    const sent = new Set<string>();
    const fired: number[] = [];
    for (const left of [20, 15, 14, 12, 9, 7, 6, 5, 4, 3, 2, 1]) {
      const band = dueBand(left);
      if (band === null) continue;
      if (sent.has(bandId(band))) continue;
      sent.add(bandId(band));
      fired.push(left);
    }
    // Four messages, with the gaps closing: fired at 14, 7, 3 and 1 days left — so
    // seven days between the first two, four between the next, two between the last.
    // Nothing fires at 12 or 9: the fortnight band already covered them.
    assert.deepEqual(fired, [14, 7, 3, 1]);
  });

  test("a qualification announced with five days left does not claim a fortnight", () => {
    const sent = new Set<string>();
    const fired: number[] = [];
    for (const left of [5, 4, 3, 2, 1]) {
      const band = dueBand(left)!;
      if (sent.has(bandId(band))) continue;
      sent.add(bandId(band));
      fired.push(left);
    }
    assert.deepEqual(fired, [5, 3, 1]);
  });

  /**
   * The band is a SCHEDULE, never a label. The three-day band covers everything at or
   * under three, so a message worded from the band would tell a coach "3 days left" on
   * a day when two remain.
   */
  test("the words come from the real day count, not from the band", () => {
    assert.equal(dueBand(2), 3); // scheduled by the 3-day band…
    assert.equal(leadFor(2), "2 days left"); // …and worded truthfully
    assert.equal(leadFor(1), "Last day");
    assert.equal(leadFor(7), "1 week left");
    assert.equal(leadFor(14), "2 weeks left");
  });

  test("a reminder carries the gap and no money (RULES L4)", () => {
    const standing = standingOf([{ type: "newMembers", target: 3 }], { newMembers: 1 });
    const message = reminderMessage("qual_x", "Summer push", 1, nudgeFor(standing, 1));
    assert.equal(message.body, "Last day — Summer push. 2 members away and you are in.");
    assert.equal(message.url, "/qualifications/qual_x");
    // One tag per qualification, so a later reminder REPLACES the earlier one on the
    // lock screen instead of stacking four near-identical cards.
    assert.equal(message.tag, "qualification_qual_x");
    assert.ok(!/₹|earn|income|worth|at this rate/i.test(message.body));
  });
});

// ---------------------------------------------------------------------------
// Document ids
// ---------------------------------------------------------------------------

describe("document ids", () => {
  test("are deterministic, so a double-tapped button makes one qualification", () => {
    const once = qualificationDocId("usr_root", "Summer push", "2026-08-31");
    const again = qualificationDocId("usr_root", " summer PUSH ", "2026-08-31");
    assert.equal(once, again);
  });

  test("a different name, date or creator is a different qualification", () => {
    const base = qualificationDocId("usr_root", "Summer push", "2026-08-31");
    assert.notEqual(base, qualificationDocId("usr_root", "Winter push", "2026-08-31"));
    assert.notEqual(base, qualificationDocId("usr_root", "Summer push", "2026-09-30"));
    assert.notEqual(base, qualificationDocId("usr_asha", "Summer push", "2026-08-31"));
  });

  test("free-text titles never reach the id raw", () => {
    // A title can contain a slash, which Firestore forbids in an id, and can be any
    // length. Hashing is what makes "whatever they typed" safe here.
    const awkward = qualificationDocId("usr_root", "north / south ".repeat(300), "2026-08-31");
    assert.ok(!awkward.includes("/"));
    assert.ok(awkward.length < 40);
  });

  test("a coach has one row per qualification, and a roll-up is not one of them", () => {
    const id = "qual_abc";
    assert.equal(progressDocId(id, "usr_asha"), progressDocId(id, "usr_asha"));
    assert.notEqual(progressDocId(id, "usr_asha"), progressDocId(id, "usr_bhav"));
    assert.notEqual(progressDocId(id, "usr_asha"), summaryDocId(id));
  });
});
