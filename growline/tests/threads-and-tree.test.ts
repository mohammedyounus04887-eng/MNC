import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_BODY,
  MAX_LINK_URL,
  MAX_LINK_URL_STORED,
  SCOPE_HELP,
  SCOPE_LABELS,
  THREAD_SCOPES,
  attribution,
  audienceLabel,
  canRead,
  checkBody,
  checkLinkUrl,
  isThreadScope,
  relativeTime,
} from "@/lib/threads";

/**
 * Unit tests for the pure logic behind threads (F8, v2 §6) and the Firestore tree
 * and document-id layer (D35, D36, D41, D51).
 *
 * ## What these tests are actually defending
 *
 * Two of the things under test here are security controls rather than conveniences,
 * and the tests are written accordingly — as attempts to break them, not as
 * demonstrations that the happy path works:
 *
 *   `canRead`     is the app-side copy of the addressing rule. It decides whether one
 *                 coach's broadcast is shown to another coach, and the single most
 *                 important thing it does is REFUSE — a "direct line only" message
 *                 must not reach a grandchild. `firestore.rules` states the same rule
 *                 independently (RULES P2), and the rules tests cover that side; this
 *                 file covers the copy the server render trusts.
 *
 *   `checkLinkUrl` validates a URL authored by one coach and rendered as an anchor to
 *                 thousands of others. It is the one field in the app with that shape,
 *                 so the scheme allow-list is the whole defence and every obfuscation
 *                 worth trying is tried below.
 *
 * The document-id builders are a third: each one IS a uniqueness constraint that
 * Firestore does not otherwise have (D35), so "deterministic" and "never collides"
 * are correctness properties and not implementation details.
 *
 * ## Expectations come from the spec, not from the code
 *
 * Where the two disagree, the test asserts what the spec says and is marked `todo` with
 * the reason — a failing expectation that does not fail the run. The alternative, an
 * assertion pinned to what the code currently returns, is worse than no test: it makes
 * the gap permanent and reads to the next person as a decision somebody made. Grep
 * `KNOWN GAP` for the two in this file; each says what the fix is and why this file did
 * not make it.
 *
 * ## Fixed instants only
 *
 * `relativeTime` is fed explicit `now` values. Reading `Date.now()` in a test makes it
 * pass at 11:00 and fail at 23:55 IST, and E1 exists because a day boundary has
 * already been got wrong once in this codebase.
 */

// ---------------------------------------------------------------------------
// Loading `@/lib/collections`
// ---------------------------------------------------------------------------

/**
 * `@/lib/collections` is NOT importable on its own, and that is worth being explicit
 * about rather than quietly working around.
 *
 * It imports `./firebase-admin` for the `db` handle used by the collection-reference
 * helpers at the bottom of the file. `firebase-admin.ts` resolves its target at MODULE
 * SCOPE, on purpose — `const target = resolveTarget()` runs for anybody who imports
 * `db`, so a half-configured process fails at import instead of at request time, and
 * the comment there explains why that check cannot live inside `createApp()`. The
 * consequence for a unit test is that a bare `import("@/lib/collections")` throws
 * "FIREBASE_SERVICE_ACCOUNT is not set, and no emulator host is configured" before a
 * single pure function becomes reachable. Initialisation is eager, not lazy.
 *
 * So this file points the process at the emulators before importing. Nothing here
 * talks to them: `initializeApp({ projectId })`, `getFirestore()` and `settings()` are
 * all local, and no query is ever issued, so the host does not need to be listening.
 * The emulator branch is deliberately the one chosen over supplying a fake
 * `FIREBASE_SERVICE_ACCOUNT` — a credential is the SDK's signal that a real project is
 * intended, and a test process should not be one env var away from writing to one.
 * `FIREBASE_SERVICE_ACCOUNT` is deleted for the same reason, and because
 * `resolveTarget` refuses a credential alongside an emulator host.
 *
 * `node --test` runs each test FILE in its own process, so this mutation cannot reach
 * a sibling test file.
 *
 * The alternative — moving the pure functions out of `collections.ts` into a module
 * with no `db` import — is a source change, and this file does not get to make one.
 * It is the right fix and it is reported upward instead.
 */
delete process.env.FIREBASE_SERVICE_ACCOUNT;
if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "growline-unit-test";
}
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
}
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
}

/**
 * Dynamic and memoised. Dynamic because the env preamble above has to run first, and
 * a static `import` is hoisted above it. Memoised so the firebase-admin app is created
 * once for the file rather than once per test.
 */
let collectionsPromise: Promise<typeof import("@/lib/collections")> | null = null;
function loadCollections(): Promise<typeof import("@/lib/collections")> {
  if (!collectionsPromise) collectionsPromise = import("@/lib/collections");
  return collectionsPromise;
}

// ===========================================================================
// threads.ts — the addressing rule
// ===========================================================================

describe("canRead — who a broadcast reaches", () => {
  /**
   * The tree, declared once as parent→children, which is the shape a human can check
   * by eye:
   *
   *     root
   *     ├── asha
   *     │   └── chandan
   *     │       └── deepa
   *     └── bhavana
   *
   *     outsider          (a root of their own, no relation to anybody above)
   *
   * `bhavana` is the sibling branch: nothing asha sends may reach her. `deepa` sits
   * three levels under root, which is what makes "scope all reaches ANY descendant, at
   * any depth" a real claim rather than a claim about children.
   */
  const CHILDREN: Record<string, string[]> = {
    root: ["asha", "bhavana"],
    asha: ["chandan"],
    bhavana: [],
    chandan: ["deepa"],
    deepa: [],
    outsider: [],
  };

  /**
   * The same tree as the reader documents the app actually holds. Written out by hand
   * rather than derived, so that a mistake in `buildUplinePath` cannot quietly make
   * every assertion below agree with itself. The first test checks the two views match.
   *
   * `uplinePath` is nearest-ancestor-first (D36), which is what lets `canRead` treat
   * "direct" as an equality check and "all" as membership.
   */
  type Reader = { id: string; uplineId: string | null; uplinePath: string[] };
  const READERS: Record<string, Reader> = {
    root: { id: "root", uplineId: null, uplinePath: [] },
    asha: { id: "asha", uplineId: "root", uplinePath: ["root"] },
    bhavana: { id: "bhavana", uplineId: "root", uplinePath: ["root"] },
    chandan: { id: "chandan", uplineId: "asha", uplinePath: ["asha", "root"] },
    deepa: {
      id: "deepa",
      uplineId: "chandan",
      uplinePath: ["chandan", "asha", "root"],
    },
    outsider: { id: "outsider", uplineId: null, uplinePath: [] },
  };

  const EVERYONE = Object.keys(READERS);

  const parentOf = (id: string): string | null => {
    for (const [parent, kids] of Object.entries(CHILDREN)) {
      if (kids.includes(id)) return parent;
    }
    return null;
  };

  const ancestorsOf = (id: string): string[] => {
    const out: string[] = [];
    for (let p = parentOf(id); p; p = parentOf(p)) out.push(p);
    return out;
  };

  const descendantsOf = (id: string): Set<string> => {
    const out = new Set<string>();
    const queue = [...(CHILDREN[id] ?? [])];
    while (queue.length > 0) {
      const next = queue.shift() as string;
      if (out.has(next)) continue;
      out.add(next);
      queue.push(...(CHILDREN[next] ?? []));
    }
    return out;
  };

  const thread = (senderId: string, scope: string) => ({ senderId, scope });

  test("the fixture's two views of the tree agree", () => {
    // Not a test of the product — a test of the test. If these drift, every
    // assertion below is checking `canRead` against a tree nobody drew.
    for (const id of EVERYONE) {
      assert.equal(READERS[id].uplineId, parentOf(id), `uplineId for ${id}`);
      assert.deepEqual(READERS[id].uplinePath, ancestorsOf(id), `uplinePath for ${id}`);
    }
  });

  test("a sender can always read their own broadcast, at either scope", () => {
    // The sender is the one watching the seen and ack counts rise, so their own card
    // has to be in their own feed. `firestore.rules` grants this as its first branch.
    for (const id of EVERYONE) {
      for (const scope of THREAD_SCOPES) {
        assert.equal(canRead(thread(id, scope), READERS[id]), true, `${id}/${scope}`);
      }
    }
  });

  test('scope "all" reaches every descendant, at any depth', () => {
    // root → asha is one level, root → chandan is two, root → deepa is three. Depth is
    // the whole point of "all": v2 §6's scope help says "however deep it goes".
    for (const reader of ["asha", "bhavana", "chandan", "deepa"]) {
      assert.equal(canRead(thread("root", "all"), READERS[reader]), true, reader);
    }
    // And from a middle of the tree, so this is not only a property of the root.
    assert.equal(canRead(thread("asha", "all"), READERS.chandan), true);
    assert.equal(canRead(thread("asha", "all"), READERS.deepa), true);
  });

  test('scope "direct" reaches ONLY direct downlines — a grandchild is refused', () => {
    /**
     * The single most important assertion in this file.
     *
     * "My direct line only" means the coaches the sender brought in themselves
     * (SCOPE_HELP.direct says exactly that). A grandchild receiving it is not a
     * cosmetic bug: the sender chose the narrower of two options, was shown copy
     * promising it, and cannot see afterwards who actually got the message. D51 makes
     * the same guarantee on the rules side — "a 'direct line only' message from a
     * grandparent is not addressed to you, and the rules will not serve it."
     */
    assert.equal(canRead(thread("root", "direct"), READERS.asha), true, "child asha");
    assert.equal(canRead(thread("root", "direct"), READERS.bhavana), true, "child bhavana");

    assert.equal(
      canRead(thread("root", "direct"), READERS.chandan),
      false,
      "grandchild must NOT receive a direct-line-only broadcast"
    );
    assert.equal(
      canRead(thread("root", "direct"), READERS.deepa),
      false,
      "great-grandchild must NOT receive a direct-line-only broadcast"
    );

    // Same shape one level down, so it is not an artefact of the root's empty path.
    assert.equal(canRead(thread("asha", "direct"), READERS.chandan), true, "asha's child");
    assert.equal(
      canRead(thread("asha", "direct"), READERS.deepa),
      false,
      "asha's grandchild must NOT receive a direct-line-only broadcast"
    );
  });

  test("a sibling on another branch is refused, at either scope", () => {
    // bhavana is under root, not under asha. Nothing asha sends is addressed to her,
    // and "all" must not be read as "everyone in the company".
    for (const scope of THREAD_SCOPES) {
      assert.equal(canRead(thread("asha", scope), READERS.bhavana), false, `asha/${scope}`);
      assert.equal(canRead(thread("bhavana", scope), READERS.asha), false, `bhavana/${scope}`);
      assert.equal(
        canRead(thread("bhavana", scope), READERS.chandan),
        false,
        `bhavana/${scope} → asha's child`
      );
      assert.equal(
        canRead(thread("bhavana", scope), READERS.deepa),
        false,
        `bhavana/${scope} → asha's grandchild`
      );
    }
  });

  test("somebody outside the line entirely is refused, and reaches nobody", () => {
    // Both directions. An outsider must not read a line's broadcasts, and must not be
    // able to put a card in a stranger's feed either.
    for (const scope of THREAD_SCOPES) {
      for (const sender of EVERYONE) {
        if (sender === "outsider") continue;
        assert.equal(
          canRead(thread(sender, scope), READERS.outsider),
          false,
          `${sender}/${scope} → outsider`
        );
        assert.equal(
          canRead(thread("outsider", scope), READERS[sender]),
          false,
          `outsider/${scope} → ${sender}`
        );
      }
    }
  });

  test("a broadcast never travels upward", () => {
    // Threads go down a line. An upline is not in their own downline's audience, so a
    // downline cannot put a message in their mentor's feed by any scope.
    for (const id of EVERYONE) {
      for (const ancestor of ancestorsOf(id)) {
        for (const scope of THREAD_SCOPES) {
          assert.equal(
            canRead(thread(id, scope), READERS[ancestor]),
            false,
            `${id}/${scope} → ancestor ${ancestor}`
          );
        }
      }
    }
  });

  test("the whole matrix, checked against the tree rather than against the code", () => {
    /**
     * Every (sender × scope × reader) combination in the fixture — 6 × 2 × 6 = 72 —
     * against an expectation derived from CHILDREN by walking it, not by restating
     * what `canRead` does. The individual tests above name the cases that matter; this
     * one catches a case nobody thought to name.
     */
    let checked = 0;
    for (const sender of EVERYONE) {
      const direct = new Set(CHILDREN[sender] ?? []);
      const all = descendantsOf(sender);
      for (const scope of THREAD_SCOPES) {
        const audience = scope === "direct" ? direct : all;
        for (const reader of EVERYONE) {
          const expected = reader === sender || audience.has(reader);
          assert.equal(
            canRead(thread(sender, scope), READERS[reader]),
            expected,
            `${sender}/${scope} → ${reader}`
          );
          checked += 1;
        }
      }
    }
    assert.equal(checked, 72, "the matrix should cover every combination");
  });

  test("there are exactly two scopes, and isThreadScope is what keeps it that way", () => {
    /**
     * `canRead` branches on `scope === "direct"` and treats everything else as "all",
     * which is the more permissive of the two. That is only safe because a thread
     * document can never carry a third value: `isThreadScope` gates the write in
     * `POST /api/threads` before `createThread` is called, and it is the reason the
     * else-branch is unreachable rather than fail-open. So it is tested here as part of
     * the addressing rule, not as a separate type guard.
     */
    assert.deepEqual([...THREAD_SCOPES], ["direct", "all"]);

    for (const good of THREAD_SCOPES) assert.equal(isThreadScope(good), true, good);

    for (const bad of [
      "ALL",
      "All",
      "Direct",
      "all ",
      " direct",
      "",
      "everyone",
      "entire",
      null,
      undefined,
      0,
      1,
      true,
      {},
      [],
      ["all"],
      new String("all"),
    ]) {
      assert.equal(isThreadScope(bad), false, JSON.stringify(bad) ?? String(bad));
    }
  });

  test("every scope has a label and a help line, so no scope renders as undefined", () => {
    // Both maps are keyed by ThreadScope and read straight into the composer, so a
    // scope added without its copy would render "undefined" on the send button.
    for (const scope of THREAD_SCOPES) {
      assert.equal(typeof SCOPE_LABELS[scope], "string");
      assert.ok(SCOPE_LABELS[scope].length > 0, `label for ${scope}`);
      assert.equal(typeof SCOPE_HELP[scope], "string");
      assert.ok(SCOPE_HELP[scope].length > 0, `help for ${scope}`);
    }
  });
});

// ===========================================================================
// threads.ts — the URL guard
// ===========================================================================

describe("checkLinkUrl — the scheme allow-list", () => {
  const SCHEME_ERROR = "Only https:// links can be shared.";
  const PARSE_ERROR = "Add a full link, starting with https://";

  test("refuses every scheme that is not http or https", () => {
    /**
     * `javascript:` is the obvious one. `data:text/html` matters as much and is missed
     * more often: it opens attacker-authored markup in a tab of its own, and the author
     * is another coach's upline. The rest are here because "not http(s)" is the rule
     * being tested, not "not the two schemes somebody remembered".
     */
    for (const raw of [
      "javascript:alert(1)",
      "javascript:void(0)",
      "data:text/html,<script>alert(1)</script>",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "file://C:/Windows/System32",
      "blob:https://example.com/9b1c",
      "filesystem:https://example.com/temporary/x",
      "mailto:someone@example.com",
      "tel:+919999999999",
      "about:blank",
      "chrome://settings",
      "ws://example.com/socket",
      "wss://example.com/socket",
      "ftp://example.com/file",
      "intent://scan#Intent;scheme=zxing;end",
    ]) {
      assert.deepEqual(checkLinkUrl(raw), { ok: false, error: SCHEME_ERROR }, raw);
    }
  });

  test("scheme matching is case-insensitive, so JAVASCRIPT: is not a way in", () => {
    // The WHATWG parser lower-cases `protocol`, which is what makes a case check
    // unnecessary — asserted rather than assumed, because the comparison in the source
    // is a plain `!==` against two lower-case literals.
    for (const raw of [
      "JavaScript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "jAvAsCrIpT:alert(1)",
      "DATA:text/html,x",
      "VBScript:msgbox(1)",
      "FILE:///etc/passwd",
    ]) {
      assert.deepEqual(checkLinkUrl(raw), { ok: false, error: SCHEME_ERROR }, raw);
    }
  });

  test("tab, newline and control-character obfuscation does not get a scheme through", () => {
    /**
     * The classic bypass against a hand-rolled scheme check: browsers strip ASCII tab,
     * LF and CR from a URL before parsing it, so `java\nscript:` is `javascript:` by the
     * time it is a link. A validator that string-compares the raw input sees something
     * that is not `javascript:` and lets it through.
     *
     * `new URL` performs the same stripping, so the allow-list sees the real scheme and
     * refuses it. Leading C0 controls are stripped too. These are the inputs this test
     * exists to try, and all of them are refused.
     */
    for (const raw of [
      "java\nscript:alert(1)",
      "java\tscript:alert(1)",
      "jav\rascript:alert(1)",
      "java\n\tscri\rpt:alert(1)",
      "\u0000javascript:alert(1)",
      "\u0001javascript:alert(1)",
      "\u001fjavascript:alert(1)",
      "  javascript:alert(1)  ",
      "\n\tjavascript:alert(1)\n",
      "da\nta:text/html,<script>alert(1)</script>",
    ]) {
      assert.equal(checkLinkUrl(raw).ok, false, JSON.stringify(raw));
    }
  });

  test("accepts http and https, and returns the normalised absolute form", () => {
    assert.deepEqual(checkLinkUrl("https://ok.example/path?q=1#f"), {
      ok: true,
      linkUrl: "https://ok.example/path?q=1#f",
    });
    // A bare origin gains its root path — the stored value is what a browser would
    // resolve, so two spellings of one link are one string.
    assert.deepEqual(checkLinkUrl("http://ok.example"), {
      ok: true,
      linkUrl: "http://ok.example/",
    });
    // Host lower-cased, path case preserved. Paths are case-sensitive; hosts are not.
    assert.deepEqual(checkLinkUrl("HTTPS://OK.EXAMPLE/A"), {
      ok: true,
      linkUrl: "https://ok.example/A",
    });
    assert.deepEqual(checkLinkUrl("  https://ok.example/a  "), {
      ok: true,
      linkUrl: "https://ok.example/a",
    });
  });

  test("a form a regex would mis-read is resolved, never stored ambiguous", () => {
    /**
     * The source comment names `https:/\/evil.com` as the reason for parsing rather
     * than regexing, so it gets asserted.
     *
     * The outcome is accept-and-normalise, and that is correct: the scheme really is
     * https, so there is nothing to refuse — the danger a regex creates is that it
     * approves a string whose meaning it guessed wrong and then stores that string
     * verbatim, so the browser resolves a host the validator never looked at. Here the
     * resolution happens once, server-side, before it is written, and what every
     * recipient's anchor carries is the unambiguous form. So the assertion is on the
     * host of the value that comes back, which is the thing that was in doubt.
     */
    for (const raw of ["https:/\\/evil.example", "https:evil.example", "https:\\\\evil.example"]) {
      const result = checkLinkUrl(raw);
      assert.deepEqual(result, { ok: true, linkUrl: "https://evil.example/" }, raw);
      assert.equal(new URL(result.ok ? (result.linkUrl as string) : "").host, "evil.example");
    }
  });

  test("a scheme-relative or bare host is refused rather than guessed", () => {
    /**
     * `//evil.com` is the input a regex-and-prepend validator turns into an own-origin
     * link or a silently different host. `new URL` has no base to resolve it against
     * and throws, so it is refused and the coach is told to paste a full link.
     *
     * A bare `example.com` is refused for the same reason. That is a product choice as
     * much as a security one — guessing https:// for the coach would mean the app
     * decided which scheme somebody else's link uses — and the error message says what
     * to do about it.
     */
    for (const raw of [
      "//evil.example",
      "/path/only",
      "../relative",
      "evil.example",
      "www.evil.example",
      "evil.example/path",
      "https://",
      "http://",
      "https:// ",
      "https://a b.example",
      "not a url at all",
      "javascript\u0000:alert(1)",
      "https://evil.example\u0000.good.example",
    ]) {
      assert.deepEqual(checkLinkUrl(raw), { ok: false, error: PARSE_ERROR }, JSON.stringify(raw));
    }
  });

  test("empty, null and undefined mean 'no link', not an error", () => {
    // The field is optional, and a coach who leaves it blank is not making a mistake.
    // Whitespace-only counts as blank for the same reason.
    for (const raw of [undefined, null, "", " ", "   ", "\n", "\t\n ", "\u00a0"]) {
      assert.deepEqual(checkLinkUrl(raw), { ok: true, linkUrl: null }, JSON.stringify(raw));
    }
  });

  test("a non-string is refused", () => {
    // The value arrives from `req.json()`, so its type is whatever the client sent.
    for (const raw of [0, 1, -1, NaN, true, false, {}, [], ["https://x.example"], () => {}]) {
      assert.deepEqual(
        checkLinkUrl(raw),
        { ok: false, error: "That link does not look right." },
        String(raw)
      );
    }
  });

  test("the length cap, at the boundary", () => {
    const prefix = "https://a.example/";
    const atLimit = prefix + "a".repeat(MAX_LINK_URL - prefix.length);
    const overLimit = prefix + "a".repeat(MAX_LINK_URL - prefix.length + 1);

    assert.equal(atLimit.length, MAX_LINK_URL);
    assert.deepEqual(checkLinkUrl(atLimit), { ok: true, linkUrl: atLimit });
    assert.deepEqual(checkLinkUrl(overLimit), { ok: false, error: "That link is too long." });

    // Measured after trimming, so surrounding whitespace does not eat the allowance.
    assert.deepEqual(checkLinkUrl(`   ${atLimit}   `), { ok: true, linkUrl: atLimit });
  });

  test("the length cap runs before parsing, so it is not a way past the allow-list", () => {
    // An over-long hostile URL is still refused — by the length check rather than the
    // scheme check, but refused. Ordering matters here only in that neither ordering
    // may produce an `ok`.
    assert.equal(checkLinkUrl(`javascript:${"a".repeat(MAX_LINK_URL)}`).ok, false);
    assert.equal(checkLinkUrl(`data:text/html,${"a".repeat(MAX_LINK_URL)}`).ok, false);
  });

  test("percent-encoding an accepted link changes its length but not its scheme or host", () => {
    /**
     * Normalisation can grow a value substantially — every non-ASCII character becomes
     * two or more percent-escapes. What has to survive that is the part which is a
     * security property: the scheme is still https and the host is still the one that
     * was written, so the growth is a size question rather than an escape. The size
     * question itself is the `todo` immediately below.
     */
    const raw = `https://ok.example/?q=${"\u00e9".repeat(200)}`;
    assert.ok(raw.length < MAX_LINK_URL, "the input is inside the cap");

    const result = checkLinkUrl(raw);
    assert.equal(result.ok, true);
    const linkUrl = result.ok ? (result.linkUrl as string) : "";
    const parsed = new URL(linkUrl);
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.host, "ok.example");
  });

  test("the cap bounds the value that is STORED, not only the value typed", () => {
    /**
     * This was a real gap, found by this test and now closed.
     *
     * `MAX_LINK_URL` was checked against the input, but the value returned — written to
     * the thread document and rendered into every recipient's anchor — is
     * `parsed.toString()`, which percent-encodes. 200 accented characters arrive as 223
     * and leave as ~1223; four-byte characters take the multiplier to about six. So the
     * field a coach was told is capped at 500 was not the field that got stored.
     *
     * The fix is deliberately NOT "check the normalised form against 500". That would
     * refuse a perfectly ordinary link containing Kannada or Devanagari text — which
     * this audience will paste — and tell them a 223-character URL was too long. Hence
     * a second, realistic ceiling for the stored form.
     */
    const raw = `https://ok.example/?q=${"é".repeat(200)}`;
    assert.ok(raw.length < MAX_LINK_URL, "the input is inside the typing cap");

    const result = checkLinkUrl(raw);
    assert.equal(result.ok, true, "a legitimate non-ASCII link must still be accepted");
    const linkUrl = result.ok ? (result.linkUrl as string) : "";

    // It really does grow — otherwise this test would be vacuous.
    assert.ok(
      linkUrl.length > raw.length,
      "expected normalisation to lengthen the value"
    );
    assert.ok(
      linkUrl.length <= MAX_LINK_URL_STORED,
      `stored link is ${linkUrl.length} characters; the stored cap is ${MAX_LINK_URL_STORED}`
    );
  });

  test("a link that explodes past the stored ceiling is refused", () => {
    /**
     * Astral characters carry the worst multiplier. Each is TWO UTF-16 units in
     * `String.length` but twelve characters once percent-encoded, so with a 22-character
     * prefix, n of them give `22 + 2n` typed and `22 + 12n` stored. n = 200 is 422 typed
     * (inside the 500 cap) and 2422 stored (past the 2000 ceiling) — which is the whole
     * point: an input that looks small and stores large.
     */
    const raw = `https://ok.example/?q=${"𝕏".repeat(200)}`;
    assert.ok(raw.length < MAX_LINK_URL, "still inside the typing cap");
    const result = checkLinkUrl(raw);
    assert.equal(result.ok, false, "the stored form is over 2000 and must be refused");
  });
});

// ===========================================================================
// threads.ts — body, attribution, time and audience
// ===========================================================================

describe("checkBody", () => {
  test("trims the ends and leaves the middle alone", () => {
    assert.deepEqual(checkBody("  Club at 6am  "), { ok: true, body: "Club at 6am" });
    // A coach's line breaks are content — ThreadFeed renders the body with
    // `whitespace-pre-line` precisely so they survive.
    assert.deepEqual(checkBody("  Line one\n\nLine two \n"), {
      ok: true,
      body: "Line one\n\nLine two",
    });
  });

  test("refuses a whitespace-only body", () => {
    /**
     * The reason this matters more than a usual empty check: sending is a fan-out. A
     * body of spaces would put a blank card in every inbox in a line AND fire a push
     * notification for it, and there is no delete. The trim is what makes the emptiness
     * visible before the send.
     */
    for (const raw of [
      "",
      " ",
      "   ",
      "\n",
      "\t",
      "\r\n",
      "   \n\t\r  ",
      "\u00a0", // NBSP — trimmed by String.prototype.trim
      "\u3000", // ideographic space — also trimmed
      "\u2003", // em space
    ]) {
      assert.deepEqual(
        checkBody(raw),
        { ok: false, error: "Write a message first." },
        JSON.stringify(raw)
      );
    }
  });

  test(
    "a body with no visible content is refused however it is spelled",
    () => {
      /**
       * `String.prototype.trim` removes ECMAScript WhiteSpace — which covers the spaces,
       * tabs, newlines, NBSP and ideographic space asserted above, but not the zero-width
       * and formatting characters, because those are not whitespace by that definition.
       * So a body of a single U+200B survived the trim with length 1, and delivered the
       * blank card plus push notification to an entire line that the check exists to
       * prevent. U+FEFF and U+2060 behaved the same way.
       *
       * FIXED. `checkBody` now tests for visible content by codepoint rather than relying
       * on `trim()`. Note what the fix deliberately does NOT do: it does not strip these
       * characters from the stored body, because U+200D (zero-width joiner) is meaningful
       * in Devanagari and Kannada conjuncts and in emoji sequences — removing it from a
       * coach's actual text would corrupt legitimate Indic spelling to fix a blank-message
       * bug.
       */
      // Built from code points rather than pasted. These characters are invisible, and a
      // reviewer must be able to see what the test is sending without selecting the line.
      const ZWSP = String.fromCodePoint(0x200b); // zero-width space
      const ZWNBSP = String.fromCodePoint(0xfeff); // zero-width no-break space
      const WORD_JOINER = String.fromCodePoint(0x2060);

      for (const raw of [ZWSP, ZWNBSP, WORD_JOINER, `${ZWSP}${ZWSP} ${ZWSP}`]) {
        assert.equal(
          checkBody(raw).ok,
          false,
          `${JSON.stringify(raw)} has no visible content and should be refused`
        );
      }
    }
  );

  test("refuses a non-string", () => {
    for (const raw of [undefined, null, 0, 1, true, false, {}, [], ["hi"]]) {
      assert.deepEqual(
        checkBody(raw),
        { ok: false, error: "Write a message first." },
        String(raw)
      );
    }
  });

  test("the length cap, at the boundary", () => {
    const atLimit = "a".repeat(MAX_BODY);
    assert.deepEqual(checkBody(atLimit), { ok: true, body: atLimit });
    assert.deepEqual(checkBody(`a${atLimit}`), {
      ok: false,
      error: `Keep it under ${MAX_BODY} characters.`,
    });
  });

  test("the length is measured after trimming, so padding does not eat the allowance", () => {
    // A coach who pastes from WhatsApp brings trailing newlines with them. Those must
    // not be the reason a message of legal length is refused.
    const atLimit = "a".repeat(MAX_BODY);
    assert.deepEqual(checkBody(`\n\n   ${atLimit}   \n\n`), { ok: true, body: atLimit });
  });
});

describe("attribution", () => {
  test("renders the original author", () => {
    assert.equal(attribution("Asha"), "via Asha");
  });

  test("is null when there is no original author", () => {
    // A thread nobody forwarded has `originalSenderName: null`, and the feed must show
    // no attribution line at all rather than a dangling "via".
    assert.equal(attribution(null), null);
    // An empty name is the same case: "via " is worse than nothing.
    assert.equal(attribution(""), null);
  });

  test("names the original author, never the hop it arrived through", () => {
    /**
     * Asha writes it, Bhavana forwards it, Chetan forwards that. The card Chetan's line
     * reads must say "via Asha": the person a coach is being asked to trust is whoever
     * wrote the thing, and a chain of "via Bhavana, via Asha" is both noise and a map
     * of somebody's team structure. D51 — "a forward carries the ORIGINAL author's
     * name, not the hop it arrived through".
     *
     * The re-broadcast in `threads-queries` is what carries `originalSenderName`
     * forward across hops; what is checked here is that the renderer given that value
     * uses it and mentions nobody else.
     */
    const asChetansLineSeesIt = {
      senderName: "Chetan",
      originalSenderName: "Asha", // set at the first forward, unchanged by later ones
      previousHopName: "Bhavana",
    };
    const line = attribution(asChetansLineSeesIt.originalSenderName);
    assert.equal(line, "via Asha");
    assert.ok(line !== null && !line.includes("Bhavana"), "must not name the hop");
  });
});

describe("relativeTime", () => {
  // Fixed. Never Date.now() — see the file header.
  const NOW = new Date("2026-08-12T10:00:00.000Z");
  const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

  test("under a minute is 'just now'", () => {
    for (const seconds of [0, 1, 30, 59]) {
      assert.equal(relativeTime(ago(seconds), NOW), "just now", `${seconds}s`);
    }
  });

  test("minutes, up to the hour", () => {
    assert.equal(relativeTime(ago(60), NOW), "1 min ago");
    assert.equal(relativeTime(ago(120), NOW), "2 min ago");
    assert.equal(relativeTime(ago(600), NOW), "10 min ago");
    assert.equal(relativeTime(ago(59 * 60), NOW), "59 min ago");
  });

  test("hours, up to the day", () => {
    assert.equal(relativeTime(ago(3600), NOW), "1 h ago");
    assert.equal(relativeTime(ago(2 * 3600), NOW), "2 h ago");
    assert.equal(relativeTime(ago(23 * 3600), NOW), "23 h ago");
  });

  test("the thresholds round rather than truncate", () => {
    // 90 seconds is "2 min", not "1 min", and 59½ minutes is "1 h". Pinned because the
    // rounding is the reason "59 min ago" and "1 h ago" have no gap between them.
    assert.equal(relativeTime(ago(90), NOW), "2 min ago");
    assert.equal(relativeTime(ago(3570), NOW), "1 h ago");
    assert.equal(relativeTime(ago(3599), NOW), "1 h ago");
  });

  test("a day or more becomes a date", () => {
    // At exactly 24 hours the relative form stops: "24 h ago" is harder to read than a
    // date, which is the whole reason for the switch.
    assert.equal(relativeTime(ago(24 * 3600), NOW), "11 Aug");
    assert.equal(relativeTime(ago(25 * 3600), NOW), "11 Aug");
    assert.equal(relativeTime(ago(30 * 24 * 3600), NOW), "13 Jul");
  });

  test("the date shown is the coach's IST date, not the server's UTC date", () => {
    /**
     * E1, in the one place in this module that touches a calendar. IST is UTC+5:30, so
     * anything after 18:30 UTC is already tomorrow in India. These two instants are 61
     * minutes apart and straddle that boundary — if the `timeZone: APP_TIMEZONE` option
     * were ever dropped, both would render "11 Aug" and this test would say so.
     */
    const laterNow = new Date("2026-08-20T10:00:00.000Z");
    // 20:30 UTC on the 11th = 02:00 IST on the 12th.
    assert.equal(relativeTime(new Date("2026-08-11T20:30:00.000Z"), laterNow), "12 Aug");
    // 18:29 UTC on the 11th = 23:59 IST, still the 11th.
    assert.equal(relativeTime(new Date("2026-08-11T18:29:00.000Z"), laterNow), "11 Aug");
    // And across a year boundary, where getting the zone wrong changes the month too.
    assert.equal(relativeTime(new Date("2025-12-31T18:31:00.000Z"), laterNow), "1 Jan");
  });

  test("a clock running fast does not print a negative age", () => {
    // Phone clocks drift, and `createdAt` is a server timestamp. A card stamped in the
    // future must read "just now" rather than "-3 min ago".
    assert.equal(relativeTime(ago(-5 * 60), NOW), "just now");
    assert.equal(relativeTime(ago(-3600), NOW), "just now");
  });
});

describe("audienceLabel", () => {
  test("zero is its own sentence, and shows no number", () => {
    // "Sent to 0 people" is the failure this exists to prevent. Both scopes get their
    // own wording because "no direct line" and "nobody in your line" are different
    // situations for the coach reading it.
    assert.equal(audienceLabel(0, "direct"), "You have no direct line yet");
    assert.equal(audienceLabel(0, "all"), "You have nobody in your line yet");
    assert.ok(!/\d/.test(audienceLabel(0, "direct")), "no digit in the zero case");
    assert.ok(!/\d/.test(audienceLabel(0, "all")), "no digit in the zero case");
  });

  test("one is singular", () => {
    assert.equal(audienceLabel(1, "direct"), "1 coach in your direct line");
    assert.equal(audienceLabel(1, "all"), "1 coach in your line");
  });

  test("more than one is plural", () => {
    assert.equal(audienceLabel(2, "direct"), "2 coaches in your direct line");
    assert.equal(audienceLabel(7, "all"), "7 coaches in your line");
    assert.equal(audienceLabel(1240, "all"), "1240 coaches in your line");
  });
});

// ===========================================================================
// collections.ts — the tree
// ===========================================================================

describe("buildUplinePath", () => {
  const tree = (pairs: Array<[string, string | null]>) =>
    new Map<string, string | null>(pairs);

  test("a root has an empty path", async () => {
    const { buildUplinePath } = await loadCollections();
    assert.deepEqual(buildUplinePath("a", tree([["a", null]])), []);
  });

  test("a user the map has never heard of has an empty path", async () => {
    // The migration builds the map from every user row, so a miss means a dangling
    // reference. An empty path — "treat them as a root" — is the safe reading: it can
    // only under-report a line, never leak one coach's roll-up into a stranger's.
    const { buildUplinePath } = await loadCollections();
    assert.deepEqual(buildUplinePath("ghost", tree([])), []);
    assert.deepEqual(buildUplinePath("ghost", tree([["a", null]])), []);
  });

  test("the nearest ancestor comes first, at depth (D36)", async () => {
    const { buildUplinePath } = await loadCollections();
    // e → d → c → b → a(root)
    const chain = tree([
      ["e", "d"],
      ["d", "c"],
      ["c", "b"],
      ["b", "a"],
      ["a", null],
    ]);

    assert.deepEqual(buildUplinePath("e", chain), ["d", "c", "b", "a"]);
    assert.deepEqual(buildUplinePath("d", chain), ["c", "b", "a"]);
    assert.deepEqual(buildUplinePath("c", chain), ["b", "a"]);
    assert.deepEqual(buildUplinePath("b", chain), ["a"]);
    assert.deepEqual(buildUplinePath("a", chain), []);

    // Stated as the two properties everything downstream relies on: `canRead`'s
    // "direct" branch is an equality check against index 0, and the rules' branch (3)
    // is an `array-contains` over the rest.
    assert.equal(buildUplinePath("e", chain)[0], "d", "index 0 is the direct upline");
    assert.equal(buildUplinePath("e", chain).at(-1), "a", "the last entry is the root");
  });

  test("a long valid chain is walked in full", async () => {
    const { buildUplinePath } = await loadCollections();
    const pairs: Array<[string, string | null]> = [["u0", null]];
    for (let i = 1; i < 100; i++) pairs.push([`u${i}`, `u${i - 1}`]);
    const chain = tree(pairs);

    const path = buildUplinePath("u99", chain);
    assert.equal(path.length, 99);
    assert.equal(path[0], "u98");
    assert.equal(path.at(-1), "u0");
  });

  test("the user is never in their own path", async () => {
    const { buildUplinePath } = await loadCollections();
    const chain = tree([
      ["c", "b"],
      ["b", "a"],
      ["a", null],
    ]);
    for (const id of ["a", "b", "c"]) {
      assert.ok(!buildUplinePath(id, chain).includes(id), `${id} in its own path`);
    }
  });

  /**
   * The cycle cases.
   *
   * A corrupt `uplineId` chain is not hypothetical — it is what a bad migration, a
   * hand-edited document, or a future tree-move feature produces, and the source
   * comment commits to "a corrupt uplineId chain must not hang the migration". The
   * guard is a `seen` set, and these are the shapes it has to survive.
   *
   * On the `timeout` option: it is set as documentation of intent, but it cannot
   * actually rescue this test. `buildUplinePath` is synchronous, and node's test
   * timeout cannot preempt a synchronous loop — an unguarded implementation would peg
   * a core until the run was killed. Which is exactly why the guard has to live in the
   * function rather than in the test, and why "it returned at all" is the assertion
   * that matters here.
   */
  test("a self-reference terminates", { timeout: 5000 }, async () => {
    const { buildUplinePath } = await loadCollections();
    // a → a. Nobody is their own upline, so the sane answer is "no ancestors".
    assert.deepEqual(buildUplinePath("a", tree([["a", "a"]])), []);
  });

  test("a two-node cycle terminates", { timeout: 5000 }, async () => {
    const { buildUplinePath } = await loadCollections();
    const ring = tree([
      ["a", "b"],
      ["b", "a"],
    ]);
    // Each walks one hop and stops on re-encountering itself. Neither contains itself,
    // and neither is longer than the ring.
    assert.deepEqual(buildUplinePath("a", ring), ["b"]);
    assert.deepEqual(buildUplinePath("b", ring), ["a"]);
  });

  test("a three-node cycle terminates", { timeout: 5000 }, async () => {
    const { buildUplinePath } = await loadCollections();
    const ring = tree([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
    ]);
    assert.deepEqual(buildUplinePath("a", ring), ["b", "c"]);
    assert.deepEqual(buildUplinePath("b", ring), ["c", "a"]);
    assert.deepEqual(buildUplinePath("c", ring), ["a", "b"]);
  });

  test("a chain that runs into a cycle terminates", { timeout: 5000 }, async () => {
    const { buildUplinePath } = await loadCollections();
    // d → c → b → c: a tail leading into a loop, which is the shape a partial tree
    // move would leave behind. The walk must stop at the loop, not orbit it.
    const lasso = tree([
      ["d", "c"],
      ["c", "b"],
      ["b", "c"],
    ]);
    assert.deepEqual(buildUplinePath("d", lasso), ["c", "b"]);
  });

  test("a thousand-node ring terminates", { timeout: 10000 }, async () => {
    const { buildUplinePath } = await loadCollections();
    const size = 1000;
    const pairs: Array<[string, string | null]> = [];
    for (let i = 0; i < size; i++) pairs.push([`u${i}`, `u${(i + 1) % size}`]);

    const path = buildUplinePath("u0", tree(pairs));
    // Every other node exactly once, and never the starting user.
    assert.equal(path.length, size - 1);
    assert.equal(new Set(path).size, size - 1);
    assert.ok(!path.includes("u0"));
  });

  test("every corrupt shape still returns a sane path", async () => {
    const { buildUplinePath } = await loadCollections();
    /**
     * The invariants that make a returned path safe to write onto a log or a target
     * document, whatever the input tree looked like: no duplicates (an
     * `array-contains` would still work but a count would double), and the user is
     * never their own ancestor (which would make them read their own roll-up as a
     * downline's).
     */
    const shapes: Array<[string, Map<string, string | null>]> = [
      ["self", tree([["a", "a"]])],
      [
        "two-ring",
        tree([
          ["a", "b"],
          ["b", "a"],
        ]),
      ],
      [
        "three-ring",
        tree([
          ["a", "b"],
          ["b", "c"],
          ["c", "a"],
        ]),
      ],
      [
        "lasso",
        tree([
          ["a", "b"],
          ["b", "c"],
          ["c", "b"],
        ]),
      ],
      [
        "dangling",
        tree([
          ["a", "b"],
          ["b", "missing"],
        ]),
      ],
    ];

    for (const [name, shape] of shapes) {
      for (const id of shape.keys()) {
        const path = buildUplinePath(id, shape);
        assert.equal(new Set(path).size, path.length, `${name}: duplicates for ${id}`);
        assert.ok(!path.includes(id), `${name}: ${id} is its own ancestor`);
        assert.ok(path.length < 1000, `${name}: path for ${id} did not terminate early`);
      }
    }
  });
});

// ===========================================================================
// collections.ts — the document ids
// ===========================================================================

describe("document ids — the uniqueness constraints (D35, D41, D51)", () => {
  /**
   * Realistic components, because whether some of these builders are safe depends on
   * the alphabets they are fed.
   *
   * Coach and user ids are Firebase Auth uids, which after D34 are the migrated cuids —
   * lower-case alphanumeric. Thread ids are Firestore auto-ids, also alphanumeric.
   * Neither contains the `__` separator, which is the reason the point below about
   * separator ambiguity is latent rather than live.
   */
  const COACH = "clx9k2m4a0000abcd1234efgh";
  const OTHER_COACH = "clx9k2m4a0001zyxw9876lkji";
  const USER = "clx9k2m4a0002qrst5555mnop";
  const THREAD = "Xy7Qw2LmNp0RtUvBcDeF";
  const HASH = "a".repeat(64);

  test("the collection names each match their key, so a rename cannot go unnoticed", async () => {
    // Every value in COLLECTIONS is its own key. Worth pinning: a changed string does
    // not fail anything, it silently starts reading and writing an empty collection
    // while the old documents sit there.
    const { COLLECTIONS } = await loadCollections();
    for (const [key, value] of Object.entries(COLLECTIONS)) {
      assert.equal(value, key, `COLLECTIONS.${key}`);
    }
    // The four that only exist so v2.4–v2.6 do not invent variants.
    assert.equal(COLLECTIONS.threads, "threads");
    assert.equal(COLLECTIONS.threadReceipts, "threadReceipts");
    assert.equal(COLLECTIONS.subscriptions, "subscriptions");
    assert.equal(COLLECTIONS.portfolios, "portfolios");
  });

  test("every builder is deterministic, and its format is pinned", async () => {
    const {
      prospectDocId,
      reportDocId,
      dailyLogDocId,
      targetDocId,
      threadReceiptDocId,
      referralCodeDocId,
      pushSubscriptionDocId,
    } = await loadCollections();

    /**
     * Determinism is the whole mechanism: `set()` on a deterministic id is an upsert,
     * so two racing writers converge on one document instead of creating two. And the
     * exact format is pinned because changing it does not fail — it orphans every
     * document already written under the old shape.
     */
    assert.equal(prospectDocId(COACH, "c-42"), `${COACH}__c-42`);
    assert.equal(prospectDocId(COACH, "c-42"), prospectDocId(COACH, "c-42"));

    assert.equal(reportDocId("prospect-1", HASH), `prospect-1__${HASH}`);
    assert.equal(reportDocId("prospect-1", HASH), reportDocId("prospect-1", HASH));

    assert.equal(dailyLogDocId(USER, "2026-08-10"), `${USER}__2026-08-10`);
    assert.equal(dailyLogDocId(USER, "2026-08-10"), dailyLogDocId(USER, "2026-08-10"));

    assert.equal(targetDocId(COACH, "2026-08"), `${COACH}__2026-08`);
    assert.equal(targetDocId(COACH, "2026-08"), targetDocId(COACH, "2026-08"));

    assert.equal(threadReceiptDocId(THREAD, USER), `${THREAD}__${USER}`);
    assert.equal(threadReceiptDocId(THREAD, USER), threadReceiptDocId(THREAD, USER));

    assert.equal(referralCodeDocId("AB2C3D"), "AB2C3D");
    assert.equal(referralCodeDocId("AB2C3D"), referralCodeDocId("AB2C3D"));

    assert.equal(
      pushSubscriptionDocId("https://fcm.googleapis.com/x/abc"),
      pushSubscriptionDocId("https://fcm.googleapis.com/x/abc")
    );
  });

  test("different inputs produce different ids", async () => {
    const {
      prospectDocId,
      reportDocId,
      dailyLogDocId,
      targetDocId,
      threadReceiptDocId,
      referralCodeDocId,
      pushSubscriptionDocId,
    } = await loadCollections();

    /**
     * A collision is not a crash, it is an upsert onto somebody else's document — one
     * coach's prospect overwriting another's, or two coaches' logs merging. So this is
     * checked as a cross-product per builder rather than a handful of pairs.
     *
     * Components are drawn from the alphabets these ids are actually built from (uids,
     * dayKeys, months, hex hashes, auto-ids) — see the note on separator ambiguity in
     * the next test for why that restriction is deliberate and not an oversight.
     */
    const distinct = (label: string, ids: Array<string | null>) => {
      assert.equal(
        new Set(ids).size,
        ids.length,
        `${label}: ${ids.length} inputs produced ${new Set(ids).size} ids`
      );
    };

    distinct(
      "prospectDocId",
      [COACH, OTHER_COACH, USER].flatMap((coach) =>
        ["c-1", "c-2", "c-10", "ck9zzz"].map((client) => prospectDocId(coach, client))
      )
    );

    distinct(
      "reportDocId",
      ["p-1", "p-2", "p-11"].flatMap((prospect) =>
        ["a".repeat(64), "b".repeat(64), `${"a".repeat(63)}b`].map((hash) =>
          reportDocId(prospect, hash)
        )
      )
    );

    distinct(
      "dailyLogDocId",
      [USER, COACH, OTHER_COACH].flatMap((user) =>
        // Adjacent days and a month rollover: D26's constraint is one log per coach per
        // LOCAL day, so consecutive days must never share an id.
        ["2026-07-31", "2026-08-01", "2026-08-09", "2026-08-10", "2026-12-31"].map((day) =>
          dailyLogDocId(user, day)
        )
      )
    );

    distinct(
      "targetDocId",
      [COACH, OTHER_COACH].flatMap((coach) =>
        ["2026-01", "2026-08", "2026-09", "2027-01"].map((month) => targetDocId(coach, month))
      )
    );

    distinct(
      "threadReceiptDocId",
      [THREAD, "Ab1Cd2Ef3Gh4Ij5Kl6Mn", "Zz9Yy8Xx7Ww6Vv5Uu4Tt"].flatMap((thread) =>
        [USER, COACH, OTHER_COACH].map((user) => threadReceiptDocId(thread, user))
      )
    );

    // Codes from the real generator alphabet (users.ts: no 0/O/1/I), including two that
    // differ in one character.
    distinct(
      "referralCodeDocId",
      ["AB2C3D", "AB2C3E", "ZZ9YY8", "K4M7NP", "K4M7NQ"].map((code) => referralCodeDocId(code))
    );

    distinct(
      "pushSubscriptionDocId",
      [
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://fcm.googleapis.com/fcm/send/abd",
        "https://fcm.googleapis.com/fcm/send/abc/",
        "https://updates.push.services.mozilla.com/wpush/v2/abc",
        "https://wns2-par02p.notify.windows.com/w/?token=abc",
      ].map((endpoint) => pushSubscriptionDocId(endpoint))
    );
  });

  test("argument order matters, so a pair id is not symmetric", async () => {
    const { threadReceiptDocId, prospectDocId, dailyLogDocId } = await loadCollections();

    /**
     * `threadReceipts/{threadId}__{userId}` (D51) would be a broken constraint if the
     * two components were interchangeable: one receipt per (thread, reader) means the
     * pair is ordered.
     *
     * NOTE (reported upward, not asserted here): the separator `__` is not escaped and
     * the components are not checked for containing it, so the id is not a strictly
     * injective function of its two arguments — `("a__b", "c")` and `("a", "b__c")`
     * both assemble to `a__b__c`. Unreachable today because every component is a
     * Firebase uid, a cuid, a Firestore auto-id, a "YYYY-MM-DD" key, a "YYYY-MM" month
     * or a hex hash, and none of those alphabets contains an underscore — but it is a
     * property of the alphabets rather than of the code, so it is not asserted as
     * correct here.
     */
    assert.notEqual(threadReceiptDocId("aaa", "bbb"), threadReceiptDocId("bbb", "aaa"));
    assert.notEqual(prospectDocId(COACH, USER), prospectDocId(USER, COACH));
    assert.notEqual(dailyLogDocId("2026-08-10", USER), dailyLogDocId(USER, "2026-08-10"));
  });

  test("a report's identity is the inputs that produced it (D20)", async () => {
    const { reportDocId } = await loadCollections();
    // Same prospect, same inputs → the same document, so two concurrent renders cannot
    // mint two live 90-day bearer tokens to one person's health data. Different inputs →
    // a new report, because E3 makes reports immutable.
    assert.equal(reportDocId("p-1", HASH), reportDocId("p-1", HASH));
    assert.notEqual(reportDocId("p-1", HASH), reportDocId("p-1", "b".repeat(64)));
    assert.notEqual(reportDocId("p-1", HASH), reportDocId("p-2", HASH));
  });

  test("prospectDocId yields null when there is no clientId, so Firestore auto-ids (D6)", async () => {
    const { prospectDocId } = await loadCollections();
    // A QR self-fill is created online in one shot and has no offline-queue id to
    // deduplicate against, so it gets an auto-id rather than a synthetic one.
    assert.equal(prospectDocId(COACH, null), null);
    assert.equal(prospectDocId(COACH, ""), null);
    // But "0" is a perfectly good clientId, and a falsy-string bug here would silently
    // stop deduplicating one queue entry in ten.
    assert.equal(prospectDocId(COACH, "0"), `${COACH}__0`);
  });

  test("an id containing a slash is refused", async () => {
    const {
      prospectDocId,
      reportDocId,
      dailyLogDocId,
      targetDocId,
      threadReceiptDocId,
      referralCodeDocId,
    } = await loadCollections();

    // Firestore's first id rule. A "/" would make the id read as a path segment
    // wherever the id is interpolated rather than passed to `doc()`.
    assert.throws(() => prospectDocId(COACH, "a/b"), /Invalid prospect document id/);
    assert.throws(() => prospectDocId(COACH, "../../users/admin"), /Invalid prospect/);
    assert.throws(() => reportDocId("p/1", HASH), /Invalid report document id/);
    assert.throws(() => reportDocId("p-1", "ab/cd"), /Invalid report document id/);
    assert.throws(() => dailyLogDocId("u/1", "2026-08-10"), /Invalid dailyLog document id/);
    assert.throws(() => dailyLogDocId(USER, "2026/08/10"), /Invalid dailyLog document id/);
    assert.throws(() => targetDocId(COACH, "2026/08"), /Invalid target document id/);
    assert.throws(() => threadReceiptDocId("t/1", USER), /Invalid threadReceipt document id/);
    assert.throws(() => threadReceiptDocId(THREAD, "u/1"), /Invalid threadReceipt document id/);
    assert.throws(() => referralCodeDocId("AB/CD"), /Invalid referralCode document id/);
  });

  test('the ids "." and ".." are refused', async () => {
    const { referralCodeDocId, prospectDocId } = await loadCollections();

    // `referralCodeDocId` is the only single-component builder, so it is the only one
    // that can produce these at all.
    assert.throws(() => referralCodeDocId("."), /Invalid referralCode document id/);
    assert.throws(() => referralCodeDocId(".."), /Invalid referralCode document id/);
    assert.throws(() => referralCodeDocId("  ..  "), /Invalid referralCode document id/);

    // Firestore reserves the exact ids, not the characters, so a two-part id that ends
    // in a dot is legal and is correctly allowed through. Pinned so nobody "fixes" this
    // into rejecting every dot.
    assert.equal(prospectDocId(COACH, "."), `${COACH}__.`);
    assert.equal(prospectDocId(COACH, ".."), `${COACH}__..`);
  });

  test("Firestore's reserved __…__ pattern is refused, on the assembled id", async () => {
    const { referralCodeDocId, threadReceiptDocId, prospectDocId } = await loadCollections();

    assert.throws(() => referralCodeDocId("__abc__"), /Reserved referralCode document id/);
    assert.throws(() => referralCodeDocId("__x__"), /Reserved referralCode document id/);
    // Lower case still folds into the pattern, because the check runs after upper-casing.
    assert.throws(() => referralCodeDocId("__abc__"), /Reserved/);

    // The check is on the WHOLE assembled id, not on a component — which is what makes
    // it meaningful for the two-part builders, where an attacker only controls one side.
    assert.throws(() => threadReceiptDocId("", "x__"), /Reserved threadReceipt document id/);
    assert.throws(() => prospectDocId("", "x__"), /Reserved prospect document id/);

    // Merely containing a double underscore is fine — only the wrapping pattern is
    // reserved, and a prospect id contains the separator by construction.
    assert.equal(referralCodeDocId("A__B"), "A__B");
    assert.equal(prospectDocId(COACH, "c__1"), `${COACH}__c__1`);
  });

  test("the size limit is counted in bytes, not characters", async () => {
    const { referralCodeDocId, dailyLogDocId } = await loadCollections();

    // Exactly at the limit is allowed; one past it is not.
    assert.equal(referralCodeDocId("A".repeat(1500)).length, 1500);
    assert.throws(() => referralCodeDocId("A".repeat(1501)), /exceeds 1500 bytes/);

    /**
     * The one that a `.length` check would get wrong: 800 characters of "é" is 1600
     * bytes in UTF-8, and Firestore's limit is bytes. A coach's name or a pasted string
     * in Kannada or Devanagari is three bytes per character, so this is the realistic
     * shape of the failure, not an exotic one.
     */
    assert.throws(() => referralCodeDocId("\u00e9".repeat(800)), /exceeds 1500 bytes/);
    assert.throws(() => referralCodeDocId("\u0c95".repeat(600)), /exceeds 1500 bytes/);
    assert.throws(() => dailyLogDocId("u".repeat(1600), "2026-08-10"), /exceeds 1500 bytes/);

    /**
     * And the check runs AFTER upper-casing, which matters because upper-casing can
     * lengthen a string: "ß" becomes "SS". 750 of them is 1500 bytes before the fold
     * and 1500 after; 751 is over on both sides. If the order were reversed, a code
     * could pass validation and then exceed the limit at write time.
     */
    assert.equal(referralCodeDocId("\u00df".repeat(750)).length, 1500);
    assert.throws(() => referralCodeDocId("\u00df".repeat(751)), /exceeds 1500 bytes/);
  });

  test("an empty id is refused", async () => {
    const { referralCodeDocId } = await loadCollections();
    assert.throws(() => referralCodeDocId(""), /Invalid referralCode document id/);
    assert.throws(() => referralCodeDocId("   "), /Invalid referralCode document id/);
    assert.throws(() => referralCodeDocId("\n\t"), /Invalid referralCode document id/);
  });

  test("a hostile clientId cannot escape the coach's own id space", async () => {
    const { prospectDocId } = await loadCollections();

    /**
     * `clientId` is generated in the browser for the offline queue (D6), so it is
     * whatever the client sends. The property that has to hold is not "every hostile
     * string is rejected" — most of them are harmless as opaque ids — but that the
     * result is EITHER refused OR still inside this coach's namespace. A clientId that
     * produced an id belonging to another coach would let one coach upsert over
     * another's prospect.
     *
     * (That property rests on uids containing no `__`; see the separator note above.)
     */
    const hostile = [
      "a/b",
      "/",
      "../../users/admin",
      "..%2F..%2Fadmin",
      "%2F..%2F",
      ".",
      "..",
      "__x__",
      "x__",
      "__",
      "\n",
      "\r\n",
      "\u0000",
      "\u200b",
      "\ud83d\ude42",
      "'; DROP TABLE prospects; --",
      "<script>alert(1)</script>",
      "{$ne: null}",
      " ",
      "null",
      "undefined",
      "a".repeat(2000),
    ];

    for (const clientId of hostile) {
      let id: string | null;
      try {
        id = prospectDocId(COACH, clientId);
      } catch {
        continue; // refused outright, which is also fine
      }
      assert.ok(id !== null, `${JSON.stringify(clientId)} produced a null id`);
      assert.ok(
        id.startsWith(`${COACH}__`),
        `${JSON.stringify(clientId)} escaped the coach prefix: ${JSON.stringify(id)}`
      );
      assert.ok(!id.includes("/"), `${JSON.stringify(clientId)} kept a slash`);
      assert.ok(id !== "." && id !== "..", `${JSON.stringify(clientId)} became a reserved id`);
      assert.ok(
        !/^__.*__$/.test(id),
        `${JSON.stringify(clientId)} became a reserved pattern id`
      );
      assert.ok(Buffer.byteLength(id, "utf8") <= 1500, `${JSON.stringify(clientId)} is too long`);
    }

    // The ones that must specifically be refused rather than merely contained.
    for (const clientId of ["a/b", "/", "../../users/admin", "a".repeat(2000)]) {
      assert.throws(() => prospectDocId(COACH, clientId), JSON.stringify(clientId));
    }
  });

  test("referralCodeDocId upper-cases and trims, so a lookup is case-insensitive", async () => {
    const { referralCodeDocId } = await loadCollections();

    /**
     * A referral code is read aloud on a morning walk and typed into a phone keyboard
     * that auto-lower-cases. The reservation document's id has one spelling (D41), so
     * the fold has to happen here or `/join/ab2c3d` and `/join/AB2C3D` resolve to
     * different coaches — one of them to nobody.
     */
    assert.equal(referralCodeDocId("ab2c3d"), "AB2C3D");
    assert.equal(referralCodeDocId("AB2C3D"), "AB2C3D");
    assert.equal(referralCodeDocId("  ab2c3d  "), "AB2C3D");
    assert.equal(referralCodeDocId("\n ab2c3d \t"), "AB2C3D");

    // Every one of the 64 case spellings of a 6-character code resolves to one id.
    const code = "ab2c3d";
    const spellings = new Set<string>();
    for (let mask = 0; mask < 1 << code.length; mask++) {
      const spelled = [...code]
        .map((ch, i) => ((mask >> i) & 1 ? ch.toUpperCase() : ch.toLowerCase()))
        .join("");
      spellings.add(referralCodeDocId(spelled));
    }
    assert.deepEqual([...spellings], ["AB2C3D"], "case spellings must collapse to one id");
  });

  test("pushSubscriptionDocId hashes, because an endpoint cannot be an id", async () => {
    const { pushSubscriptionDocId } = await loadCollections();

    /**
     * The constraint being preserved is `unique(endpoint)`: a device that re-subscribes
     * must replace its own document rather than accumulate one per subscription, or the
     * same coach gets the morning reminder twice.
     *
     * The endpoint itself cannot be the id — it is a URL, so it contains slashes and
     * can exceed 1500 bytes. Hashing is why this builder does not call
     * `assertValidDocId`: sha-256 hex cannot violate any of Firestore's rules. That is
     * asserted rather than assumed, for every shape of endpoint including the ones that
     * would be rejected outright if they were used raw.
     */
    const endpoints = [
      "https://fcm.googleapis.com/fcm/send/abc123",
      "https://fcm.googleapis.com/fcm/send/abc124",
      `https://fcm.googleapis.com/fcm/send/${"x".repeat(4000)}`,
      "..",
      ".",
      "__reserved__",
      "/",
      "",
      "\u0000",
      "\u0c95\u0cbe\u0cb0\u0ccd\u0caf",
    ];

    for (const endpoint of endpoints) {
      const id = pushSubscriptionDocId(endpoint);
      assert.match(id, /^[0-9a-f]{64}$/, `hash shape for ${JSON.stringify(endpoint)}`);
      assert.equal(id, pushSubscriptionDocId(endpoint), "deterministic");
      // The same four rules `assertValidDocId` enforces, satisfied structurally.
      assert.ok(!id.includes("/"));
      assert.ok(id !== "." && id !== "..");
      assert.ok(!/^__.*__$/.test(id));
      assert.ok(Buffer.byteLength(id, "utf8") <= 1500);
    }

    // A one-character difference has to give a completely different document.
    assert.notEqual(
      pushSubscriptionDocId("https://fcm.googleapis.com/fcm/send/abc123"),
      pushSubscriptionDocId("https://fcm.googleapis.com/fcm/send/abc124")
    );
  });
});
