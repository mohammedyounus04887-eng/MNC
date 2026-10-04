// Must precede anything touching firebase-admin: `resolveTarget()` runs at module scope
// (D45) and throws unless a credential or the full emulator pair is in the env.
import "dotenv/config";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../src/lib/firebase-admin";
import { users } from "../src/lib/collections";
import { FOUNDING_WORKSPACE_ID } from "../src/modules/workspaces/model";
import {
  WORKSPACES,
  workspaceMemberDocId,
  workspaceMembers,
} from "../src/modules/workspaces/queries";

/**
 * Places every pre-existing coach into the founding workspace.
 *
 * Workspaces arrived after the users did, so every row written before them has no
 * `workspaceId`. That is not a cosmetic gap: the boundary fails CLOSED, so an unassigned
 * coach matches no workspace-scoped rule and no workspace-scoped query — present in the
 * database and absent from the product. This is the script that makes sure none stays
 * that way.
 *
 * A separate script rather than a change to `migrate-to-firestore.ts`, because that one
 * is the SQLite cutover and has already run; this has to work against a Firestore that is
 * already live.
 *
 * **Idempotent.** It only ever writes a user who has no `workspaceId`, and `set` on the
 * workspace and membership documents converges rather than duplicating. Run it as often
 * as you like — after a deploy, after a restore, or when `--check` says it is needed.
 *
 *   npx tsx scripts/backfill-workspaces.ts            apply
 *   npx tsx scripts/backfill-workspaces.ts --check    report only, exit 1 if work remains
 */

const BATCH_LIMIT = 400;
const checkOnly = process.argv.includes("--check");

/**
 * Who owns the founding workspace.
 *
 * The earliest coach with no upline — the root of the original tree, which is the person
 * whose organisation this actually is. Falling back to the earliest coach overall covers a
 * database where every row somehow has an upline; an owner that is wrong is still better
 * than a workspace nobody can administer.
 */
async function pickOwner(): Promise<string | null> {
  const roots = await users()
    .where("uplineId", "==", null)
    .orderBy("createdAt", "asc")
    .limit(1)
    .get();
  if (!roots.empty) return roots.docs[0].id;

  const anyone = await users().orderBy("createdAt", "asc").limit(1).get();
  return anyone.empty ? null : anyone.docs[0].id;
}

async function main() {
  console.log(`\nWorkspace backfill${checkOnly ? " (check only)" : ""}\n`);

  const all = await users().get();
  if (all.empty) {
    console.log("  no users — nothing to do\n");
    return;
  }

  const unassigned = all.docs.filter((d) => {
    const ws = d.data().workspaceId;
    return typeof ws !== "string" || ws.length === 0;
  });

  console.log(`  users total       ${all.size}`);
  console.log(`  already assigned  ${all.size - unassigned.length}`);
  console.log(`  to assign         ${unassigned.length}`);

  if (checkOnly) {
    console.log(
      unassigned.length === 0
        ? "\n  Every coach has a workspace.\n"
        : `\n  ${unassigned.length} coach(es) have no workspace. Run without --check.\n`
    );
    process.exit(unassigned.length === 0 ? 0 : 1);
  }

  if (unassigned.length === 0) {
    console.log("\n  Every coach already has a workspace — nothing written.\n");
    return;
  }

  const ownerId = await pickOwner();
  if (!ownerId) {
    throw new Error("Could not choose an owner for the founding workspace.");
  }

  // `set` with merge:false is deliberate on a fresh workspace but must not clobber one
  // that already exists with a name somebody has since edited — so create only if absent.
  const wsRef = db.collection(WORKSPACES).doc(FOUNDING_WORKSPACE_ID);
  const existing = await wsRef.get();
  if (!existing.exists) {
    await wsRef.set({
      name: "Growline",
      accent: "gold",
      // Empty, always — RULES L8. A level name exists only because a human typed it.
      levelGroups: [],
      ownerId,
      createdAt: Timestamp.now(),
    });
    console.log(`  created workspace ${FOUNDING_WORKSPACE_ID} owned by ${ownerId}`);
  } else {
    console.log(`  workspace ${FOUNDING_WORKSPACE_ID} already exists — left as is`);
  }

  let written = 0;
  let batch = db.batch();
  let inBatch = 0;

  for (const userDoc of unassigned) {
    batch.update(userDoc.ref, { workspaceId: FOUNDING_WORKSPACE_ID });
    batch.set(
      workspaceMembers().doc(workspaceMemberDocId(FOUNDING_WORKSPACE_ID, userDoc.id)),
      {
        workspaceId: FOUNDING_WORKSPACE_ID,
        userId: userDoc.id,
        role: userDoc.id === ownerId ? "owner" : "member",
        joinedAt: userDoc.data().createdAt ?? Timestamp.now(),
      }
    );
    written++;
    // Two writes per user, so the batch ceiling is halved.
    inBatch += 2;
    if (inBatch >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();

  console.log(`  assigned          ${written}`);
  console.log(`\n  Done. Re-run with --check to confirm nothing is left.\n`);
}

main().catch((e) => {
  console.error(`\nbackfill-workspaces failed: ${(e as Error).message}\n`);
  process.exit(1);
});
