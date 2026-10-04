/**
 * Security Rules tests for `duplicationScores` (F20).
 *
 *   npm run test:rules:duplication
 *
 * House style (e2e/rules.test.ts): real authenticated clients against the emulator
 * with the real rules file, and every check states the rule it defends and why.
 *
 * ## The ones that matter most
 *
 * MANDATORY — nobody can write one. A duplication reading is the output of a read
 * across the entire organisation, and it is the single figure in these modules that
 * an individual has an obvious motive to fabricate. A client-writable score is a
 * coach typing 100 into their own line's report card.
 *
 * MANDATORY — a coach can read their OWN reading and nobody else's. Not a peer, not
 * their upline, not their downline. Activity counts do flow up a line (P1), so an
 * upline reading this would not be a privacy breach in itself — the grant is
 * withheld because the screen that would use it does not exist, and because the
 * moment it is written the ancestry test has to be resolved live against the current
 * tree (D64) rather than against anything stored here.
 *
 * MANDATORY — nothing stored ON a reading can grant access to it. The last check
 * below plants an ancestry array on a document and confirms the rule ignores it
 * completely. That is D64 as a property of the database: authorization never reads a
 * write-time snapshot of the tree, and no future field on this document can quietly
 * become one.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const ROOT = "usr_root"; // top of the tree, has a line two levels deep
const ASHA = "usr_asha"; // ROOT's direct downline, has her own downline
const BHAV = "usr_bhav"; // ROOT's other direct downline, no line of her own
const CHAN = "usr_chan"; // ASHA's downline — ROOT's grandchild
const OUTSIDER = "usr_outsider"; // root of an unrelated tree

const D = "duplicationScores";

let env: RulesTestEnvironment;
let failures = 0;
let passes = 0;

async function check(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    passes++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${name} — ${(e as Error).message.split("\n")[0]}`);
  }
}

/** A reading, in the shape the scheduled job writes. Counts only — never names. */
const reading = (userId: string, score: number | null) => ({
  userId,
  score,
  reason: score === null ? "noLine" : "ok",
  levels: [{ depth: 1, people: 2, active: 1, pending: 0, rate: 0.5, weighted: 0.5, weight: 1 }],
  lineSize: 2,
  pendingCount: 0,
  deepestLevel: 1,
  deepestActiveLevel: 1,
  own: { daysLogged: 9, active: true },
  fromKey: "2026-07-16",
  toKey: "2026-08-12",
  windowDays: 28,
  timeZone: "Asia/Kolkata",
});

async function main() {
  env = await initializeTestEnvironment({
    projectId: "growline-duplication-rules",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: Number((process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":").at(-1)),
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", ROOT), {
      name: "Root", uplineId: null, uplinePath: [], shareProspects: false,
      levelName: null, city: "Bengaluru",
    });
    await setDoc(doc(db, "users", ASHA), {
      name: "Asha", uplineId: ROOT, uplinePath: [ROOT], shareProspects: true,
      levelName: null, city: "Bengaluru",
    });
    await setDoc(doc(db, "users", BHAV), {
      name: "Bhavana", uplineId: ROOT, uplinePath: [ROOT], shareProspects: false,
      levelName: null, city: "Mysuru",
    });
    await setDoc(doc(db, "users", CHAN), {
      name: "Chandan", uplineId: ASHA, uplinePath: [ASHA, ROOT], shareProspects: false,
      levelName: null, city: "Mysuru",
    });
    await setDoc(doc(db, "users", OUTSIDER), {
      name: "Outsider", uplineId: null, uplinePath: [], shareProspects: true,
      levelName: null, city: "Bengaluru",
    });

    await setDoc(doc(db, D, `dup_${ROOT}`), reading(ROOT, 41));
    await setDoc(doc(db, D, `dup_${ASHA}`), reading(ASHA, 100));
    /**
     * The same reading, plus an ancestry array of the kind a future field might
     * innocently add. The rule must ignore it — see the header, and D64.
     */
    await setDoc(doc(db, D, `dup_${BHAV}`), {
      ...reading(BHAV, 0),
      uplinePath: [ROOT],
      sharedWith: [ROOT, OUTSIDER],
    });
  });

  const as = (u: string) => env.authenticatedContext(u).firestore();

  console.log("\nduplicationScores — reads\n");

  await check("a coach can read their own reading", () =>
    assertSucceeds(getDoc(doc(as(ROOT), D, `dup_${ROOT}`)))
  );
  await check("...and can query for it by their own uid", () =>
    assertSucceeds(
      getDocs(query(collection(as(ROOT), D), where("userId", "==", ROOT)))
    )
  );

  /**
   * The collection must not be enumerable. One unfiltered list would hand a coach
   * every line's activity in the organisation, which no screen has ever needed and
   * which the per-document rule would otherwise be the only thing standing against.
   */
  await check("MANDATORY: the collection cannot be listed unfiltered", () =>
    assertFails(getDocs(collection(as(ROOT), D)))
  );
  await check("...nor filtered to somebody else", () =>
    assertFails(getDocs(query(collection(as(ASHA), D), where("userId", "==", ROOT))))
  );

  await check("MANDATORY: a coach cannot read a peer's reading", () =>
    // Asha and Bhavana are siblings. Neither line is any of the other's business,
    // and sideways is the direction P1 never permits anything to travel.
    assertFails(getDoc(doc(as(ASHA), D, `dup_${BHAV}`)))
  );
  await check("MANDATORY: an upline cannot read a downline's reading", () =>
    // Withheld deliberately, not by oversight: the coaching screen that would use
    // this does not exist, and when it is built it is server-rendered like the team
    // tree with the Admin SDK doing the reading (D48).
    assertFails(getDoc(doc(as(ROOT), D, `dup_${ASHA}`)))
  );
  await check("...including a grandparent two levels up", () =>
    assertFails(getDoc(doc(as(ROOT), D, `dup_${CHAN}`)))
  );
  await check("a downline cannot read their upline's reading", () =>
    // Asha is IN Root's line, so Root's score is partly about her — which is not the
    // same as it being hers to open.
    assertFails(getDoc(doc(as(ASHA), D, `dup_${ROOT}`)))
  );
  await check("a coach in an unrelated tree cannot read anything", () =>
    assertFails(getDoc(doc(as(OUTSIDER), D, `dup_${ROOT}`)))
  );
  await check("a signed-out client cannot read a reading", () =>
    assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), D, `dup_${ROOT}`)))
  );

  /**
   * D64, as a property of the database. Bhavana's reading carries `uplinePath:
   * [ROOT]` and `sharedWith: [ROOT, OUTSIDER]`, both of which name Root. The rule
   * reads neither, so Root is still refused — authorization is decided by the
   * requester's uid against `userId`, never by anything a document says about who
   * the tree looked like when it was written.
   */
  await check("MANDATORY: an ancestry array stored ON a reading grants nothing", () =>
    assertFails(getDoc(doc(as(ROOT), D, `dup_${BHAV}`)))
  );

  console.log("\nduplicationScores — writes\n");

  await check("MANDATORY: a coach cannot write their own score", () =>
    assertFails(setDoc(doc(as(ASHA), D, `dup_${ASHA}`), reading(ASHA, 100)))
  );
  await check("...nor edit the one that is there", () =>
    assertFails(updateDoc(doc(as(ROOT), D, `dup_${ROOT}`), { score: 100 }))
  );
  await check("...nor delete a reading they dislike", () =>
    assertFails(deleteDoc(doc(as(ROOT), D, `dup_${ROOT}`)))
  );
  await check("...nor invent a reading for somebody else", () =>
    assertFails(setDoc(doc(as(ASHA), D, `dup_${CHAN}`), reading(CHAN, 0)))
  );
  await check("a signed-out client cannot write one either", () =>
    assertFails(
      setDoc(doc(env.unauthenticatedContext().firestore(), D, "dup_anything"), reading(ROOT, 99))
    )
  );

  await env.cleanup();
  console.log(
    failures === 0
      ? `\nAll ${passes} duplication rules checks passed.\n`
      : `\n${failures} duplication rules check(s) FAILED.\n`
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
