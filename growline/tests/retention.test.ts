import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOUCH_THROTTLE_MS, isStale } from "@/modules/retention/model";

/**
 * The 180-day health-data purge (RULES P5, v2 §5.3).
 *
 * This is the only job in the codebase that destroys user data irreversibly, and it
 * shipped measuring the wrong thing — record age instead of inactivity. These tests pin
 * the boundary and the direction it fails in.
 */

const DAY = 86_400_000;
const RETENTION = 180;
const NOW = new Date("2026-08-14T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe("what counts as stale", () => {
  test("a prospect touched today is not stale", () => {
    assert.equal(isStale(NOW, RETENTION, NOW), false);
  });

  test("the boundary is inclusive at exactly the retention window", () => {
    assert.equal(isStale(daysAgo(179), RETENTION, NOW), false);
    assert.equal(isStale(daysAgo(180), RETENTION, NOW), true);
    assert.equal(isStale(daysAgo(181), RETENTION, NOW), true);
  });

  test("MANDATORY: a missing value is never stale", () => {
    /*
     * This is the direction that matters. A row the backfill has not reached must not be
     * mistaken for one nobody has touched in six months, because the action it triggers
     * cannot be undone. Keeping data too long is a fixable problem; deleting it early is
     * not.
     */
    assert.equal(isStale(null, RETENTION, NOW), false);
  });

  test("a far-future value — a clock skew — is not stale either", () => {
    assert.equal(isStale(new Date(NOW.getTime() + 30 * DAY), RETENTION, NOW), false);
  });
});

describe("the bug this replaced", () => {
  test("MANDATORY: the purge no longer queries createdAt", () => {
    /*
     * The exact regression: `where("createdAt", "<", cutoff)` nulled the height, weight
     * and derived metrics of a prospect captured 200 days ago and worked yesterday, and
     * deleted their reports with them. Live data destroyed on a healthy relationship.
     */
    const purge = readFileSync("functions/src/healthRetention.ts", "utf8");
    assert.match(purge, /where\("lastActivityAt", "<="/);
    assert.doesNotMatch(purge, /where\("createdAt", "<"/);
  });

  test("the composite index matches the query the purge now makes", () => {
    // The emulator invents missing indexes, so nothing else in this repo would notice
    // that changing the query orphaned its index — it would surface as
    // FAILED_PRECONDITION on the first real run, inside a scheduled job nobody watches.
    const idx = JSON.parse(readFileSync("firestore.indexes.json", "utf8")) as {
      indexes: { collectionGroup: string; fields: { fieldPath: string }[] }[];
    };
    const match = idx.indexes.find(
      (i) =>
        i.collectionGroup === "prospects" &&
        i.fields.length === 2 &&
        i.fields[0].fieldPath === "lastActivityAt" &&
        i.fields[1].fieldPath === "heightCm"
    );
    assert.ok(match, "no (lastActivityAt, heightCm) index for the retention purge");
  });
});

describe("activity is only what the rule names", () => {
  test("a stage move touches; editing notes or a follow-up date does not", () => {
    /*
     * RULES P5 says "no stage change, no report view". Counting a notes edit would let a
     * coach keep somebody's health data alive indefinitely through activity that person
     * took no part in, which is the rule made decorative.
     */
    const route = readFileSync(
      "src/app/api/prospects/[id]/pipeline/route.ts",
      "utf8"
    );
    assert.match(route, /if \(data\.stage !== undefined\) await touchProspect\(/);
  });

  test("a report view touches, but not when the coach is previewing their own send", () => {
    const page = readFileSync("src/app/r/[token]/page.tsx", "utf8");
    assert.match(page, /if \(!viewerOwnsProspect\) void touchProspect\(/);
  });

  test("capture seeds the field, so a new prospect is never invisible to the purge", () => {
    const src = readFileSync("src/lib/prospects.ts", "utf8");
    assert.match(src, /lastActivityAt: Timestamp\.now\(\)/);
  });
});

describe("the write throttle", () => {
  test("is a day — long enough to bound cost, far short of the 180-day window", () => {
    /*
     * A report view is an unauthenticated page load, so writing on every one is both a
     * cost bomb and a way for anybody holding the link to run up a bill. The precision
     * given up is a day against a window of 180; it cannot change a purge decision.
     */
    assert.equal(TOUCH_THROTTLE_MS, DAY);
    assert.ok(TOUCH_THROTTLE_MS * 30 < RETENTION * DAY);
  });
});
