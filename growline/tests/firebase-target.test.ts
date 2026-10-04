import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveTarget, type CredentialEnv } from "@/lib/firebase-target";

/**
 * The boot guard in `src/lib/firebase-admin.ts` — the single place this app decides
 * which project it talks to and with whose authority.
 *
 * It has never had a test, because it used to read `process.env` at module scope: a
 * unit test that imports it can only ever exercise the one configuration that process
 * was started with, and the interesting cases are the ones that must THROW. Splitting
 * the decision into a pure function of an env object is what makes the table below
 * possible, and the table is the point — every combination, stated once, including the
 * three that are refused.
 *
 * Why this matters more than its size suggests: the dangerous state is
 * FIREBASE_AUTH_EMULATOR_HOST set on its own. The Admin SDK then swaps in the emulator
 * token verifier — `algorithms: ['none']` — so a session cookie signed with nothing,
 * naming any uid, is accepted, while Firestore reads and writes a REAL project. One
 * variable in a deploy config. Nothing in the logs says so.
 */

const SA = '{"project_id":"grow--line","private_key":"x","client_email":"y"}';
const EMU = {
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
};

describe("the three configurations that boot", () => {
  test("both emulator hosts, no credential — dev, e2e, CI", () => {
    assert.deepEqual(resolveTarget(EMU), { usingEmulators: true });
  });

  test("a service account, no emulator hosts — a real project", () => {
    assert.deepEqual(resolveTarget({ FIREBASE_SERVICE_ACCOUNT: SA }), {
      usingEmulators: false,
      serviceAccount: SA,
    });
  });

  test("nothing set, but inside `next build` — the build phase touches no Firebase (D81)", () => {
    // Reproduced from App Hosting build 022bb1bb: "Collecting page data" evaluates
    // every route module inside Cloud Build, where K_SERVICE does not exist, and the
    // guard failed the BUILD with the message meant for a misconfigured SERVER. The
    // runtime is a different process (`next start` never sets NEXT_PHASE), so the
    // refusal below still protects it.
    assert.deepEqual(resolveTarget({ NEXT_PHASE: "phase-production-build" }), {
      usingEmulators: false,
      serviceAccount: null,
    });
  });

  test("nothing set, but running on Cloud Run — App Hosting via ADC (D80)", () => {
    // `serviceAccount: null` is the discriminant `createApp` switches on to call
    // `applicationDefault()`. This is the branch where no key material exists
    // anywhere, which is why apphosting.yaml needs no secret at all.
    assert.deepEqual(resolveTarget({ K_SERVICE: "growline" }), {
      usingEmulators: false,
      serviceAccount: null,
    });
  });
});

describe("the states that must refuse to start", () => {
  const refused: [string, CredentialEnv, RegExp][] = [
    [
      "auth emulator alone — tokens stop being verified against real data",
      { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" },
      /FIREBASE_AUTH_EMULATOR_HOST is set but FIRESTORE_EMULATOR_HOST is not/,
    ],
    [
      "firestore emulator alone — data goes local while auth stays live",
      { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
      /FIRESTORE_EMULATOR_HOST is set but FIREBASE_AUTH_EMULATOR_HOST is not/,
    ],
    [
      "a credential alongside emulator hosts — the credential is decoration",
      { ...EMU, FIREBASE_SERVICE_ACCOUNT: SA },
      /FIREBASE_SERVICE_ACCOUNT is set alongside/,
    ],
    [
      "nothing at all, off Cloud Run — no credential to fall back on",
      {},
      /not running on Cloud Run \(K_SERVICE is unset\)/,
    ],
  ];

  for (const [what, env, message] of refused) {
    test(what, () => {
      assert.throws(() => resolveTarget(env), message);
    });
  }

  test("the refusal happens at boot, not at the first query", () => {
    // The whole reason this is a throw rather than a lazy failure: a process that
    // starts and then fails every request looks like an outage with no cause, and on
    // App Hosting it would pass its health check and take traffic.
    assert.throws(() => resolveTarget({}), /Refusing to start/);
  });
});

describe("precedence, where two signals disagree", () => {
  test("an explicit credential beats ADC", () => {
    // Somebody who put a service account in the environment meant THAT account.
    // Preferring the platform's would silently point a deployment at a different
    // project than the operator configured.
    const t = resolveTarget({ FIREBASE_SERVICE_ACCOUNT: SA, K_SERVICE: "growline" });
    assert.deepEqual(t, { usingEmulators: false, serviceAccount: SA });
  });

  test("emulators beat ADC — being on Cloud Run does not defeat emulator routing", () => {
    // The SDK routes to the emulator hosts regardless of what credential is resolved,
    // so if this returned the ADC branch the guard would be describing a process
    // differently from how it actually behaves.
    assert.deepEqual(resolveTarget({ ...EMU, K_SERVICE: "growline" }), {
      usingEmulators: true,
    });
  });
});

describe("empty string is unset, because that is the SDK's own test", () => {
  /*
   * `useEmulator()` in the SDK's auth-api-request.js is
   * `!!process.env.FIREBASE_AUTH_EMULATOR_HOST`, so `FOO=""` is unset to the thing
   * being guarded. A guard that disagreed with it — by trimming, or checking host
   * shape — could call a value unset that the SDK still routes on, which is worse
   * than no guard. .env.example ships empty credential lines for this reason.
   */
  test("an empty credential is not a credential", () => {
    assert.throws(() => resolveTarget({ FIREBASE_SERVICE_ACCOUNT: "" }), /Refusing to start/);
  });

  test("an empty emulator host does not trip the half-set guard", () => {
    assert.deepEqual(
      resolveTarget({ FIREBASE_AUTH_EMULATOR_HOST: "", FIREBASE_SERVICE_ACCOUNT: SA }),
      { usingEmulators: false, serviceAccount: SA }
    );
  });

  test("an empty K_SERVICE is not Cloud Run", () => {
    assert.throws(() => resolveTarget({ K_SERVICE: "" }), /Refusing to start/);
  });
});

describe("the Cloud Run probe is K_SERVICE and nothing else", () => {
  /*
   * The gate is the entire safety of the ADC branch. On a laptop, ADC either does not
   * exist — the boot succeeds and every request fails later, exactly the failure this
   * guard was written to move forward in time — or it exists and points at whichever
   * project that person last used with `gcloud auth`, which is worse than either.
   *
   * So the variables below must NOT be treated as evidence of an attached credential:
   * NODE_ENV is set by `next start` on a laptop, GCLOUD_PROJECT by the Firebase CLI,
   * and GOOGLE_APPLICATION_CREDENTIALS by this repo's own rules-deploy workflow.
   */
  test("only the production-build phase unlocks the build branch", () => {
    // `next dev` sets its own phase value, and a dev server DOES talk to Firebase —
    // it must keep failing fast when unconfigured, not limp along credential-less.
    assert.throws(
      () => resolveTarget({ NEXT_PHASE: "phase-development-server" }),
      /Refusing to start/
    );
    assert.throws(() => resolveTarget({ NEXT_PHASE: "" }), /Refusing to start/);
  });

  for (const decoy of [
    "NODE_ENV",
    "GCLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "FUNCTION_TARGET",
    "PORT",
  ]) {
    test(`${decoy} does not stand in for K_SERVICE`, () => {
      assert.throws(() => resolveTarget({ [decoy]: "something" }), /Refusing to start/);
    });
  }
});
