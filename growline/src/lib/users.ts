import { randomInt } from "crypto";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import {
  COLLECTIONS,
  referralCodeDocId,
  referralCodes,
  users,
} from "./collections";
import {
  workspaces,
  writeMembership,
  writeWorkspace,
} from "@/modules/workspaces/queries";

/**
 * User reads and writes against Firestore.
 *
 * `AppUser` is deliberately shape-compatible with the Prisma `User` model it
 * replaces — same field names, `Date` rather than `Timestamp` — so the nine
 * screens calling `getSessionUser()` need no changes at all. It adds `uplinePath`
 * and `directDownlineCount`, which Prisma had no equivalent of (D36).
 */

export type AppUser = {
  id: string;
  phone: string;
  name: string;
  photoUrl: string | null;
  city: string | null;
  uplineId: string | null;
  uplinePath: string[];
  directDownlineCount: number;
  /**
   * The organisation this coach belongs to. Exactly one, always.
   *
   * Empty string means NOT YET ASSIGNED, which is a broken row rather than a valid state:
   * every workspace-scoped rule and query treats it as matching nothing, so such a user
   * sees no workspace data at all. That is deliberate — failing closed on a missing
   * boundary is the only safe direction — and `scripts/backfill-workspaces.ts` exists to
   * make sure no row stays in it.
   */
  workspaceId: string;
  referralCode: string;
  levelName: string | null;
  plan: string;
  /** Required in the Prisma model it replaces, so kept non-null here too. */
  trialEndsAt: Date;
  shareProspects: boolean;
  followupPushOn: string | null;
  createdAt: Date;
};

const toDate = (v: unknown): Date | null =>
  v instanceof Timestamp ? v.toDate() : null;

export function toAppUser(snap: DocumentSnapshot): AppUser | null {
  const d = snap.data();
  if (!d) return null;
  return {
    id: snap.id,
    phone: d.phone,
    name: d.name,
    photoUrl: d.photoUrl ?? null,
    city: d.city ?? null,
    uplineId: d.uplineId ?? null,
    uplinePath: d.uplinePath ?? [],
    workspaceId: d.workspaceId ?? "",
    directDownlineCount: d.directDownlineCount ?? 0,
    referralCode: d.referralCode,
    levelName: d.levelName ?? null,
    plan: d.plan ?? "trial",
    // Epoch rather than "now" when absent: a missing date should read as an
    // expired trial the coach can see, not a fresh one silently granted.
    trialEndsAt: toDate(d.trialEndsAt) ?? new Date(0),
    shareProspects: d.shareProspects === true,
    followupPushOn: d.followupPushOn ?? null,
    createdAt: toDate(d.createdAt) ?? new Date(0),
  };
}

export async function getUserById(id: string): Promise<AppUser | null> {
  return toAppUser(await users().doc(id).get());
}

export async function getUserByPhone(phone: string): Promise<AppUser | null> {
  const snap = await users().where("phone", "==", phone).limit(1).get();
  return snap.empty ? null : toAppUser(snap.docs[0]);
}

/**
 * Resolves a referral code through its reservation document (D41).
 *
 * Two document reads and no query, which also means no single-field index and no
 * chance of returning the wrong coach if two ever shared a code — the reservation
 * makes that state unreachable rather than merely unlikely.
 */
export async function getUserByReferralCode(code: string): Promise<AppUser | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const claim = await referralCodes().doc(referralCodeDocId(trimmed)).get();
  if (!claim.exists) return null;
  const uid = claim.data()?.uid as string | undefined;
  return uid ? getUserById(uid) : null;
}

export async function getUsersByIds(ids: string[]): Promise<AppUser[]> {
  if (ids.length === 0) return [];
  const refs = ids.map((id) => users().doc(id));
  const snaps = await db.getAll(...refs);
  return snaps.map(toAppUser).filter((u): u is AppUser => u !== null);
}

// No 0/O/1/I — codes get read aloud and typed on cheap keyboards.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CLAIM_ATTEMPTS = 20;

function candidateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/**
 * A code that is free *at the moment you ask*, which is not the same as a code you
 * own. Only exported for the migration backfill, which claims codes that already
 * exist rather than inventing them.
 *
 * Do not use this to pick a code and then write it in a separate step — that is
 * precisely the race D41 fixes. Claiming happens inside createUser's transaction.
 */
export async function isReferralCodeFree(code: string): Promise<boolean> {
  return !(await referralCodes().doc(referralCodeDocId(code)).get()).exists;
}

const TRIAL_DAYS = 60;

/**
 * Creates the user document for an already-authenticated Firebase user.
 *
 * `uid` is the Firebase Auth uid and becomes the document id — the invariant
 * D34 established, which is what lets Security Rules compare `request.auth.uid`
 * with no lookup. Migrated users carry their old cuid as their uid; users who
 * sign up from here get a Firebase-minted one. Both are simply "the uid".
 *
 * The upline's `directDownlineCount` moves in the same transaction as the new
 * user, because Firestore cannot count children and a counter that drifts is
 * worse than no counter.
 */
export async function createUser(params: {
  uid: string;
  phone: string;
  name: string;
  city: string;
  photoUrl: string | null;
  upline: AppUser | null;
}): Promise<AppUser> {
  const { uid, phone, name, city, photoUrl, upline } = params;

  // Nearest ancestor first, so the new user's path is their upline prepended to
  // the upline's own path (collections.ts buildUplinePath, same ordering).
  const uplinePath = upline ? [upline.id, ...upline.uplinePath] : [];

  /**
   * Which organisation this coach joins.
   *
   * Joining with a referral code puts them in the SPONSOR's workspace — that is what a
   * referral means, and it is why the tree can never straddle two organisations.
   *
   * Signing up WITHOUT a code makes them the root of their own line, so they get a
   * workspace of their own and own it. That is the honest reading of "a workspace is one
   * organisation": an unsponsored coach is not a stray member of somebody else's group,
   * they are the first member of theirs. It also means there is no shared default
   * workspace for strangers to land in and see each other.
   *
   * The id is minted here rather than inside the transaction so the same value can be
   * written to both the workspace and the user row.
   *
   * An upline with NO workspace — a row the backfill has not reached — does not hand down
   * an empty one. Inheriting `""` would write a user who belongs to no organisation, and
   * because the boundary fails closed that coach would see nothing workspace-scoped
   * anywhere, with no error to explain it.
   *
   * So they start a workspace of their own instead. Be clear about the trade: this leaves
   * their `uplineId` pointing at a sponsor in a DIFFERENT organisation, which is a tree
   * straddling two workspaces — the one thing the referral rule exists to prevent. It is
   * chosen because the alternative is a coach who is silently invisible to every scoped
   * feature, and because the situation is only reachable on a database where
   * `scripts/backfill-workspaces.ts` has not been run yet.
   *
   * The rule that follows from it: run the backfill after any migration or reset, BEFORE
   * accepting signups. `--check` exits non-zero while any coach is unassigned, which is
   * what makes that enforceable rather than remembered.
   */
  if (upline && !upline.workspaceId) throw new Error("SPONSOR_WORKSPACE_REQUIRED");
  const startingOwnWorkspace = upline === null;
  const workspaceId = startingOwnWorkspace
    ? workspaces().doc().id
    : upline.workspaceId;

  const base = {
    workspaceId,
    phone,
    name,
    city,
    photoUrl,
    uplineId: upline?.id ?? null,
    uplinePath,
    directDownlineCount: 0,
    levelName: null,
    // v2 §8 cancels the trial model; `plan` stays until v2.6 replaces it with
    // tiers, so a migrated row and a new row keep the same shape until then.
    plan: "trial",
    trialEndsAt: Timestamp.fromDate(new Date(Date.now() + TRIAL_DAYS * 86_400_000)),
    shareProspects: false, // v1 §5.4 — never default this to true
    followupPushOn: null,
    createdAt: Timestamp.now(),
  };

  /**
   * The code is claimed INSIDE the transaction that writes the user (D41).
   *
   * Reading "is this code free?" beforehand and writing it afterwards is what the
   * Prisma unique constraint used to make safe: two signups could both read free
   * and both write, and the database refused the second. Firestore will not. So the
   * reservation document is read and created in the same transaction, which
   * Firestore aborts if anyone else claimed it in between.
   */
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const code = candidateCode();
    const claimRef = referralCodes().doc(referralCodeDocId(code));
    let taken = false;

    await db.runTransaction(async (tx) => {
      const userRef = users().doc(uid);
      const existingUser = await tx.get(userRef);
      if (existingUser.exists) {
        throw new Error("USER_ALREADY_EXISTS");
      }
      if (upline) {
        const currentSponsor = await tx.get(users().doc(upline.id));
        if (!currentSponsor.exists || currentSponsor.get("workspaceId") !== workspaceId || currentSponsor.get("disabled") === true) throw new Error("SPONSOR_WORKSPACE_REQUIRED");
      }

      // The route-level checks are useful for a fast response, but they are not
      // a uniqueness boundary: two signup requests can pass them concurrently.
      // Reading the phone query in this transaction makes Firestore retry one of
      // those transactions after the other commits, so the second request cannot
      // create a duplicate phone row.
      const phoneMatches = await tx.get(
        users().where("phone", "==", phone).limit(1)
      );
      if (!phoneMatches.empty) {
        throw new Error("PHONE_ALREADY_EXISTS");
      }

      if ((await tx.get(claimRef)).exists) {
        taken = true;
        return;
      }
      tx.create(claimRef, { uid, createdAt: Timestamp.now() });
      tx.set(userRef, { ...base, referralCode: code });

      /**
       * The workspace and the membership land in the SAME transaction as the user.
       *
       * A user row whose `workspaceId` points at a workspace that failed to write is
       * invisible to every scoped query in the app — present in the database, absent from
       * the product. Writing them together makes that state unreachable rather than rare.
       */
      if (startingOwnWorkspace) {
        writeWorkspace(tx, { id: workspaceId, name, ownerId: uid });
      }
      writeMembership(tx, {
        workspaceId,
        userId: uid,
        role: startingOwnWorkspace ? "owner" : "member",
      });

      if (upline) {
        tx.update(users().doc(upline.id), {
          directDownlineCount: FieldValue.increment(1),
        });
      }
    });

    if (!taken) return (await getUserById(uid))!;
  }

  // 32^6 codes against 20 tries: reaching here means the space is genuinely
  // crowded, not that we were unlucky. Failing loudly beats issuing a duplicate.
  throw new Error("Could not claim a unique referral code");
}

export async function updateUser(
  id: string,
  data: Partial<{
    name: string;
    city: string;
    photoUrl: string | null;
    levelName: string | null;
    shareProspects: boolean;
    followupPushOn: string | null;
  }>
): Promise<AppUser | null> {
  await users().doc(id).update(data);
  return getUserById(id);
}

/** Direct downlines only. Deeper levels come from uplinePath queries (D36). */
export async function getDirectDownlines(uplineId: string): Promise<AppUser[]> {
  const snap = await db
    .collection(COLLECTIONS.users)
    .where("uplineId", "==", uplineId)
    .orderBy("createdAt", "asc")
    .get();
  return snap.docs.map(toAppUser).filter((u): u is AppUser => u !== null);
}
