/**
 * One-shot SQLite -> Firestore migration (BUILD_PROMPT_V2.md §3, PLAN_V2.1a.md).
 *
 *   npx tsx scripts/migrate-to-firestore.ts [--dry-run]
 *
 * Run it against the emulators first:
 *   npx firebase emulators:start --only auth,firestore
 *
 * ## The part that matters
 *
 * Firebase Auth normally mints its own uid at first sign-in. Every foreign key in
 * this database — coachId, userId, setById, requestedById — points at the user's
 * existing cuid, and migrated users do not sign in until *after* cutover, so that
 * uid does not exist yet at migration time.
 *
 * So we create the Auth users ourselves, with `uid` set to the existing cuid, keyed
 * by phone. Every foreign key stays valid untouched, and Security Rules get to
 * compare `request.auth.uid` directly with no lookup on any read of any collection.
 * Users still re-verify by SMS exactly as §3 says — they just land on the same id.
 *
 * The alternative (an authUid -> userId mapping collection) is a get() inside every
 * rule evaluation forever, to avoid this one script.
 */
// Must precede firebase-admin: that module reads the emulator host at load time,
// and tsx does not load .env the way `next` does.
import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Timestamp } from "firebase-admin/firestore";
import { PrismaClient } from "../src/generated/prisma/client";
import { auth, db, usingEmulators } from "../src/lib/firebase-admin";
import {
  COLLECTIONS,
  buildUplinePath,
  dailyLogDocId,
  prospectDocId,
  referralCodeDocId,
  reportDocId,
  targetDocId,
} from "../src/lib/collections";
import { APP_TIMEZONE, dayKey } from "../src/lib/day";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_LIMIT = 400; // Firestore caps a batch at 500; leave headroom.

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" }),
});

const ts = (d: Date | null | undefined) => (d ? Timestamp.fromDate(d) : null);

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function writeAll(
  collection: string,
  docs: { id: string | null; data: Record<string, unknown> }[]
) {
  if (DRY_RUN) return;
  for (const group of chunk(docs, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const { id, data } of group) {
      const ref = id
        ? db.collection(collection).doc(id)
        : db.collection(collection).doc();
      batch.set(ref, data);
    }
    await batch.commit();
  }
}

async function main() {
  if (!usingEmulators && !process.env.MIGRATE_ALLOW_PRODUCTION) {
    throw new Error(
      "Refusing to run against a real Firebase project. Start the emulators, or " +
        "set MIGRATE_ALLOW_PRODUCTION=1 deliberately once the parity gate has passed."
    );
  }
  console.log(
    `\nMigrating -> ${usingEmulators ? "EMULATOR" : "PRODUCTION"}${DRY_RUN ? " (dry run)" : ""}\n`
  );

  const [allUsers, allProspects, allReports, allLogs, allTargets, allProofs] =
    await Promise.all([
      prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.prospect.findMany(),
      prisma.report.findMany(),
      prisma.dailyLog.findMany(),
      prisma.target.findMany(),
      prisma.proof.findMany(),
    ]);

  // ---- uplinePath, computed once for every user -------------------------------
  const uplineById = new Map(allUsers.map((u) => [u.id, u.uplineId]));
  const pathById = new Map(allUsers.map((u) => [u.id, buildUplinePath(u.id, uplineById)]));

  const directCount = new Map<string, number>();
  for (const u of allUsers) {
    if (u.uplineId) directCount.set(u.uplineId, (directCount.get(u.uplineId) ?? 0) + 1);
  }

  // ---- Auth users, uid = existing cuid ----------------------------------------
  //
  // importUsers() is NOT an upsert — it fails with "localId belongs to an existing
  // account" rather than overwriting. Verified against the emulator. Without the
  // skip below, a migration interrupted after this step could never be re-run: the
  // Auth import would fail every time and nothing downstream would execute. A
  // one-shot migration that cannot be resumed after a partial failure is a trap,
  // so existing uids are looked up first and only the missing ones are created.
  //
  // The Firestore writes are already idempotent — batch.set() on a deterministic
  // id is an upsert — so with this in place the whole script is safe to re-run.
  let created = 0;
  let skipped = 0;
  if (!DRY_RUN) {
    const existing = new Set<string>();
    for (const group of chunk(allUsers, 100)) {
      // getUsers accepts at most 100 identifiers per call.
      const found = await auth.getUsers(group.map((u) => ({ uid: u.id })));
      for (const u of found.users) existing.add(u.uid);
    }

    const missing = allUsers.filter((u) => !existing.has(u.id));
    skipped = allUsers.length - missing.length;

    for (const group of chunk(missing, 1000)) {
      const result = await auth.importUsers(
        group.map((u) => ({ uid: u.id, phoneNumber: u.phone, displayName: u.name }))
      );
      if (result.failureCount > 0) {
        for (const e of result.errors) {
          console.error(`  auth import failed for ${group[e.index].phone}: ${e.error.message}`);
        }
        throw new Error(
          `${result.failureCount} Auth user(s) failed to import. No Firestore ` +
            `documents have been written; fix the cause and re-run.`
        );
      }
      created += group.length;
    }
  }
  console.log(
    `  auth users:      ${allUsers.length} total — ${created} created, ${skipped} already present`
  );

  // ---- Firestore documents ----------------------------------------------------
  await writeAll(
    COLLECTIONS.users,
    allUsers.map((u) => ({
      id: u.id,
      data: {
        phone: u.phone,
        name: u.name,
        photoUrl: u.photoUrl,
        city: u.city,
        referralCode: u.referralCode,
        levelName: u.levelName,
        uplineId: u.uplineId,
        uplinePath: pathById.get(u.id) ?? [],
        directDownlineCount: directCount.get(u.id) ?? 0,
        shareProspects: u.shareProspects,
        plan: u.plan,
        trialEndsAt: ts(u.trialEndsAt),
        followupPushOn: u.followupPushOn,
        createdAt: ts(u.createdAt),
      },
    }))
  );

  // ---- Referral-code reservations (D41) ---------------------------------------
  //
  // Every existing code needs its claim document, or `/join/<code>` stops
  // resolving for migrated coaches: getUserByReferralCode reads the reservation
  // now, not a query over users. Duplicate codes in the source would collapse to
  // one claim here, so they are surfaced rather than silently merged.
  const codeOwners = new Map<string, string[]>();
  for (const u of allUsers) {
    const key = referralCodeDocId(u.referralCode);
    codeOwners.set(key, [...(codeOwners.get(key) ?? []), u.id]);
  }
  const collisions = [...codeOwners].filter(([, owners]) => owners.length > 1);
  if (collisions.length > 0) {
    throw new Error(
      `Referral codes are not unique in the source database, so they cannot all be ` +
        `claimed: ${collisions
          .map(([code, owners]) => `${code} -> ${owners.join(", ")}`)
          .join("; ")}. Fix the source rows first.`
    );
  }
  await writeAll(
    COLLECTIONS.referralCodes,
    [...codeOwners].map(([code, owners]) => ({
      id: code,
      data: { uid: owners[0], createdAt: Timestamp.now() },
    }))
  );

  await writeAll(
    COLLECTIONS.prospects,
    allProspects.map((p) => ({
      // D6 survives as a deterministic id; QR self-fills keep an auto-id.
      id: prospectDocId(p.coachId, p.clientId) ?? p.id,
      data: {
        coachId: p.coachId,
        coachUplinePath: pathById.get(p.coachId) ?? [],
        clientId: p.clientId,
        name: p.name,
        phone: p.phone,
        age: p.age,
        gender: p.gender,
        heightCm: p.heightCm,
        weightKg: p.weightKg,
        stage: p.stage,
        nextFollowupAt: ts(p.nextFollowupAt),
        source: p.source,
        notes: p.notes,
        /**
         * NOT backfilled, deliberately.
         *
         * These rows predate the consent tick (RULES P6), so no consent was recorded for
         * them. Writing a timestamp here would invent evidence — and the whole point of
         * storing a date is that it can be corroborated. Null reads as "not recorded",
         * which is the truth, and the 180-day health-data purge covers them regardless.
         */
        consentAt: null,
        createdAt: ts(p.createdAt),
        legacyId: p.id, // lets reports resolve their prospect after the id change
      },
    }))
  );

  const coachByProspect = new Map(allProspects.map((p) => [p.id, p.coachId]));
  const prospectDocIdByLegacy = new Map(
    allProspects.map((p) => [p.id, prospectDocId(p.coachId, p.clientId) ?? p.id])
  );

  await writeAll(
    COLLECTIONS.reports,
    allReports.map((r) => ({
      id: reportDocId(prospectDocIdByLegacy.get(r.prospectId) ?? r.prospectId, r.inputsHash),
      data: {
        prospectId: prospectDocIdByLegacy.get(r.prospectId) ?? r.prospectId,
        coachId: coachByProspect.get(r.prospectId) ?? null,
        token: r.token,
        metricsJson: r.metricsJson,
        inputsHash: r.inputsHash,
        sentAt: ts(r.sentAt),
        createdAt: ts(r.createdAt),
      },
    }))
  );

  await writeAll(
    COLLECTIONS.dailyLogs,
    allLogs.map((l) => {
      const key = dayKey(l.logDate, APP_TIMEZONE);
      return {
        id: dailyLogDocId(l.userId, key),
        data: {
          userId: l.userId,
          dayKey: key,
          logDate: ts(l.logDate),
          uplinePath: pathById.get(l.userId) ?? [],
          servings: l.servings,
          memberships: l.memberships,
          sessions: l.sessions,
          invites: l.invites,
          followupsDone: l.followupsDone,
          note: l.note,
          createdAt: ts(l.createdAt),
        },
      };
    })
  );

  await writeAll(
    COLLECTIONS.targets,
    allTargets.map((t) => ({
      id: targetDocId(t.coachId, t.month),
      data: {
        coachId: t.coachId,
        setById: t.setById,
        uplinePath: pathById.get(t.coachId) ?? [],
        month: t.month,
        targetPoints: t.targetPoints,
        progressPoints: t.progressPoints,
        status: t.status,
        createdAt: ts(t.createdAt),
        updatedAt: ts(t.updatedAt),
      },
    }))
  );

  const coachByTarget = new Map(allTargets.map((t) => [t.id, t.coachId]));
  const targetDocIdByLegacy = new Map(
    allTargets.map((t) => [t.id, targetDocId(t.coachId, t.month)])
  );

  await writeAll(
    COLLECTIONS.proofs,
    allProofs.map((p) => ({
      id: p.id,
      data: {
        targetId: targetDocIdByLegacy.get(p.targetId) ?? p.targetId,
        coachId: coachByTarget.get(p.targetId) ?? null,
        requestedById: p.requestedById,
        requestNote: p.requestNote,
        status: p.status,
        mediaUrl: p.mediaUrl,
        submitNote: p.submitNote,
        comment: p.comment,
        createdAt: ts(p.createdAt),
        submittedAt: ts(p.submittedAt),
        reviewedAt: ts(p.reviewedAt),
      },
    }))
  );

  // ---- Parity gate: counts must match, per §3 ---------------------------------
  const expected: Record<string, number> = {
    [COLLECTIONS.users]: allUsers.length,
    [COLLECTIONS.prospects]: allProspects.length,
    [COLLECTIONS.reports]: allReports.length,
    [COLLECTIONS.dailyLogs]: allLogs.length,
    [COLLECTIONS.targets]: allTargets.length,
    [COLLECTIONS.proofs]: allProofs.length,
  };

  if (DRY_RUN) {
    console.log("\n  dry run — source counts only:", expected, "\n");
    return;
  }

  console.log("\n  collection        source   firestore");
  let failed = 0;
  for (const [name, want] of Object.entries(expected)) {
    const got = (await db.collection(name).count().get()).data().count;
    const ok = got === want;
    if (!ok) failed++;
    console.log(
      `  ${name.padEnd(16)}  ${String(want).padStart(5)}   ${String(got).padStart(6)}  ${ok ? "ok" : "MISMATCH"}`
    );
  }

  // A mismatch here is usually two source rows colliding on one deterministic id —
  // which is the constraint doing its job, not a bug to paper over. Investigate the
  // duplicate rather than switching the collection to auto-ids.
  if (failed > 0) throw new Error(`${failed} collection(s) did not match. NOT safe to cut over.`);
  console.log("\n  All collections match.\n");
}

main()
  .catch((e) => {
    console.error("\nMigration failed:", e.message ?? e, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
