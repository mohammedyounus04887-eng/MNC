import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The celebration engine's rules, asserted against the source.
 *
 * Read rather than executed: `celebrate()` needs a DOM, a canvas 2D context and a
 * requestAnimationFrame loop, and a jsdom harness able to run it would be testing
 * jsdom's canvas shim rather than this code. What matters here is not that the
 * confetti looks right — no test can judge that — but that the four rules the
 * engine exists to enforce centrally are actually in it, because the entire point
 * of a shared engine is that no call site has to re-argue them.
 *
 * These would all be silent when broken: a celebration that blocks a tap, one
 * that runs for six seconds, one that fires for somebody who asked for less
 * motion. Each is invisible to the person who wrote it and obvious to a coach.
 */
const SRC = readFileSync("src/lib/celebrate.ts", "utf8");

/**
 * Source with comments stripped.
 *
 * An earlier sweep in this repo failed on its own explanatory comment, and the
 * lesson stuck: a test that punishes writing a decision down teaches the next
 * person to delete the explanation instead of the code. Assertions about what the
 * code DOES read this; assertions about what it must never SAY read the raw text.
 */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the rules a shared engine exists to hold", () => {
  test("never blocks input (G5)", () => {
    // A celebration a coach cannot tap through is a modal, and the 30-second rule
    // does not survive a 1.4s modal on the save path.
    assert.match(SRC, /pointer-events:none/);
  });

  test("hard-capped under 1.5 seconds (G5)", () => {
    const cap = /const MAX_MS = (\d+)/.exec(SRC);
    assert.ok(cap, "MAX_MS is not declared");
    assert.ok(Number(cap[1]) < 1500, `cap is ${cap[1]}ms, budget is under 1500`);
    // And the loop must enforce it itself rather than trusting a caller to stop.
    assert.match(SRC, /elapsed >= MAX_MS/);
  });

  test("silent under prefers-reduced-motion (G5)", () => {
    assert.match(SRC, /prefers-reduced-motion: reduce/);
  });

  test("skippable by one tap (G5)", () => {
    assert.match(SRC, /addEventListener\("pointerdown", stop/);
  });
});

describe("the choices that keep it cheap on a low-end phone", () => {
  test("device pixel ratio is capped", () => {
    // A 3x-DPR canvas is 2.25x the fill cost of a 2x one for no visible gain on
    // confetti, and these phones are exactly where that shows up as dropped frames.
    assert.match(SRC, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/);
  });

  test("no confetti library is imported", () => {
    // canvas-confetti is ~5KB gzipped for a feature that runs a few times a week.
    assert.doesNotMatch(SRC, /from ["']canvas-confetti/);
    assert.doesNotMatch(SRC, /require\(["']canvas-confetti/);
  });

  test("overlapping calls are refused, not queued", () => {
    // Two celebrations at once is double the particle load for no extra feeling,
    // and G5's "never two glows touching" in its literal form.
    assert.match(SRC, /if \(running\) return;/);
  });

  test("the canvas is always removed, including on the skip path", () => {
    const stopBody = /const stop = \(\) => \{([\s\S]*?)\};/.exec(SRC);
    assert.ok(stopBody, "no stop() found");
    assert.match(stopBody[1], /canvas\.remove\(\)/);
    assert.match(stopBody[1], /running = false/);
  });
});

describe("it follows the theme instead of pinning colours", () => {
  test("particle colours are read from CSS custom properties", () => {
    // A hard-coded gold glow survived a whole reskin in this codebase and clashed
    // with the new accent for a full release. Reading tokens means the next
    // palette change carries the confetti with it, with nothing to remember.
    const body = code(SRC);
    assert.match(body, /getPropertyValue\(/);
    for (const token of ["--accent", "--accent-hi", "--gem-green-text", "--gem-pink-text"]) {
      assert.match(body, new RegExp(token.replace(/-/g, "\\-")), `${token} is not read`);
    }
    // Hex literals may exist ONLY as fallbacks beside a token name, never as the
    // particle palette itself.
    const hexes = body.match(/#[0-9a-f]{6}/gi) ?? [];
    for (const hex of hexes) {
      assert.match(
        body,
        new RegExp(`--[a-z-]+"\\s*,\\s*"${hex}`, "i"),
        `${hex} appears without a token beside it`
      );
    }
  });
});

describe("the dead celebration this engine was built to resurrect", () => {
  test("TargetRing no longer depends on a prop nobody passed", () => {
    /*
     * The confetti in TargetRing was gated on `previousPercent`, which its only
     * caller never supplied — so the effect returned on its first line and the
     * celebration had never run once since it was written. The fix reads the last
     * seen percentage from localStorage instead, which needs no caller to
     * remember anything.
     */
    const ring = readFileSync("src/components/TargetRing.tsx", "utf8");
    // Comments stripped: the prop name survives in the note explaining WHY it
    // went, and that note is the most valuable line in the file.
    assert.doesNotMatch(code(ring), /previousPercent/);
    assert.match(ring, /growline:target-pct:/);
    assert.match(ring, /celebrate\(\)/);
  });

  test("the crossing is recorded before it is acted on", () => {
    // Otherwise a crash or a fast unmount mid-celebration leaves the milestone
    // armed, and it fires again on the next load — a celebration that repeats is
    // worse than one that never fires, because it teaches the number is fake.
    const ring = readFileSync("src/components/TargetRing.tsx", "utf8");
    const setIdx = ring.indexOf("localStorage.setItem");
    const crossIdx = ring.indexOf("const crossed =");
    assert.ok(setIdx > 0 && crossIdx > 0);
    assert.ok(setIdx < crossIdx, "the percentage must be stored before the crossing is evaluated");
  });
});
