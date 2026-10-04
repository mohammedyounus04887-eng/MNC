import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  MAX_SLUG,
  MAX_STORY,
  MIN_SLUG,
  RESERVED_SLUGS,
  checkSlug,
  checkStory,
  portfolioUrl,
  readyToPublish,
  suggestSlug,
} from "@/modules/portfolio/model";

/**
 * The pure half of the public portfolio (F9).
 *
 * The slug rules carry more weight than they look like they do: this string ends up
 * printed on a QR poster on a club wall, so a name that validates today and collides with
 * a route next month costs a coach a reprint.
 */

describe("slug shape — this gets read out loud down a phone", () => {
  test("a plain name is accepted and lowercased", () => {
    assert.deepEqual(checkSlug("PriyaSharma"), { ok: true, value: "priyasharma" });
  });

  test("hyphens are allowed between parts, never at the edges or doubled", () => {
    assert.equal(checkSlug("priya-sharma").ok, true);
    assert.equal(checkSlug("-priya").ok, false);
    assert.equal(checkSlug("priya-").ok, false);
    assert.equal(checkSlug("priya--sharma").ok, false);
  });

  test("spaces, underscores and symbols are refused", () => {
    for (const bad of ["priya sharma", "priya_sharma", "priya.sharma", "priya@2"]) {
      assert.equal(checkSlug(bad).ok, false, bad);
    }
  });

  test("length is bounded at both ends", () => {
    assert.equal(checkSlug("a".repeat(MIN_SLUG - 1)).ok, false);
    assert.equal(checkSlug("a".repeat(MIN_SLUG)).ok, true);
    assert.equal(checkSlug("a".repeat(MAX_SLUG)).ok, true);
    assert.equal(checkSlug("a".repeat(MAX_SLUG + 1)).ok, false);
  });

  test("surrounding whitespace is trimmed, not rejected", () => {
    assert.deepEqual(checkSlug("  priya  "), { ok: true, value: "priya" });
  });

  test("non-strings and empties are refused without throwing", () => {
    for (const bad of [null, undefined, 42, {}, [], ""]) {
      assert.equal(checkSlug(bad).ok, false);
    }
  });
});

describe("reserved slugs — every one of these would shadow a real route", () => {
  test("MANDATORY: every real top-level route is reserved", () => {
    /*
     * Enumerated from the filesystem, not typed out here.
     *
     * A route added next month that nobody remembers to reserve is the exact failure this
     * list exists to prevent — and a hardcoded copy of today's routes could not notice it.
     * Reading the directories means adding `src/app/pricing/` fails this test until
     * "pricing" is reserved, which is the moment it costs nothing to fix. Route GROUPS
     * `(app)` and private `_folders` are skipped: neither appears in a URL.
     */
    const roots = [
      ...readdirSync("src/app", { withFileTypes: true }),
      ...readdirSync("src/app/(app)", { withFileTypes: true }),
    ]
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((n) => !n.startsWith("(") && !n.startsWith("_") && !n.startsWith("["));

    assert.ok(roots.length > 15, "expected to find the app's routes");
    for (const route of roots) {
      assert.equal(
        RESERVED_SLUGS.has(route),
        true,
        `"${route}" is a real route — add it to RESERVED_SLUGS or a coach can claim a link that leads nowhere`
      );
      assert.equal(checkSlug(route).ok, false, `"${route}" must not be claimable`);
    }
  });

  test("the words a growing product reaches for are reserved too", () => {
    for (const word of ["pricing", "help", "blog", "about", "terms", "privacy", "support"]) {
      assert.equal(checkSlug(word).ok, false, word);
    }
  });

  test("reserved names fail with the reserved message, not the format one", () => {
    const r = checkSlug("login");
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /taken by the app/i);
  });
});

describe("the suggestion is only ever a suggestion", () => {
  test("a normal name becomes a usable slug", () => {
    assert.equal(suggestSlug("Priya Sharma"), "priya-sharma");
  });

  test("punctuation and repeated spaces collapse", () => {
    assert.equal(suggestSlug("  Dr.  Priya   Sharma!  "), "dr-priya-sharma");
  });

  test("a name with no Latin letters suggests nothing rather than something random", () => {
    // A coach who typed their name in Kannada has nothing to build a slug from, and an
    // empty box they fill themselves is more honest than a generated string.
    assert.equal(suggestSlug("ಪ್ರಿಯಾ"), "");
  });

  test("a suggestion is never a reserved word", () => {
    assert.equal(suggestSlug("Admin"), "");
    assert.equal(suggestSlug("Support"), "");
  });

  test("whatever it suggests is always valid", () => {
    for (const name of ["Priya Sharma", "A B", "Ravi", "Chandan  Kumar", "X"]) {
      const s = suggestSlug(name);
      if (s !== "") assert.equal(checkSlug(s).ok, true, `${name} -> ${s}`);
    }
  });

  test("a long name is cut to the limit and still valid", () => {
    const s = suggestSlug("Venkatanarasimharajuvaripeta Subramanian Iyer");
    assert.ok(s.length <= MAX_SLUG);
    assert.equal(checkSlug(s).ok, true);
  });
});

describe("story and publishing", () => {
  test("a story over the limit is refused with a readable message", () => {
    const r = checkStory("x".repeat(MAX_STORY + 1));
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, new RegExp(String(MAX_STORY)));
  });

  test("an absent story is empty, not an error — every field here is optional", () => {
    assert.deepEqual(checkStory(undefined), { ok: true, value: "" });
    assert.deepEqual(checkStory(null), { ok: true, value: "" });
  });

  test("a page with only a name is not encouraged to publish", () => {
    assert.equal(readyToPublish({ slug: "priya", story: "" }), false);
    assert.equal(readyToPublish({ slug: "priya", story: "   " }), false);
    assert.equal(readyToPublish({ slug: "", story: "My story" }), false);
    assert.equal(readyToPublish({ slug: "priya", story: "My story" }), true);
  });
});

describe("the public URL", () => {
  test("is built from the site origin and the slug, with no double slash", () => {
    assert.equal(portfolioUrl("https://growline.in", "priya"), "https://growline.in/priya");
    assert.equal(portfolioUrl("https://growline.in/", "priya"), "https://growline.in/priya");
    assert.equal(portfolioUrl("https://growline.in///", "priya"), "https://growline.in/priya");
  });
});

/**
 * Source with comments removed.
 *
 * Every grep-the-source assertion below needs this. A file that documents WHY a forbidden
 * string is absent contains that string, and an assertion reading the raw text fails on
 * the explanation — so the fix becomes deleting the comment, which is precisely backwards.
 */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("compliance and layering", () => {
  test("MANDATORY: nothing in the portfolio names a company or a rank (RULES L1/L8)", () => {
    for (const file of [
      "src/modules/portfolio/model.ts",
      "src/modules/portfolio/PortfolioEditor.tsx",
      "src/app/[slug]/page.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(src, /\b(herbalife|amway|oriflame|vestige|modicare|forever living)\b/i);
      // No rank ladder anywhere — a coach types their own label or there is none (L8).
      assert.doesNotMatch(src, /\b(supervisor|president'?s team|diamond|chairman'?s club)\b/i);
    }
  });

  test("MANDATORY: no income or earnings wording on the public page (RULES L4)", () => {
    const page = readFileSync("src/app/[slug]/page.tsx", "utf8");
    const editor = readFileSync("src/modules/portfolio/PortfolioEditor.tsx", "utf8");
    for (const src of [page, editor]) {
      assert.doesNotMatch(src, /\b(earn|income|salary|commission|₹\d)/i);
    }
  });

  test("the coach's phone number is never rendered into the indexed page", () => {
    // The page asks search engines to index it, so a wa.me href would put a personal
    // mobile number in crawlable HTML. It goes through the redirect route instead.
    //
    // Comments are stripped first. Matching the raw file catches the paragraph that
    // EXPLAINS why wa.me is absent, which would make the test punish the explanation
    // rather than the violation — the same trap the goals suite hit.
    const page = code(readFileSync("src/app/[slug]/page.tsx", "utf8"));
    assert.doesNotMatch(page, /wa\.me/);
    assert.match(page, /api\/public\/contact/);
  });

  test("the client editor never imports the query layer (RULES E2)", () => {
    const src = readFileSync("src/modules/portfolio/PortfolioEditor.tsx", "utf8");
    assert.match(src, /^"use client";/);
    assert.doesNotMatch(
      src,
      /^\s*import\s[^\n]*(firebase-admin|@\/lib\/collections|\.\/queries)/m
    );
  });

  test("the pure model has no database import", () => {
    const src = readFileSync("src/modules/portfolio/model.ts", "utf8");
    assert.doesNotMatch(src, /^\s*import\s/m);
  });
});
