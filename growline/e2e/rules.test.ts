/**
 * Security Rules tests.
 *
 * BUILD_PROMPT_V2 §5.7: "Security Rules tests — upline CANNOT read prospects when
 * toggle is off (this test is mandatory)."
 *
 * These run against the Firestore emulator with the rules file loaded, using real
 * authenticated clients. They exist because the UI hiding something proves nothing
 * — the question is what a hand-written query gets back.
 *
 *   npm run test:rules
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import { doc, getDoc, getDocs, collection, query, where, setDoc } from "firebase/firestore";

const ROOT = "usr_root";
const ASHA = "usr_asha"; // shareProspects: true
const BHAV = "usr_bhav"; // shareProspects: false
const CHAN = "usr_chan"; // Asha's downline
const OUTSIDER = "usr_outsider";

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

/**
 * Canary for the scale section: proves this harness still counts document lookups
 * at all.
 *
 * Without it, "26 documents still pass" could equally mean the emulator stopped
 * enforcing the budget, and the check above would be a vacuous green. These three
 * pin the ceilings the real rule lives under, using a throwaway ruleset — the real
 * rules have no way to spend that many lookups, which is the point.
 *
 * Measured here: a single-document read allows 10 distinct lookups and refuses 11;
 * a query refuses 21. (The emulator actually allows 20 for a query, but the docs
 * say 10 for both, so that ceiling is deliberately not asserted — the rule budgets
 * against 10 and this must not go red if the emulator ever aligns with the docs.)
 */
async function checkLookupBudgetIsEnforced() {
  const lookups = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => `get(/databases/$(database)/documents/canary/d_${i}).data.ok == true`
    ).join(" && ");

  const budget = await initializeTestEnvironment({
    projectId: "growline-rules-budget",
    firestore: {
      rules: `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /overQuery/{id}  { allow read: if ${lookups(21)}; }
    match /overSingle/{id} { allow read: if ${lookups(11)}; }
    match /underBoth/{id}  { allow read: if ${lookups(10)}; }
    match /{document=**}   { allow read, write: if false; }
  }
}`,
      host: "127.0.0.1",
      port: Number((process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":").at(-1)),
    },
  });

  await budget.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (let i = 0; i < 21; i++) await setDoc(doc(db, "canary", `d_${i}`), { ok: true });
    for (const c of ["overQuery", "overSingle", "underBoth"]) {
      await setDoc(doc(db, c, "x"), { n: 1 });
    }
  });

  const db = budget.authenticatedContext(ROOT).firestore();
  await check("canary: 21 distinct lookups in a query rule is over budget", () =>
    assertFails(getDocs(collection(db, "overQuery")))
  );
  await check("canary: 11 distinct lookups in a single-document rule is over budget", () =>
    assertFails(getDoc(doc(db, "overSingle", "x")))
  );
  await check("canary: 10 distinct lookups is inside both budgets", () =>
    assertSucceeds(getDoc(doc(db, "underBoth", "x")))
  );
  await budget.cleanup();
}

async function main() {
  env = await initializeTestEnvironment({
    projectId: "growline-rules-test",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: Number((process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":").at(-1)),
    },
  });

  // Seed with rules disabled — this is fixture setup, not a thing under test.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", ROOT), {
      name: "Root", uplineId: null, uplinePath: [], shareProspects: false,
    });
    await setDoc(doc(db, "users", ASHA), {
      name: "Asha", uplineId: ROOT, uplinePath: [ROOT], shareProspects: true,
    });
    await setDoc(doc(db, "users", BHAV), {
      name: "Bhavana", uplineId: ROOT, uplinePath: [ROOT], shareProspects: false,
    });
    await setDoc(doc(db, "users", CHAN), {
      name: "Chandan", uplineId: ASHA, uplinePath: [ASHA, ROOT], shareProspects: false,
    });
    await setDoc(doc(db, "users", OUTSIDER), {
      name: "Outsider", uplineId: null, uplinePath: [], shareProspects: true,
    });

    await setDoc(doc(db, "prospects", "p_asha"), {
      coachId: ASHA, coachUplinePath: [ROOT], name: "Meera", phone: "+919111111101",
    });
    await setDoc(doc(db, "prospects", "p_bhav"), {
      coachId: BHAV, coachUplinePath: [ROOT], name: "Sunita", phone: "+919111111103",
    });
    await setDoc(doc(db, "dailyLogs", "l_bhav"), {
      userId: BHAV, uplinePath: [ROOT], dayKey: "2026-08-09", servings: 3,
    });
    // A real targets document, so the "targets are closed" check below is testing a
    // denied read rather than passing vacuously on a document that does not exist.
    await setDoc(doc(db, "targets", "t_asha"), {
      coachId: ASHA, setById: ROOT, uplinePath: [ROOT], month: "2026-08",
      targetPoints: 500, progressPoints: 120, status: "active",
    });
    await setDoc(doc(db, "proofs", "pr_1"), {
      targetId: "t_asha", coachId: ASHA, requestedById: ROOT, status: "submitted",
    });
    await setDoc(doc(db, "reports", "r_1"), {
      prospectId: "p_asha", coachId: ASHA, token: "tok", metricsJson: "{}",
    });

    // Threads (F8). ROOT sends both scopes so the grandchild case is testable:
    // CHAN is ROOT's grandchild, so "all" reaches them and "direct" must not.
    await setDoc(doc(db, "threads", "th_root_all"), {
      senderId: ROOT, senderName: "Root", scope: "all",
      body: "Club meet on Sunday.", seenCount: 0, ackCount: 0,
    });
    await setDoc(doc(db, "threads", "th_root_direct"), {
      senderId: ROOT, senderName: "Root", scope: "direct",
      body: "Just for my direct line.", seenCount: 0, ackCount: 0,
    });
    await setDoc(doc(db, "threads", "th_asha_direct"), {
      senderId: ASHA, senderName: "Asha", scope: "direct",
      body: "Asha to her own line.", seenCount: 0, ackCount: 0,
    });
    await setDoc(doc(db, "threadReceipts", "th_root_all__usr_chan"), {
      threadId: "th_root_all", userId: CHAN, userName: "Chandan",
    });
    // A Real V announcement (F12). Sender is an admin who is in nobody's uplinePath —
    // which is the whole point of the platform scope.
    await setDoc(doc(db, "threads", "th_platform"), {
      senderId: "usr_realv_admin", senderName: "Growline", scope: "platform",
      body: "New feature: threads.", seenCount: 0, ackCount: 0,
    });
    await setDoc(doc(db, "adminAudit", "audit_1"), {
      actorId: ROOT, actorName: "Root", action: "broadcast", detail: "To all: hello",
    });
    // A real pending link request, so the denial checks below are testing a refused read
    // rather than passing vacuously against a document that does not exist.
    await setDoc(doc(db, "lineRequests", "req_1"), {
      childId: OUTSIDER, childName: "Outsider", parentId: ASHA, parentName: "Asha",
      requestedBy: OUTSIDER, status: "pending",
    });
  });

  const as = (uid: string) => env.authenticatedContext(uid).firestore();
  const anon = () => env.unauthenticatedContext().firestore();

  console.log("\nSecurity Rules\n");

  // ---- THE MANDATORY ONE ----------------------------------------------------
  await check(
    "MANDATORY: upline CANNOT read a downline's prospect while the toggle is off",
    () => assertFails(getDoc(doc(as(ROOT), "prospects", "p_bhav")))
  );
  await check(
    "MANDATORY: nor by querying — the list path is closed too",
    () =>
      assertFails(
        getDocs(query(collection(as(ROOT), "prospects"), where("coachId", "==", BHAV)))
      )
  );

  // ---- The toggle actually toggles ------------------------------------------
  // These two carry a second job since /users was closed to clients: they prove the
  // privacy rule's `get()` on that collection still resolves, because a `get()`
  // inside a rule is not subject to the rules. If they ever fail together while the
  // MANDATORY pair above still passes, suspect that, not the toggle.
  await check("upline CAN read a downline's prospect when the toggle is ON", () =>
    assertSucceeds(getDoc(doc(as(ROOT), "prospects", "p_asha")))
  );
  await check("...and via a query filtered to that one coach", () =>
    assertSucceeds(
      getDocs(query(collection(as(ROOT), "prospects"), where("coachId", "==", ASHA)))
    )
  );

  // ---- Ownership and outsiders ----------------------------------------------
  await check("a coach reads their own prospect", () =>
    assertSucceeds(getDoc(doc(as(ASHA), "prospects", "p_asha")))
  );
  await check("a sibling cannot read a prospect, toggle or not", () =>
    assertFails(getDoc(doc(as(BHAV), "prospects", "p_asha")))
  );
  await check("a downline cannot read their UPLINE's prospects", () =>
    assertFails(getDoc(doc(as(CHAN), "prospects", "p_asha")))
  );
  await check("a stranger cannot read a sharing coach's prospect", () =>
    assertFails(getDoc(doc(as(OUTSIDER), "prospects", "p_asha")))
  );
  await check("an unauthenticated client cannot read prospects at all", () =>
    assertFails(getDoc(doc(anon(), "prospects", "p_asha")))
  );
  await check("an unfiltered listing of all prospects is refused", () =>
    assertFails(getDocs(collection(as(ROOT), "prospects")))
  );

  /**
   * dailyLogs and targets are closed to every CLIENT, including the owning coach.
   *
   * Activity still flows up (v1 §5.4) — it always did so through the Admin SDK, and
   * `buildTeamTree()` is unaffected. What is gone is a browser-readable grant based on a
   * `uplinePath` SNAPSHOT, which would have turned into a stale GRANT the day a coach can
   * be re-parented: the old upline keeping read access forever, the new one having none.
   *
   * The upline read used to be asserted as a success here. It is now asserted as a
   * failure, deliberately, so reopening it has to be a decision somebody makes on purpose.
   */
  await check("an upline cannot read a downline's daily log FROM A CLIENT", () =>
    assertFails(getDoc(doc(as(ROOT), "dailyLogs", "l_bhav")))
  );
  await check("nor can the coach who owns it — nothing in the browser reads it", () =>
    assertFails(getDoc(doc(as(BHAV), "dailyLogs", "l_bhav")))
  );
  await check("a sibling certainly cannot", () =>
    assertFails(getDoc(doc(as(ASHA), "dailyLogs", "l_bhav")))
  );
  await check("targets are closed to clients the same way", () =>
    assertFails(getDoc(doc(as(ASHA), "targets", "t_asha")))
  );

  // ---- Users are server-only -------------------------------------------------
  // No browser code reads this collection — the team tree is built by the Admin
  // SDK. Rules cannot grant single fields, so any read allowed here is the WHOLE
  // document: phone, referralCode, plan, trialEndsAt, and shareProspects itself.
  // These three are what stops that being reopened for the sake of a name and a
  // photo; the fix they lock in is in the /users comment in firestore.rules.
  await check("an upline CANNOT read a downline's user document", () =>
    assertFails(getDoc(doc(as(ROOT), "users", CHAN)))
  );
  await check("nor can a coach read their own", () =>
    assertFails(getDoc(doc(as(ASHA), "users", ASHA)))
  );
  await check("a stranger certainly cannot", () =>
    assertFails(getDoc(doc(as(OUTSIDER), "users", ASHA)))
  );

  // ---- Proofs are for the two people in the exchange -------------------------
  await check("the coach reads their own proof", () =>
    assertSucceeds(getDoc(doc(as(ASHA), "proofs", "pr_1")))
  );
  await check("the upline who asked reads it", () =>
    assertSucceeds(getDoc(doc(as(ROOT), "proofs", "pr_1")))
  );
  await check("nobody else does", () =>
    assertFails(getDoc(doc(as(BHAV), "proofs", "pr_1")))
  );

  // ---- Reports are server-only (D17: the token is the access control) --------
  await check("reports are unreadable by any client, even the owning coach", () =>
    assertFails(getDoc(doc(as(ASHA), "reports", "r_1")))
  );

  // ---- Threads: addressed by who sent them, narrowed by scope ----------------
  /**
   * The scope test is the one that matters, and CHAN is why the fixture has three
   * levels. A "direct line only" broadcast from ROOT must not reach ROOT's
   * GRANDCHILD, and the only thing standing between them is this rule — the app's
   * `canRead` would filter it out of the rendered list, but a hand-written query
   * bypasses the app entirely.
   */
  await check("a sender reads their own thread", () =>
    assertSucceeds(getDoc(doc(as(ROOT), "threads", "th_root_all")))
  );
  await check("a direct downline reads their upline's 'whole line' thread", () =>
    assertSucceeds(getDoc(doc(as(ASHA), "threads", "th_root_all")))
  );
  await check("a GRANDCHILD reads a 'whole line' thread — that is what 'all' means", () =>
    assertSucceeds(getDoc(doc(as(CHAN), "threads", "th_root_all")))
  );
  await check(
    "MANDATORY: a grandchild CANNOT read a 'direct line only' thread",
    () => assertFails(getDoc(doc(as(CHAN), "threads", "th_root_direct")))
  );
  await check("a direct downline CAN read the 'direct line only' one", () =>
    assertSucceeds(getDoc(doc(as(ASHA), "threads", "th_root_direct")))
  );
  await check("somebody outside the line reads nothing", () =>
    assertFails(getDoc(doc(as(OUTSIDER), "threads", "th_root_all")))
  );
  await check("a sibling cannot read a thread sent down another branch", () =>
    assertFails(getDoc(doc(as(BHAV), "threads", "th_asha_direct")))
  );

  /**
   * Query shapes. These pin the design decision in the rule's comment: because rules
   * for a list are evaluated once against the QUERY, a listener must pin every field
   * the rule tests. The direct upline needs no scope pin; a deeper ancestor does.
   */
  await check("a coach can list their own sent threads", () =>
    assertSucceeds(
      getDocs(query(collection(as(ROOT), "threads"), where("senderId", "==", ROOT)))
    )
  );
  await check("a coach can list their DIRECT upline's threads, either scope", () =>
    assertSucceeds(
      getDocs(query(collection(as(ASHA), "threads"), where("senderId", "==", ROOT)))
    )
  );
  await check("a grandchild can list a grandparent's threads ONLY with scope pinned", () =>
    assertSucceeds(
      getDocs(
        query(
          collection(as(CHAN), "threads"),
          where("senderId", "==", ROOT),
          where("scope", "==", "all")
        )
      )
    )
  );
  await check("...and is refused the same query without the scope constraint", () =>
    assertFails(
      getDocs(query(collection(as(CHAN), "threads"), where("senderId", "==", ROOT)))
    )
  );
  await check("an unfiltered listing of every thread is refused", () =>
    assertFails(getDocs(collection(as(ASHA), "threads")))
  );

  /**
   * The platform scope (F12 broadcast). Reaches everyone, including a coach whose tree has
   * nothing to do with the sender — that is what distinguishes it from "entire line", and
   * it is the branch most likely to be broken by a future edit to the threads rule.
   */
  await check("a Real V announcement reaches a coach outside any relevant line", () =>
    assertSucceeds(getDoc(doc(as(OUTSIDER), "threads", "th_platform")))
  );
  await check("...and the deepest downline too", () =>
    assertSucceeds(getDoc(doc(as(CHAN), "threads", "th_platform")))
  );
  await check("a coach can list announcements with the scope pinned", () =>
    assertSucceeds(
      getDocs(
        query(collection(as(OUTSIDER), "threads"), where("scope", "==", "platform"))
      )
    )
  );
  await check("an announcement is still denied to somebody with no account", () =>
    assertFails(getDoc(doc(anon(), "threads", "th_platform")))
  );
  await check("a coach cannot forge an announcement to everyone", () =>
    assertFails(
      setDoc(doc(as(ASHA), "threads", "th_forged_platform"), {
        senderId: ASHA, scope: "platform", body: "Free stuff",
      })
    )
  );

  /**
   * Link requests are server-only. The READ matters as much as the write: an open read
   * would let anyone list who is trying to attach to whom, which is somebody's team
   * structure being assembled from the outside.
   */
  await check("a party to a link request still cannot read it from a client", () =>
    assertFails(getDoc(doc(as(ASHA), "lineRequests", "req_1")))
  );
  await check("...and cannot forge one that would move them under somebody", () =>
    assertFails(
      setDoc(doc(as(ASHA), "lineRequests", "req_forged"), {
        childId: OUTSIDER, parentId: ASHA, requestedBy: OUTSIDER, status: "pending",
      })
    )
  );
  await check("...nor accept one by writing the status themselves", () =>
    assertFails(
      setDoc(doc(as(ASHA), "lineRequests", "req_1"), { status: "accepted" })
    )
  );

  // The audit trail is closed to every browser, including an admin's.
  await check("adminAudit is unreadable by any client", () =>
    assertFails(getDoc(doc(as(ROOT), "adminAudit", "audit_1")))
  );
  await check("...and unwritable, so it cannot be forged or cleared", () =>
    assertFails(setDoc(doc(as(ROOT), "adminAudit", "audit_2"), { action: "nothing" }))
  );

  // Receipts stay shut: a sender gets counts off the thread document, never a
  // per-person read log of their line.
  await check("threadReceipts are unreadable by the reader they describe", () =>
    assertFails(getDoc(doc(as(CHAN), "threadReceipts", "th_root_all__usr_chan")))
  );
  await check("...and by the sender of the thread", () =>
    assertFails(getDoc(doc(as(ROOT), "threadReceipts", "th_root_all__usr_chan")))
  );

  // ---- No client writes anywhere ---------------------------------------------
  await check("a coach cannot write their own user document", () =>
    assertFails(setDoc(doc(as(ASHA), "users", ASHA), { name: "Hacked" }))
  );
  await check("a coach cannot grant themselves an uplinePath", () =>
    assertFails(setDoc(doc(as(OUTSIDER), "users", OUTSIDER), { uplinePath: [ROOT] }))
  );
  await check("a coach cannot write a prospect directly", () =>
    assertFails(setDoc(doc(as(ASHA), "prospects", "p_new"), { coachId: ASHA }))
  );
  await check("a coach cannot forge a thread from their upline", () =>
    assertFails(
      setDoc(doc(as(CHAN), "threads", "th_forged"), { senderId: ROOT, scope: "all" })
    )
  );
  await check("nor inflate an ack count by writing a receipt", () =>
    assertFails(
      setDoc(doc(as(CHAN), "threadReceipts", "th_root_direct__usr_chan"), {
        threadId: "th_root_direct", userId: CHAN,
      })
    )
  );

  // ---- Scale: the coach lookup is charged per request, not per document -------
  /**
   * Everything above ran against a one-prospect-per-coach fixture, and a
   * one-document fixture cannot tell you what the privacy rule's `get()` costs.
   * Read the rule as "runs once per returned document" and you conclude the shared
   * listing starts failing somewhere around ten prospects — a coach's first week.
   * It does not: a query is evaluated once, against its own constraints, so the
   * single bound `coachId` resolves one `/users` document however many prospects
   * come back. See the accounting note on the prospects rule.
   *
   * 26 documents is well past where the per-document reading predicts
   * permission-denied, and the mandatory denial is re-run at the same size — a
   * cheap fix for a cap that does not exist would be to move the toggle out of the
   * rules and into query constraints, and this is the check that would catch it.
   */
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (let i = 0; i < 25; i++) {
      await setDoc(doc(db, "prospects", `bulk_asha_${i}`), {
        coachId: ASHA, coachUplinePath: [ROOT],
        name: `Asha prospect ${i}`, phone: `+9192222${String(i).padStart(5, "0")}`,
      });
      await setDoc(doc(db, "prospects", `bulk_bhav_${i}`), {
        coachId: BHAV, coachUplinePath: [ROOT],
        name: `Bhavana prospect ${i}`, phone: `+9193333${String(i).padStart(5, "0")}`,
      });
    }
  });

  await check("a 26-document shared listing still passes — one lookup, not one per row", () =>
    assertSucceeds(
      getDocs(query(collection(as(ROOT), "prospects"), where("coachId", "==", ASHA)))
    )
  );
  await check("MANDATORY at scale: 26 documents with the toggle off are still refused", () =>
    assertFails(
      getDocs(query(collection(as(ROOT), "prospects"), where("coachId", "==", BHAV)))
    )
  );

  await checkLookupBudgetIsEnforced();

  await env.cleanup();
  console.log(
    failures === 0
      ? `\nAll ${passes} rules checks passed.\n`
      : `\n${failures} rules check(s) FAILED.\n`
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
