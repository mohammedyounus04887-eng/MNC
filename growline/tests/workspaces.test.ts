import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACCENTS,
  ACCENT_KEYS,
  DEFAULT_ACCENT,
  MAX_LEVEL_GROUPS,
  MAX_LEVEL_GROUP_NAME,
  MAX_WORKSPACE_NAME,
  checkLevelGroups,
  checkWorkspaceName,
  isAccentKey,
  sameWorkspace,
} from "@/modules/workspaces/model";

/**
 * The pure half of workspaces. The parts that need Firestore — placement at signup and
 * read isolation — are covered by `scripts/verify-workspaces.ts` and
 * `e2e/workspace-rules.test.ts` respectively, because neither is expressible here.
 */

describe("the workspace boundary predicate", () => {
  test("matches only when both sides name the same workspace", () => {
    assert.equal(sameWorkspace("ws_a", "ws_a"), true);
    assert.equal(sameWorkspace("ws_a", "ws_b"), false);
  });

  test("a missing id on either side matches NOTHING", () => {
    /**
     * The important case. A coach the backfill has not reached has no workspace, and a
     * document written before workspaces existed has none either — so a naive equality
     * check would make those two "the same workspace" and open the boundary at exactly
     * the point the data is worst. Every falsy combination must be false.
     */
    for (const [reader, document] of [
      [null, null],
      [undefined, undefined],
      ["", ""],
      [null, "ws_a"],
      ["ws_a", null],
      ["", "ws_a"],
      ["ws_a", ""],
      [undefined, "ws_a"],
      ["ws_a", undefined],
    ] as const) {
      assert.equal(
        sameWorkspace(reader, document),
        false,
        `sameWorkspace(${JSON.stringify(reader)}, ${JSON.stringify(document)}) must be false`
      );
    }
  });
});

describe("accent colours are an allow-list, not a colour value", () => {
  test("every key has a label and a real CSS variable", () => {
    for (const key of ACCENT_KEYS) {
      assert.ok(ACCENTS[key]?.label.trim(), `${key} has no label`);
      assert.match(ACCENTS[key].cssVar, /^--[a-z-]+$/, `${key} has a malformed var`);
    }
  });

  test("every accent variable actually exists in the stylesheet", () => {
    // A var that does not exist paints as "no colour at all", and a swatch rendering
    // nothing is indistinguishable from a swatch that is simply dark. Caught once
    // already: the pink accent pointed at `--pink-text`, which is spelled
    // `--gem-pink-text`.
    const css = readFileSync("src/app/globals.css", "utf8");
    for (const key of ACCENT_KEYS) {
      const declared = new RegExp(`^\\s*${ACCENTS[key].cssVar}\\s*:`, "m").test(css);
      assert.ok(declared, `${ACCENTS[key].cssVar} (${key}) is not defined in globals.css`);
    }
  });

  test("isAccentKey refuses anything not offered", () => {
    for (const key of ACCENT_KEYS) assert.equal(isAccentKey(key), true);
    for (const bad of ["#ff0000", "red", "GOLD", "", null, undefined, 5, {}, ["gold"]]) {
      assert.equal(isAccentKey(bad), false, `${JSON.stringify(bad)} must be refused`);
    }
  });

  test("the default is a real key", () => {
    assert.equal(isAccentKey(DEFAULT_ACCENT), true);
  });
});

describe("workspace name", () => {
  test("trims, and refuses empty or whitespace-only", () => {
    assert.deepEqual(checkWorkspaceName("  Alpha Group "), { ok: true, name: "Alpha Group" });
    for (const bad of ["", "   ", "\n\t", null, undefined, 5]) {
      assert.equal(checkWorkspaceName(bad).ok, false, `${JSON.stringify(bad)} must fail`);
    }
  });

  test("the length cap, at the boundary", () => {
    assert.equal(checkWorkspaceName("a".repeat(MAX_WORKSPACE_NAME)).ok, true);
    assert.equal(checkWorkspaceName("a".repeat(MAX_WORKSPACE_NAME + 1)).ok, false);
  });
});

describe("level names — RULES L1/L8 territory", () => {
  test("nothing is ever supplied: an empty list stays empty", () => {
    /**
     * The rule that matters most in this module. A level name may exist ONLY because a
     * human typed it, so no default, no starter list and no substitution may ever appear
     * here. If this test ever fails because something "helpful" was added, the helpful
     * thing is the bug.
     */
    assert.deepEqual(checkLevelGroups([]), { ok: true, levelGroups: [] });
    assert.deepEqual(checkLevelGroups(["", "  ", "\n"]), { ok: true, levelGroups: [] });
  });

  test("blank rows are dropped rather than rejected", () => {
    // The editor is a list of rows; an empty one is somebody deleting a level, not an
    // error to argue with.
    assert.deepEqual(checkLevelGroups(["Starter", "", "Leader", "   "]), {
      ok: true,
      levelGroups: ["Starter", "Leader"],
    });
  });

  test("duplicates are dropped, case-insensitively", () => {
    assert.deepEqual(checkLevelGroups(["Leader", "leader", "LEADER", "Elite"]), {
      ok: true,
      levelGroups: ["Leader", "Elite"],
    });
  });

  test("order is preserved — it is a ladder, not a set", () => {
    assert.deepEqual(checkLevelGroups(["Three", "One", "Two"]).ok && checkLevelGroups(["Three", "One", "Two"]), {
      ok: true,
      levelGroups: ["Three", "One", "Two"],
    });
  });

  test("a too-long single name is refused, at the boundary", () => {
    assert.equal(checkLevelGroups(["a".repeat(MAX_LEVEL_GROUP_NAME)]).ok, true);
    assert.equal(checkLevelGroups(["a".repeat(MAX_LEVEL_GROUP_NAME + 1)]).ok, false);
  });

  test("too many levels is refused, at the boundary", () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `L${i}`);
    assert.equal(checkLevelGroups(names(MAX_LEVEL_GROUPS)).ok, true);
    assert.equal(checkLevelGroups(names(MAX_LEVEL_GROUPS + 1)).ok, false);
  });

  test("non-arrays and non-strings are handled without throwing", () => {
    assert.equal(checkLevelGroups("Leader").ok, false);
    assert.equal(checkLevelGroups(null).ok, false);
    // Junk entries inside a valid array are skipped, not fatal.
    assert.deepEqual(checkLevelGroups([1, "Leader", null, {}, "Elite"]), {
      ok: true,
      levelGroups: ["Leader", "Elite"],
    });
  });
});
