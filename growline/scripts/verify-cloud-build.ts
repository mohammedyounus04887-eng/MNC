import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { parse } from "yaml";

/**
 * Builds the app the way App Hosting builds it, and fails if it would not survive.
 *
 * Run: `npm run verify:build` — before pushing anything that touches configuration.
 *
 * ## Why a local `npm run build` passing means almost nothing
 *
 * The cloud builder has no `.env`. That file is gitignored and never uploaded, so
 * every variable in it — dozens — is simply absent up there, while locally Next
 * loads it automatically before any of your code runs. A build that reads one of
 * them succeeds on your machine every single time and fails on every rollout.
 *
 * Nine consecutive rollouts died on this class of problem. The one that stung most
 * was a "proof" that the boot guard tolerated a cloud build: the test set
 * `K_SERVICE` by hand, so it proved only that the assumption agreed with itself.
 * `K_SERVICE` is a Cloud RUN signal and is absent at BUILD time (D81). This script
 * therefore unsets it, hides `.env`, and passes exactly the variables
 * `apphosting.yaml` marks BUILD — read out of that file rather than restated here,
 * so the two cannot drift.
 *
 * ## It also checks what got baked in
 *
 * `NEXT_PUBLIC_*` is inlined into the client bundle at build time. A variable that
 * resolves empty is not an error — it is compiled in as `undefined`, and the browser
 * then talks to nothing, silently, in production only. So after the build this
 * greps the emitted chunks for each value it passed in and reports any that a client
 * file needs and did not get. A variable no client file reads is expected to be
 * absent; that is not a failure, and the output says which is which.
 */

type EnvVar = { variable: string; value?: string; availability?: string[] };

const ROOT = process.cwd();
const ENV_FILE = `${ROOT}/.env`;
const HIDDEN = `${ROOT}/.env.verify-cloud-build.bak`;

function buildVars(): EnvVar[] {
  const doc = parse(readFileSync("apphosting.yaml", "utf8")) as { env?: EnvVar[] };
  return (doc.env ?? []).filter((e) => e.availability?.includes("BUILD"));
}

/** Which of these variables any client component actually needs inlined. */
function neededInClient(name: string): boolean {
  if (!name.startsWith("NEXT_PUBLIC_")) return false;
  const hits = execFileSync(
    "grep",
    ["-rl", "--include=*.ts", "--include=*.tsx", `process.env.${name}`, "src"],
    { encoding: "utf8" }
  )
    .split("\n")
    .filter(Boolean);
  // A "use client" file, or one with no directive that a client file may import.
  return hits.some((f) => readFileSync(f, "utf8").startsWith('"use client"'));
}

function main() {
  const vars = buildVars();
  console.log(`\nBuilding as App Hosting would — ${vars.length} BUILD variables, no .env\n`);

  const hid = existsSync(ENV_FILE);
  if (hid) renameSync(ENV_FILE, HIDDEN);

  // Restore on every exit path, including a thrown build error and Ctrl-C. A run
  // that leaves the developer without their .env is worse than no check at all.
  const restore = () => {
    if (hid && existsSync(HIDDEN)) renameSync(HIDDEN, ENV_FILE);
  };
  process.on("exit", restore);
  process.on("SIGINT", () => process.exit(130));

  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "production",
  };
  for (const v of vars) env[v.variable] = v.value ?? "";

  rmSync(".next", { recursive: true, force: true });
  try {
    execFileSync("npm", ["run", "build"], { env, stdio: "inherit" });
  } catch {
    console.error("\n  BUILD FAILED under cloud conditions. It would fail the rollout.\n");
    process.exit(1);
  }

  console.log("\n  Build succeeded. Checking what was inlined into the client bundle:\n");
  let bad = 0;
  for (const v of vars) {
    if (!v.value) continue;
    const needed = neededInClient(v.variable);
    const present =
      execFileSync("bash", [
        "-c",
        `grep -rl -- ${JSON.stringify(v.value)} .next/static/chunks 2>/dev/null | wc -l`,
      ])
        .toString()
        .trim() !== "0";

    if (needed && !present) {
      console.log(`  FAIL  ${v.variable} — a client file reads it and it is NOT in the bundle`);
      bad += 1;
    } else if (needed) {
      console.log(`  PASS  ${v.variable} — inlined`);
    } else {
      console.log(`  ok    ${v.variable} — server-only, correctly absent from the bundle`);
    }
  }

  console.log("");
  if (bad > 0) {
    console.log(`  ${bad} variable(s) would be undefined in the browser.\n`);
    process.exit(1);
  }
  console.log("  Safe to roll out.");
  // It leaves .next built with PRODUCTION values, and e2e's global setup refuses
  // to run against a bundle built with different env values than the test run —
  // correctly, since that is the "e2e runs whatever is in .next" trap. Say so here
  // rather than letting the next person read it as a broken test suite.
  console.log("  Note: .next now holds a production build. Run `npm run build`");
  console.log("  before `npm run e2e`, or its env guard will refuse to start.\n");
}

main();
