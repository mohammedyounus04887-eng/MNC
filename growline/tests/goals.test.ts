import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BLOCKERS,
  DEFAULT_INVITES_PER_MEMBER,
  DEFAULT_VOLUME_PER_MEMBER,
  DEFAULT_WORKING_DAYS,
  EMPTY_SHEET,
  GOAL_STEPS,
  INVITES_PER_HOUR,
  checkBlockers,
  checkNeedsAmount,
  checkWhy,
  completion,
  hasSomethingToTalkAbout,
  isBlockerKey,
  isHoursOption,
  pathFitsHours,
  stepDone,
  suggestActivityPath,
} from "@/modules/goals/model";

/**
 * The pure half of the Goal Sheet. Privacy — who may read what — is in
 * `e2e/goals-rules.test.ts`, because it is a property of the database, not of this module.
 */

describe("the compliance line: money is never computed with", () => {
  test("suggestActivityPath takes no money and returns none", () => {
    /**
     * The load-bearing test in this file. RULES L4 forbids income, earnings or commission
     * anywhere, and the reverse-math is where an income projection would most naturally
     * creep in — "you want ₹10,000, so you need to earn…". It cannot: the function is not
     * given an amount, so it cannot project one.
     *
     * Asserted structurally rather than by inspecting a string, so it stays true when
     * somebody edits the implementation.
     */
    const path = suggestActivityPath({ volumeTarget: 400 });
    assert.ok(path);
    const keys = Object.keys(path!).join(" ").toLowerCase();
    for (const banned of ["money", "amount", "income", "earn", "rupee", "inr", "commission", "₹"]) {
      assert.ok(!keys.includes(banned), `"${banned}" must not be part of the activity path`);
    }
    // Every value it returns is a count, never a currency figure.
    for (const [key, value] of Object.entries(path!)) {
      assert.equal(typeof value, "number", `${key} should be a plain count`);
    }
  });

  test("the module ships no currency symbol at all", () => {
    // A blunt tripwire on the source itself: the sheet stores an amount a coach typed,
    // but nothing in the model may render or reason about currency.
    const src = readFileSync("src/modules/goals/model.ts", "utf8");
    // Strip the comment that explains the rule, which legitimately names the symbol.
    const code = src.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!code.includes("₹"), "a rupee symbol appears in goal-sheet model CODE");
  });

  test("an amount is stored as typed, and never fed to the suggestion", () => {
    assert.equal(checkNeedsAmount("10000"), 10000);
    assert.equal(checkNeedsAmount(2500.4), 2500);
    // Junk and non-positives become "not stated" rather than zero, which would read as
    // a coach saying their reason is worth nothing.
    for (const bad of ["", null, undefined, "abc", 0, -5, NaN, Infinity]) {
      assert.equal(checkNeedsAmount(bad), null, `${JSON.stringify(bad)} should be null`);
    }
    // The suggestion's signature has no slot for it — this is the type system enforcing
    // the rule rather than a reviewer remembering it.
    assert.equal("needsAmount" in (suggestActivityPath({ volumeTarget: 100 }) ?? {}), false);
  });
});

describe("the reverse-math suggests, and rounds towards the goal", () => {
  test("a worked example, end to end", () => {
    const path = suggestActivityPath({
      volumeTarget: 400,
      volumePerMember: 100,
      invitesPerMember: 10,
      workingDays: 26,
    });
    assert.deepEqual(path, {
      volumeTarget: 400,
      volumePerMember: 100,
      membersNeeded: 4,
      invitesPerMember: 10,
      invitesNeeded: 40,
      workingDays: 26,
      invitesPerDay: 2, // ceil(40/26)
    });
  });

  test("it rounds UP at every step — a path that rounds down misses its own target", () => {
    const path = suggestActivityPath({ volumeTarget: 401, volumePerMember: 100 });
    // 4.01 members is five people, not four.
    assert.equal(path?.membersNeeded, 5);
  });

  test("every assumption is overridable — the app suggests, humans decide", () => {
    const base = suggestActivityPath({ volumeTarget: 400 });
    assert.equal(base?.volumePerMember, DEFAULT_VOLUME_PER_MEMBER);
    assert.equal(base?.invitesPerMember, DEFAULT_INVITES_PER_MEMBER);
    assert.equal(base?.workingDays, DEFAULT_WORKING_DAYS);

    const tuned = suggestActivityPath({
      volumeTarget: 400,
      volumePerMember: 200,
      invitesPerMember: 4,
      workingDays: 20,
    });
    assert.equal(tuned?.membersNeeded, 2);
    assert.equal(tuned?.invitesNeeded, 8);
    assert.equal(tuned?.invitesPerDay, 1);
  });

  test("no target means no suggestion, rather than a path of zeroes", () => {
    for (const bad of [0, -100, Number.NaN]) {
      assert.equal(suggestActivityPath({ volumeTarget: bad }), null);
    }
  });

  test("absurd assumptions cannot produce a divide-by-zero or a negative", () => {
    const path = suggestActivityPath({
      volumeTarget: 100,
      volumePerMember: 0,
      invitesPerMember: -3,
      workingDays: 0,
    });
    assert.ok(path);
    for (const value of Object.values(path!)) assert.ok(Number.isFinite(value) && value >= 0);
  });
});

describe("fitting the path to the hours somebody actually has", () => {
  test("warns when the arithmetic asks for more than the day holds", () => {
    const path = suggestActivityPath({ volumeTarget: 2000, workingDays: 26 })!;
    // 20 members -> 200 invites -> 8/day, against 1 hour = 3 invites.
    assert.equal(pathFitsHours(path, 1), false);
    assert.equal(pathFitsHours(path, 4), true); // 4h = 12/day
  });

  test("unknown hours is not a warning", () => {
    const path = suggestActivityPath({ volumeTarget: 5000 })!;
    assert.equal(pathFitsHours(path, null), true);
  });

  test("the boundary is inclusive — exactly enough hours fits", () => {
    const path = suggestActivityPath({ volumeTarget: 600, workingDays: 20 })!;
    assert.equal(path.invitesPerDay, 3);
    assert.equal(pathFitsHours(path, 1), 3 <= 1 * INVITES_PER_HOUR);
  });
});

describe("the sheet is three skippable steps", () => {
  test("an empty sheet is valid and reads as nothing done", () => {
    const c = completion(EMPTY_SHEET);
    assert.deepEqual(c, { done: 0, total: 3, pct: 0 });
    assert.equal(hasSomethingToTalkAbout(EMPTY_SHEET), false);
  });

  test("each step counts on its own, so partial progress shows", () => {
    assert.equal(stepDone({ ...EMPTY_SHEET, why: "For my children" }, "why"), true);
    assert.equal(stepDone({ ...EMPTY_SHEET, hoursPerDay: 2 }, "why"), true);
    assert.equal(stepDone({ ...EMPTY_SHEET, shortTermGoal: "10 people" }, "goals"), true);
    assert.equal(stepDone({ ...EMPTY_SHEET, longTermGoal: "A car" }, "goals"), true);
    assert.equal(stepDone({ ...EMPTY_SHEET, blockers: ["time"] }, "blockers"), true);
    assert.equal(stepDone({ ...EMPTY_SHEET, blockerNote: "Evenings are busy" }, "blockers"), true);
  });

  test("whitespace is not progress", () => {
    assert.equal(stepDone({ ...EMPTY_SHEET, why: "   " }, "why"), false);
    assert.equal(stepDone({ ...EMPTY_SHEET, blockerNote: "\n\t " }, "blockers"), false);
  });

  test("the meter reaches 100 only when all three are done", () => {
    const full = {
      ...EMPTY_SHEET,
      why: "For my children",
      shortTermGoal: "10 people",
      blockers: ["time"] as const,
    };
    assert.deepEqual(completion({ ...full, blockers: ["time"] }), {
      done: 3,
      total: 3,
      pct: 100,
    });
  });

  test("every step key has a title, so none renders blank", () => {
    for (const step of GOAL_STEPS) assert.ok(step.title.trim().length > 0);
  });
});

describe("blockers", () => {
  test("each has a key and a plain-words label (S6)", () => {
    for (const b of BLOCKERS) {
      assert.match(b.key, /^[a-z]+$/);
      assert.ok(b.label.trim().length > 0);
      // "Simple words" — no jargon a coach would not say out loud.
      for (const jargon of ["CRM", "pipeline", "conversion", "engagement", "funnel"]) {
        assert.ok(!b.label.toLowerCase().includes(jargon.toLowerCase()));
      }
    }
  });

  test("unknown keys are dropped, not rejected", () => {
    assert.deepEqual(checkBlockers(["time", "not-a-blocker", 5, null]), ["time"]);
    assert.deepEqual(checkBlockers("time"), []);
    assert.deepEqual(checkBlockers(null), []);
  });

  test("duplicates collapse and order is canonical, not input order", () => {
    // Canonical order keeps the talking-points card stable between edits.
    assert.deepEqual(checkBlockers(["knowledge", "time", "time"]), ["time", "knowledge"]);
  });

  test("isBlockerKey refuses anything not offered", () => {
    for (const b of BLOCKERS) assert.equal(isBlockerKey(b.key), true);
    for (const bad of ["TIME", "", null, 5, {}]) assert.equal(isBlockerKey(bad), false);
  });
});

describe("hours are a picker, not a free number", () => {
  test("only the offered options are accepted", () => {
    assert.equal(isHoursOption(2), true);
    for (const bad of [0, 5, 24, -1, 2.5, "2", null]) {
      assert.equal(isHoursOption(bad), false, `${JSON.stringify(bad)} must be refused`);
    }
  });
});

describe("free text", () => {
  test("trims, and absent means empty rather than an error", () => {
    assert.deepEqual(checkWhy("  For my children  "), { ok: true, value: "For my children" });
    assert.deepEqual(checkWhy(undefined), { ok: true, value: "" });
    assert.deepEqual(checkWhy(null), { ok: true, value: "" });
  });

  test("over-long is refused at the boundary", () => {
    assert.equal(checkWhy("a".repeat(400)).ok, true);
    assert.equal(checkWhy("a".repeat(401)).ok, false);
  });
});
