import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

/**
 * Load `.env` into the TEST process, the same file `next start` loads into the server.
 *
 * Without this the two disagree about the world. `e2e/demo-gate.spec.ts` asserts that
 * `/demo` is reachable exactly when `DEMO_MODE` is set — and it read the flag from the
 * test runner's environment while the server read it from `.env`, so with the demo
 * enabled locally the test asserted "must be 404" against a server correctly answering
 * 200. The test was wrong, not the gate.
 *
 * `override: false` is the default and is what we want: a variable already set in the
 * shell or by CI wins, so CI (which has no `.env`) is unaffected.
 */
loadEnv();

/**
 * Which browser to drive, resolved per machine rather than hardcoded.
 *
 * The cloud container ships a Chromium at a fixed path and no matching Playwright
 * download, so the config pointed straight at it. That path does not exist on a
 * Windows PC, and the suite could not run there at all — which defeats the point of
 * "phone decides, PC verifies", since e2e is PC work by definition.
 *
 * Order: an explicit override, then the container's binary, then the locally
 * installed Chrome. Never a download.
 */
const CONTAINER_CHROMIUM = "/opt/pw-browsers/chromium";
const explicitPath = process.env.PW_CHROMIUM_PATH;
const resolvedPath =
  explicitPath && existsSync(explicitPath)
    ? explicitPath
    : existsSync(CONTAINER_CHROMIUM)
      ? CONTAINER_CHROMIUM
      : undefined;
const browserBinding = resolvedPath
  ? { launchOptions: { executablePath: resolvedPath } }
  : // Uses the Chrome already installed on the machine, so no revision has to
    // match and nothing is fetched.
    { channel: "chrome" as const };

/**
 * e2e against the Firebase emulators — no real project, no SMS, no reCAPTCHA.
 *
 * The emulator exposes the verification codes it "sent" over a REST endpoint, so
 * the whole phone-auth flow is drivable in CI. That is what makes the v2 §5.7
 * happy-path test possible without a phone in someone's hand.
 *
 * Assumes the emulators are already running (`npm run emulators`) and the data has
 * been migrated (`npm run migrate:firestore`). Deliberately not started here: the
 * emulator holds state in memory, and a test run that silently wipes it would make
 * every other script's results depend on test ordering.
 */
export default defineConfig({
  testDir: "./e2e",
  /**
   * Only `*.spec.ts`. Without this, Playwright's default pattern also matches `*.test.ts`,
   * and `e2e/` holds five Security-Rules suites that are plain `tsx` scripts: they run
   * `main()` at module scope and finish with `process.exit()`.
   *
   * Playwright EXECUTES a file to discover its tests, so those scripts ran during every
   * e2e run and whichever `process.exit(0)` landed first killed the process mid-suite —
   * no summary, a fraction of the tests executed, and **exit code 0**. A green e2e was
   * partly luck about which async script finished first, and it was masking a real
   * failure: the run that first completed properly reported one immediately.
   *
   * The rules suites are still run, deliberately and on purpose, by their own npm scripts
   * (`test:rules`, `test:rules:boards`, …). They are not Playwright tests and should never
   * have been collected as them.
   */
  testMatch: "**/*.spec.ts",
  /**
   * Start the production server if one is not already up.
   *
   * Without this, `npm run e2e` on a machine with no server running fails all 43 tests
   * with ECONNREFUSED — 43 red lines that look exactly like the app being broken and are
   * actually nothing but a missing process. That is not a hypothetical: it happened twice
   * in one session here, and the second time it was briefly read as a real regression.
   *
   * `next start`, not `next dev`, because the production bundle is what ships and is what
   * `.github/scripts/ci-integration.sh` has always used.
   *
   * `reuseExistingServer` is unconditional rather than `!process.env.CI`. CI starts its
   * own server inside the emulator lifetime and traps the kill, and Playwright must attach
   * to that one rather than race a second process for port 3000 — the usual `!CI` idiom is
   * written for suites where Playwright owns the server, and here it does not.
   */
  // Refuses to start if .next was built with different NEXT_PUBLIC_* values than this
  // run has — see the file for the 43-failure cascade that motivated it.
  globalSetup: "./e2e/global-setup.ts",

  webServer: {
    command: "npx next start",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  fullyParallel: false, // one Firestore, shared state
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    // A ₹10K Android is the target device (v1 §4.4), so the viewport is a small
    // phone rather than a desktop window.
    ...devices["Pixel 5"],
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Pixel 5"],
        // See browserBinding above: the container's Chromium where it exists, the
        // machine's installed Chrome otherwise. Never `playwright install`.
        ...browserBinding,
      },
    },
  ],
});
