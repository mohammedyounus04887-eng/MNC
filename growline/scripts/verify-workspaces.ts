import "dotenv/config";
import { db } from "../src/lib/firebase-admin";
import { users } from "../src/lib/collections";
import { createUser, getUserById } from "../src/lib/users";
import {
  WORKSPACES,
  getMembership,
  getWorkspace,
  workspaceMemberDocId,
  workspaceMembers,
} from "../src/modules/workspaces/queries";

/**
 * Proves the two placement rules that make workspaces work at all:
 *
 *   joined WITH a referral code   → the sponsor's workspace, as a member
 *   joined WITHOUT one            → a workspace of their own, as its owner
 *
 * Neither is reachable from a unit test — both are properties of a Firestore transaction —
 * and neither is reachable from the rules tests, which check who may READ a workspace, not
 * who gets put in which. So they get their own script, like the re-parent verification.
 *
 * The failure mode is quiet, which is why it is worth a script: a coach placed in the
 * wrong workspace, or in none, still signs in and still sees their own screens. What
 * breaks is everything scoped — the wall, the boards, the qualifications — and it breaks
 * by showing nothing rather than by erroring.
 *
 * Fixtures are prefixed `vws_` and deleted at both ends, so this shares an emulator with
 * the seeded data without disturbing the e2e suite.
 */

const P = "vws_";
const SPONSOR = `${P}sponsor`;
const REFERRED = `${P}referred`;
const SOLO = `${P}solo`;

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function cleanup() {
  const ids = [SPONSOR, REFERRED, SOLO];
  const userDocs = await Promise.all(ids.map((id) => users().doc(id).get()));

  const jobs: Promise<unknown>[] = ids.map((id) => users().doc(id).delete());
  for (const snap of userDocs) {
    const ws = snap.data()?.workspaceId as string | undefined;
    if (ws) {
      jobs.push(workspaceMembers().doc(workspaceMemberDocId(ws, snap.id)).delete());
      // Only workspaces this script minted; never the founding one.
      if (ws.startsWith(P) || snap.id === SOLO || snap.id === SPONSOR) {
        jobs.push(db.collection(WORKSPACES).doc(ws).delete());
      }
    }
    const code = snap.data()?.referralCode as string | undefined;
    if (code) jobs.push(db.collection("referralCodes").doc(code).delete());
  }
  await Promise.all(jobs.map((j) => Promise.resolve(j).catch(() => {})));
}

async function main() {
  console.log("\nWorkspace placement\n");
  await cleanup();

  // --- An unsponsored signup starts its own organisation --------------------
  const sponsor = await createUser({
    uid: SPONSOR,
    phone: "+919700000001",
    name: "Sponsor",
    city: "Bengaluru",
    photoUrl: null,
    upline: null,
  });

  check("an unsponsored coach gets a workspace", Boolean(sponsor.workspaceId), sponsor.workspaceId);
  const sponsorWs = await getWorkspace(sponsor.workspaceId);
  check("the workspace document exists", sponsorWs !== null);
  check("they own it", sponsorWs?.ownerId === SPONSOR, sponsorWs?.ownerId);
  check(
    "it is named after them rather than left blank",
    (sponsorWs?.name ?? "").length > 0,
    sponsorWs?.name
  );
  check(
    "its level names start EMPTY — never pre-filled (RULES L8)",
    Array.isArray(sponsorWs?.levelGroups) && sponsorWs!.levelGroups.length === 0,
    JSON.stringify(sponsorWs?.levelGroups)
  );
  const sponsorMembership = await getMembership(sponsor.workspaceId, SPONSOR);
  check("their membership row says owner", sponsorMembership?.role === "owner");

  // --- A referred signup joins the SPONSOR's organisation -------------------
  const referred = await createUser({
    uid: REFERRED,
    phone: "+919700000002",
    name: "Referred",
    city: "Bengaluru",
    photoUrl: null,
    upline: sponsor,
  });

  check(
    "a referred coach lands in the sponsor's workspace, not a new one",
    referred.workspaceId === sponsor.workspaceId,
    `${referred.workspaceId} vs ${sponsor.workspaceId}`
  );
  const referredMembership = await getMembership(referred.workspaceId, REFERRED);
  check("their membership row says member, not owner", referredMembership?.role === "member");
  check(
    "no second workspace was created for them",
    (await db.collection(WORKSPACES).where("ownerId", "==", REFERRED).count().get()).data()
      .count === 0
  );

  // --- Two unsponsored coaches are NOT in the same organisation -------------
  const solo = await createUser({
    uid: SOLO,
    phone: "+919700000003",
    name: "Solo",
    city: "Mysuru",
    photoUrl: null,
    upline: null,
  });
  check(
    "two unsponsored coaches get SEPARATE workspaces — no shared default",
    solo.workspaceId !== sponsor.workspaceId,
    `${solo.workspaceId} vs ${sponsor.workspaceId}`
  );

  // --- Nobody is left without one ------------------------------------------
  const orphans = (await users().get()).docs.filter((d) => {
    const ws = d.data().workspaceId;
    return typeof ws !== "string" || ws.length === 0;
  });
  check(
    "no coach anywhere is left without a workspace",
    orphans.length === 0,
    orphans.map((d) => d.id).join(", ")
  );

  // The transaction wrote the user, so re-reading proves it persisted rather than
  // only existing on the object createUser returned.
  const reread = await getUserById(REFERRED);
  check("the workspace id persisted on the user document", reread?.workspaceId === sponsor.workspaceId);

  await cleanup();

  console.log(
    failures === 0
      ? `\nAll workspace placement checks passed.\n`
      : `\n${failures} workspace placement check(s) FAILED.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(`\nverify-workspaces crashed: ${(e as Error).message}\n`);
  await cleanup().catch(() => {});
  process.exit(1);
});
