/**
 * Security Rules tests for `leaderboardSnapshots` (F13).
 *
 *   npm run test:rules:boards
 *
 * House style (e2e/rules.test.ts): real authenticated clients against the emulator
 * with the real rules file, and every check states the rule it defends and why.
 *
 * ## The two that matter most
 *
 * MANDATORY — the roster document is unreadable by everybody. It holds the full
 * ordering, bottom included, and the participant count. The brief's hardest
 * requirement is that a coach in last place can never learn it, and the only way to
 * make that true rather than merely rendered is for the ordering not to be
 * obtainable from a browser at all. The screen slices each coach's upward-only
 * window out of this document on the server.
 *
 * MANDATORY — a coach cannot read a board for a group they are not in. That is P1's
 * shape applied sideways: activity counts flow up a line, but a leaderboard is read
 * across one, so "who is in this group" has to be decided by the rules and not by
 * whichever query the client felt like sending.
 *
 * Membership is resolved from the CURRENT user document, never from anything stored
 * on the snapshot — D64's finding, which is why the fixture below never puts a
 * `uplinePath` on a board document for the rule to trust.
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
  where,
} from "firebase/firestore";

const ROOT = "usr_root"; // root of org A. No level name, city Bengaluru.
const ASHA = "usr_asha"; // ROOT's downline. Level "Team Leader", city Bengaluru.
const BHAV = "usr_bhav"; // ROOT's other downline. No level name, city Mysuru.
const CHAN = "usr_chan"; // ASHA's downline. Level " team leader " — spacing and case differ.
const OUTSIDER = "usr_outsider"; // root of org B. Same city as ASHA.

const C = "leaderboardSnapshots";

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
    projectId: "growline-leaderboards-rules",
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
      // Deliberately spaced and cased differently from Asha's. The scope key is
      // trim().lower() of what a coach typed, and the rule has to restate exactly
      // that or the two of them end up in different groups (RULES L8: the names are
      // theirs, so the app cannot tidy them into a canonical list).
      levelName: "  team leader  ", city: "Mysuru",
    });
    await setDoc(doc(db, "users", OUTSIDER), {
      name: "Outsider", uplineId: null, uplinePath: [], shareProspects: true,
      levelName: "Team Leader", city: "Bengaluru",
    });

    const entries = [
      { userId: ASHA, name: "Asha", value: 40, rank: 1 },
      { userId: CHAN, name: "Chandan", value: 20, rank: 2 },
      { userId: BHAV, name: "Bhavana", value: 5, rank: 3 },
    ];
    const board = {
      metric: "peopleMet", window: "monthly", periodKey: "2026-08",
      scopeLabel: "Organisation", entries,
    };

    await setDoc(doc(db, C, "pod_org"), {
      ...board, kind: "podium", scopeType: "org", scopeKey: ROOT,
    });
    await setDoc(doc(db, C, "ros_org"), {
      ...board, kind: "roster", scopeType: "org", scopeKey: ROOT, participantCount: 12,
    });
    await setDoc(doc(db, C, "pod_line_asha"), {
      ...board, kind: "podium", scopeType: "line", scopeKey: ASHA,
    });
    await setDoc(doc(db, C, "pod_level"), {
      ...board, kind: "podium", scopeType: "level", scopeKey: "team leader",
    });
    await setDoc(doc(db, C, "pod_club"), {
      ...board, kind: "podium", scopeType: "club", scopeKey: "bengaluru",
    });
    await setDoc(doc(db, C, "opt_usr_asha"), { kind: "optOut", userId: ASHA });
    for (const row of (await getDocs(collection(db, "users"))).docs) await setDoc(row.ref, { workspaceId: row.id === OUTSIDER ? "other-workspace" : "rules-workspace" }, { merge: true });
    for (const row of (await getDocs(collection(db, C))).docs) if (row.get("kind") !== "optOut") await setDoc(row.ref, { workspaceId: "rules-workspace" }, { merge: true });
    await setDoc(doc(db, C, "pod_legacy"), { kind: "podium", scopeType: "club", scopeKey: "bengaluru" });
  });

  const as = (uid: string) => env.authenticatedContext(uid).firestore();
  const anon = () => env.unauthenticatedContext().firestore();

  console.log("\nSecurity Rules — leaderboards\n");

  // ---- MANDATORY: the full ordering never reaches a browser -------------------
  /**
   * The roster carries every coach in rank order and the participant count. Between
   * them those two facts are "you are last", so the guarantee cannot live in the
   * component that chooses what to render — it has to be that the document is not
   * fetchable. Denied even to the coach at the top of it, who has nothing to lose by
   * reading it: a grant with an exception is a grant somebody will widen.
   */
  await check("MANDATORY: nobody can read the roster — not a member of the scope", () =>
    assertFails(getDoc(doc(as(ASHA), C, "ros_org")))
  );
  await check("...not the coach ranked first on it", () =>
    assertFails(getDoc(doc(as(ASHA), C, "ros_org")))
  );
  await check("...and not by listing rosters instead of fetching one", () =>
    assertFails(
      getDocs(query(collection(as(ASHA), C), where("kind", "==", "roster")))
    )
  );
  await check("...nor by an unfiltered listing of the whole collection", () =>
    assertFails(getDocs(collection(as(ASHA), C)))
  );

  // ---- MANDATORY: a board is readable only inside its own group ---------------
  await check("MANDATORY: a coach in another organisation cannot read this org board", () =>
    assertFails(getDoc(doc(as(OUTSIDER), C, "pod_org")))
  );
  await check("a coach reads their own organisation's board", () =>
    assertSucceeds(getDoc(doc(as(ASHA), C, "pod_org")))
  );
  await check("so does the deepest downline in it", () =>
    assertSucceeds(getDoc(doc(as(CHAN), C, "pod_org")))
  );
  await check("and the root, whose own uplinePath is empty", () =>
    // The branch a future edit is most likely to break: a root coach IS their own
    // organisation, so membership cannot be read off the last ancestor there.
    assertSucceeds(getDoc(doc(as(ROOT), C, "pod_org")))
  );

  // ---- Line boards ------------------------------------------------------------
  await check("the owner of a line reads their line's board", () =>
    assertSucceeds(getDoc(doc(as(ASHA), C, "pod_line_asha")))
  );
  await check("somebody inside that line reads it", () =>
    assertSucceeds(getDoc(doc(as(CHAN), C, "pod_line_asha")))
  );
  /**
   * An upline is ABOVE a line, not IN it, and the rule says so.
   *
   * This looks like it might be a privacy regression — activity flows up (P1), so why
   * is ROOT refused a board about their own downlines? Because ROOT loses nothing:
   * their own "My team" board is Asha's line plus everyone else beneath them, a strict
   * superset, and the team tree already shows these counts coach by coach. The only
   * thing the grant would add is a second document lookup in the rule to prove a
   * containment nobody asked for.
   */
  await check("an upline is above the line, not in it, and is refused this board", () =>
    assertFails(getDoc(doc(as(ROOT), C, "pod_line_asha")))
  );
  await check("a sibling on another branch cannot", () =>
    assertFails(getDoc(doc(as(BHAV), C, "pod_line_asha")))
  );

  // ---- Level groups: free text, normalised the same way in both places --------
  await check("a coach whose level name matches after trim and lower reads the board", () =>
    assertSucceeds(getDoc(doc(as(CHAN), C, "pod_level")))
  );
  await check("...as does the coach who typed it in title case", () =>
    assertSucceeds(getDoc(doc(as(ASHA), C, "pod_level")))
  );
  await check("a coach with no level name has no level group, and is refused", () =>
    assertFails(getDoc(doc(as(BHAV), C, "pod_level")))
  );

  // ---- City ("club") ----------------------------------------------------------
  await check("a coach in the city reads that city's board", () =>
    assertSucceeds(getDoc(doc(as(ASHA), C, "pod_club")))
  );
  await check("a coach in another city cannot", () =>
    assertFails(getDoc(doc(as(CHAN), C, "pod_club")))
  );
  await check("same city in another workspace cannot access this board", () =>
    assertFails(getDoc(doc(as(OUTSIDER), C, "pod_club")))
  );

  await check("a legacy board without workspace proof is denied", () => assertFails(getDoc(doc(as(ASHA), C, "pod_legacy"))));

  // ---- Opt-outs are not a directory ------------------------------------------
  await check("a coach reads their own opt-out", () =>
    assertSucceeds(getDoc(doc(as(ASHA), C, "opt_usr_asha")))
  );
  await check("their upline cannot — who opted out is not a list to collect", () =>
    assertFails(getDoc(doc(as(ROOT), C, "opt_usr_asha")))
  );
  await check("nor can a stranger", () =>
    assertFails(getDoc(doc(as(OUTSIDER), C, "opt_usr_asha")))
  );
  await check("and they cannot be listed as a group", () =>
    assertFails(getDocs(query(collection(as(ROOT), C), where("kind", "==", "optOut"))))
  );

  // ---- Nothing is client-writable --------------------------------------------
  await check("a coach cannot publish a board with themselves at the top", () =>
    assertFails(
      setDoc(doc(as(CHAN), C, "pod_forged"), {
        kind: "podium", scopeType: "org", scopeKey: ROOT,
        entries: [{ userId: CHAN, name: "Chandan", value: 9999, rank: 1 }],
      })
    )
  );
  await check("...nor overwrite the real one", () =>
    assertFails(setDoc(doc(as(CHAN), C, "pod_org"), { kind: "podium" }))
  );
  await check("a coach cannot write their own opt-out directly — the route does it", () =>
    assertFails(setDoc(doc(as(CHAN), C, "opt_usr_chan"), { kind: "optOut", userId: CHAN }))
  );
  await check("a coach cannot delete somebody else's opt-out and re-list them", () =>
    assertFails(deleteDoc(doc(as(ROOT), C, "opt_usr_asha")))
  );

  // ---- Signed out --------------------------------------------------------------
  await check("an unauthenticated client reads no board at all", () =>
    assertFails(getDoc(doc(anon(), C, "pod_org")))
  );

  await env.cleanup();
  console.log(
    failures === 0
      ? `\nAll ${passes} leaderboard rules checks passed.\n`
      : `\n${failures} leaderboard rules check(s) FAILED.\n`
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
