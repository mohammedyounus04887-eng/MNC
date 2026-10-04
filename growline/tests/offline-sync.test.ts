import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The offline queue's drain loop (v1 §4.3 / RULES S5).
 *
 * ## What these can and cannot prove
 *
 * They are source assertions, and they are honest about being a backstop rather than the
 * real guard. The real guard is `e2e/offline-capture.spec.ts`, which cuts the signal in a
 * live browser and is the only thing that can exercise IndexedDB, `navigator.onLine` and
 * a page teardown racing an event.
 *
 * These exist because that e2e failed for days while being read as flaky, and the actual
 * defect was a single early `return` — a shape small enough to be reintroduced by anyone
 * tidying the file, and cheap enough to pin here.
 */

const src = readFileSync("src/components/OfflineSync.tsx", "utf8");
/** Comments stripped: the file explains the bug it fixes, using the bug's own words. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("a non-empty queue is a level, not an edge", () => {
  test("MANDATORY: being offline schedules a retry instead of giving up", () => {
    /*
     * The regression, exactly: `if (!navigator.onLine) return;` treated "offline right
     * now" as terminal. If the `online` event had already fired on a page being torn
     * down — which is what happens when the signal returns milliseconds before a
     * navigation — nothing ever tried again and the captured person stayed in IndexedDB.
     */
    const guard = code.match(/if \(!navigator\.onLine\) \{[^}]*\}/);
    assert.ok(guard, "the offline guard is gone or reshaped — check it still retries");
    assert.match(guard[0], /schedule\(\)/, "offline must schedule a retry, not return");
    assert.doesNotMatch(
      code,
      /if \(!navigator\.onLine\) return;/,
      "a bare early return is the exact bug this file was rewritten to remove"
    );
  });

  test("a partial drain comes back for what is left", () => {
    // `syncQueue` stops at the first item the server will not take, so `synced > 0` and
    // `remaining > 0` are simultaneously possible and must not be read as success.
    assert.match(code, /result\.remaining > 0/);
    const tail = code.slice(code.indexOf("result.remaining > 0"));
    assert.match(tail.slice(0, 120), /schedule\(\)/);
  });

  test("the queue is read before the network is checked", () => {
    // An empty queue must cost nothing and schedule nothing, whatever the signal is
    // doing — that is every mount in the app, on every screen.
    const drain = code.slice(code.indexOf("const drain ="));
    assert.ok(
      drain.indexOf("listQueued()") < drain.indexOf("navigator.onLine"),
      "checking the network first would schedule retries for an empty queue"
    );
  });
});

describe("the retry cannot become a burst or a leak", () => {
  test("only one timer is ever outstanding", () => {
    // Mount, `online`, a queue write and a tab becoming visible can all fire within a
    // few milliseconds of a signal returning; four timers would be a burst, not a backoff.
    assert.match(code, /if \(cancelled \|\| timer !== undefined\) return;/);
  });

  test("the timer is cleared on unmount", () => {
    const cleanup = code.slice(code.lastIndexOf("return () =>"));
    assert.match(cleanup, /clearTimeout\(timer\)/);
    assert.match(cleanup, /cancelled = true/);
  });

  test("the backoff has a bounded tail rather than growing forever", () => {
    const arr = src.match(/RETRY_MS = \[([^\]]+)\]/);
    assert.ok(arr, "RETRY_MS is gone");
    const waits = arr[1].split(",").map((s) => Number(s.replace(/[_\s]/g, "")));
    assert.ok(waits.length >= 3, "a backoff needs steps");
    for (let i = 1; i < waits.length; i++) {
      assert.ok(waits[i] > waits[i - 1], "waits must increase");
    }
    // The tail is what matters on a phone: a coach offline for an hour should still
    // drain within half a minute of the signal returning, not an hour later.
    assert.ok(waits[waits.length - 1] <= 60_000, "the longest wait should stay under a minute");
  });

  test("a returning signal resets the backoff", () => {
    // The reason the last attempt failed is gone, so the next one should not wait 30s.
    const onOnline = code.slice(code.indexOf("const onOnline"));
    assert.match(onOnline.slice(0, 160), /attempt = 0/);
  });
});
