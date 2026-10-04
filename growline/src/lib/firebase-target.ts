/**
 * Which credential this process uses, and against which project.
 *
 * Split out of `firebase-admin.ts` so it can be tested: that module resolves its
 * target at import time, on purpose, which means a unit test importing it can only
 * ever exercise one configuration per process. Here the function is pure — it reads
 * an env object handed to it and returns a value — so every combination, including
 * the ones that must throw, is a normal assertion.
 *
 * Nothing in this file touches the Admin SDK. It is a decision, not a connection.
 */

/**
 * Which project this process talks to — decided once, at import.
 *
 * The Admin SDK resolves emulator routing per product, from two independent
 * variables: Firestore reads FIRESTORE_EMULATOR_HOST, Auth reads
 * FIREBASE_AUTH_EMULATOR_HOST. Set one without the other and half of this app talks
 * to a real project. The auth-only half is the dangerous half: with
 * FIREBASE_AUTH_EMULATOR_HOST set, `verifyIdToken` and `verifySessionCookie` stop
 * checking the signature and merely decode — `token-verifier.js` swaps in the
 * emulator verifier, which is `verifyJwtSignature(token, undefined, { algorithms:
 * ['none'] })`, and stops requiring `kid` and RS256 at the same time. So a cookie
 * signed with nothing, naming any uid, is accepted against real data, and nothing in
 * the logs says so.
 *
 * `usingEmulators` used to read FIRESTORE_EMULATOR_HOST alone, which made exactly
 * that state invisible: it stayed false, so the missing-credential check below was
 * satisfied by a real service account while every token went unverified. One
 * variable in a deploy config, and everything looked correct. Hence a guard rather
 * than a paragraph in .env.example.
 *
 * Three configurations boot, and no others:
 *   - both emulator hosts set, FIREBASE_SERVICE_ACCOUNT unset — dev, e2e, CI
 *   - both emulator hosts unset, FIREBASE_SERVICE_ACCOUNT set — a real project
 *   - none of the three set, but running on Cloud Run — App Hosting, using the
 *     credential the platform already attached (D80). This is the only branch where
 *     no key material exists anywhere, which is why it is the preferred one in
 *     production and why `apphosting.yaml` needs no secret at all.
 *
 * NODE_ENV takes no part, deliberately. `next build` then `next start` against the
 * emulators is how the production bundle gets checked before it ships, so
 * NODE_ENV=production is not evidence of a real deployment, and gating on it would
 * break that check. A service account is the honest signal of intent — it exists
 * only to reach a real project — which is why one alongside an emulator host is an
 * error rather than a precedence rule to pick.
 *
 * Presence is plain truthiness because that is the test the SDK itself applies:
 * `useEmulator()` in `auth-api-request.js` is `!!process.env.FIREBASE_AUTH_EMULATOR_HOST`,
 * so `FOO=""` is unset to both — which is why .env.example's empty credential line is
 * fine. Anything stricter here — trimming, a host-shape check — could call a value
 * unset that the SDK still routes on, and a guard that disagrees with the thing it
 * guards is worse than no guard.
 *
 * When Storage is switched on (storage.rules is deny-all until then, and says why),
 * FIREBASE_STORAGE_EMULATOR_HOST has to join this pair in the same change. A third
 * product with its own variable is the same skew waiting to happen.
 */
export type FirebaseTarget =
  | { usingEmulators: true }
  | { usingEmulators: false; serviceAccount: string }
  /**
   * Application Default Credentials — the service account Cloud Run has already
   * attached to this revision. `serviceAccount: null` is the discriminant, and it is
   * reachable only from inside Cloud Run. See `onCloudRun()`.
   */
  | { usingEmulators: false; serviceAccount: null };

/**
 * Only the four variables this decision turns on. The index signature is what lets
 * `process.env` be passed straight in — without it TypeScript's weak-type check
 * rejects an all-optional target that shares no declared key with `ProcessEnv`.
 */
export type CredentialEnv = Readonly<Record<string, string | undefined>> & {
  FIRESTORE_EMULATOR_HOST?: string;
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  FIREBASE_SERVICE_ACCOUNT?: string;
  /** Set by the Cloud Run runtime contract, and by nothing else. */
  K_SERVICE?: string;
  /** Set by Next.js itself for the lifetime of `next build`. */
  NEXT_PHASE?: string;
};

export function resolveTarget(env: CredentialEnv): FirebaseTarget {
  const firestoreHost = env.FIRESTORE_EMULATOR_HOST;
  const authHost = env.FIREBASE_AUTH_EMULATOR_HOST;
  const serviceAccount = env.FIREBASE_SERVICE_ACCOUNT;

  if (authHost && !firestoreHost) {
    throw new Error(
      "FIREBASE_AUTH_EMULATOR_HOST is set but FIRESTORE_EMULATOR_HOST is not. " +
        "Emulator routing is per product, so this reads and writes a REAL project " +
        "while the Admin SDK stops verifying ID-token and session-cookie signatures — " +
        "an unsigned cookie naming any user would be accepted. Set " +
        "FIRESTORE_EMULATOR_HOST as well to use the emulators, or unset " +
        "FIREBASE_AUTH_EMULATOR_HOST."
    );
  }

  if (firestoreHost && !authHost) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST is set but FIREBASE_AUTH_EMULATOR_HOST is not. Auth " +
        "would stay on the live project with no credential while all data went to the " +
        "emulator, so sign-in fails at request time with a credentials error that " +
        "points nowhere near the cause. Set FIREBASE_AUTH_EMULATOR_HOST as well, or " +
        "unset FIRESTORE_EMULATOR_HOST."
    );
  }

  if (firestoreHost && serviceAccount) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is set alongside FIRESTORE_EMULATOR_HOST and " +
        "FIREBASE_AUTH_EMULATOR_HOST. The emulator hosts win, so the credential is " +
        "decoration: every read and write would go to a local emulator and every token " +
        "would go unverified, in a process configured to look like production. Unset " +
        "both emulator hosts to use the credential, or unset FIREBASE_SERVICE_ACCOUNT " +
        "to use the emulators."
    );
  }

  if (firestoreHost) return { usingEmulators: true };

  // An explicit credential still wins. Somebody who went to the trouble of putting a
  // service account in the environment meant that account and not whichever one the
  // platform happens to attach, and silently preferring ADC over it would be the
  // guard picking a different project than the operator asked for.
  if (serviceAccount) return { usingEmulators: false, serviceAccount };

  // Third configuration: running ON Google's infrastructure, where a credential is
  // already attached to the process and shipping a key file alongside it is strictly
  // worse — a second, longer-lived secret to store, rotate and leak, granting the same
  // access ADC grants for free.
  if (onCloudRun(env)) return { usingEmulators: false, serviceAccount: null };

  // Fourth configuration: `next build`, with no Firebase anywhere in sight (D81).
  //
  // Next evaluates every route module during "Collecting page data", which runs this
  // file at module scope — inside Cloud Build, where K_SERVICE is a runtime variable
  // that does not exist. The guard as first written failed the App Hosting BUILD with
  // the very message meant for a misconfigured SERVER. But a build must not talk to
  // Firebase at all (every page here renders dynamically; nothing queries at build
  // time), so demanding a credential from one protects nothing. The ADC-shaped return
  // costs nothing either way: firebase-admin resolves ADC lazily, at first token use,
  // and there is no first use in a build.
  //
  // The runtime guarantee is intact because the runtime is a DIFFERENT process:
  // `next start` never sets NEXT_PHASE, so a misconfigured server still refuses below.
  if (env.NEXT_PHASE === "phase-production-build") {
    return { usingEmulators: false, serviceAccount: null };
  }

  throw new Error(
    "FIREBASE_SERVICE_ACCOUNT is not set, no emulator host is configured, and this " +
      "process is not running on Cloud Run (K_SERVICE is unset), so there are no " +
      "Application Default Credentials to fall back on. Refusing to start: without " +
      "one of the three, every query fails at request time instead of here."
  );
}

/**
 * Are we inside Cloud Run — which is what Firebase App Hosting deploys onto?
 *
 * `K_SERVICE` is part of the Cloud Run container runtime contract: the platform sets
 * it on every instance, and nothing else does. That makes it the right gate, and the
 * gate is the entire safety of this branch.
 *
 * Without a gate, "no credential and no emulator" would quietly become "try ADC" on a
 * developer's laptop too — where ADC either does not exist (the boot succeeds and every
 * request fails later, which is precisely the failure this guard was written to move
 * forward in time) or exists and points at whatever project that person last used with
 * `gcloud auth`, which is worse than either. Inside Cloud Run neither is possible: the
 * attached credential is the one the deployment was configured with.
 *
 * Deliberately NOT probed: NODE_ENV, GCLOUD_PROJECT, GOOGLE_APPLICATION_CREDENTIALS.
 * The first is set by `next start` on a laptop, the second by the Firebase CLI, and
 * the third is set by our own rules-deploy workflow. None of them means "a credential
 * is attached to this process by the platform"; only K_SERVICE does.
 */
function onCloudRun(env: CredentialEnv): boolean {
  return Boolean(env.K_SERVICE);
}
