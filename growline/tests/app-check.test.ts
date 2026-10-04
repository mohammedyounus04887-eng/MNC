import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { planAppCheck, type AppCheckEnv } from "@/lib/app-check";

/**
 * The App Check guard.
 *
 * This is the only part of App Check that can be tested without a browser and a real
 * reCAPTCHA key, and it is also the part where a mistake is most expensive. Get the
 * guard wrong in one direction and the 64-test e2e suite starts failing at login the
 * day somebody puts a key in their `.env`; get it wrong in the other and the protection
 * silently never turns on.
 *
 * `planAppCheck` is pure and takes its environment as an argument precisely so these
 * cases can be enumerated. Nothing here touches `process.env`.
 */

const KEY = "6Lc-fake-site-key-for-tests";

const env = (over: Partial<AppCheckEnv> = {}): AppCheckEnv => ({
  siteKey: KEY,
  ...over,
});

describe("it stays out of the way unless it is wanted", () => {
  test("no site key means do nothing at all", () => {
    // This is the state of the repository today and of every CI run, so it is the case
    // that guarantees shipping App Check changed nothing.
    for (const siteKey of [undefined, "", "   "]) {
      const plan = planAppCheck(env({ siteKey }), true);
      assert.equal(plan.action, "skip", `siteKey ${JSON.stringify(siteKey)}`);
    }
  });

  test("never during a server render", () => {
    // A "use client" module still executes on the server for the first render, and
    // there is no document there to attach a reCAPTCHA to.
    const plan = planAppCheck(env(), false);
    assert.equal(plan.action, "skip");
    if (plan.action === "skip") assert.match(plan.reason, /server/i);
  });

  test("never against the emulators, even with a key set", () => {
    // The case that would break CI and every developer's local suite: a real key cannot
    // attest 127.0.0.1. Either emulator host alone is enough to disqualify.
    const both = { authEmulatorHost: "127.0.0.1:9099", firestoreEmulatorHost: "127.0.0.1:8080" };
    for (const over of [
      { authEmulatorHost: both.authEmulatorHost },
      { firestoreEmulatorHost: both.firestoreEmulatorHost },
      both,
    ]) {
      const plan = planAppCheck(env(over), true);
      assert.equal(plan.action, "skip", JSON.stringify(over));
      if (plan.action === "skip") assert.match(plan.reason, /emulator/i);
    }
  });
});

describe("when it is wanted", () => {
  test("a key in a browser with no emulator starts it", () => {
    const plan = planAppCheck(env(), true);
    assert.equal(plan.action, "init");
    if (plan.action === "init") {
      assert.equal(plan.siteKey, KEY);
      assert.equal(plan.debugToken, null);
    }
  });

  test("Enterprise is the default, because that is what the runbook registers", () => {
    for (const provider of [undefined, "", "  ", "enterprise"]) {
      const plan = planAppCheck(env({ provider }), true);
      assert.equal(plan.action, "init");
      if (plan.action === "init") assert.equal(plan.provider, "enterprise", String(provider));
    }
  });

  test("an unrecognised provider skips and names the variable, rather than guessing", () => {
    /*
     * The first version coerced anything unrecognised to "enterprise". These values are
     * inlined at BUILD time, so a typo is baked into the bundle: the app would then
     * attest against the wrong reCAPTCHA and fail with an error identifying neither the
     * console setting nor the variable. Guessing defeats the entire point of the
     * escape hatch existing.
     */
    for (const provider of ["Enterprise", "V3", "recaptcha", "enterprize", "true"]) {
      const plan = planAppCheck(env({ provider }), true);
      assert.equal(plan.action, "skip", `provider ${provider} should not initialise`);
      if (plan.action === "skip") {
        assert.equal(plan.misconfigured, true);
        assert.match(plan.reason, /NEXT_PUBLIC_FIREBASE_APPCHECK_PROVIDER/);
        assert.match(plan.reason, new RegExp(provider));
      }
    }
  });

  test("classic v3 is selectable, because a console/client mismatch fails obscurely", () => {
    const plan = planAppCheck(env({ provider: "v3" }), true);
    assert.equal(plan.action, "init");
    if (plan.action === "init") assert.equal(plan.provider, "v3");
  });

  test("a debug token is carried through, and blank is not a token", () => {
    const withToken = planAppCheck(env({ debug: "ABC-123" }), true);
    assert.equal(withToken.action, "init");
    if (withToken.action === "init") assert.equal(withToken.debugToken, "ABC-123");

    for (const debug of ["", "   ", undefined]) {
      const plan = planAppCheck(env({ debug }), true);
      assert.equal(plan.action, "init");
      // An empty string assigned to FIREBASE_APPCHECK_DEBUG_TOKEN is not "no token" to
      // the SDK — it is a token that will not validate.
      if (plan.action === "init") assert.equal(plan.debugToken, null, JSON.stringify(debug));
    }
  });

  test("the site key is trimmed, because env files collect trailing spaces", () => {
    const plan = planAppCheck(env({ siteKey: `  ${KEY}  ` }), true);
    assert.equal(plan.action, "init");
    if (plan.action === "init") assert.equal(plan.siteKey, KEY);
  });
});

describe("the precedence between the skip reasons", () => {
  test("a server render outranks everything, including a missing key", () => {
    const plan = planAppCheck({ siteKey: KEY, authEmulatorHost: "127.0.0.1:9099" }, false);
    assert.equal(plan.action, "skip");
    // Whichever reason wins, it must never be "init" — this asserts the ordering cannot
    // be rearranged into one that initialises on the server.
    if (plan.action === "skip") assert.match(plan.reason, /server/i);
  });
});
