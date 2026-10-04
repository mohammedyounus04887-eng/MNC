import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Refuse to run the suite against a build that does not match this environment.
 *
 * ## The failure this exists to prevent
 *
 * `playwright.config.ts` starts the app with `npx next start`, which serves whatever
 * happens to be sitting in `.next`. It does not build. So the suite silently tests the
 * last build somebody made, whatever environment that build was made in.
 *
 * Next inlines every `NEXT_PUBLIC_*` value into the CLIENT BUNDLE at build time. A build
 * made with a different — or empty — set of those values produces a browser that talks to
 * a different Firebase project, or to none. Nothing errors. Phone sign-in simply never
 * starts, so every test that signs a coach in fails on a missing OTP field.
 *
 * That is 43 of 66 tests failing, in specs spread across the whole app, none of which has
 * anything to do with the change under test. It reads as a catastrophic regression. It is
 * a stale build. It cost an hour to find once, having been produced by a deliberate
 * blank-environment build run minutes earlier to verify a deploy config.
 *
 * ## What is checked
 *
 * Only that the values THIS process has are the values baked into the bundle it is about
 * to drive. Variables that are unset here are not checked — CI sets a different subset
 * than a laptop's `.env`, and a check that invented requirements would be its own trap.
 *
 * The emulator hosts matter most: with those missing the browser reaches for the real
 * project with a real credential, which is both a broken test run and the one shape of
 * mistake that could write test data somewhere it must never go.
 */

/** Inlined into the client bundle, and load-bearing for the browser half of every test. */
const MUST_MATCH = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST",
  "NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST",
] as const;

function clientBundleText(): string | null {
  const dir = join(process.cwd(), ".next", "static", "chunks");
  if (!existsSync(dir)) return null;

  let text = "";
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".js")) text += readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return text;
}

export default function globalSetup(): void {
  const bundle = clientBundleText();

  if (bundle === null) {
    throw new Error(
      "No client bundle found at .next/static/chunks.\n\n" +
        "The suite serves the app with `next start`, which does not build. Run:\n" +
        "    npm run build\n"
    );
  }

  const missing = MUST_MATCH.filter((key) => {
    const value = process.env[key];
    if (!value) return false; // not set here, so nothing to disagree about
    return !bundle.includes(value);
  });

  if (missing.length === 0) return;

  throw new Error(
    "The build in .next was made with different environment values than this test run has.\n\n" +
      "Not baked into the client bundle:\n" +
      missing.map((k) => `    ${k}=${process.env[k]}`).join("\n") +
      "\n\n" +
      "Next inlines NEXT_PUBLIC_* at BUILD time, and `next start` only serves what was\n" +
      "already built. The browser would talk to the wrong Firebase project — or to none —\n" +
      "and every test that signs a coach in would fail on a missing OTP field, which looks\n" +
      "like a catastrophic regression rather than a stale build.\n\n" +
      "Fix:\n" +
      "    npm run build\n"
  );
}
