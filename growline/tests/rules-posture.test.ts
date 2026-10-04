import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The shape of the rules files, checked as text.
 *
 * The eight Security-Rules suites in `e2e/` prove what `firestore.rules` ALLOWS, against
 * a real emulator, and they are the real coverage. This file checks something they
 * structurally cannot: that nothing in either file is open in the first place, and that
 * `storage.rules` — which no suite touches at all, because the storage emulator is not
 * in the emulator set — still denies everything.
 *
 * Written after a manual pre-deploy sweep on 2026-08-20 found the files clean. A sweep
 * somebody has to remember to run is a sweep that stops being run, and the first deploy
 * to a real project is exactly the moment nobody has spare attention.
 */

const firestoreRules = readFileSync("firestore.rules", "utf8");
const storageRules = readFileSync("storage.rules", "utf8");

/** Rule text with comments removed — a rule quoted in a comment is not a rule. */
function code(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("storage stays shut until somebody opens it deliberately", () => {
  test("storage.rules grants nothing", () => {
    // Storage is unwired (no firebase/storage import anywhere) and the rules are
    // deny-all. Pro portfolio, the Goal Sheet dream photo and video proofs all wait on
    // this being opened ON PURPOSE, with rules written for each path — not on somebody
    // loosening the catch-all to unblock themselves.
    const c = code(storageRules);
    assert.match(c, /allow read, write: if false;/, "the deny-all rule is gone");
    assert.doesNotMatch(c, /if\s+true/, "storage.rules grants something");
    assert.doesNotMatch(c, /if\s+request\.auth\s*!=\s*null/, "storage is open to any signed-in user");
  });
});

describe("no blanket allow survived into firestore.rules", () => {
  test("nothing is granted unconditionally", () => {
    for (const line of code(firestoreRules).split("\n")) {
      assert.doesNotMatch(line, /allow\s+[a-z, ]*:\s*if\s+true\s*;/, `open rule: ${line.trim()}`);
    }
  });

  test("no time-bombed test-mode rule", () => {
    /*
     * Firebase's "test mode" writes a rule of the form
     *   allow read, write: if request.time < timestamp.date(2026, 9, 1);
     * which leaves the whole database world-readable until that date and then breaks
     * every read at once. It is the single most common way a Firestore project leaks,
     * and because it EXPIRES it also looks like a working app right up until it doesn't.
     *
     * This app holds prospect names, phone numbers and health fields. That rule must
     * never appear in either file.
     */
    for (const [name, src] of [
      ["firestore.rules", firestoreRules],
      ["storage.rules", storageRules],
    ] as const) {
      assert.doesNotMatch(code(src), /request\.time\s*<\s*timestamp\.date/, `${name} is in test mode`);
    }
  });

  test("the privacy toggle is still enforced in rules, not just in the app", () => {
    // RULES P2 makes this mandatory, and e2e/rules.test.ts proves the behaviour. This
    // asserts the mechanism has not been quietly refactored out from under that test:
    // an upline's read of prospects must still be conditioned on shareProspects.
    assert.match(code(firestoreRules), /shareProspects/, "shareProspects is not referenced");
  });
});
