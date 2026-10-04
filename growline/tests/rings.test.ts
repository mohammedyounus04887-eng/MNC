import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The two rings, and the one thing they must never disagree about.
 *
 * There are deliberately two of them: `TargetRing` on /targets, which celebrates,
 * and `MiniRing` on home, which does not. That split is the right one — a
 * confetti burst in a list row a coach is scrolling past is noise, and worse, it
 * would consume the crossing so the real ring never fires it (the confetti in
 * this repo had already spent a full release never running once; it does not get
 * to happen twice).
 *
 * But two rings means two chances to draw the wrong arc. Both draw what REMAINS,
 * because v2 §4's mechanic #2 is the tension of an unfinished shape, not a report
 * of what is done. If one of them ever flips, the same target reads 20% on one
 * screen and 80% on the other — a bug no typecheck can see and every coach can.
 */
const TARGET_RING = readFileSync("src/components/TargetRing.tsx", "utf8");
const MINI_RING = readFileSync("src/components/MiniRing.tsx", "utf8");
const HOME = readFileSync("src/app/(app)/page.tsx", "utf8");

/**
 * Source with comments stripped — assertions about what the code DOES read this,
 * so that explaining a decision in a comment can never fail a test about
 * behaviour. (This repo has made that mistake; the lesson is that a test which
 * punishes writing the reasoning down teaches the next person to delete the
 * reasoning rather than the code.)
 */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("both rings tell the same story", () => {
  test("each draws the remaining arc, by the same expression", () => {
    const arc = /const dashRemaining = \(CIRCUMFERENCE \* \(100 - clamped\)\) \/ 100;/;
    assert.match(code(TARGET_RING), arc);
    assert.match(code(MINI_RING), arc);
  });

  test("each starts the arc at twelve o'clock", () => {
    // Without the rotation the arc starts at 3 o'clock, which reads as a
    // different amount of progress at a glance even though the number is right.
    assert.match(code(TARGET_RING), /rotate\(-90 /);
    assert.match(code(MINI_RING), /rotate\(-90 /);
  });

  test("each derives the percentage the same way", () => {
    const pct = /target > 0 \? Math\.round\(\(progress \/ target\) \* 100\) : 0/;
    assert.match(code(TARGET_RING), pct);
    assert.match(code(MINI_RING), pct);
  });
});

describe("only one of them celebrates", () => {
  test("the mini ring never fires confetti", () => {
    assert.doesNotMatch(code(MINI_RING), /celebrate|haptic/);
  });

  test("the mini ring never touches the crossing record", () => {
    // Reading it would be harmless; WRITING it is what would silently eat the
    // milestone before /targets ever sees it.
    assert.doesNotMatch(code(MINI_RING), /localStorage/);
  });

  test("the mini ring ships no JavaScript at all", () => {
    // No state, no effects, nothing to hydrate — on a ₹10K Android the home
    // screen's job is to render, not to boot.
    assert.doesNotMatch(code(MINI_RING), /"use client"/);
    assert.doesNotMatch(code(MINI_RING), /useState|useEffect/);
  });
});

describe("the ring is actually on the home screen", () => {
  /**
   * The reason this test exists at all: three separate features in this codebase
   * were written, typed, reviewed and shipped without ever being mounted on a
   * screen. A component that renders correctly in isolation and appears nowhere
   * is indistinguishable, to a coach, from one that was never built.
   */
  test("home renders it for a set target", () => {
    assert.match(code(HOME), /import MiniRing from "@\/components\/MiniRing"/);
    assert.match(code(HOME), /<MiniRing/);
  });

  test("home passes it the real target numbers", () => {
    assert.match(code(HOME), /progress=\{myTarget\.progressPoints\}/);
    assert.match(code(HOME), /target=\{myTarget\.targetPoints\}/);
  });
});
