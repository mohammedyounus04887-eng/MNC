import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPTY_SHEET } from "@/modules/goals/model";
import {
  MAX_ACTION,
  MAX_ACTIONS,
  MAX_CHANGE_NOTE,
} from "@/modules/goals/conversation-types";
import {
  REVIEW_WINDOW_DAYS,
  buildMonthReview,
  isReviewTime,
} from "@/modules/goals/review";

/**
 * The pure half of the target conversation (A3) and the month-end review.
 *
 * Who may accept, and who may read a conversation, are Security Rules properties and are
 * tested in e2e/goals-rules.test.ts — a unit test cannot prove them and pretending
 * otherwise is how a privacy hole ships behind a green suite.
 */

describe("month-end review — when it appears", () => {
  test("the last five days of a 31-day month", () => {
    assert.equal(isReviewTime("2026-08-26"), false);
    assert.equal(isReviewTime("2026-08-27"), true);
    assert.equal(isReviewTime("2026-08-31"), true);
  });

  test("February is 28 days, and the window moves with it", () => {
    assert.equal(isReviewTime("2026-02-23"), false);
    assert.equal(isReviewTime("2026-02-24"), true);
    assert.equal(isReviewTime("2026-02-28"), true);
  });

  test("a leap February gets its extra day", () => {
    // 2028-02-24 is the 24th of 29 — five days remain including it, so still outside.
    assert.equal(isReviewTime("2028-02-24"), false);
    assert.equal(isReviewTime("2028-02-25"), true);
    assert.equal(isReviewTime("2028-02-29"), true);
  });

  test("a 30-day month ends on the 30th, not the 31st", () => {
    assert.equal(isReviewTime("2026-04-25"), false);
    assert.equal(isReviewTime("2026-04-26"), true);
    assert.equal(isReviewTime("2026-04-30"), true);
  });

  test("the window is exactly REVIEW_WINDOW_DAYS long", () => {
    const days = [];
    for (let d = 1; d <= 31; d++) {
      const key = `2026-08-${String(d).padStart(2, "0")}`;
      if (isReviewTime(key)) days.push(d);
    }
    assert.equal(days.length, REVIEW_WINDOW_DAYS);
  });

  test("a malformed key is not review time rather than a crash", () => {
    assert.equal(isReviewTime(""), false);
    assert.equal(isReviewTime("not-a-date"), false);
  });
});

describe("month-end review — what it says", () => {
  const base = {
    sheet: { shortTermGoal: "", shortTermByKey: null },
    targetPoints: null,
    progressPoints: null,
    actionsDone: 0,
    actionsTotal: 0,
  };

  test("nothing outside the window", () => {
    assert.equal(buildMonthReview({ ...base, dayKey: "2026-08-10" }), null);
  });

  test("the month reviewed is the one the day is in", () => {
    const r = buildMonthReview({ ...base, dayKey: "2026-08-28" });
    assert.equal(r?.month, "2026-08");
    assert.equal(r?.daysLeft, 3);
  });

  test("reaching the target is recognised, not celebrated at them", () => {
    const r = buildMonthReview({
      ...base,
      dayKey: "2026-08-28",
      targetPoints: 400,
      progressPoints: 400,
    });
    assert.equal(r?.reached, true);
    assert.match(r!.headline, /got there/i);
  });

  test("missing it names the gap and the days left, never a shortfall", () => {
    const r = buildMonthReview({
      ...base,
      dayKey: "2026-08-28",
      targetPoints: 400,
      progressPoints: 150,
    });
    assert.equal(r?.reached, false);
    assert.match(r!.headline, /250/);
    assert.match(r!.headline, /3 days left/);
    // The person is never the subject of a judgement.
    assert.doesNotMatch(r!.headline, /fail|behind|short|missed/i);
  });

  test("the last day of the month has no days left and asks a question", () => {
    const r = buildMonthReview({
      ...base,
      dayKey: "2026-08-31",
      targetPoints: 400,
      progressPoints: 150,
    });
    assert.equal(r?.daysLeft, 0);
    assert.match(r!.headline, /what got in the way/i);
  });

  test("no target is a prompt to agree one, not a scolding", () => {
    const r = buildMonthReview({ ...base, dayKey: "2026-08-28" });
    assert.equal(r?.reached, null);
    assert.match(r!.headline, /agree/i);
  });

  test("a zero target counts as no target rather than an instant win", () => {
    const r = buildMonthReview({
      ...base,
      dayKey: "2026-08-28",
      targetPoints: 0,
      progressPoints: 0,
    });
    assert.equal(r?.reached, null);
  });

  test("the 90-day goal is revisited whenever one was written", () => {
    assert.equal(
      buildMonthReview({ ...base, dayKey: "2026-08-28" })?.revisitShortTerm,
      false
    );
    assert.equal(
      buildMonthReview({
        ...base,
        dayKey: "2026-08-28",
        sheet: { shortTermGoal: "Ten new people", shortTermByKey: null },
      })?.revisitShortTerm,
      true
    );
  });

  test("agreed actions are carried through for the card to count", () => {
    const r = buildMonthReview({
      ...base,
      dayKey: "2026-08-28",
      actionsDone: 2,
      actionsTotal: 3,
    });
    assert.equal(r?.actionsDone, 2);
    assert.equal(r?.actionsTotal, 3);
  });

  test("MANDATORY: no headline mentions money — RULES L4", () => {
    const headlines: string[] = [];
    for (const [target, progress] of [
      [null, null],
      [400, 400],
      [400, 150],
      [0, 0],
    ] as [number | null, number | null][]) {
      for (const key of ["2026-08-27", "2026-08-31"]) {
        const r = buildMonthReview({
          ...base,
          dayKey: key,
          targetPoints: target,
          progressPoints: progress,
        });
        if (r) headlines.push(r.headline);
      }
    }
    assert.ok(headlines.length > 0);
    for (const h of headlines) {
      assert.doesNotMatch(h, /₹|rupee|earn|income|salary|money|commission|\$/i);
    }
  });
});

describe("the caps the forms are built against", () => {
  test("an action fits on one line and there are not many of them", () => {
    assert.ok(MAX_ACTION <= 200);
    assert.ok(MAX_ACTIONS <= 8);
    assert.ok(MAX_CHANGE_NOTE <= 300);
  });

  test("the UI can never offer more action rows than the cap allows", () => {
    // Every row in the actions pane comes from a blocker the coach ticked, and the free
    // text note is shown as context rather than a row — so the pane cannot exceed the
    // six blockers, which is inside MAX_ACTIONS and inside RULES S2's six-field limit.
    const gate = readFileSync("src/modules/goals/TargetGate.tsx", "utf8");
    assert.match(gate, /data\.sheet\.blockers\.map/);
    assert.doesNotMatch(gate, /blockerNote[^)]*onChange/);
  });
});

describe("no database in anything a client component imports (RULES E2)", () => {
  for (const file of [
    "src/modules/goals/model.ts",
    "src/modules/goals/conversation-types.ts",
    "src/modules/goals/review.ts",
  ]) {
    test(`${file} is pure`, () => {
      const src = readFileSync(file, "utf8");
      // IMPORT lines only. Matching anywhere in the file fails on the doc comments that
      // explain why the import is absent, which would make the test punish the
      // explanation rather than the violation.
      assert.doesNotMatch(
        src,
        /^\s*import\s[^\n]*(firebase-admin|@\/lib\/collections|\.\/queries|\.\/conversations|\.\/nudge|\.\/activity)/m
      );
    });
  }

  test("the client components import types and caps, never the query layer", () => {
    for (const file of [
      "src/modules/goals/GoalSheetForm.tsx",
      "src/modules/goals/TargetGate.tsx",
      "src/modules/goals/TargetToAccept.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      assert.match(src, /^"use client";/);
      assert.doesNotMatch(
        src,
        /^\s*import\s[^\n]*(firebase-admin|@\/lib\/collections|\.\/queries|\.\/conversations"|\.\/nudge|\.\/activity)/m
      );
    }
  });
});

describe("the sheet still defaults to private (A2)", () => {
  test("shareNeeds is off in the empty sheet", () => {
    assert.equal(EMPTY_SHEET.shareNeeds, false);
  });

  test("the form's sharing switch is not pre-checked anywhere", () => {
    const form = readFileSync("src/modules/goals/GoalSheetForm.tsx", "utf8");
    assert.doesNotMatch(form, /shareNeeds:\s*true/);
    assert.match(form, /checked=\{sheet\.shareNeeds\}/);
  });

  test("MANDATORY: the upline's gate never renders the amount — RULES L4", () => {
    const gate = readFileSync("src/modules/goals/TargetGate.tsx", "utf8");
    assert.doesNotMatch(gate, /needsAmount/);
  });
});
