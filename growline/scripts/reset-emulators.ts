/**
 * Resets the Firestore and Auth emulators to empty.
 *
 * ## Why this exists
 *
 * The e2e suite is not idempotent, and it cannot be: `signup.spec` creates a coach,
 * `offline-capture.spec` and the QR spec each create a prospect. Run it twice against
 * the same emulator and the second run sees a database that no longer matches the
 * seed — team counts drift, `migrate:verify` reports MISMATCH, and assertions on
 * "how many people are in my line" fail for reasons that have nothing to do with the
 * code under test.
 *
 * That cost a full debugging cycle once already: a green 18/18 suite went to 6 failed
 * with no code change, purely because the emulator had accumulated two signup users
 * and four extra prospects. The failure looked exactly like a regression.
 *
 * So: reset, then re-migrate, before every e2e run. `npm run e2e:reset` does both.
 *
 * Auth matters as much as Firestore. Signup creates a Firebase Auth account, and
 * Auth's Phone provider allows one account per number — the invariant that lets the
 * user document be keyed by uid (D34). Leaving accounts behind means the next run's
 * signup either collides or silently signs in as the previous run's user.
 */

// This file imports nothing. Without an export TypeScript treats it as a global
// script, so `PROJECT` and `main` land in the same scope as every other global file
// in the program — and it duly started colliding the moment a second script in this
// folder used those names. One empty export makes it a module and closes the class.
export {};

const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "growline-dev";

async function wipe(label: string, url: string) {
  let res: Response;
  try {
    res = await fetch(url, { method: "DELETE" });
  } catch (e) {
    // A connection refused here is the common mistake, not an exotic failure:
    // the emulators simply are not running. Say so instead of a stack trace.
    throw new Error(
      `Could not reach the ${label} emulator at ${url}.\n` +
        `Start it first:  npm run emulators\n` +
        `Underlying error: ${(e as Error).message}`
    );
  }
  if (!res.ok) {
    throw new Error(`${label} reset failed: HTTP ${res.status} ${await res.text()}`);
  }
  console.log(`  cleared  ${label}`);
}

async function main() {
  console.log(`\nResetting emulators for project "${PROJECT}"`);

  // Firestore's reset endpoint bypasses Security Rules — it is an emulator-only
  // control plane, which is why this script can never touch production.
  await wipe(
    "firestore",
    `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`
  );
  await wipe("auth", `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`);

  console.log("\nEmulators are empty. Run `npm run migrate:firestore` to reseed.\n");
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}\n`);
  process.exit(1);
});
