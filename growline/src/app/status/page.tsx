import type { Metadata } from "next";
import { auth } from "@/lib/firebase-admin";
import { users } from "@/lib/collections";
import { followupCounts } from "@/lib/followup-queries";
import { getLogState } from "@/lib/daily-log-queries";
import { getMyTarget, pendingProofCount, proofsAwaitingReview } from "@/lib/targets-queries";
import { currentMonth } from "@/lib/targets";
import { shouldNudgeGoalSheet } from "@/modules/goals/nudge";
import { getWeeklyRecap } from "@/lib/weekly-recap";

/**
 * The deployment's own health readout (D83).
 *
 * ## Why this page exists
 *
 * The home screen fires seven Firestore queries in parallel, and in production a
 * failure in ANY of them is a bare 500 with a digest number — the real exception
 * lives in Cloud Run's logs, behind a console the person running the pilot should
 * not need to learn under pressure. This page runs THE SAME queries, one at a
 * time, against an id that matches no document, and prints each verdict in plain
 * text in the browser. The person who can reproduce the outage is thereby the
 * person holding the diagnosis, with no log access required.
 *
 * The probes use the very functions the home screen calls — not copies of their
 * queries — so this page cannot drift into testing something the app no longer
 * does. An id that matches nothing exercises the query PLAN (which is what index
 * and permission failures attach to) while touching no real row.
 *
 * ## What it deliberately reveals, and what it never can
 *
 * Failure messages are printed verbatim because they are the diagnosis — a
 * Firestore FAILED_PRECONDITION message carries the exact create-this-index link.
 * Those messages name collections, field paths and the project id: all of it
 * already public in this repository and in the client bundle. No probe can return
 * user data — the diagnostic id matches no document, probes return counts and
 * booleans, and nothing here accepts input. Public and unauthenticated on
 * purpose, for the same D68 reason as /privacy: it must work precisely when
 * nobody can log in.
 */

export const metadata: Metadata = {
  title: "Status — Growline",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Matches no document anywhere; Firestore still validates the full query plan.
 *
 * NOT wrapped in underscores: ids matching `__.*__` are reserved by Firestore
 * itself — production rejects them with INVALID_ARGUMENT, and the emulator
 * (found the hard way, at 6+ seconds per read) simply never answers. A probe id
 * must be boring: legal characters, guaranteed absent, nothing clever.
 */
const DIAG_ID = "zz-diagnostic-probe-matches-nothing";

type Verdict = { name: string; ok: boolean; note: string };

/**
 * Every probe is bounded. A wedged backend (a firewall eating packets, a gRPC
 * channel that retries forever) must read as a FAIL with a duration on it — a
 * status page that hangs in sympathy with the outage it was built to explain is
 * worth less than no page. Verified against a network that black-holes Firestore:
 * without the bound this page never responded at all.
 */
const PROBE_TIMEOUT_MS = 8_000;

async function probe(name: string, run: () => Promise<string>): Promise<Verdict> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer after ${PROBE_TIMEOUT_MS / 1000}s — the service is unreachable or hanging`)),
      PROBE_TIMEOUT_MS
    );
  });
  try {
    return { name, ok: true, note: await Promise.race([run(), timeout]) };
  } catch (e) {
    return { name, ok: false, note: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export default async function StatusPage() {
  // Concurrent, and safely so: probe() never rejects — every outcome, including
  // the timeout, becomes a Verdict. The page is bounded by the slowest probe
  // (at most PROBE_TIMEOUT_MS), not the sum of nine.
  const results = await Promise.all([
    probe("Database reachable (basic read)", async () => {
      const snap = await users().limit(1).get();
      return `read ok — ${snap.size} row(s) visible to the server`;
    }),
    probe("Auth admin reachable", async () => {
      try {
        await auth.getUser(DIAG_ID);
        return "unexpected: diagnostic id exists";
      } catch (e) {
        const code = (e as { code?: string })?.code ?? "";
        if (code === "auth/user-not-found") return "auth responds correctly";
        throw e;
      }
    }),
    probe("Follow-up queue query (home screen)", async () => {
      const c = await followupCounts(DIAG_ID);
      return `query accepted — due ${c.due}`;
    }),
    probe("Daily log / streak query (home screen)", async () => {
      const s = await getLogState(DIAG_ID);
      return `query accepted — streak ${s.streak}`;
    }),
    probe("Monthly target query (home screen)", async () => {
      await getMyTarget(DIAG_ID, currentMonth());
      return "query accepted";
    }),
    probe("Proofs-to-answer query (home screen)", async () => {
      return `query accepted — ${await pendingProofCount(DIAG_ID)} pending`;
    }),
    probe("Proofs-to-review query (home screen)", async () => {
      return `query accepted — ${await proofsAwaitingReview(DIAG_ID)} awaiting`;
    }),
    probe("Goal-sheet nudge query (home screen)", async () => {
      await shouldNudgeGoalSheet(DIAG_ID);
      return "query accepted";
    }),
    probe("Weekly recap query (home screen)", async () => {
      await getWeeklyRecap(DIAG_ID, 0);
      return "query accepted";
    }),
  ]);

  const failures = results.filter((r) => !r.ok).length;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-5 py-10">
      <header>
        <h1 className="text-2xl font-bold">
          Grow<span className="text-gold-ink">line</span> status
        </h1>
        <p className="mt-1 text-sm text-text-dim">
          {failures === 0
            ? "Every check the home screen depends on passed."
            : `${failures} of ${results.length} checks failed — the failure text below is the diagnosis.`}
        </p>
        {/* Which build is actually serving. A failed rollout does not take the site
            down — the previous good build keeps answering — so this line is the
            only thing on the page that can tell a successful deploy from one that
            silently rolled back. Inlined at build time; see next.config.ts. */}
        <p className="mt-3 font-mono text-xs text-text-dim" data-testid="build-stamp">
          build{" "}
          <span className="font-semibold text-text" data-testid="build-sha">
            {process.env.BUILD_SHA ?? "unknown"}
          </span>{" "}
          · {process.env.BUILT_AT ?? "unknown"}
        </p>
      </header>

      <ul className="flex flex-col gap-3">
        {results.map((r) => (
          <li key={r.name} className="rounded-xl bg-surface p-4">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${r.ok ? "bg-gem-green" : "bg-heat"}`}
              />
              <span className="font-medium">{r.name}</span>
              <span className={`ml-auto text-xs font-semibold ${r.ok ? "text-gem-green" : "text-heat"}`}>
                {r.ok ? "PASS" : "FAIL"}
              </span>
            </div>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-text-dim">
              {r.note}
            </pre>
          </li>
        ))}
      </ul>

      <p className="text-xs text-text-dim">
        These are the same queries the app itself runs, against an id that matches no
        document. Nothing on this page reads or shows anyone&apos;s data.
      </p>
    </main>
  );
}
