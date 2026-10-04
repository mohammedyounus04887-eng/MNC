import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Proves the unit-test harness itself works: TypeScript is being transpiled, imports
 * from `@/...` resolve, and a failing assertion actually fails the run.
 *
 * ## Why the runner is `node --test` and not Vitest or Jest
 *
 * Node has had a test runner built in since 20, and `tsx` is already a dependency
 * (the seed and migration scripts run through it). So the entire unit-test capability
 * costs zero new packages. On a project whose infra budget is a stated constraint
 * (v1 §10) and whose CI has to install from lockfile on every push, a test runner
 * that adds nothing to `node_modules` is the right default. Reach for Vitest if
 * something genuinely needs jsdom or module mocking — neither of which the pure
 * modules under test here need, because they are pure.
 */

test("the harness transpiles TypeScript and resolves the @ alias", async () => {
  const { HEALTHY_BMI_MIN, MIN_REPORT_AGE } = await import("@/lib/wellness");
  assert.equal(typeof HEALTHY_BMI_MIN, "number");
  // Not just "is a number": 18 is RULES L6, and a harness check that would still
  // pass if this constant drifted would be worth nothing.
  assert.equal(MIN_REPORT_AGE, 18);
});

test("an assertion failure is a real failure", () => {
  assert.throws(() => assert.equal(1, 2));
});
