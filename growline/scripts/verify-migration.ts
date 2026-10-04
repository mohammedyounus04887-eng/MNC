/**
 * Asserts the things the migration actually claims — not just that rows arrived.
 *
 *   npx tsx scripts/verify-migration.ts
 *
 * Row counts matching proves very little on their own: a migration can move every
 * row and still put the tree, the day boundaries or the document ids somewhere
 * wrong. These are the claims PLAN_V2.1a.md makes, each one checked.
 */
import "dotenv/config";
import { auth, db } from "../src/lib/firebase-admin";
import { COLLECTIONS, dailyLogDocId, reportDocId } from "../src/lib/collections";
import { APP_TIMEZONE, dayKey, startOfDayInZone } from "../src/lib/day";
import { shiftKey } from "../src/lib/daily-log";
import { buildTeamTree, isInDownline } from "../src/lib/team";
import { followupCounts } from "../src/lib/followup-queries";
import {
  getMyTarget,
  pendingProofCount,
  proofsAwaitingReview,
  setTarget,
  updateProgress,
} from "../src/lib/targets-queries";

/**
 * The same relative anchors the seed uses. Both files describe the SAME fixtures, so
 * both have to derive their dates the same way — this script broke the moment the seed
 * went relative precisely because it was still asserting absolute dates the seed no
 * longer wrote.
 */
const TODAY = dayKey(new Date(), APP_TIMEZONE);
const YESTERDAY = shiftKey(TODAY, -1);
const FIRST_OF_MONTH = `${TODAY.slice(0, 8)}01`;
const LAST_OF_PREV_MONTH = shiftKey(FIRST_OF_MONTH, -1);

const ROOT = "usr_root0000000000000000";
const ASHA = "usr_asha0000000000000000";
const BHAV = "usr_bhav0000000000000000";
const CHAN = "usr_chan0000000000000000";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  console.log("\nVerifying migration\n");

  // --- Decision 1: the Auth uid IS the old cuid -------------------------------
  const authUser = await auth.getUser(ASHA);
  check("Auth uid equals the pre-existing cuid", authUser.uid === ASHA, authUser.uid);
  check("Auth phone preserved in E.164", authUser.phoneNumber === "+919000000002", authUser.phoneNumber ?? "none");

  // Every foreign key still resolves, because no id was ever rewritten.
  const ashaDoc = await db.collection(COLLECTIONS.users).doc(ASHA).get();
  check("user doc id equals the Auth uid", ashaDoc.exists && ashaDoc.id === authUser.uid);

  // --- uplinePath: ordered, nearest ancestor first ----------------------------
  const chan = (await db.collection(COLLECTIONS.users).doc(CHAN).get()).data()!;
  const path: string[] = chan.uplinePath;
  check("uplinePath is nearest-ancestor-first", path[0] === ASHA && path[1] === ROOT, JSON.stringify(path));
  check("root has an empty uplinePath",
    ((await db.collection(COLLECTIONS.users).doc(ROOT).get()).data()!.uplinePath as string[]).length === 0);
  check("directDownlineCount is materialised",
    (await db.collection(COLLECTIONS.users).doc(ROOT).get()).data()!.directDownlineCount === 2);

  // --- Decision 3: the team roll-up WITHOUT groupBy ---------------------------
  // This is the query that replaces the four groupBy aggregations in team.ts.
  // Asha's path is [root]; Chandan's is [asha, root] — so both are in root's line.
  const augustLogs = await db
    .collection(COLLECTIONS.dailyLogs)
    .where("uplinePath", "array-contains", ROOT)
    .where("dayKey", ">=", FIRST_OF_MONTH)
    .count()
    .get();
  check("whole-line month roll-up via array-contains + count()",
    augustLogs.data().count === 6, `${augustLogs.data().count} logs (expected 6)`);

  // Last month's log must be excluded — D26's month boundary, in IST not UTC.
  const previousMonthOnly = await db
    .collection(COLLECTIONS.dailyLogs)
    .where("uplinePath", "array-contains", ROOT)
    .where("dayKey", "==", LAST_OF_PREV_MONTH)
    .count()
    .get();
  check("month boundary respected (last month's logs not counted as this month's)",
    previousMonthOnly.data().count === 2,
    `${previousMonthOnly.data().count} logs on ${LAST_OF_PREV_MONTH}`);

  // --- D26: the composite id IS the uniqueness constraint ---------------------
  // Four days back, matching the seed. Deliberately not today: nothing is seeded there,
  // because a log dated today lands inside every freshly created qualification window.
  const SEEDED_DAY = shiftKey(TODAY, -4);
  const logId = dailyLogDocId(ASHA, SEEDED_DAY);
  const log = await db.collection(COLLECTIONS.dailyLogs).doc(logId).get();
  check("daily log addressable by userId__dayKey", log.exists, logId);
  check("stored dayKey is the coach's local day", log.data()?.dayKey === SEEDED_DAY);

  // --- D20: one report identity per set of inputs -----------------------------
  const reportSnap = await db.collection(COLLECTIONS.reports).limit(1).get();
  const report = reportSnap.docs[0];
  check("report id is prospectDocId__inputsHash",
    report.id === reportDocId(report.data().prospectId, report.data().inputsHash), report.id);
  check("report token preserved intact",
    report.data().token === "Xk7mQp2RtY9wLb4NcF6vHs3JdG8zA5eU");

  // --- D6: offline-capture idempotency survived as a doc id -------------------
  const queued = await db.collection(COLLECTIONS.prospects)
    .where("clientId", "!=", null).limit(1).get();
  const q = queued.docs[0];
  check("queued capture id is coachId__clientId",
    q.id === `${q.data().coachId}__${q.data().clientId}`, q.id);

  const qr = await db.collection(COLLECTIONS.prospects).where("source", "==", "qr").get();
  // The invariant, not the count: e2e runs add QR prospects to this emulator, and
  // asserting "exactly one" made this fail for the wrong reason.
  check("every QR self-fill has an id with no clientId component",
    qr.docs.length >= 1 && qr.docs.every((d) => d.data().clientId === null),
    `${qr.docs.length} QR prospect(s)`);

  // --- Privacy: the data the v2.1b rules test will need -----------------------
  const share = (await db.collection(COLLECTIONS.users).doc(ASHA).get()).data()!.shareProspects;
  const noShare = (await db.collection(COLLECTIONS.users).doc(BHAV).get()).data()!.shareProspects;
  check("shareProspects migrated per-user, not defaulted", share === true && noShare === false,
    `asha=${share} bhavana=${noShare}`);

  // --- OTP table is gone, not carried over ------------------------------------
  const otp = await db.collection("otpCodes").count().get();
  check("otp_codes NOT migrated (Firebase Auth owns this now)", otp.data().count === 0);

  // --- team.ts on Firestore: the groupBy replacement, end to end --------------
  const tree = await buildTeamTree(ROOT);
  check("team tree builds from the root", tree !== null);
  const level1 = tree?.children.map((c) => c.id) ?? [];
  check("level 1 contains both seeded directs",
    level1.includes(ASHA) && level1.includes(BHAV),
    tree?.children.map((c) => c.name).join(", "));

  const ashaNode = tree?.children.find((c) => c.id === ASHA);
  // Again the invariant: Chandan hangs off Asha. The e2e signup legitimately adds
  // another child, so a count assertion here tested the fixture, not the tree.
  check("level 2 renders under the right parent",
    ashaNode?.children.some((c) => c.id === CHAN) === true,
    `${ashaNode?.children.length} child(ren)`);

  // Asha logged 4 days, one of them 31 July. Only 3 fall in the current month.
  check("logsThisMonth excludes last month", ashaNode?.logsThisMonth === 3,
    `${ashaNode?.logsThisMonth} logs`);
  check("a coach with no logs shows zero",
    tree?.children.find((c) => c.id === BHAV)?.logsThisMonth === 0);

  // D31: 420/400 shown honestly as overshoot, not clamped or hidden.
  check("targetPct derived from the numbers", ashaNode?.targetPct === 105,
    `${ashaNode?.targetPct}%`);

  check("directCount comes from the materialised counter and matches the tree",
    tree?.directCount === tree?.children.length, `counter=${tree?.directCount}`);
  check("hasMore false when children are rendered", ashaNode?.hasMore === false);

  check("isInDownline finds a grandchild", await isInDownline(ROOT, CHAN));
  check("isInDownline rejects a sibling", (await isInDownline(BHAV, CHAN)) === false);
  check("isInDownline treats a user as their own line", await isInDownline(ASHA, ASHA));

  // --- follow-up counts: null must not sort as "overdue" ----------------------
  /**
   * Asha has Meera (follow-up YESTERDAY) and Ravi (no follow-up at all).
   *
   * In Firestore's type ordering `null` sorts BEFORE every timestamp, so a naive
   * "< today" range counts Ravi as overdue. Zero is the proof it does not — and Ravi is
   * the only thing this check is about.
   *
   * The `now` passed in is therefore THREE DAYS AGO, not the real clock. That is not a
   * fudge: `followupCounts` takes `now` as a parameter precisely so a caller can ask
   * "what was due on a given day", and this assertion needs a day on which Meera's
   * follow-up is still in the FUTURE, so that a non-zero count could only have come from
   * Ravi's null. Against the real clock Meera is genuinely one day late — which is what
   * `e2e/session4.spec.ts` asserts, from the other side of the same fixture.
   */
  const asOf = startOfDayInZone(shiftKey(TODAY, -3), APP_TIMEZONE);
  const counts = await followupCounts(ASHA, "Asia/Kolkata", asOf);
  check("prospects with no follow-up date are not counted overdue",
    counts.overdue === 0, `overdue=${counts.overdue}`);
  check("a future follow-up is not counted as due today",
    counts.today === 0, `today=${counts.today}`);

  // --- targets and proofs: D32's matrix, on Firestore -------------------------
  const month = TODAY.slice(0, 7);
  const myTarget = await getMyTarget(ASHA, month);
  check("target addressable by coachId__month", myTarget !== null, myTarget?.id);
  check("proofs hydrated without a join", myTarget?.proofs.length === 1);
  check("setBy resolved to a name", myTarget?.setBy.name === "Root Coach",
    myTarget?.setBy.name);

  // The relational filter `where: { target: { coachId } }` has no Firestore
  // equivalent; this proves the denormalised coachId replaces it correctly.
  check("proofsAwaitingReview finds the submitted proof",
    (await proofsAwaitingReview(ROOT)) === 1);
  check("pendingProofCount excludes an already-submitted proof",
    (await pendingProofCount(ASHA)) === 0);

  // Authorization is re-derived from the database, not trusted from the caller.
  check("a coach cannot set their own target",
    (await setTarget(ASHA, ASHA, month, 100)).ok === false);
  check("a non-upline cannot set someone's target",
    (await setTarget(BHAV, CHAN, month, 100)).ok === false);
  check("an upline two levels up cannot set a target",
    (await setTarget(ROOT, CHAN, month, 100)).ok === false);
  check("the direct upline CAN set a target",
    (await setTarget(ASHA, CHAN, month, 250)).ok === true);
  check("progress is movable only by the target's own coach",
    (await updateProgress(ROOT, `${CHAN}__${month}`, 50)).ok === false);
  check("the coach CAN move their own progress",
    (await updateProgress(CHAN, `${CHAN}__${month}`, 50)).ok === true);

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
