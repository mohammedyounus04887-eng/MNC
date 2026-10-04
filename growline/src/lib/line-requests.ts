import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import { dailyLogs, prospects, targets, users } from "./collections";
import { getUserByReferralCode, getUserById, type AppUser } from "./users";

/**
 * "Link my line" — connecting two coaches who are already a team in real life.
 *
 * ## The problem this solves
 *
 * The tree was only ever built at signup, through a referral code, and `uplineId` was
 * never writable afterwards. So a coach who installed the app BEFORE their upline did —
 * which is how adoption actually happens, from the keen person downward — signed up with
 * no code and became a permanent root. There was no way to attach them later, ever.
 *
 * That, and not a senior coach refusing to install, is what blocked bottom-up adoption. If
 * the person at the top never joins, the tree simply roots at the highest person who did,
 * and everyone below still works — PROVIDED attachment can happen after signup. This is
 * that.
 *
 * ## Two-sided approval, always
 *
 * A request needs the other party's yes. Never one-tap, in either direction, and the
 * reason is not politeness:
 *
 *   - attaching yourself UNDER someone would let you see their line, so anyone could
 *     help themselves to a stranger's team by guessing a code;
 *   - claiming someone as your downline would make their activity flow up to you, so
 *     anyone could start watching a stranger's work.
 *
 * Either direction unilaterally is a privacy hole, so both directions ask.
 *
 * ## Identified by referral code, not phone number
 *
 * Both coaches already know each other; what the app needs is an identifier. The referral
 * code is the app-native one, and using it instead of a phone number means this feature
 * cannot be used to test whether a given phone number has an account. No enumeration.
 *
 * ## v1 attaches an unattached coach; it does not MOVE an attached one
 *
 * The child must currently have no upline. Moving a coach who already reports to somebody
 * is a different question — whose team are they on, and does the old upline get a say —
 * and it is a product decision, not a technical one.
 *
 * It also happens to make the hard part easy. Because the child is a root, their
 * `uplinePath` is empty and every descendant's path currently ENDS at the child. So
 * re-parenting is a pure APPEND of the child's new ancestors onto every affected path —
 * no recomputation, and the same operation for the child, their descendants, and all of
 * those coaches' prospects, logs and targets.
 */

export const LINE_REQUESTS = "lineRequests";

/** Matches the tree-depth guard the migration's cycle check assumes (D36). */
export const MAX_DEPTH = 100;

export type LineRequestStatus = "pending" | "accepted" | "declined" | "cancelled";

export type LineRequest = {
  id: string;
  childId: string;
  childName: string;
  parentId: string;
  parentName: string;
  /** Whichever of the two started it. The OTHER one is who may accept. */
  requestedBy: string;
  status: LineRequestStatus;
  createdAt: Date;
  respondedAt: Date | null;
};

/**
 * One request per (child, parent) pair, as a document id.
 *
 * Same reasoning as the constraints in D35: without it, tapping twice on a slow connection
 * makes two pending requests for the same pair, and the other coach sees the same ask
 * duplicated in their list.
 */
export function lineRequestId(childId: string, parentId: string): string {
  return `${childId}__${parentId}`;
}

function toLineRequest(id: string, d: Record<string, unknown>): LineRequest {
  const ts = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null);
  return {
    id,
    childId: (d.childId as string) ?? "",
    childName: (d.childName as string) ?? "",
    parentId: (d.parentId as string) ?? "",
    parentName: (d.parentName as string) ?? "",
    requestedBy: (d.requestedBy as string) ?? "",
    status: (d.status as LineRequestStatus) ?? "pending",
    createdAt: ts(d.createdAt) ?? new Date(0),
    respondedAt: ts(d.respondedAt),
  };
}

export type LinkCheckFailure = { ok: false; error: string };
export type LinkCheckOk = { ok: true; child: AppUser; parent: AppUser };

/**
 * Whether `child` may be placed under `parent`, re-derived from the database.
 *
 * Called when the request is CREATED and again when it is ACCEPTED, because everything it
 * checks can change in between — the child may have been attached by another request, the
 * parent may have moved under the child, either may have grown a line.
 */
export async function checkLink(
  childId: string,
  parentId: string
): Promise<LinkCheckFailure | LinkCheckOk> {
  if (childId === parentId) {
    return { ok: false, error: "You cannot add yourself to your own line." };
  }

  const [child, parent] = await Promise.all([
    getUserById(childId),
    getUserById(parentId),
  ]);
  if (!child || !parent) return { ok: false, error: "That coach was not found." };

  if (child.uplineId) {
    return {
      ok: false,
      error: `${child.name} is already in someone's line. Ask support to move them.`,
    };
  }

  /**
   * The cycle check. If the proposed parent is somewhere BELOW the child, attaching the
   * child under them closes a loop — and a loop in `uplinePath` is not a cosmetic problem:
   * the roll-up queries walk it, and `buildUplinePath`'s cycle guard exists because
   * somebody already found one.
   */
  if (parent.uplinePath.includes(childId)) {
    return {
      ok: false,
      error: `${parent.name} is already below you in your line, so this would form a loop.`,
    };
  }

  if (parent.uplinePath.length + 1 >= MAX_DEPTH) {
    return { ok: false, error: "That line is already as deep as it can go." };
  }

  return { ok: true, child, parent };
}

/**
 * Creates a pending request. `requestedBy` must be one of the two coaches, and it decides
 * who has to approve.
 */
export async function createLineRequest(params: {
  childId: string;
  parentId: string;
  requestedBy: string;
}): Promise<{ ok: true; id: string } | LinkCheckFailure> {
  const { childId, parentId, requestedBy } = params;
  if (requestedBy !== childId && requestedBy !== parentId) {
    return { ok: false, error: "Only the two coaches involved can ask for this." };
  }

  const check = await checkLink(childId, parentId);
  if (!check.ok) return check;

  const id = lineRequestId(childId, parentId);
  const ref = db.collection(LINE_REQUESTS).doc(id);
  const existing = await ref.get();
  if (existing.exists && existing.data()?.status === "pending") {
    // Idempotent rather than an error: the coach's intent is already recorded, and telling
    // them "already requested" is more useful than a failure.
    return { ok: true, id };
  }

  await ref.set({
    childId,
    childName: check.child.name,
    parentId,
    parentName: check.parent.name,
    requestedBy,
    status: "pending" satisfies LineRequestStatus,
    createdAt: Timestamp.now(),
    respondedAt: null,
  });
  return { ok: true, id };
}

/** Requests this coach must answer — started by the other party, still pending. */
export async function pendingForUser(userId: string): Promise<LineRequest[]> {
  const [asChild, asParent] = await Promise.all([
    db.collection(LINE_REQUESTS).where("childId", "==", userId).where("status", "==", "pending").get(),
    db.collection(LINE_REQUESTS).where("parentId", "==", userId).where("status", "==", "pending").get(),
  ]);
  return [...asChild.docs, ...asParent.docs]
    .map((doc) => toLineRequest(doc.id, doc.data()))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

const BATCH_LIMIT = 400;

/**
 * Appends `ancestors` to the tree-path field of every document in a collection whose path
 * currently contains `subtreeRootId`.
 *
 * Idempotent, and that is deliberate rather than incidental: the guard skips any document
 * that already contains the new immediate parent, so a fan-out interrupted halfway can be
 * re-run without doubling anybody's path. Firestore has no transaction big enough to cover
 * a whole subtree's prospects, logs and targets, so "safe to re-run" is the only property
 * that makes an interruption recoverable.
 */
async function appendToPaths(
  collectionRef: ReturnType<typeof prospects>,
  field: string,
  subtreeRootId: string,
  ancestors: string[]
): Promise<number> {
  if (ancestors.length === 0) return 0;
  const immediateParent = ancestors[0];

  const snap = await collectionRef.where(field, "array-contains", subtreeRootId).get();
  let written = 0;
  let batch = db.batch();
  let inBatch = 0;

  for (const doc of snap.docs) {
    const current = (doc.data()[field] as string[]) ?? [];
    if (current.includes(immediateParent)) continue; // already appended
    batch.update(doc.ref, { [field]: [...current, ...ancestors] });
    written++;
    inBatch++;
    if (inBatch >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();
  return written;
}

export type AcceptResult =
  | { ok: true; moved: { users: number; prospects: number; logs: number; targets: number } }
  | LinkCheckFailure;

/**
 * Accepts a request and performs the re-parent.
 *
 * `approver` must be the coach who did NOT start it — that is the two-sided approval, and
 * it is enforced here rather than in the UI because a route is reachable directly.
 *
 * Two phases, because no Firestore transaction is large enough for the second:
 *
 *  1. **The authoritative change, in a transaction:** the child's own `uplineId` and
 *     `uplinePath`, the parent's counter, and the request status. After this commits, the
 *     tree is correct and the app behaves correctly for the child.
 *  2. **The fan-out, in idempotent batches:** every descendant's path, and the denormalised
 *     copies on all affected prospects, logs and targets.
 *
 * If phase 2 is interrupted, the tree is right at the top and stale below — roll-ups
 * under-report until it is re-run, which it safely can be. That is the honest trade: the
 * alternative is holding a lock across thousands of writes, and the failure mode there is
 * a half-attached coach.
 */
export async function acceptLineRequest(
  requestId: string,
  approverId: string
): Promise<AcceptResult> {
  const ref = db.collection(LINE_REQUESTS).doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "That request was not found." };

  const request = toLineRequest(snap.id, snap.data()!);
  if (request.status !== "pending") {
    return { ok: false, error: "That request has already been answered." };
  }

  // The approver is the party who did not ask. Checked before anything else is read.
  const counterpart =
    request.requestedBy === request.childId ? request.parentId : request.childId;
  if (approverId !== counterpart) {
    return { ok: false, error: "Only the other coach can accept this." };
  }

  // Re-checked at accept time: the child may have been attached by a different request
  // while this one sat pending.
  const check = await checkLink(request.childId, request.parentId);
  if (!check.ok) return check;

  const { child, parent } = check;
  const ancestors = [parent.id, ...parent.uplinePath];

  await db.runTransaction(async (tx) => {
    tx.update(users().doc(child.id), {
      uplineId: parent.id,
      uplinePath: ancestors,
    });
    tx.update(users().doc(parent.id), {
      directDownlineCount: FieldValue.increment(1),
    });
    tx.update(ref, {
      status: "accepted" satisfies LineRequestStatus,
      respondedAt: Timestamp.now(),
    });
  });

  // Phase 2. The child's own documents are covered by the same queries as their
  // descendants': a prospect of the child has `coachUplinePath` containing nothing yet, so
  // it is picked up by the child-scoped pass below rather than the subtree one.
  const [descendants, childProspects, childLogs, childTargets] = await Promise.all([
    appendToPaths(users(), "uplinePath", child.id, ancestors),
    appendToPaths(prospects(), "coachUplinePath", child.id, ancestors),
    appendToPaths(dailyLogs(), "uplinePath", child.id, ancestors),
    appendToPaths(targets(), "uplinePath", child.id, ancestors),
  ]);

  /**
   * The child's OWN rows have empty paths — they were a root — so `array-contains child.id`
   * does not match them and the passes above miss them. They are rewritten directly.
   */
  const own = await Promise.all([
    setPathWhereEmpty(prospects(), "coachUplinePath", "coachId", child.id, ancestors),
    setPathWhereEmpty(dailyLogs(), "uplinePath", "userId", child.id, ancestors),
    setPathWhereEmpty(targets(), "uplinePath", "coachId", child.id, ancestors),
  ]);

  return {
    ok: true,
    moved: {
      users: descendants,
      prospects: childProspects + own[0],
      logs: childLogs + own[1],
      targets: childTargets + own[2],
    },
  };
}

/**
 * Sets the path on documents OWNED by one coach, for the coach who was just re-parented.
 *
 * Separate from `appendToPaths` because their rows have an EMPTY path — being a root is
 * exactly what an empty path means — so no `array-contains` query can find them. Filtering
 * by owner is the only way in, and the same idempotence guard applies.
 */
async function setPathWhereEmpty(
  collectionRef: ReturnType<typeof prospects>,
  field: string,
  ownerField: string,
  ownerId: string,
  ancestors: string[]
): Promise<number> {
  const snap = await collectionRef.where(ownerField, "==", ownerId).get();
  let written = 0;
  let batch = db.batch();
  let inBatch = 0;

  for (const doc of snap.docs) {
    const current = (doc.data()[field] as string[]) ?? [];
    if (current.includes(ancestors[0])) continue;
    batch.update(doc.ref, { [field]: [...current, ...ancestors] });
    written++;
    inBatch++;
    if (inBatch >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();
  return written;
}

/** Declining, or the asker cancelling. Both just close the request. */
export async function respondNegative(
  requestId: string,
  actorId: string,
  status: "declined" | "cancelled"
): Promise<{ ok: true } | LinkCheckFailure> {
  const ref = db.collection(LINE_REQUESTS).doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "That request was not found." };

  const request = toLineRequest(snap.id, snap.data()!);
  if (request.status !== "pending") {
    return { ok: false, error: "That request has already been answered." };
  }

  const isParty = actorId === request.childId || actorId === request.parentId;
  if (!isParty) return { ok: false, error: "That request was not found." };
  if (status === "cancelled" && actorId !== request.requestedBy) {
    return { ok: false, error: "Only the coach who asked can cancel it." };
  }

  await ref.update({ status, respondedAt: Timestamp.now() });
  return { ok: true };
}

/** Resolves the other coach from a referral code, for the request form. */
export async function findByCode(code: string): Promise<AppUser | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  try {
    return await getUserByReferralCode(trimmed);
  } catch {
    // `referralCodeDocId` throws on a code that cannot be a document id. "No such code"
    // is the right answer to a coach who mistyped, not a 500.
    return null;
  }
}
