import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LEADER_TOOLS,
  LEADER_TRIAL_DAYS,
  QUALIFYING_DOWNLINES,
  TIERS_ENFORCED,
  TIER_INFO,
  canUseLeaderTool,
  effectiveTier,
  isQualifiedForLeaderTrial,
  isTier,
  shouldOfferLeaderTrial,
  trialDaysLeft,
  type TierRecord,
} from "@/modules/tiers/model";

/**
 * Tiers (v2 §8), built under the standing instruction "don't gate anything yet".
 *
 * The most important assertion in this file is the FIRST one: that enforcement is off.
 * If somebody flips it, this fails and forces them to come here and consciously update
 * both the test and the pricing screen's launch-open promise on the same day.
 */

describe("the flip", () => {
  test("STANDING INSTRUCTION: tiers are not enforced (2026-08-14, owner)", () => {
    /*
     * "start tiers now, don't gate anything yet." When this is deliberately flipped,
     * three things must move together: this assertion, the launch-open banner in
     * src/app/(app)/plans/page.tsx, and the "start-trial" refusal in
     * src/app/api/tiers/route.ts. This test is the tripwire that makes it a set.
     */
    assert.equal(TIERS_ENFORCED, false);
  });

  test("while off, every Leader tool is allowed for every tier", () => {
    for (const tier of ["starter", "leader", "elite"] as const) {
      for (const tool of LEADER_TOOLS) {
        assert.equal(canUseLeaderTool(tier, tool).allowed, true, `${tier}/${tool}`);
      }
    }
  });

  test("the enforced branch is real code, not a stub — a Starter is refused with a reason", () => {
    /*
     * The gate must be tested in BOTH positions or the flip rots: an `if (!ENFORCED)`
     * that always short-circuits hides a broken enforced branch until the day it
     * matters. The source of truth is a constant, so this reads the function's own
     * source to check the enforced path exists and does what the copy promises.
     */
    const src = readFileSync("src/modules/tiers/model.ts", "utf8");
    const fn = src.slice(src.indexOf("export function canUseLeaderTool"));
    assert.match(fn, /tier === "leader" \|\| tier === "elite"/);
    assert.match(fn, /allowed: false/);
    // The refusal names what still works — v2 §8: never lock a user out of their business.
    assert.match(fn, /keep working on Starter/);
    // And it is calm: a denied action is a Trust Zone moment (RULES G1).
    assert.doesNotMatch(fn, /reason:[^}]*!/);
  });
});

describe("qualification — the 2nd direct downline", () => {
  test("two direct downlines qualify; one does not", () => {
    assert.equal(QUALIFYING_DOWNLINES, 2);
    assert.equal(isQualifiedForLeaderTrial(0), false);
    assert.equal(isQualifiedForLeaderTrial(1), false);
    assert.equal(isQualifiedForLeaderTrial(2), true);
    assert.equal(isQualifiedForLeaderTrial(9), true);
  });

  test("the offer shows once, to a qualified Starter who has not seen it", () => {
    assert.equal(shouldOfferLeaderTrial(2, null), true);
    assert.equal(shouldOfferLeaderTrial(1, null), false);
    const seen: TierRecord = {
      tier: "starter",
      source: "trial",
      trialEndsKey: null,
      offerSeenKey: "2026-08-14",
    };
    assert.equal(shouldOfferLeaderTrial(2, seen), false);
    const leader: TierRecord = {
      tier: "leader",
      source: "trial",
      trialEndsKey: "2026-09-12",
      offerSeenKey: null,
    };
    assert.equal(shouldOfferLeaderTrial(2, leader), false);
  });
});

describe("the trial clock — day keys, never Date subtraction (RULES E1)", () => {
  const trial: TierRecord = {
    tier: "leader",
    source: "trial",
    trialEndsKey: "2026-09-12",
    offerSeenKey: "2026-08-14",
  };

  test("30 days, inclusive of the start day", () => {
    assert.equal(LEADER_TRIAL_DAYS, 30);
    // Started 2026-08-14 → last live day 2026-09-12 → 30 days.
    assert.equal(trialDaysLeft(trial, "2026-08-14"), 30);
    assert.equal(trialDaysLeft(trial, "2026-09-12"), 1);
    assert.equal(trialDaysLeft(trial, "2026-09-13"), 0);
  });

  test("effective tier is Leader through the last day and Starter the morning after", () => {
    assert.equal(effectiveTier(trial, "2026-09-12"), "leader");
    assert.equal(effectiveTier(trial, "2026-09-13"), "starter");
  });

  test("expiry is derived at read time — nothing has to run for it to happen", () => {
    // Same record, two different todays, two different answers, zero writes.
    assert.equal(effectiveTier(trial, "2026-08-20"), "leader");
    assert.equal(effectiveTier(trial, "2026-12-01"), "starter");
  });

  test("a paid Leader never expires on a date, because it never carries one", () => {
    const paid: TierRecord = { ...trial, source: "paid", trialEndsKey: null };
    assert.equal(effectiveTier(paid, "2030-01-01"), "leader");
    // No countdown on a subscription: it ends by cancellation, not by a day key.
    assert.equal(trialDaysLeft(paid, "2026-08-14"), 0);
  });

  test("a promo grant DOES expire on its date, and is counted down", () => {
    // The trap this pins: effectiveTier used to expire only `source === "trial"`, so a
    // granted record with an end date was permanent Leader. One code handed out at a
    // club launch would have been free Leader forever for everyone who typed it.
    const granted: TierRecord = {
      tier: "leader",
      source: "granted",
      trialEndsKey: "2026-09-14",
      offerSeenKey: null,
    };
    assert.equal(effectiveTier(granted, "2026-09-14"), "leader", "the last day is live");
    assert.equal(effectiveTier(granted, "2026-09-15"), "starter", "the day after is not");
    assert.equal(trialDaysLeft(granted, "2026-09-14"), 1);
    assert.equal(trialDaysLeft(granted, "2026-09-15"), 0);
  });

  test("a dated source with no date is Starter, not an endless Leader", () => {
    const halfWritten: TierRecord = { ...trial, trialEndsKey: null };
    assert.equal(effectiveTier(halfWritten, "2026-08-14"), "starter");
  });

  test("no record is Starter, and a garbage tier value is Starter", () => {
    assert.equal(effectiveTier(null, "2026-08-14"), "starter");
    assert.equal(isTier("gold"), false);
    assert.equal(isTier("leader"), true);
  });
});

describe("the pricing screen's content (v2 §8)", () => {
  test("Starter is free forever, in those words", () => {
    assert.match(TIER_INFO.starter.priceLine, /free forever/i);
  });

  test("Leader favours annual with monthly as the sub-line", () => {
    assert.match(TIER_INFO.leader.priceLine, /9,999\/year/);
    assert.match(TIER_INFO.leader.subLine ?? "", /2 months free/);
    assert.match(TIER_INFO.leader.subLine ?? "", /999\/month/);
  });

  test("Elite is visible and not available", () => {
    assert.match(TIER_INFO.elite.priceLine, /2,499/);
    assert.equal(TIER_INFO.elite.available, false);
    assert.match(TIER_INFO.elite.subLine ?? "", /coming soon/i);
  });

  test("MANDATORY: no tier copy promises income (RULES L4)", () => {
    for (const info of Object.values(TIER_INFO)) {
      for (const s of [info.name, info.priceLine, info.subLine ?? "", ...info.features]) {
        assert.doesNotMatch(s, /\b(earn|income|commission|profit|salary)\b/i, s);
      }
    }
  });

  test("MANDATORY: no rank names or company names in tier copy (RULES L1/L8)", () => {
    const src = readFileSync("src/modules/tiers/model.ts", "utf8");
    assert.doesNotMatch(src, /\b(supervisor|president'?s team|diamond|chairman'?s club)\b/i);
    assert.doesNotMatch(src, /\b(herbalife|amway|oriflame|vestige|modicare)\b/i);
  });
});

describe("the v1 trial is gone (v2 §8: delete any remnants)", () => {
  test("no screen shows a countdown to a charge that will never happen", () => {
    for (const file of ["src/app/(app)/page.tsx", "src/app/(app)/settings/page.tsx"]) {
      const src = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(src, /Free trial ·|days left|trialDaysLeft|trialEndDate/, file);
    }
  });
});

describe("the gates are standing in the Leader routes", () => {
  test("targets, threads and proof-review call the gate", () => {
    /*
     * The point of wiring gates while they are open is that the flip is one constant.
     * This proves the plumbing exists in each route so nobody has to find it later.
     */
    for (const [file, tool] of [
      ["src/app/api/targets/route.ts", "set-targets"],
      ["src/app/api/threads/route.ts", "send-threads"],
      ["src/app/api/proofs/[id]/route.ts", "review-proofs"],
    ] as const) {
      const src = readFileSync(file, "utf8");
      assert.match(src, new RegExp(`gateLeaderTool\\([^)]*"${tool}"\\)`), file);
      assert.match(src, /status: 402/, `${file} should answer 402 when gated`);
    }
  });

  test("proof SUBMISSION is not gated — only review is", () => {
    const src = readFileSync("src/app/api/proofs/[id]/route.ts", "utf8");
    const reviewIdx = src.indexOf("gateLeaderTool");
    const submitIdx = src.indexOf("submitProof(");
    assert.ok(reviewIdx > 0 && submitIdx > 0);
    // The gate sits inside the decision branch, before reviewProof, and submitProof
    // is reached without passing it.
    assert.ok(reviewIdx < src.indexOf("reviewProof("));
    const submitBranch = src.slice(src.lastIndexOf("\n", submitIdx - 200), submitIdx);
    assert.doesNotMatch(submitBranch, /gateLeaderTool/);
  });
});
