import { Timestamp } from "firebase-admin/firestore";
import { proofs, targetDocId, targets } from "./collections";
import { getDirectDownlines, getUserById } from "./users";
import {
  MAX_TARGET_POINTS,
  deriveStatus,
  isMonthKey,
  type ProofStatus,
} from "./targets";

/**
 * Database side of targets and proofs, and the single place the authorization rules
 * live. Every mutation re-derives who is allowed to do it from the database rather
 * than trusting anything the client sent:
 *
 *   set / change a target   → the coach's DIRECT upline only (F7 says direct)
 *   update progress         → the target's own coach only
 *   ask for proof           → the upline who set that target
 *   attach evidence         → the target's own coach
 *   approve / reject        → the upline who asked
 *
 * "Not allowed" and "not found" return the same failure on purpose, so no route can
 * be used to discover whether another coach's target or proof exists.
 *
 * ## Firestore notes
 *
 * `pendingProofCount` used the relational filter `where: { target: { coachId } }`,
 * which has no Firestore equivalent — a query cannot reach through a reference.
 * That is why `coachId` is denormalised onto every proof document, written from the
 * target at creation time. The same copy removes the target read that `submitProof`
 * used to do purely to learn who owned it.
 */

export type Denied = { ok: false; error: string };
const DENIED: Denied = { ok: false, error: "Not found" };

/** True only for a DIRECT downline — deliberately not the whole subtree. */
async function isDirectDownline(uplineId: string, coachId: string): Promise<boolean> {
  const coach = await getUserById(coachId);
  return coach?.uplineId === uplineId;
}

export type TargetProof = {
  id: string;
  status: string;
  requestNote: string | null;
  submitNote: string | null;
  comment: string | null;
  mediaUrl: string | null;
  createdAt: Date;
};

export type TargetWithProofs = {
  id: string;
  month: string;
  targetPoints: number;
  progressPoints: number;
  status: string;
  coachId: string;
  setById: string;
  setBy: { id: string; name: string };
  proofs: TargetProof[];
};

const toDate = (v: unknown): Date =>
  v instanceof Timestamp ? v.toDate() : new Date(0);

async function proofsForTargets(targetIds: string[]): Promise<Map<string, TargetProof[]>> {
  const out = new Map<string, TargetProof[]>();
  if (targetIds.length === 0) return out;
  // `in` accepts at most 30 values per query.
  for (let i = 0; i < targetIds.length; i += 30) {
    const snap = await proofs()
      .where("targetId", "in", targetIds.slice(i, i + 30))
      .get();
    for (const doc of snap.docs) {
      const d = doc.data();
      const list = out.get(d.targetId) ?? [];
      list.push({
        id: doc.id,
        status: d.status,
        requestNote: d.requestNote ?? null,
        submitNote: d.submitNote ?? null,
        comment: d.comment ?? null,
        mediaUrl: d.mediaUrl ?? null,
        createdAt: toDate(d.createdAt),
      });
      out.set(d.targetId, list);
    }
  }
  // Newest first, matching the old `orderBy: { createdAt: "desc" }`. Sorted here
  // rather than in the query so the `in` lookup needs no composite index.
  for (const list of out.values()) {
    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  return out;
}

async function hydrate(
  docs: { id: string; data: FirebaseFirestore.DocumentData }[]
): Promise<TargetWithProofs[]> {
  if (docs.length === 0) return [];
  const proofsBy = await proofsForTargets(docs.map((d) => d.id));
  const setters = new Map<string, string>();
  for (const id of new Set(docs.map((d) => d.data.setById as string))) {
    const u = await getUserById(id);
    if (u) setters.set(id, u.name);
  }
  return docs.map((d) => ({
    id: d.id,
    month: d.data.month,
    targetPoints: d.data.targetPoints,
    progressPoints: d.data.progressPoints,
    status: d.data.status,
    coachId: d.data.coachId,
    setById: d.data.setById,
    setBy: { id: d.data.setById, name: setters.get(d.data.setById) ?? "" },
    proofs: proofsBy.get(d.id) ?? [],
  }));
}

/** The signed-in coach's own target for a month, with any proof requests on it. */
export async function getMyTarget(
  coachId: string,
  month: string
): Promise<TargetWithProofs | null> {
  if (!isMonthKey(month)) return null;
  const snap = await targets().doc(targetDocId(coachId, month)).get();
  if (!snap.exists) return null;
  return (await hydrate([{ id: snap.id, data: snap.data()! }]))[0] ?? null;
}

/**
 * What an upline sees: each direct downline and their target for the month. Activity
 * flows upward (Section 5.4) — this returns points and names of COACHES, never any
 * prospect of theirs.
 */
export async function getDirectLineTargets(uplineId: string, month: string) {
  const downlines = await getDirectDownlines(uplineId);
  if (downlines.length === 0) return [];

  // The document id is (coachId, month), so the targets are addressable directly —
  // no query, and missing ones simply come back absent.
  const refs = downlines.map((d) => targets().doc(targetDocId(d.id, month)));
  const snaps = await targets().firestore.getAll(...refs);
  const present = snaps
    .filter((s) => s.exists)
    .map((s) => ({ id: s.id, data: s.data()! }));

  const hydrated = await hydrate(present);
  const byCoach = new Map(hydrated.map((t) => [t.coachId, t]));
  return downlines.map((d) => ({
    coach: {
      id: d.id,
      name: d.name,
      photoUrl: d.photoUrl,
      city: d.city,
      levelName: d.levelName,
    },
    target: byCoach.get(d.id) ?? null,
  }));
}

export type SetTargetResult = { ok: true; id: string } | Denied;

export async function setTarget(
  actorId: string,
  coachId: string,
  month: string,
  points: number
): Promise<SetTargetResult> {
  if (!isMonthKey(month)) return { ok: false, error: "That month is not valid." };
  if (!Number.isInteger(points) || points < 1 || points > MAX_TARGET_POINTS) {
    return { ok: false, error: "Enter a target between 1 and 999999." };
  }
  // A coach cannot set their own target — the point of F7 is that it comes from
  // the upline.
  if (actorId === coachId) return DENIED;
  if (!(await isDirectDownline(actorId, coachId))) return DENIED;

  const coach = await getUserById(coachId);
  const id = targetDocId(coachId, month);
  const ref = targets().doc(id);
  const existing = await ref.get();
  const progress = existing.exists ? (existing.data()!.progressPoints as number) : 0;
  const status = deriveStatus(progress, points, month);

  if (existing.exists) {
    // setById is refreshed so the person who last set it is the one who can ask
    // for proof on it.
    await ref.update({ setById: actorId, targetPoints: points, status, updatedAt: Timestamp.now() });
  } else {
    await ref.set({
      coachId,
      setById: actorId,
      uplinePath: coach?.uplinePath ?? [],
      month,
      targetPoints: points,
      progressPoints: 0,
      status,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }
  return { ok: true, id };
}

export type ProgressResult =
  | { ok: true; progressPoints: number; status: string; justAchieved: boolean }
  | Denied;

/** Only the target's own coach may move their progress (F7: updated manually). */
export async function updateProgress(
  actorId: string,
  targetId: string,
  points: number
): Promise<ProgressResult> {
  if (!Number.isInteger(points) || points < 0 || points > MAX_TARGET_POINTS) {
    return { ok: false, error: "Enter a number between 0 and 999999." };
  }
  const ref = targets().doc(targetId);
  const snap = await ref.get();
  const t = snap.data();
  if (!t || t.coachId !== actorId) return DENIED;

  const status = deriveStatus(points, t.targetPoints, t.month);
  await ref.update({ progressPoints: points, status, updatedAt: Timestamp.now() });
  return {
    ok: true,
    progressPoints: points,
    status,
    // Celebrate the crossing, not every save at or above the line.
    justAchieved: status === "achieved" && t.status !== "achieved",
  };
}

export type ProofResult = { ok: true; id: string } | Denied;

/** Only the upline who set the target may ask for evidence on it. */
export async function requestProof(
  actorId: string,
  targetId: string,
  requestNote: string | null
): Promise<ProofResult> {
  const snap = await targets().doc(targetId).get();
  const t = snap.data();
  if (!t || t.setById !== actorId) return DENIED;
  // Guard against a stale target whose coach is no longer in this upline's line.
  if (!(await isDirectDownline(actorId, t.coachId))) return DENIED;

  const ref = await proofs().add({
    targetId,
    // Copied from the target so proof queries never have to reach through a
    // reference — see the Firestore note at the top of this file.
    coachId: t.coachId,
    requestedById: actorId,
    requestNote,
    status: "pending",
    mediaUrl: null,
    submitNote: null,
    comment: null,
    createdAt: Timestamp.now(),
    submittedAt: null,
    reviewedAt: null,
  });
  return { ok: true, id: ref.id };
}

/** Only the target's coach may attach evidence, and only while it is unreviewed. */
export async function submitProof(
  actorId: string,
  proofId: string,
  mediaUrl: string | null,
  submitNote: string | null
): Promise<ProofResult> {
  const ref = proofs().doc(proofId);
  const p = (await ref.get()).data();
  if (!p || p.coachId !== actorId) return DENIED;
  if (p.status === "approved") {
    return { ok: false, error: "This one is already approved." };
  }
  if (!mediaUrl && !submitNote) {
    return { ok: false, error: "Add a photo or a short note." };
  }

  await ref.update({
    mediaUrl,
    submitNote,
    // Re-submitting after a rejection returns it to the upline's queue.
    status: "submitted",
    submittedAt: Timestamp.now(),
    reviewedAt: null,
    comment: null,
  });
  return { ok: true, id: proofId };
}

/** Only the upline who asked may approve or reject. */
export async function reviewProof(
  actorId: string,
  proofId: string,
  decision: Extract<ProofStatus, "approved" | "rejected">,
  comment: string | null
): Promise<ProofResult> {
  const ref = proofs().doc(proofId);
  const p = (await ref.get()).data();
  if (!p || p.requestedById !== actorId) return DENIED;
  if (p.status === "pending") {
    return { ok: false, error: "Nothing has been sent for this yet." };
  }

  await ref.update({ status: decision, comment, reviewedAt: Timestamp.now() });
  return { ok: true, id: proofId };
}

/** Proof requests waiting on the signed-in coach, for the home prompt. */
export async function pendingProofCount(coachId: string): Promise<number> {
  const snap = await proofs()
    .where("coachId", "==", coachId)
    .where("status", "in", ["pending", "rejected"])
    .count()
    .get();
  return snap.data().count;
}

/** Submitted proofs waiting on the signed-in upline to review. */
export async function proofsAwaitingReview(uplineId: string): Promise<number> {
  const snap = await proofs()
    .where("requestedById", "==", uplineId)
    .where("status", "==", "submitted")
    .count()
    .get();
  return snap.data().count;
}
