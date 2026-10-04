import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, collection, getDocs, query, where } from "firebase/firestore";

/**
 * Recognition Wall (Feature B) — the collection is server-only, and this proves it.
 *
 * `recognitions` and `wallPrefs` have NO block in firestore.rules, so Firestore's default
 * deny covers them. That is deliberate (every read goes through the admin SDK in a server
 * component), but "we meant to leave it out" and "we forgot" look identical in a rules
 * file — so this suite pins the intent. If somebody later adds a client-side listener and
 * opens the collection, these fail and force the decision to be conscious.
 *
 * The suite deliberately asserts a PERMITTED read too. A file of nothing but denials
 * passes just as well against a rules file that denies everything, including the things
 * the app needs — so the workspaceMembers check is here as the control that proves the
 * emulator is loading real rules.
 */

const ASHA = "usr_asha";
const CHAN = "usr_chan";
const OUTSIDER = "usr_outsider";
const WS_A = "ws_a";
const WS_B = "ws_b";

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
    projectId: "growline-wall-rules",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: Number((process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":").at(-1)),
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", ASHA), { name: "Asha", workspaceId: WS_A, uplinePath: [] });
    await setDoc(doc(db, "users", CHAN), { name: "Chandan", workspaceId: WS_A, uplinePath: [ASHA] });
    await setDoc(doc(db, "users", OUTSIDER), { name: "Outsider", workspaceId: WS_B, uplinePath: [] });

    await setDoc(doc(db, "recognitions", "card1"), {
      workspaceId: WS_A,
      earnerId: ASHA,
      earnerName: "Asha",
      kind: "streak",
      value: 30,
      claps: 2,
    });
    await setDoc(doc(db, "recognitions", "card1", "claps", CHAN), { at: 1 });
    await setDoc(doc(db, "wallPrefs", ASHA), { optOut: false });

    // The control: a real permission this suite can prove still works.
    await setDoc(doc(db, "workspaceMembers", `${WS_A}__${ASHA}`), {
      workspaceId: WS_A,
      userId: ASHA,
      role: "owner",
    });
  });

  const as = (uid: string) => env.authenticatedContext(uid).firestore();
  const anon = () => env.unauthenticatedContext().firestore();

  console.log("\nRecognition Wall — server-only\n");

  // ---- The control, so a deny-all rules file cannot pass this suite -----------
  await check("CONTROL: a coach can still list their own workspace's members", () =>
    assertSucceeds(
      getDocs(
        query(collection(as(ASHA), "workspaceMembers"), where("workspaceId", "==", WS_A))
      )
    )
  );

  // ---- Cards are unreadable from any browser ---------------------------------
  await check("MANDATORY: the earner cannot read their own card from a browser", () =>
    assertFails(getDoc(doc(as(ASHA), "recognitions", "card1")))
  );
  await check("nor can a workspace-mate", () =>
    assertFails(getDoc(doc(as(CHAN), "recognitions", "card1")))
  );
  await check("nor can somebody in another workspace", () =>
    assertFails(getDoc(doc(as(OUTSIDER), "recognitions", "card1")))
  );
  await check("nor a signed-out visitor", () =>
    assertFails(getDoc(doc(anon(), "recognitions", "card1")))
  );
  await check("a workspace-scoped LIST is refused too, not just the document read", () =>
    assertFails(
      getDocs(query(collection(as(CHAN), "recognitions"), where("workspaceId", "==", WS_A)))
    )
  );

  // ---- Nobody can mint a card or a clap from a browser -----------------------
  await check("MANDATORY: a coach cannot mint themselves a card", () =>
    assertFails(
      setDoc(doc(as(ASHA), "recognitions", "forged"), {
        workspaceId: WS_A,
        earnerId: ASHA,
        kind: "target-reached",
        value: 999999,
      })
    )
  );
  await check("...and cannot inflate the clap count on a real one", () =>
    assertFails(setDoc(doc(as(CHAN), "recognitions", "card1"), { claps: 500 }))
  );
  await check("a clap document cannot be written directly", () =>
    assertFails(setDoc(doc(as(OUTSIDER), "recognitions", "card1", "claps", OUTSIDER), { at: 1 }))
  );

  // ---- The opt-out is server-written too ------------------------------------
  await check("MANDATORY: nobody can put another coach back on the wall", () =>
    assertFails(setDoc(doc(as(CHAN), "wallPrefs", ASHA), { optOut: false }))
  );
  await check("nor read somebody else's wall preference", () =>
    assertFails(getDoc(doc(as(CHAN), "wallPrefs", ASHA)))
  );

  await env.cleanup();

  console.log(
    failures === 0
      ? `\nAll ${passes} wall rules checks passed.\n`
      : `\n${failures} wall rules check(s) FAILED.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nwall-rules crashed: ${(e as Error).message}\n`);
  process.exit(1);
});
