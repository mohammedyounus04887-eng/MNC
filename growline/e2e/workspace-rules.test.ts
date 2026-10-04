import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, query, where, setDoc } from "firebase/firestore";

/**
 * Workspace isolation — the property the whole multi-tenant design rests on.
 *
 * The requirement is "a user in workspace A cannot read anything in workspace B", and the
 * only way that test is worth anything is if the SAME reads succeed inside A. A suite that
 * only ever asserts failure would pass just as happily against a deny-all ruleset, and
 * would keep passing after somebody accidentally denied the app its own data — so every
 * denial here is paired with the permission it is the mirror of.
 */

const WS_A = "ws_alpha";
const WS_B = "ws_beta";

const ALICE = "usr_alice"; // workspace A, owner
const AMIT = "usr_amit"; // workspace A, member
const BINA = "usr_bina"; // workspace B, owner
const NOBODY = "usr_nobody"; // no workspaceId at all — a row the backfill missed

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
    projectId: "growline-workspace-rules",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: Number((process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":").at(-1)),
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, "users", ALICE), {
      name: "Alice", workspaceId: WS_A, uplineId: null, uplinePath: [], shareProspects: false,
    });
    await setDoc(doc(db, "users", AMIT), {
      name: "Amit", workspaceId: WS_A, uplineId: ALICE, uplinePath: [ALICE], shareProspects: false,
    });
    await setDoc(doc(db, "users", BINA), {
      name: "Bina", workspaceId: WS_B, uplineId: null, uplinePath: [], shareProspects: false,
    });
    // Deliberately has NO workspaceId — the state the backfill exists to remove, and the
    // one where a boundary check must fail closed rather than match everything.
    await setDoc(doc(db, "users", NOBODY), {
      name: "Nobody", uplineId: null, uplinePath: [], shareProspects: false,
    });

    await setDoc(doc(db, "workspaces", WS_A), {
      name: "Alpha Group", accent: "gold", levelGroups: [], ownerId: ALICE,
    });
    await setDoc(doc(db, "workspaces", WS_B), {
      name: "Beta Group", accent: "info", levelGroups: [], ownerId: BINA,
    });

    await setDoc(doc(db, "workspaceMembers", `${WS_A}__${ALICE}`), {
      workspaceId: WS_A, userId: ALICE, role: "owner",
    });
    await setDoc(doc(db, "workspaceMembers", `${WS_A}__${AMIT}`), {
      workspaceId: WS_A, userId: AMIT, role: "member",
    });
    await setDoc(doc(db, "workspaceMembers", `${WS_B}__${BINA}`), {
      workspaceId: WS_B, userId: BINA, role: "owner",
    });
  });

  const as = (uid: string) => env.authenticatedContext(uid).firestore();
  const anon = () => env.unauthenticatedContext().firestore();

  console.log("\nWorkspace isolation\n");

  // ---- The permissions the denials below are the mirror of ------------------
  // Without these, every "cannot read B" assertion would pass against a deny-all
  // ruleset and prove nothing.
  await check("a coach reads their OWN workspace", () =>
    assertSucceeds(getDoc(doc(as(ALICE), "workspaces", WS_A)))
  );
  await check("...and so does an ordinary member of it", () =>
    assertSucceeds(getDoc(doc(as(AMIT), "workspaces", WS_A)))
  );
  await check("a coach lists the members of their own workspace", () =>
    assertSucceeds(
      getDocs(
        query(collection(as(ALICE), "workspaceMembers"), where("workspaceId", "==", WS_A))
      )
    )
  );

  // ---- THE ISOLATION ASSERTIONS ---------------------------------------------
  await check("MANDATORY: a coach in A cannot read workspace B", () =>
    assertFails(getDoc(doc(as(ALICE), "workspaces", WS_B)))
  );
  await check("MANDATORY: nor can a member of A", () =>
    assertFails(getDoc(doc(as(AMIT), "workspaces", WS_B)))
  );
  await check("MANDATORY: and B cannot read A — the boundary is symmetric", () =>
    assertFails(getDoc(doc(as(BINA), "workspaces", WS_A)))
  );
  await check("a coach in A cannot read a membership row from B", () =>
    assertFails(getDoc(doc(as(ALICE), "workspaceMembers", `${WS_B}__${BINA}`)))
  );
  await check("nor list B's members by filtering for them", () =>
    assertFails(
      getDocs(
        query(collection(as(ALICE), "workspaceMembers"), where("workspaceId", "==", WS_B))
      )
    )
  );
  await check("nor list every membership across all organisations", () =>
    assertFails(getDocs(collection(as(ALICE), "workspaceMembers")))
  );
  await check("there is no query that returns every workspace", () =>
    assertFails(getDocs(collection(as(ALICE), "workspaces")))
  );

  // ---- Fail closed on a missing boundary ------------------------------------
  // A user the backfill never reached has no workspaceId. That must match NOTHING,
  // rather than matching every document whose field is also absent.
  await check("a user with no workspaceId reads no workspace at all", () =>
    assertFails(getDoc(doc(as(NOBODY), "workspaces", WS_A)))
  );
  await check("...not even one whose id they might guess", () =>
    assertFails(getDoc(doc(as(NOBODY), "workspaces", WS_B)))
  );
  await check("a signed-out visitor reads nothing", () =>
    assertFails(getDoc(doc(anon(), "workspaces", WS_A)))
  );

  // ---- No client writes: the boundary cannot be moved from a browser --------
  await check("a coach cannot move themselves into another organisation", () =>
    assertFails(setDoc(doc(as(AMIT), "users", AMIT), { workspaceId: WS_B }))
  );
  await check("a coach cannot rewrite their own workspace", () =>
    assertFails(setDoc(doc(as(ALICE), "workspaces", WS_A), { name: "Renamed" }))
  );
  await check("...nor forge a membership into somebody else's", () =>
    assertFails(
      setDoc(doc(as(ALICE), "workspaceMembers", `${WS_B}__${ALICE}`), {
        workspaceId: WS_B, userId: ALICE, role: "owner",
      })
    )
  );

  await env.cleanup();

  console.log(
    failures === 0
      ? `\nAll ${passes} workspace isolation checks passed.\n`
      : `\n${failures} workspace isolation check(s) FAILED.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nworkspace-rules crashed: ${(e as Error).message}\n`);
  process.exit(1);
});
