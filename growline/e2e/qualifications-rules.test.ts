/**
 * Security Rules tests for the qualification collections (F14).
 *
 *   npm run test:rules:quals
 *
 * House style (e2e/rules.test.ts): real authenticated clients against the emulator
 * with the real rules file, and every check states the rule it defends and why.
 *
 * ## The ones that matter most
 *
 * MANDATORY — `qualificationProgress` is unreadable by everybody. It holds the
 * audience size, every participant's numbers and every participant's shortfall.
 * The qualifier list this feature renders shows QUALIFIED coaches by name and the
 * one-condition-away group as a count, and that distinction is only a guarantee if
 * the underlying rows cannot be fetched. Denied to the creator too, and to the coach
 * a row is about: a grant with an exception is a grant somebody widens.
 *
 * MANDATORY — a coach outside the creator's line cannot read the qualification at
 * all. P1's shape: activity flows up a line, and a qualification runs down one, so
 * "who is in this" has to be decided by the rules rather than by whichever query a
 * client felt like sending.
 *
 * MANDATORY — nothing here is client-writable. A writable progress row is a coach
 * marking themselves qualified, which would be the entire feature handed away.
 *
 * Membership is resolved from the CURRENT user document, never from anything stored
 * on the qualification — D64 — which is why no fixture below puts an audience list or
 * a `uplinePath` on a qualification for a rule to trust.
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

const ROOT = "usr_root"; // creator of both qualifications below
const ASHA = "usr_asha"; // ROOT's direct downline
const BHAV = "usr_bhav"; // ROOT's other direct downline
const CHAN = "usr_chan"; // ASHA's downline — ROOT's grandchild
const OUTSIDER = "usr_outsider"; // root of an unrelated tree

const Q = "qualifications";
const P = "qualificationProgress";

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

async function main() {
  env = await initializeTestEnvironment({
    projectId: "growline-qualifications-rules",
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
      levelName: "Team Leader", city: "Bengaluru",
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

    for (const uid of [ROOT, ASHA, BHAV, CHAN, OUTSIDER]) await setDoc(doc(db, "users", uid), { workspaceId: uid === OUTSIDER ? "other-workspace" : "rules-workspace" }, { merge: true });
    const definition = {
      workspaceId: "rules-workspace",
      creatorId: ROOT,
      creatorName: "Root",
      title: "Summer push",
      criteria: [
        { type: "newMembers", target: 2 },
        { type: "daysActive", target: 10 },
      ],
      fromKey: "2026-08-01",
      deadlineKey: "2026-08-31",
      timeZone: "Asia/Kolkata",
    };

    await setDoc(doc(db, Q, "qual_direct"), { ...definition, audience: "direct" });
    await setDoc(doc(db, Q, "qual_all"), { ...definition, audience: "all" });

    await setDoc(doc(db, P, "qp_qual_direct__usr_asha"), {
      kind: "progress", qualificationId: "qual_direct", creatorId: ROOT,
      userId: ASHA, userName: "Asha",
      values: { newMembers: 2, daysActive: 4 }, baseline: {}, unchecked: {},
      met: { newMembers: true, daysActive: false }, metCount: 1, stepsAway: 1,
      qualified: false, qualifiedAt: null, remindersSent: [],
    });
    await setDoc(doc(db, P, "qs_qual_direct"), {
      kind: "summary", qualificationId: "qual_direct", creatorId: ROOT,
      audienceSize: 2, qualifiedCount: 0, oneStepCount: 1, byCriterion: {},
    });
  });

  const as = (uid: string) => env.authenticatedContext(uid).firestore();
  const anon = () => env.unauthenticatedContext().firestore();

  console.log("\nSecurity Rules — qualifications\n");

  // ---- MANDATORY: nobody reads anybody's numbers ------------------------------
  /**
   * The rows carry how far short each person is, and the summary carries how many
   * people there are. A participant is shown who has QUALIFIED by name and how many
   * are one condition away as a COUNT; that asymmetry is a product decision about
   * publishing somebody's shortfall to their peers, and it can only be a guarantee
   * if the rows themselves are not fetchable.
   */
  await check("MANDATORY: the creator cannot read a progress row", () =>
    assertFails(getDoc(doc(as(ROOT), P, "qp_qual_direct__usr_asha")))
  );
  await check("...nor can the coach the row is about", () =>
    assertFails(getDoc(doc(as(ASHA), P, "qp_qual_direct__usr_asha")))
  );
  await check("...nor a peer in the same qualification", () =>
    assertFails(getDoc(doc(as(BHAV), P, "qp_qual_direct__usr_asha")))
  );
  await check("...and the roll-up is not readable either", () =>
    // audienceSize beside qualifiedCount is "how many of us have not made it",
    // which is the same reveal in one document instead of many.
    assertFails(getDoc(doc(as(ROOT), P, "qs_qual_direct")))
  );
  await check("...not by listing one qualification's rows", () =>
    assertFails(
      getDocs(query(collection(as(ROOT), P), where("qualificationId", "==", "qual_direct")))
    )
  );
  await check("...nor by an unfiltered listing of the collection", () =>
    assertFails(getDocs(collection(as(ROOT), P)))
  );

  // ---- MANDATORY: a qualification is readable only inside the creator's line ---
  await check("MANDATORY: a coach in another line cannot read the qualification", () =>
    assertFails(getDoc(doc(as(OUTSIDER), Q, "qual_direct")))
  );
  await check("the creator reads their own", () =>
    assertSucceeds(getDoc(doc(as(ROOT), Q, "qual_direct")))
  );
  await check("a direct downline reads a direct-line qualification", () =>
    assertSucceeds(getDoc(doc(as(ASHA), Q, "qual_direct")))
  );
  /**
   * "My direct line only" means exactly that. Chandan is in ROOT's line but was not
   * brought in by ROOT, so a direct-scoped qualification is not addressed to him —
   * and the rule refuses it rather than leaving the UI to decide. Same distinction
   * F8 draws between a thread's two scopes, enforced the same way.
   */
  await check("a grandchild is refused a DIRECT-line qualification", () =>
    assertFails(getDoc(doc(as(CHAN), Q, "qual_direct")))
  );
  await check("...and reads the same creator's WHOLE-line one", () =>
    assertSucceeds(getDoc(doc(as(CHAN), Q, "qual_all")))
  );
  await check("an unrelated coach is refused the whole-line one too", () =>
    assertFails(getDoc(doc(as(OUTSIDER), Q, "qual_all")))
  );
  await check("an unauthenticated client reads nothing", () =>
    assertFails(getDoc(doc(anon(), Q, "qual_direct")))
  );

  // ---- MANDATORY: nothing is client-writable ----------------------------------
  await check("MANDATORY: a coach cannot mark themselves qualified", () =>
    assertFails(
      updateDoc(doc(as(ASHA), P, "qp_qual_direct__usr_asha"), { qualified: true })
    )
  );
  await check("...nor write a progress row from scratch", () =>
    assertFails(
      setDoc(doc(as(CHAN), P, "qp_qual_all__usr_chan"), {
        kind: "progress", qualificationId: "qual_all", creatorId: ROOT,
        userId: CHAN, userName: "Chandan", qualified: true,
      })
    )
  );
  await check("...nor forge a roll-up", () =>
    assertFails(setDoc(doc(as(ASHA), P, "qs_qual_all"), { kind: "summary" }))
  );
  await check("a coach cannot announce a qualification in somebody else's name", () =>
    assertFails(
      setDoc(doc(as(CHAN), Q, "qual_forged"), {
        creatorId: ROOT, creatorName: "Root", title: "Forged",
        criteria: [{ type: "daysActive", target: 1 }], audience: "all",
        fromKey: "2026-08-01", deadlineKey: "2026-08-31", timeZone: "Asia/Kolkata",
      })
    )
  );
  /**
   * The one a future session is most likely to want to relax. There is no edit
   * screen because a qualification people are already measured against must not
   * have its conditions moved; a client write is that edit with no screen.
   */
  await check("...nor soften the conditions of one they are being measured on", () =>
    assertFails(
      updateDoc(doc(as(ASHA), Q, "qual_direct"), {
        criteria: [{ type: "daysActive", target: 1 }],
      })
    )
  );
  await check("...nor delete it to escape it", () =>
    assertFails(deleteDoc(doc(as(ASHA), Q, "qual_direct")))
  );

  await env.cleanup();
  console.log(
    failures === 0
      ? `\nAll ${passes} qualification rules checks passed.\n`
      : `\n${failures} qualification rules check(s) FAILED.\n`
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
