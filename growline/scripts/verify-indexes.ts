import "dotenv/config";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../src/lib/firebase-admin";
import {
  dailyLogs,
  prospects,
  proofs,
  reports,
  targets,
  threads,
  users,
} from "../src/lib/collections";
import { qualificationProgress } from "../src/modules/qualifications/docs";
import { VOICE_LOGS } from "../src/modules/voice-log/model";

// voice-log keeps its collection handle module-private, so reach it by name rather than
// widening that file's exports for a script.
const voiceLogs = () => db.collection(VOICE_LOGS);

/**
 * Runs every compound query the app makes, and reports the ones Firestore refuses.
 *
 * ## Why this exists
 *
 * A Firestore query needing a composite index that does not exist throws
 * FAILED_PRECONDITION at runtime. Not at deploy, not at build — the first time a real
 * user opens the screen. And the emulator CREATES missing indexes silently on demand, so
 * every test we have passes against an instance that is more permissive than production.
 * CI is structurally incapable of catching this class, which makes it the single most
 * likely thing to break on launch day.
 *
 * The only honest check is to execute the real query shapes against the real thing. That
 * is what this does.
 *
 *     npm run verify:indexes          # against whatever .env points at
 *
 * Against the emulator it will pass trivially — that is expected and is not a result.
 * **Point it at the production project before launch**, with the emulator host variables
 * UNSET and a service account that can read. It reads at most a handful of documents per
 * query and writes nothing.
 *
 * ## What a failure gives you
 *
 * Firestore's error carries a console URL that creates the exact missing index. Add the
 * index to `firestore.indexes.json` as well — the URL fixes production, the file is what
 * stops the next environment starting broken.
 *
 * ## What this cannot tell you
 *
 * Only that the index EXISTS. Not that it is fast, and not that it is cheap. A query that
 * returns in 40ms against 30 seeded documents can still be the wrong shape at 30,000.
 */

const IST = "Asia/Kolkata";
const NOW = new Date();
const DAY_KEY = NOW.toISOString().slice(0, 10);
const MONTH = DAY_KEY.slice(0, 7);
const SOME_ID = "index-probe-nonexistent-id";
const SOME_TS = Timestamp.fromDate(new Date(NOW.getTime() - 30 * 86_400_000));

/**
 * Every compound query in `src/` and `functions/`, named by where it runs.
 *
 * A query is listed when Firestore may need a composite index for it: an equality plus a
 * range or orderBy on a DIFFERENT field, an array-contains plus anything, or an `in` plus
 * an orderBy. Equality-only queries and single-field ranges are served by the automatic
 * single-field indexes and are deliberately absent — listing them would pad the count
 * without checking anything.
 *
 * The filter VALUES are deliberate nonsense. Firestore validates the index before it
 * looks for data, so a query matching nothing still proves the index exists — and probing
 * with ids that cannot exist means this is safe to run against production data.
 */
const QUERIES: { where: string; what: string; run: () => Promise<unknown> }[] = [
  {
    where: "home · prospects list",
    what: "prospects: coachId == , orderBy createdAt desc",
    run: () => prospects().where("coachId", "==", SOME_ID).orderBy("createdAt", "desc").limit(1).get(),
  },
  {
    where: "home · follow-up counts (F5)",
    what: "prospects: coachId == , nextFollowupAt range",
    run: () =>
      prospects()
        .where("coachId", "==", SOME_ID)
        .where("nextFollowupAt", ">=", SOME_TS)
        .where("nextFollowupAt", "<", Timestamp.now())
        .limit(1)
        .get(),
  },
  {
    where: "public QR capture · flood guard",
    what: "prospects: coachId == , source == , createdAt >=",
    run: () =>
      prospects()
        .where("coachId", "==", SOME_ID)
        .where("source", "==", "qr")
        .where("createdAt", ">=", SOME_TS)
        .limit(1)
        .get(),
  },
  {
    where: "weekly recap",
    what: "prospects: coachId == , createdAt >= (ASCENDING — the declared index is DESC)",
    run: () =>
      prospects().where("coachId", "==", SOME_ID).where("createdAt", ">=", SOME_TS).limit(1).get(),
  },
  {
    where: "retention purge (Cloud Function)",
    what: "prospects: lastActivityAt < , heightCm != null",
    run: () =>
      prospects()
        .where("lastActivityAt", "<", SOME_TS)
        .where("heightCm", "!=", null)
        .limit(1)
        .get(),
  },
  {
    where: "daily log · streak window",
    what: "dailyLogs: userId == , dayKey >= , orderBy dayKey DESC (declared index is ASC)",
    run: () =>
      dailyLogs()
        .where("userId", "==", SOME_ID)
        .where("dayKey", ">=", "2000-01-01")
        .orderBy("dayKey", "desc")
        .limit(1)
        .get(),
  },
  {
    where: "admin · coach detail",
    what: "dailyLogs: userId == , orderBy dayKey DESC",
    run: () => dailyLogs().where("userId", "==", SOME_ID).orderBy("dayKey", "desc").limit(1).get(),
  },
  {
    where: "team roll-up · whole line",
    what: "dailyLogs: uplinePath array-contains , dayKey >=",
    run: () =>
      dailyLogs()
        .where("uplinePath", "array-contains", SOME_ID)
        .where("dayKey", ">=", "2000-01-01")
        .limit(1)
        .get(),
  },
  {
    where: "team roll-up · line targets",
    what: "targets: uplinePath array-contains , month ==",
    run: () =>
      targets()
        .where("uplinePath", "array-contains", SOME_ID)
        .where("month", "==", MONTH)
        .limit(1)
        .get(),
  },
  {
    where: "team tree · one level down",
    what: "users: uplineId in [..] , orderBy createdAt asc",
    run: () =>
      users().where("uplineId", "in", [SOME_ID]).orderBy("createdAt", "asc").limit(1).get(),
  },
  {
    where: "threads · sent list",
    what: "threads: senderId == , orderBy createdAt desc",
    run: () => threads().where("senderId", "==", SOME_ID).orderBy("createdAt", "desc").limit(1).get(),
  },
  {
    where: "threads · inbox from my uplines",
    what: "threads: senderId in [..] , orderBy createdAt desc",
    run: () =>
      threads().where("senderId", "in", [SOME_ID]).orderBy("createdAt", "desc").limit(1).get(),
  },
  {
    where: "threads · platform announcements",
    what: "threads: scope == , orderBy createdAt desc",
    run: () => threads().where("scope", "==", "platform").orderBy("createdAt", "desc").limit(1).get(),
  },
  {
    where: "qualifications · progress rows",
    what: "qualificationProgress: qualificationId == , kind ==",
    run: () =>
      qualificationProgress()
        .where("qualificationId", "==", SOME_ID)
        .where("kind", "==", "progress")
        .limit(1)
        .get(),
  },
  {
    where: "voice log · purge sweep",
    what: "voiceLogs: status == , dayKey <",
    run: () =>
      voiceLogs().where("status", "==", "uncounted").where("dayKey", "<", DAY_KEY).limit(1).get(),
  },
  {
    where: "targets · proofs awaiting me",
    what: "proofs: requestedById == , status ==",
    run: () =>
      proofs()
        .where("requestedById", "==", SOME_ID)
        .where("status", "==", "submitted")
        .limit(1)
        .get(),
  },
  {
    where: "targets · my pending proofs",
    what: "proofs: coachId == , status in [..]",
    run: () =>
      proofs()
        .where("coachId", "==", SOME_ID)
        .where("status", "in", ["pending", "rejected"])
        .limit(1)
        .get(),
  },
  {
    where: "goal sheet · recent activity (A3)",
    what: "dailyLogs: userId == , dayKey >=",
    run: () =>
      dailyLogs().where("userId", "==", SOME_ID).where("dayKey", ">=", "2000-01-01").limit(1).get(),
  },
  {
    where: "goal sheet · first-prospect nudge (A1)",
    what: "prospects: coachId == , limit 1",
    run: () => prospects().where("coachId", "==", SOME_ID).limit(1).select().get(),
  },
  {
    where: "recognition wall (Feature B)",
    what: "recognitions: workspaceId == , earnedAt >= , orderBy earnedAt desc",
    run: () =>
      db
        .collection("recognitions")
        .where("workspaceId", "==", SOME_ID)
        .where("earnedAt", ">=", SOME_TS)
        .orderBy("earnedAt", "desc")
        .limit(1)
        .get(),
  },
  {
    where: "report erasure",
    what: "reports: prospectId ==",
    run: () => reports().where("prospectId", "==", SOME_ID).limit(1).get(),
  },
];

async function main() {
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  console.log(
    `\nChecking ${QUERIES.length} compound queries against ${
      emulator
        ? `the EMULATOR (${process.env.FIRESTORE_EMULATOR_HOST}) — it creates missing indexes on demand, so a pass here proves nothing about production`
        : `project "${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "(unset)"}"`
    }\n`
  );

  const missing: { where: string; what: string; error: string }[] = [];

  for (const q of QUERIES) {
    try {
      await q.run();
      console.log(`  ok    ${q.where} — ${q.what}`);
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      // FAILED_PRECONDITION is the missing-index signal. Anything else — permissions, a
      // bad credential, no network — is a broken run rather than a missing index, and
      // saying so keeps somebody from "fixing" an index that was never the problem.
      const isIndex = /FAILED_PRECONDITION|requires an index/i.test(message);
      console.log(`  ${isIndex ? "MISSING" : "ERROR  "} ${q.where} — ${q.what}`);
      console.log(`          ${message.split("\n")[0]}`);
      missing.push({ where: q.where, what: q.what, error: message });
    }
  }

  if (missing.length === 0) {
    console.log(
      `\nAll ${QUERIES.length} compound queries are served.${
        emulator ? " (Emulator — run this against production before launch.)" : ""
      }\n`
    );
    process.exit(0);
  }

  console.log(`\n${missing.length} of ${QUERIES.length} queries FAILED:\n`);
  for (const m of missing) {
    console.log(`  ${m.where}\n    ${m.what}`);
    // Firestore puts a create-this-index console URL in the message. Surfacing it is the
    // whole point — it turns a launch-day outage into a two-minute fix.
    const url = m.error.match(/https:\/\/console\.firebase\.google\.com\/\S+/);
    if (url) console.log(`    fix: ${url[0]}`);
    console.log("");
  }
  console.log("Add each one to firestore.indexes.json too — the console URL fixes this");
  console.log("project, the file is what stops the next environment starting broken.\n");
  process.exit(1);
}

main().catch((e) => {
  console.error(`\nverify-indexes crashed: ${(e as Error).message}\n`);
  process.exit(1);
});
