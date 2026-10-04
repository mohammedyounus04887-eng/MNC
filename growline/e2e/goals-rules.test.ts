import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

/**
 * Goal-sheet privacy (Feature A2).
 *
 * Two properties, and both need the permission asserted beside the denial or the suite
 * would pass against a deny-all and prove nothing:
 *
 *   1. the DIRECT upline reads the sheet — and nobody further up the line does;
 *   2. the personal reason is private until the coach turns it on.
 */

const ROOT = "usr_root";
const ASHA = "usr_asha"; // ROOT's direct downline
const CHAN = "usr_chan"; // ASHA's direct downline, ROOT's grandchild
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

async function main() {
  env = await initializeTestEnvironment({
    projectId: "growline-goals-rules",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: Number((process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":").at(-1)),
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", ROOT), { name: "Root", uplineId: null, uplinePath: [] });
    await setDoc(doc(db, "users", ASHA), { name: "Asha", uplineId: ROOT, uplinePath: [ROOT] });
    await setDoc(doc(db, "users", CHAN), {
      name: "Chandan", uplineId: ASHA, uplinePath: [ASHA, ROOT],
    });
    await setDoc(doc(db, "users", OUTSIDER), { name: "Outsider", uplineId: null, uplinePath: [] });

    // Chandan's sheet, sharing OFF — the default.
    await setDoc(doc(db, "goalSheets", CHAN), {
      why: "For my children", shortTermGoal: "10 new people a month",
      blockers: ["time"], hoursPerDay: 2, shareNeeds: false,
    });
    await setDoc(doc(db, "goalSheets", CHAN, "private", "needs"), {
      needs: "School fees", needsAmount: 10000,
    });

    // Asha's sheet, sharing ON — the mirror case.
    await setDoc(doc(db, "goalSheets", ASHA), {
      why: "Independence", shortTermGoal: "Build my line", shareNeeds: true,
    });
    await setDoc(doc(db, "goalSheets", ASHA, "private", "needs"), {
      needs: "Clearing a loan", needsAmount: 50000,
    });

    // A target conversation between Asha (upline) and Chandan (the coach it is for).
    await setDoc(doc(db, "goalConversations", "tgt_chan_aug"), {
      coachId: CHAN, uplineId: ASHA, month: "2026-08", status: "proposed",
      proposedPoints: 400, changeNote: "",
      actions: [{ blocker: "time", action: "Three evening calls, not ten", done: false }],
    });
  });

  const as = (uid: string) => env.authenticatedContext(uid).firestore();
  const anon = () => env.unauthenticatedContext().firestore();

  console.log("\nGoal sheet privacy\n");

  // ---- The sheet itself: owner and DIRECT upline ---------------------------
  await check("a coach reads their own sheet", () =>
    assertSucceeds(getDoc(doc(as(CHAN), "goalSheets", CHAN)))
  );
  await check("their DIRECT upline reads it — this is the coaching material", () =>
    assertSucceeds(getDoc(doc(as(ASHA), "goalSheets", CHAN)))
  );
  await check(
    "MANDATORY: the grandparent in the line CANNOT — direct upline only, not the chain",
    () => assertFails(getDoc(doc(as(ROOT), "goalSheets", CHAN)))
  );
  await check("somebody outside the line cannot", () =>
    assertFails(getDoc(doc(as(OUTSIDER), "goalSheets", CHAN)))
  );
  await check("a signed-out visitor cannot", () =>
    assertFails(getDoc(doc(anon(), "goalSheets", CHAN)))
  );

  // ---- The personal reason: private by default -----------------------------
  await check("the coach always reads their own personal reason", () =>
    assertSucceeds(getDoc(doc(as(CHAN), "goalSheets", CHAN, "private", "needs")))
  );
  await check(
    "MANDATORY: the direct upline CANNOT, while sharing is off",
    () => assertFails(getDoc(doc(as(ASHA), "goalSheets", CHAN, "private", "needs")))
  );
  await check("...and once it is ON, the direct upline can", () =>
    assertSucceeds(getDoc(doc(as(ROOT), "goalSheets", ASHA, "private", "needs")))
  );
  await check(
    "...but sharing ON still does not open it to the rest of the line",
    () => assertFails(getDoc(doc(as(CHAN), "goalSheets", ASHA, "private", "needs")))
  );
  await check("nor to a stranger", () =>
    assertFails(getDoc(doc(as(OUTSIDER), "goalSheets", ASHA, "private", "needs")))
  );

  // ---- The target conversation: the two parties, and nobody else ------------
  await check("the coach the target is for reads the conversation", () =>
    assertSucceeds(getDoc(doc(as(CHAN), "goalConversations", "tgt_chan_aug")))
  );
  await check("so does the upline who proposed it", () =>
    assertSucceeds(getDoc(doc(as(ASHA), "goalConversations", "tgt_chan_aug")))
  );
  await check(
    "MANDATORY: the grandparent cannot — a renegotiation is not the line's business",
    () => assertFails(getDoc(doc(as(ROOT), "goalConversations", "tgt_chan_aug")))
  );
  await check("nor can a stranger", () =>
    assertFails(getDoc(doc(as(OUTSIDER), "goalConversations", "tgt_chan_aug")))
  );
  await check("MANDATORY: nobody can accept a target from a browser", () =>
    assertFails(
      setDoc(doc(as(CHAN), "goalConversations", "tgt_chan_aug"), { status: "accepted" })
    )
  );
  await check("...and an upline cannot accept on their downline's behalf either", () =>
    assertFails(
      setDoc(doc(as(ASHA), "goalConversations", "tgt_chan_aug"), { status: "accepted" })
    )
  );

  // ---- No client writes -----------------------------------------------------
  await check("a coach cannot write their own sheet directly", () =>
    assertFails(setDoc(doc(as(CHAN), "goalSheets", CHAN), { why: "hacked" }))
  );
  await check("an upline cannot flip somebody else's sharing switch", () =>
    assertFails(setDoc(doc(as(ASHA), "goalSheets", CHAN), { shareNeeds: true }))
  );
  await check("nor write into the private half", () =>
    assertFails(
      setDoc(doc(as(ASHA), "goalSheets", CHAN, "private", "needs"), { needs: "x" })
    )
  );

  await env.cleanup();

  console.log(
    failures === 0
      ? `\nAll ${passes} goal-sheet privacy checks passed.\n`
      : `\n${failures} goal-sheet privacy check(s) FAILED.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\ngoals-rules crashed: ${(e as Error).message}\n`);
  process.exit(1);
});
