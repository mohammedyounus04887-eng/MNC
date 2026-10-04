import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import manifest from "@/app/manifest";
import { RESERVED_SLUGS } from "@/modules/portfolio/model";

/**
 * The web app manifest (v1 §10).
 *
 * These are not style checks. Chrome will simply not offer installation if any of the
 * required fields is missing or wrong, and it says so nowhere a user would look — the
 * button is absent and that is the entire feedback. So the criteria are pinned here,
 * where a change that breaks installability fails a test instead of quietly removing a
 * feature nobody is watching.
 *
 * The audit that found the manifest missing found it by reading the filesystem, not by
 * anything failing. That is the gap this closes.
 */

const m = manifest();

describe("installability — the fields Chrome actually requires", () => {
  test("name, start_url, scope and a standalone display", () => {
    assert.ok(m.name && m.name.length > 0, "name is required");
    assert.ok(m.short_name && m.short_name.length > 0, "short_name shows under the icon");
    // Android truncates the launcher label around 12 characters.
    assert.ok(m.short_name!.length <= 12, `short_name "${m.short_name}" will be truncated`);
    assert.equal(m.start_url, "/");
    assert.equal(m.scope, "/");
    assert.equal(m.display, "standalone");
  });

  test("a 192 and a 512 exist, and both are declared purpose any", () => {
    const any = (m.icons ?? []).filter((i) => i.purpose === "any");
    for (const size of ["192x192", "512x512"]) {
      assert.ok(
        any.some((i) => i.sizes === size),
        `Chrome requires a ${size} icon with purpose "any"`
      );
    }
  });

  test("a maskable set exists, or Android pads a dark icon into a white circle", () => {
    const maskable = (m.icons ?? []).filter((i) => i.purpose === "maskable");
    assert.ok(maskable.length >= 2, "expected maskable 192 and 512");
    for (const size of ["192x192", "512x512"]) {
      assert.ok(maskable.some((i) => i.sizes === size), `missing maskable ${size}`);
    }
  });

  test("every icon the manifest promises is actually on disk and non-empty", () => {
    // A manifest pointing at a missing file fails installation with no visible error.
    for (const icon of m.icons ?? []) {
      const path = `public${icon.src}`;
      assert.ok(existsSync(path), `${icon.src} is declared but not committed`);
      assert.ok(statSync(path).size > 500, `${icon.src} is suspiciously small`);
    }
    // iOS ignores the manifest entirely and reads this one from the layout instead.
    assert.ok(existsSync("public/icons/apple-touch-icon.png"), "apple-touch-icon missing");
  });
});

describe("it looks like the app, not like a default", () => {
  test("the splash is the app's own ground, whatever that currently is", () => {
    /**
     * This test used to pin `#0B1020` under the title "splash and status bar use the
     * dark ground, not white", and it survived two whole design systems doing so.
     * The app became cream; the splash stayed near-black navy; the test agreed with
     * the splash. On Android — the entire target platform — every cold start painted
     * a dark rectangle and then loaded a light app, and the suite called it correct.
     *
     * The lesson is the one worth keeping: a test that pins a VALUE becomes an
     * argument for the bug the moment the value moves. This pins the RELATIONSHIP —
     * the splash equals `--bg` — which is the thing that was actually true all along
     * and would have caught the drift on the reskin commit that caused it.
     */
    const css = readFileSync("src/app/globals.css", "utf8");
    const bg = /:root\s*\{[^}]*?--bg:\s*(#[0-9a-fA-F]{3,8})/.exec(css);
    assert.ok(bg, "could not find --bg on :root in globals.css");
    assert.equal(m.background_color, bg[1]);
    assert.equal(m.theme_color, bg[1]);
  });

  test("the status bar follows the system theme, which the manifest cannot", () => {
    // `theme_color` in the manifest is a single value. `viewport.themeColor` takes a
    // media query, so it is the only slot that can be right for both audiences —
    // and each colour must be its own theme's real ground.
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const css = readFileSync("src/app/globals.css", "utf8");
    const light = /:root\s*\{[^}]*?--bg:\s*(#[0-9a-fA-F]{3,8})/.exec(css)?.[1];
    const dark = /prefers-color-scheme:\s*dark[\s\S]{0,200}?--bg:\s*(#[0-9a-fA-F]{3,8})/.exec(css)?.[1];
    assert.ok(light && dark, "could not read both --bg values from globals.css");
    assert.match(layout, /prefers-color-scheme: light\)", color: "#/);
    assert.ok(
      layout.includes(`color: "${light}"`),
      `layout's light themeColor is not ${light}`
    );
    assert.ok(
      layout.includes(`color: "${dark}"`),
      `layout's dark themeColor is not ${dark}`
    );
  });

  test("no deleted palette survives in the launcher identity", () => {
    /**
     * #0B1020 was Dark Achiever's ground. It outlived the design system by two
     * reskins in three separate files, because nothing compared them to each other.
     *
     * Comments are stripped first, and that is not incidental. The first version of
     * this assertion failed on the sentence in manifest.ts explaining WHY the value
     * changed — the one artefact most worth keeping. This repo has made that mistake
     * before: a test that punishes writing the reasoning down teaches the next
     * person to delete the reasoning rather than the code.
     */
    const code = (text: string) =>
      text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/<!--[\s\S]*?-->/g, "");

    for (const file of [
      "src/app/manifest.ts",
      "src/app/layout.tsx",
      "public/icons/icon.svg",
      "scripts/make-icons.ts",
    ]) {
      assert.doesNotMatch(
        code(readFileSync(file, "utf8")),
        /#0B1020/i,
        `${file} still carries the deleted Dark Achiever ground`
      );
    }
  });

  test("the shortcuts are the daily loop, and all point at real routes", () => {
    const urls = (m.shortcuts ?? []).map((s) => s.url);
    assert.deepEqual(urls, ["/prospects/new", "/log", "/team"]);
    for (const s of m.shortcuts ?? []) {
      assert.ok(s.name.length > 0 && s.name.length <= 16, `"${s.name}" is too long`);
      // RULES S6: plain words on a launcher menu, same as in the app.
      assert.doesNotMatch(s.name, /CRM|pipeline|analytics|engagement/i);
    }
  });

  test("no income promise reaches the store listing or the launcher (RULES L4)", () => {
    const copy = [m.name, m.short_name, m.description, ...(m.shortcuts ?? []).map((s) => s.description ?? "")].join(" ");
    assert.doesNotMatch(copy, /earn|income|₹|salary|profit|rich/i);
  });
});

describe("the route cannot be shadowed by a coach", () => {
  test("manifest and icons are both reserved slugs", () => {
    // `/manifest.webmanifest` and `/icons/*` carry dots or extra segments so the
    // portfolio matcher never sees them, but the bare words would match it.
    for (const slug of ["manifest", "icons"]) {
      assert.ok(RESERVED_SLUGS.has(slug), `"${slug}" must be reserved`);
    }
  });
});
