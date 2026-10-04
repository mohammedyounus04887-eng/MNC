import type { FirebaseApp } from "firebase/app";

/**
 * Firebase App Check (client half).
 *
 * ## What this is defending against, precisely
 *
 * Not data theft — `firestore.rules` already handles that. This defends the *bill*. The
 * repository is public and the Firebase web config ships in every browser bundle by
 * design, so the project id is knowable by anyone. With Phone auth enabled, that is
 * enough to drive OTP sends at the project, and SMS to Indian numbers is billed per
 * message. App Check makes the backend refuse requests that did not come from this app.
 *
 * ## The order matters, and getting it wrong is an outage
 *
 * App Check has two halves and this is only the first. Turning ENFORCEMENT on in the
 * Firebase console while no client is attesting means every Auth and Firestore request
 * is rejected — the app goes down for everybody, immediately. So this ships first, inert,
 * and the console flip happens afterwards once the App Check metrics page shows real
 * traffic attesting. `HANDOFF.md` carries the ordered runbook.
 *
 * ## Fails open, in all four directions
 *
 * 1. **Unconfigured** — no site key, nothing happens. This is the state the repository is
 *    in today and on CI, so shipping this changes nothing until somebody sets the key.
 * 2. **Emulators** — a real reCAPTCHA key cannot attest `127.0.0.1`, so App Check is
 *    skipped whenever an emulator host is set. Without this the 64-test e2e suite would
 *    start failing at login the day a key is added to a developer's `.env`.
 * 3. **Misconfigured provider** — an unrecognised provider value skips and names the
 *    variable, rather than guessing. Guessing produces an attestation failure that
 *    identifies neither the console setting nor the environment variable.
 * 4. **Throws** — a bad key or a blocked network must not take the login screen down with
 *    it. The error is logged and the app carries on. Once enforcement is on the requests
 *    will fail anyway, but they fail with a Firebase error a support person can read
 *    rather than a white screen.
 *
 * The planning is split from the doing so the guard — the part that must never
 * regress — is a pure function with a unit test, rather than four conditions tangled
 * into an initialiser that can only be exercised with a browser.
 */

/** Which reCAPTCHA the console was set up with. Mismatching this silently breaks attestation. */
export type AppCheckProviderKind = "enterprise" | "v3";

export type AppCheckPlan =
  | { action: "skip"; reason: string; misconfigured?: true }
  | {
      action: "init";
      provider: AppCheckProviderKind;
      siteKey: string;
      /** Set as `self.FIREBASE_APPCHECK_DEBUG_TOKEN` BEFORE init, or it is ignored. */
      debugToken: string | null;
    };

/** Only the variables this decision reads. Passed in so the planner stays pure. */
export type AppCheckEnv = {
  siteKey?: string;
  provider?: string;
  debug?: string;
  authEmulatorHost?: string;
  firestoreEmulatorHost?: string;
};

/**
 * Decides whether App Check should start, and how.
 *
 * `hasWindow` is passed rather than read, because this file is reached during SSR too:
 * a client component still executes on the server for the first render, and
 * `initializeAppCheck` there has no document to attach a reCAPTCHA to.
 */
export function planAppCheck(env: AppCheckEnv, hasWindow: boolean): AppCheckPlan {
  if (!hasWindow) return { action: "skip", reason: "server render" };

  const siteKey = (env.siteKey ?? "").trim();
  if (!siteKey) return { action: "skip", reason: "no site key configured" };

  // An emulator host means local or CI. A production reCAPTCHA key cannot attest
  // 127.0.0.1, so attempting it would break exactly the flows the suite covers.
  if (env.authEmulatorHost || env.firestoreEmulatorHost) {
    return { action: "skip", reason: "emulators in use" };
  }

  /*
   * Enterprise is the default because it is what the cutover runbook registers. An
   * unrecognised value is NOT quietly coerced to it.
   *
   * The first version of this did coerce, which meant a typo in
   * NEXT_PUBLIC_FIREBASE_APPCHECK_PROVIDER — a value inlined at BUILD time, so baked
   * into the bundle and not fixable without a redeploy — would attest against the wrong
   * reCAPTCHA and fail with an error naming neither the console setting nor the
   * variable. That is precisely the failure the escape hatch exists to prevent, so
   * guessing here defeats the point of having it.
   *
   * Skipping instead costs nothing before enforcement is on, because App Check was going
   * to be off anyway. After enforcement both outcomes are an outage — but this one prints
   * the name of the variable that caused it.
   */
  const raw = (env.provider ?? "").trim();
  if (raw !== "" && raw !== "enterprise" && raw !== "v3") {
    return {
      action: "skip",
      misconfigured: true,
      reason: `NEXT_PUBLIC_FIREBASE_APPCHECK_PROVIDER is ${JSON.stringify(raw)}; it must be "enterprise" or "v3"`,
    };
  }
  const provider: AppCheckProviderKind = raw === "v3" ? "v3" : "enterprise";

  const debug = (env.debug ?? "").trim();
  return { action: "init", provider, siteKey, debugToken: debug === "" ? null : debug };
}

/** Reads the plan out of `process.env`. Split out so tests never touch the real env. */
export function appCheckEnv(): AppCheckEnv {
  return {
    siteKey: process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY,
    provider: process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_PROVIDER,
    debug: process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN,
    authEmulatorHost: process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
    firestoreEmulatorHost: process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST,
  };
}

/** `initializeAppCheck` throws if called twice for one app, and callers are lazy. */
let started = false;

/**
 * Starts App Check for `app`, if the plan says to. Idempotent and never throws.
 *
 * Called from `firebaseApp()` — the single point every client consumer of Auth and
 * Firestore already goes through — so attestation is in place before the first request
 * rather than depending on some screen remembering to ask for it.
 *
 * ## Why the SDK is imported dynamically
 *
 * `firebase/app-check` is ~300KB of source, and a static import puts all of it in the
 * shared client chunk that every page loads — for every coach, on every visit, whether
 * or not App Check is configured. Measured: it landed in the 664KB shared bundle while
 * doing nothing at all, because no site key is set. v1 §4.4 is explicit that this app is
 * built for a ₹10K Android on slow data, and paying for an unused dependency on every
 * page load is the exact cost that rule exists to prevent.
 *
 * Behind `await import(...)` the bytes are fetched only when a site key is actually
 * configured, and then once.
 *
 * ## The race this accepts, and why it is safe
 *
 * The import makes startup asynchronous, so there is a window between the Firebase app
 * existing and attestation being ready. Nothing in this app makes a Firebase network
 * call in that window: the first one is the OTP send, which cannot happen until a coach
 * has typed a phone number and pressed a button. That is hundreds of milliseconds at the
 * very least, against a chunk fetch that starts immediately and is cached thereafter.
 *
 * The caller deliberately does not await this. Blocking `firebaseApp()` on a network
 * fetch would put a download in front of the login screen rendering, which is a certain
 * cost paid to avoid a race that user interaction already prevents.
 */
export async function startAppCheck(app: FirebaseApp): Promise<AppCheckPlan> {
  const plan = planAppCheck(appCheckEnv(), typeof window !== "undefined");
  if (plan.action === "skip") {
    // Silence is right for the ordinary skips — unconfigured and emulators are the
    // normal states. A misconfiguration is not, and it is invisible otherwise.
    if (plan.misconfigured) console.warn(`App Check not started: ${plan.reason}`);
    return plan;
  }
  if (started) return plan;

  // Set before the guard flips, so a second synchronous call cannot start a second
  // import while the first is still in flight.
  started = true;

  try {
    if (plan.debugToken) {
      // Must be assigned before initializeAppCheck reads it. Only ever a developer's
      // own token for a real project; never a production value.
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
        plan.debugToken;
    }
    const { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } = await import(
      "firebase/app-check"
    );
    initializeAppCheck(app, {
      provider:
        plan.provider === "v3"
          ? new ReCaptchaV3Provider(plan.siteKey)
          : new ReCaptchaEnterpriseProvider(plan.siteKey),
      // A coach's session outlasts a token. Without refresh their app starts being
      // refused partway through an evening of logging work.
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    // Deliberately swallowed — see the header. A failed attestation must not be a blank
    // login screen. `started` stays true: a key that fails once fails every time, and
    // retrying on every firebaseApp() call would be a fetch loop.
    console.warn("App Check did not start; requests will be unattested.", e);
  }
  return plan;
}
