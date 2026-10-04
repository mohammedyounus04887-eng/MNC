import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

/**
 * The Phase-2 features the owner authorised on 2026-08-14 (D74).
 *
 * ## Why this file exists
 *
 * RULES S7 says "No Phase 2 features early. If it maps to v1 §8, park it", and these four
 * DO map to §8 — F13 is the line item verbatim. They ship anyway, by explicit owner
 * decision. That makes them permanently odd-looking: a future session reading S7, finding
 * leaderboards, and tidying up would be following the written rule and destroying
 * authorised work.
 *
 * So the authorisation is pinned here, where a deletion trips a test instead of passing
 * review. The failure message points at D74 rather than just going red.
 */

const AUTHORISED = [
  { name: "F13 Leaderboards", dir: "src/modules/leaderboards", route: "src/app/(app)/leaderboards" },
  { name: "F14 Qualifications", dir: "src/modules/qualifications", route: "src/app/(app)/qualifications" },
  { name: "F20 Duplication", dir: "src/modules/duplication", route: "src/app/(app)/duplication" },
  { name: "Quick win: voice-note log", dir: "src/modules/voice-log", route: "src/app/(app)/voice-log" },
  { name: "Quick win: who-to-call", dir: "src/modules/call-list", route: "src/app/(app)/who-to-call" },
] as const;

/** The six scheduled jobs these features depend on. Unexported = the feature is inert. */
const REQUIRED_FUNCTIONS = [
  "rebuildLeaderboards",
  "evaluateQualifications",
  "qualificationReminders",
  "rebuildDuplicationScores",
  "silenceCheck",
  "purgeVoiceNotes",
] as const;

describe("the authorised Phase-2 features are still here (D74)", () => {
  for (const f of AUTHORISED) {
    test(`${f.name} exists`, () => {
      assert.ok(
        existsSync(f.dir),
        `${f.dir} is gone. If this was a RULES S7 cleanup, STOP — the owner authorised ` +
          `these on 2026-08-14 (DECISIONS.md D74). S7 still parks the REST of v1 §8.`
      );
      assert.ok(existsSync(f.route), `${f.route} is gone — the feature is unreachable`);
    });
  }

  test("MANDATORY: every one is reachable from the More hub, not by typed URL", () => {
    /*
     * They were URL-only for weeks, which is indistinguishable from not shipping. Now that
     * they are authorised, a coach following the UI has to be able to find them — and the
     * bottom bar is full at five tabs, so /more is the answer.
     */
    const more = readFileSync("src/app/(app)/more/page.tsx", "utf8");
    for (const f of AUTHORISED) {
      const href = f.route.replace("src/app/(app)", "");
      assert.match(more, new RegExp(`href: "${href}"`), `${f.name} is not linked from /more`);
    }
  });
});

describe("the jobs that make them work actually deploy", () => {
  test("MANDATORY: all six are exported from the Functions entry point", () => {
    /*
     * This was bug #1: six functions written and none exported, so none deployed and every
     * feature was inert. An export is one line and its absence is invisible — the boards
     * simply stay empty, which reads as "no data yet" rather than as a broken deploy.
     */
    const index = readFileSync("functions/src/index.ts", "utf8");
    for (const fn of REQUIRED_FUNCTIONS) {
      assert.ok(
        index.includes(fn),
        `${fn} is not exported from functions/src/index.ts — the feature will be inert`
      );
    }
  });

  test("every scheduled job source file is still present", () => {
    const files = readdirSync("functions/src");
    for (const f of ["leaderboards.ts", "qualifications.ts", "duplication.ts", "silence.ts", "voice-logs.ts"]) {
      assert.ok(files.includes(f), `functions/src/${f} is gone`);
    }
  });
});

describe("S7 is not repealed — only these four are excepted", () => {
  test("the rule still says park, and names the exception", () => {
    const rules = readFileSync("RULES.md", "utf8");
    const s7 = rules.split("\n").find((l) => l.startsWith("| S7 |")) ?? "";
    assert.match(s7, /park it/i, "S7 must still say park");
    assert.match(s7, /D74/, "S7 must point at the decision that excepted these four");
    assert.match(s7, /exception is not the rule/i);
  });

  test("the rest of v1 §8 is still unbuilt, and that is the point", () => {
    /*
     * The cheapest way to lose a rule is to let one authorised exception read as its
     * repeal. If any of these appears, it needs its OWN owner decision — not a citation
     * of D74.
     */
    for (const parked of [
      "src/modules/feed",
      "src/modules/events",
      "src/modules/posters",
      "src/modules/club-owner",
      "src/app/(app)/feed",
      "src/app/(app)/events",
    ]) {
      assert.ok(
        !existsSync(parked),
        `${parked} exists — that is v1 §8 work D74 did NOT authorise. It needs its own decision.`
      );
    }
  });
});
