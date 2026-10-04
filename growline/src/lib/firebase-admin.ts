import {
  getApps,
  initializeApp,
  cert,
  applicationDefault,
  type App,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { resolveTarget } from "./firebase-target";

/**
 * Server-side Firebase. This is the only place credentials are read.
 *
 * All data access stays server-side — API routes and server components — exactly
 * as it did under Prisma (DECISIONS.md D1: "no client-side DB calls, so the swap
 * is contained to the server layer"). The Admin SDK bypasses Security Rules, which
 * is why `firestore.rules` denies everything until v2.1b gives the browser a
 * reason to read directly.
 */

// Module scope on purpose. `createApp()` below runs only when no app exists yet, so
// a guard living inside it could be skipped by initialization order; this one runs
// for anyone who imports `db` or `auth`, which is every server path.
const target = resolveTarget(process.env);

export const usingEmulators = target.usingEmulators;

function projectId(): string {
  const id =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT;
  if (!id) throw new Error("NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set");
  return id;
}

function createApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  // Against the emulators the SDK needs no credentials at all — it routes to
  // FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST, and `resolveTarget` has
  // established that BOTH are set. Passing a fake service account here would mask a
  // missing one in production.
  if (target.usingEmulators) return initializeApp({ projectId: projectId() });

  // ADC. `applicationDefault()` rather than omitting `credential` entirely: the SDK
  // would resolve to the same place, but silence here reads as an oversight, and the
  // difference between "no credential configured" and "the platform's credential,
  // deliberately" is the whole point of the branch above.
  if (target.serviceAccount === null) {
    return initializeApp({ credential: applicationDefault(), projectId: projectId() });
  }

  // No credential check here any more: the union `resolveTarget` returns carries the
  // service account only on this branch, so "real project, no credential" is not a
  // state this function can be reached in.
  return initializeApp({
    credential: cert(JSON.parse(target.serviceAccount)),
    projectId: projectId(),
  });
}

const globalForFirebase = globalThis as unknown as {
  firebaseApp?: App;
  firestore?: Firestore;
};

export const app = globalForFirebase.firebaseApp ?? createApp();
globalForFirebase.firebaseApp = app;

function createFirestore(): Firestore {
  const store = getFirestore(app);
  // `settings()` may be called ONCE per Firestore instance, ever — a second call
  // throws "Firestore has already been initialized".
  //
  // Next evaluates this module more than once while collecting page data, and
  // both the firebase-admin app and its Firestore are process-wide singletons, so
  // the second evaluation gets the same object back. Hence the cache is
  // unconditional: gating it on NODE_ENV !== "production" (the shape D1 used for
  // Prisma, where the concern was HMR duplicating clients) breaks `next build`.
  if (!globalForFirebase.firestore) {
    // `undefined` is how an optional column arrives from a form. Without this the
    // SDK throws on every optional prospect field (age, gender, height, weight)
    // rather than simply omitting them.
    store.settings({ ignoreUndefinedProperties: true });
    globalForFirebase.firestore = store;
  }
  return store;
}

export const db = globalForFirebase.firestore ?? createFirestore();
export const auth = getAuth(app);
