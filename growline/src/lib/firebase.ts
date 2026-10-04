"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import { startAppCheck } from "./app-check";

/**
 * Browser-side Firebase: Auth, and — since v2.1b — a read-only Firestore.
 *
 * Every **write** still goes through API routes using the Admin SDK (D1, D38), and
 * `firestore.rules` denies client writes everywhere. The client Firestore exists
 * for one thing: listening. v2 §3 asks for QR submissions to appear without a
 * refresh, and a listener is the only way to do that without polling — which v1
 * §4.4 rules out, because background polling burns data on the cheap plans this
 * audience uses (D10).
 *
 * Phone auth MUST happen in the browser: Firebase issues the SMS and solves the
 * reCAPTCHA client-side, then hands back an ID token the server verifies.
 */

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let cachedAuth: Auth | null = null;

export function firebaseApp(): FirebaseApp {
  const app = getApps().length ? getApp() : initializeApp(config);
  /*
   * App Check attaches here rather than in each consumer, because this is the one
   * function `firebaseAuth()` and `firebaseDb()` both go through — so attestation is in
   * place before the first request instead of depending on a screen remembering to ask.
   *
   * It is a no-op today: with no site key configured it skips, and it skips again
   * whenever an emulator host is set. See `app-check.ts` for why it fails open in all
   * three directions, and why enabling enforcement in the console before this ships
   * would be an outage rather than a security improvement.
   */
  // Not awaited: see app-check.ts. Blocking here would put a chunk download in front
  // of the login screen to close a race that user interaction already prevents.
  void startAppCheck(app);
  return app;
}

export function firebaseAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  const auth = getAuth(firebaseApp());

  // Against the emulator there is no real SMS and no reCAPTCHA. Test numbers
  // configured in the Auth emulator return a fixed code, which is what makes the
  // login flow runnable in CI without a phone.
  const emulator = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
  if (emulator) {
    connectAuthEmulator(auth, `http://${emulator}`, { disableWarnings: true });
  }

  // The SMS arrives on the coach's phone; the UI should speak their language
  // where Firebase has it. Falls back to the device locale.
  auth.useDeviceLanguage();
  cachedAuth = auth;
  return auth;
}

export const usingAuthEmulator = Boolean(
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST
);

let cachedDb: Firestore | null = null;

/**
 * Read-only Firestore for listeners.
 *
 * Reads are governed by `firestore.rules`, which for prospects requires the query
 * be filtered to a single `coachId` — so a listener must always constrain by the
 * signed-in coach. That is not a workaround; it is the shape the privacy rule
 * serves, verified in the rules tests.
 */
export function firebaseDb(): Firestore {
  if (cachedDb) return cachedDb;
  const store = getFirestore(firebaseApp());
  const emulator = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST;
  if (emulator) {
    const [host, port] = emulator.split(":");
    connectFirestoreEmulator(store, host, Number(port));
  }
  cachedDb = store;
  return store;
}
