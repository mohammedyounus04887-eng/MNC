import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_LEADER_DAYS,
  checkMint,
  checkRedeemable,
  extendedEndKey,
  isValidCodeShape,
  normaliseCode,
  redeemedMessage,
} from "@/modules/promo/model";
import { daysBetweenKeys, shiftKey } from "@/lib/daily-log";

/**
 * Promo codes (v2 §8, Phase 9b).
 *
 * The arithmetic is the whole risk here. A code is days of free Leader, and getting the
 * sum wrong means either taking days off somebody who was given a present, or handing
 * out a longer run than the business agreed to. Both are silent.
 */

const TODAY = "2026-08-19";

describe("code normalisation — a poster read out loud, typed one-handed", () => {
  test("case, spaces and dashes do not matter", () => {
    for (const raw of ["FOUNDING50", "founding50", "Founding 50", "founding-50", " FOUNDING50 "]) {
      assert.equal(normaliseCode(raw), "FOUNDING50", raw);
    }
  });

  test("a non-string is the empty code, not a crash", () => {
    assert.equal(normaliseCode(undefined), "");
    assert.equal(normaliseCode(42), "");
    assert.equal(normaliseCode(null), "");
  });

  test("shape rejects punctuation and absurd lengths", () => {
    assert.equal(isValidCodeShape("FOUNDING50"), true);
    assert.equal(isValidCodeShape("AB"), false, "too short");
    assert.equal(isValidCodeShape("A".repeat(25)), false, "too long");
    assert.equal(isValidCodeShape("FOUND!NG"), false, "punctuation");
    assert.equal(isValidCodeShape("founding"), false, "must already be normalised");
  });
});

describe("extension arithmetic (RULES E1 — through day.ts, never a Date subtraction)", () => {
  test("a coach with no run gets exactly leaderDays, inclusive of today", () => {
    const end = extendedEndKey({ todayKey: TODAY, currentEndKey: null, leaderDays: 30 });
    // Inclusive: today counts as day 1, so the last live day is today + 29.
    assert.equal(end, shiftKey(TODAY, 29));
    assert.equal(daysBetweenKeys(TODAY, end) + 1, 30, "30 live days including today");
  });

  test("a one-day grant starts and ends today", () => {
    assert.equal(extendedEndKey({ todayKey: TODAY, currentEndKey: null, leaderDays: 1 }), TODAY);
  });

  test("days are ADDED to a live run, never substituted for it", () => {
    // Eleven days into a 30-day qualification trial: nineteen left, ending 2026-09-06.
    const currentEndKey = "2026-09-06";
    const end = extendedEndKey({ todayKey: TODAY, currentEndKey, leaderDays: 90 });
    assert.equal(
      daysBetweenKeys(currentEndKey, end),
      90,
      "90 days on top of the nineteen they had, not 90 instead of them"
    );
    // The failure this guards: replacing the run would have ended 2026-11-16, which is
    // EARLIER than extending it, silently costing the coach their remaining nineteen.
    assert.ok(end > shiftKey(TODAY, 89), "extending must beat replacing");
  });

  test("a run that ends today is still live, and is extended", () => {
    const end = extendedEndKey({ todayKey: TODAY, currentEndKey: TODAY, leaderDays: 10 });
    assert.equal(daysBetweenKeys(TODAY, end), 10);
  });

  test("a LAPSED run is not extended — the grant starts today", () => {
    const end = extendedEndKey({ todayKey: TODAY, currentEndKey: "2026-07-01", leaderDays: 30 });
    assert.equal(end, shiftKey(TODAY, 29), "a finished run adds nothing");
  });

  test("it crosses a month and a year end without drifting", () => {
    assert.equal(
      extendedEndKey({ todayKey: "2026-12-20", currentEndKey: null, leaderDays: 30 }),
      "2027-01-18"
    );
    // A leap year, because February is where hand-rolled date maths dies.
    assert.equal(
      extendedEndKey({ todayKey: "2028-02-27", currentEndKey: null, leaderDays: 4 }),
      "2028-03-01"
    );
  });
});

describe("minting bounds — the 11pm-before-a-launch typo", () => {
  const good = { code: "FOUNDING50", leaderDays: 90, maxUses: 50, expiresKey: "2026-12-31" };

  test("a good code passes and comes back normalised", () => {
    const r = checkMint({ ...good, code: "founding-50" }, TODAY);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.code, "FOUNDING50");
  });

  test("an extra zero on the days is refused", () => {
    const r = checkMint({ ...good, leaderDays: 900 }, TODAY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, new RegExp(String(MAX_LEADER_DAYS)));
  });

  test("zero, fractional and negative values are refused", () => {
    for (const leaderDays of [0, -30, 1.5]) {
      assert.equal(checkMint({ ...good, leaderDays }, TODAY).ok, false, String(leaderDays));
    }
    for (const maxUses of [0, -1, 2.5]) {
      assert.equal(checkMint({ ...good, maxUses }, TODAY).ok, false, String(maxUses));
    }
  });

  test("a code that expired before it was minted is refused", () => {
    const r = checkMint({ ...good, expiresKey: "2026-08-18" }, TODAY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /already passed/i);
  });

  test("expiring today is fine — a code minted for tonight's launch", () => {
    assert.equal(checkMint({ ...good, expiresKey: TODAY }, TODAY).ok, true);
  });
});

describe("redeemability", () => {
  const promo = { uses: 0, maxUses: 50, expiresKey: "2026-12-31" };

  test("a live code is redeemable, including on its last day", () => {
    assert.equal(checkRedeemable(promo, TODAY).ok, true);
    assert.equal(checkRedeemable(promo, "2026-12-31").ok, true);
  });

  test("an unknown code and an expired code give the SAME answer", () => {
    // A code is a bearer token. Distinguishing "wrong" from "expired" would let somebody
    // probe which codes exist.
    const unknown = checkRedeemable(null, TODAY);
    const expired = checkRedeemable(promo, "2027-01-01");
    assert.equal(unknown.ok, false);
    assert.equal(expired.ok, false);
    if (!unknown.ok && !expired.ok) assert.equal(unknown.error, expired.error);
  });

  test("a fully-used code says so, because the coach's code is real", () => {
    const r = checkRedeemable({ ...promo, uses: 50 }, TODAY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /fully used/i);
  });
});

describe("Trust Zone (RULES G1) and RULES L4", () => {
  test("the success line says what happened and what did NOT", () => {
    const m = redeemedMessage("2026-11-17");
    assert.match(m, /2026-11-17/);
    assert.match(m, /nothing was charged/i);
    assert.doesNotMatch(m, /!/);
    assert.doesNotMatch(m, /🎉|🔥|congrat/i);
  });

  /**
   * Comment lines are stripped before any of these sweeps run.
   *
   * The first version of this checked the raw file and failed on the doc comment that
   * explains WHY there is no celebration here — a sweep that punishes writing the rule
   * down teaches the next person to delete the explanation instead of the confetti.
   * What must be clean is what ships to the screen.
   */
  const codeOnly = (path: string) =>
    readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => {
        const t = l.trimStart();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join("\n");

  test("the redeem field carries no celebration and no income wording", () => {
    // G1: /plans is a Trust Zone, and a grant arriving there must not teach a coach
    // that this screen celebrates — one scroll above the buttons that charge them.
    const src = codeOnly("src/modules/promo/RedeemField.tsx");
    assert.doesNotMatch(src, /confetti|celebrat|🎉|🔥/i);
    // L4: no income promises anywhere, including in a free-days message.
    assert.doesNotMatch(src, /earn ₹|income|₹\d/i);
  });

  test("no promo copy implies a discount — a code is days, never a price", () => {
    for (const f of ["src/modules/promo/model.ts", "src/modules/promo/RedeemField.tsx"]) {
      assert.doesNotMatch(codeOnly(f), /\b(discount|% off|cheaper)\b/i, f);
    }
  });
});
