import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

/**
 * Every public route either opts INTO search indexing deliberately, or opts out.
 *
 * `src/proxy.ts` keeps a list of paths reachable with no session. Each one renders
 * somebody's personal data to a stranger, so each one owes an answer to "should Google
 * keep a copy of this". Until 2026-08-20 `/join/{code}` had no answer at all: it showed
 * a coach's name and photo to anyone holding a referral code — codes that get printed on
 * posters and pasted into WhatsApp groups — while its two siblings `/c/{code}` and
 * `/r/{token}` were both explicitly noindex.
 *
 * Nothing would have caught that. It was the absence of a line, and absences do not fail
 * tests unless a test goes looking for them. This is that test.
 *
 * The portfolio is the deliberate exception and is asserted as such: a coach publishes it
 * ON PURPOSE and wants to be findable. That is a choice; being recruited is not.
 */

type Route = { file: string; expect: "noindex" | "indexed"; why: string };

const ROUTES: Route[] = [
  {
    file: "src/app/c/[code]/page.tsx",
    expect: "noindex",
    why: "shows a coach's name and photo to anyone with the code",
  },
  {
    file: "src/app/join/[code]/page.tsx",
    expect: "noindex",
    why: "shows a coach's name and photo to anyone with the code",
  },
  {
    file: "src/app/r/[token]/page.tsx",
    expect: "noindex",
    why: "a prospect's wellness report behind a bearer token (RULES P3)",
  },
  {
    file: "src/app/privacy/page.tsx",
    expect: "indexed",
    why: "a legal notice should be findable, and it holds nobody's personal data",
  },
];

describe("public routes decide about search indexing on purpose", () => {
  for (const r of ROUTES) {
    test(`${r.file} is ${r.expect} — ${r.why}`, () => {
      assert.ok(existsSync(r.file), `${r.file} moved; update this list`);
      const src = readFileSync(r.file, "utf8");

      assert.match(
        src,
        /robots:\s*\{/,
        `${r.file} sets no robots directive at all. Decide, do not default.`
      );

      if (r.expect === "noindex") {
        assert.match(src, /index:\s*false/, `${r.file} must be noindex`);
      } else {
        assert.match(src, /index:\s*true/, `${r.file} is meant to be indexed`);
      }
    });
  }

  test("the portfolio is indexed when published, and not when it is not", () => {
    /*
     * The one deliberate exception, and it is conditional — which is why a blanket
     * "contains no index: false" assertion was the wrong test and failed on a page that
     * is actually correct.
     *
     * A PUBLISHED page is indexed: the whole point of a link a coach prints on a poster
     * is being findable. An unclaimed or unpublished slug returns not-found and is
     * noindex, so a coach who has not published does not appear in search results — and
     * neither does a 404 for a slug somebody guessed.
     */
    const src = readFileSync("src/app/[slug]/page.tsx", "utf8");
    assert.match(src, /index:\s*true/, "a published portfolio must be findable");
    assert.match(
      src,
      /Page not found[\s\S]{0,80}index:\s*false/,
      "an unpublished or unclaimed slug must not be indexed"
    );
  });
});
