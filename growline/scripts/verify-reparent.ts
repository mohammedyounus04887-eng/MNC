// Must come before anything that touches firebase-admin: `resolveTarget()` runs at module
// scope (D45) and throws if neither a credential nor the emulator pair is in the env.
import "dotenv/config";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../src/lib/firebase-admin";
import { dailyLogs, prospects, targets, users } from "../src/lib/collections";
import {
  LINE_REQUESTS,
  acceptLineRequest,
  createLineRequest,
  lineRequestId,
} from "../src/lib/line-requests";

/**
 * Proves the re-parent actually moves a whole subtree, not just the coach at the top.
 *
 * This is the one operation in the app that rewrites documents across four collections at
 * once, and the failure mode is silent: the coach looks attached, their team screen looks
 * right, and their downlines' work quietly stops rolling up. A unit test cannot reach it
 * (it needs Firestore) and an e2e test would have to drive two coaches through two browsers
 * to assert something that is really a data property. So it gets its own script.
 *
 * Fixture ids are all prefixed `vrp_` and deleted at the end, so this can run against the
 * same emulator as the seeded data without disturbing the e2e suite.
 *
 * Run: npx tsx scripts/verify-reparent.ts   (with the emulators up and the app seeded)
 */

const P = "vrp_";
const ORPHAN = `${P}orphan`;
const KID = `${P}kid`;
const GRANDKID = `${P}grandkid`;
const PARENT = `${P}parent`;
const ABOVE = `${P}above`;

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const arrEq = (a: unknown, b: string[]) =>
  Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

async function user(id: string, uplineId: string | null, uplinePath: string[]) {
  await users().doc(id).set({
    phone: `+9199${id.slice(-8)}`,
    name: id,
    city: null,
    photoUrl: null,
    uplineId,
    uplinePath,
    directDownlineCount: 0,
    referralCode: id.slice(-6).toUpperCase(),
    levelName: null,
    plan: "trial",
    trialEndsAt: Timestamp.now(),
    shareProspects: false,
    followupPushOn: null,
    createdAt: Timestamp.now(),
  });
}

async function setup() {
  // A two-level line ABOVE the parent, so the appended ancestors are more than one id —
  // a bug that appends only the immediate parent would pass with a shallower fixture.
  await user(ABOVE, null, []);
  await user(PARENT, ABOVE, [ABOVE]);

  // The orphan tree: a root with a child and a grandchild, exactly the "installed before
  // my upline did" case.
  await user(ORPHAN, null, []);
  await user(KID, ORPHAN, [ORPHAN]);
  await user(GRANDKID, KID, [KID, ORPHAN]);

  // The orphan's OWN rows have empty paths — that is what being a root means — so no
  // array-contains query can find them. This is the case most likely to be missed.
  await prospects().doc(`${P}p_orphan`).set({
    coachId: ORPHAN, coachUplinePath: [], clientId: null, name: "Orphan's prospect",
    phone: "+919555500001", age: null, gender: null, heightCm: null, weightKg: null,
    stage: "spoken", nextFollowupAt: null, source: "manual", notes: null,
    consentAt: Timestamp.now(), createdAt: Timestamp.now(),
  });
  await prospects().doc(`${P}p_kid`).set({
    coachId: KID, coachUplinePath: [ORPHAN], clientId: null, name: "Kid's prospect",
    phone: "+919555500002", age: null, gender: null, heightCm: null, weightKg: null,
    stage: "spoken", nextFollowupAt: null, source: "manual", notes: null,
    consentAt: Timestamp.now(), createdAt: Timestamp.now(),
  });
  await dailyLogs().doc(`${ORPHAN}__2026-08-09`).set({
    userId: ORPHAN, dayKey: "2026-08-09", logDate: Timestamp.now(), uplinePath: [],
    servings: 3, memberships: 0, sessions: 0, invites: 0, followupsDone: 0,
    note: null, createdAt: Timestamp.now(),
  });
  await dailyLogs().doc(`${GRANDKID}__2026-08-09`).set({
    userId: GRANDKID, dayKey: "2026-08-09", logDate: Timestamp.now(),
    uplinePath: [KID, ORPHAN], servings: 1, memberships: 0, sessions: 0, invites: 0,
    followupsDone: 0, note: null, createdAt: Timestamp.now(),
  });
  await targets().doc(`${KID}__2026-08`).set({
    coachId: KID, setById: ORPHAN, uplinePath: [ORPHAN], month: "2026-08",
    targetPoints: 100, progressPoints: 10, status: "active",
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}

async function cleanup() {
  const ids = [ORPHAN, KID, GRANDKID, PARENT, ABOVE];
  await Promise.all([
    ...ids.map((id) => users().doc(id).delete()),
    prospects().doc(`${P}p_orphan`).delete(),
    prospects().doc(`${P}p_kid`).delete(),
    dailyLogs().doc(`${ORPHAN}__2026-08-09`).delete(),
    dailyLogs().doc(`${GRANDKID}__2026-08-09`).delete(),
    targets().doc(`${KID}__2026-08`).delete(),
    db.collection(LINE_REQUESTS).doc(lineRequestId(ORPHAN, PARENT)).delete(),
    db.collection(LINE_REQUESTS).doc(lineRequestId(PARENT, ORPHAN)).delete(),
  ]);
}

async function main() {
  console.log("\nRe-parent verification\n");
  await cleanup();
  await setup();

  // The expected new ancestor chain for the orphan: parent, then everything above them.
  const expected = [PARENT, ABOVE];

  // --- The orphan asks to be placed under the parent -------------------------
  const created = await createLineRequest({
    childId: ORPHAN,
    parentId: PARENT,
    requestedBy: ORPHAN,
  });
  check("a request can be created", created.ok);

  // --- Two-sided approval: the asker cannot accept their own request ---------
  const selfAccept = await acceptLineRequest(lineRequestId(ORPHAN, PARENT), ORPHAN);
  check(
    "the coach who asked CANNOT accept their own request",
    !selfAccept.ok,
    selfAccept.ok ? "it was accepted" : ""
  );

  // --- A third party cannot accept it either --------------------------------
  const strangerAccept = await acceptLineRequest(lineRequestId(ORPHAN, PARENT), ABOVE);
  check("an unrelated coach cannot accept it", !strangerAccept.ok);

  // --- The parent accepts ---------------------------------------------------
  const accepted = await acceptLineRequest(lineRequestId(ORPHAN, PARENT), PARENT);
  check("the other coach can accept", accepted.ok, accepted.ok ? "" : accepted.error);

  // --- The tree ------------------------------------------------------------
  const [orphan, kid, grandkid, parent] = await Promise.all(
    [ORPHAN, KID, GRANDKID, PARENT].map((id) => users().doc(id).get())
  );
  check("the orphan now has the parent as upline", orphan.data()?.uplineId === PARENT);
  check(
    "the orphan's path is parent then everything above",
    arrEq(orphan.data()?.uplinePath, expected),
    JSON.stringify(orphan.data()?.uplinePath)
  );
  check(
    "the child's path was appended, not replaced",
    arrEq(kid.data()?.uplinePath, [ORPHAN, ...expected]),
    JSON.stringify(kid.data()?.uplinePath)
  );
  check(
    "the GRANDCHILD moved too — the whole subtree, not just the top",
    arrEq(grandkid.data()?.uplinePath, [KID, ORPHAN, ...expected]),
    JSON.stringify(grandkid.data()?.uplinePath)
  );
  check(
    "the parent's direct-downline counter went up",
    (parent.data()?.directDownlineCount ?? 0) === 1,
    String(parent.data()?.directDownlineCount)
  );

  // --- The denormalised copies ---------------------------------------------
  const [pOrphan, pKid, lOrphan, lGrand, tKid] = await Promise.all([
    prospects().doc(`${P}p_orphan`).get(),
    prospects().doc(`${P}p_kid`).get(),
    dailyLogs().doc(`${ORPHAN}__2026-08-09`).get(),
    dailyLogs().doc(`${GRANDKID}__2026-08-09`).get(),
    targets().doc(`${KID}__2026-08`).get(),
  ]);
  check(
    "the orphan's OWN prospect got the new path (empty paths are invisible to array-contains)",
    arrEq(pOrphan.data()?.coachUplinePath, expected),
    JSON.stringify(pOrphan.data()?.coachUplinePath)
  );
  check(
    "a descendant's prospect was appended",
    arrEq(pKid.data()?.coachUplinePath, [ORPHAN, ...expected]),
    JSON.stringify(pKid.data()?.coachUplinePath)
  );
  check(
    "the orphan's own daily log got the new path",
    arrEq(lOrphan.data()?.uplinePath, expected),
    JSON.stringify(lOrphan.data()?.uplinePath)
  );
  check(
    "a grandchild's daily log was appended — roll-ups will find it",
    arrEq(lGrand.data()?.uplinePath, [KID, ORPHAN, ...expected]),
    JSON.stringify(lGrand.data()?.uplinePath)
  );
  check(
    "a target was appended",
    arrEq(tKid.data()?.uplinePath, [ORPHAN, ...expected]),
    JSON.stringify(tKid.data()?.uplinePath)
  );

  // --- Idempotence: re-running the fan-out must not double any path ---------
  const again = await acceptLineRequest(lineRequestId(ORPHAN, PARENT), PARENT);
  check("an already-answered request cannot be accepted twice", !again.ok);

  // --- The cycle guard ----------------------------------------------------
  // GRANDKID is now below PARENT, so putting PARENT under GRANDKID would close a loop.
  const cycle = await createLineRequest({
    childId: PARENT,
    parentId: GRANDKID,
    requestedBy: PARENT,
  });
  check("a request that would form a loop is refused", !cycle.ok, cycle.ok ? "allowed" : "");

  // --- An already-attached coach cannot be re-attached in v1 ---------------
  const already = await createLineRequest({
    childId: KID,
    parentId: ABOVE,
    requestedBy: KID,
  });
  check("a coach who already has an upline cannot be attached again", !already.ok);

  await cleanup();

  console.log(
    failures === 0
      ? `\nAll re-parent checks passed.\n`
      : `\n${failures} re-parent check(s) FAILED.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(`\nverify-reparent crashed: ${(e as Error).message}\n`);
  await cleanup().catch(() => {});
  process.exit(1);
});
