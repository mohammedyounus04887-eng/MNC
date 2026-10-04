import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { prospects, prospectDocId } from "./collections";
import { getUserById } from "./users";
import { createHash } from "node:crypto";
import { db } from "./firebase-admin";

/**
 * Prospect reads and writes against Firestore.
 *
 * `AppProspect` mirrors the Prisma `Prospect` model field for field so the screens
 * and routes reading it need no reshaping.
 */

export type AppProspect = {
  id: string;
  coachId: string;
  clientId: string | null;
  name: string;
  phone: string;
  age: number | null;
  gender: string | null;
  heightCm: number | null;
  weightKg: number | null;
  stage: string;
  nextFollowupAt: Date | null;
  source: string;
  notes: string | null;
  createdAt: Date;
  workspaceId: string | null;
  clubMemberId: string | null;
  integrationHandoffOperationId: string | null;
};

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

export function toAppProspect(snap: DocumentSnapshot): AppProspect | null {
  const d = snap.data();
  if (!d) return null;
  return {
    id: snap.id,
    coachId: d.coachId,
    clientId: d.clientId ?? null,
    name: d.name,
    phone: d.phone,
    age: d.age ?? null,
    gender: d.gender ?? null,
    heightCm: d.heightCm ?? null,
    weightKg: d.weightKg ?? null,
    stage: d.stage ?? "spoken",
    nextFollowupAt: toDate(d.nextFollowupAt),
    source: d.source ?? "manual",
    notes: d.notes ?? null,
    createdAt: toDate(d.createdAt) ?? new Date(0),
    workspaceId: typeof d.workspaceId === "string" ? d.workspaceId : null,
    clubMemberId: typeof d.clubMemberId === "string" ? d.clubMemberId : null,
    integrationHandoffOperationId: typeof d.integrationHandoffOperationId === "string" ? d.integrationHandoffOperationId : null,
  };
}

export async function getProspectById(id: string): Promise<AppProspect | null> {
  return toAppProspect(await prospects().doc(id).get());
}

/**
 * A prospect belonging to a specific coach, or null.
 *
 * Ownership is checked here rather than by the caller, so "not yours" and "does
 * not exist" are indistinguishable — no route can be used to probe for other
 * coaches' prospects (the same reasoning as D32 for targets).
 */
export async function getProspectForCoach(
  id: string,
  coachId: string
): Promise<AppProspect | null> {
  const p = await getProspectById(id);
  return p && p.coachId === coachId ? p : null;
}

export async function listProspectsByCoach(coachId: string): Promise<AppProspect[]> {
  const snap = await prospects()
    .where("coachId", "==", coachId)
    .orderBy("createdAt", "desc")
    .get();
  return snap.docs.map(toAppProspect).filter((p): p is AppProspect => p !== null);
}

export async function countProspectsByCoach(coachId: string): Promise<number> {
  return (await prospects().where("coachId", "==", coachId).count().get()).data().count;
}

export type NewProspect = {
  coachId: string;
  clientId?: string | null;
  name: string;
  phone: string;
  age?: number | null;
  gender?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  stage?: string;
  nextFollowupAt?: Date | null;
  source?: string;
  notes?: string | null;
  /**
   * Whether this person agreed (RULES P6). The CALLER establishes this — the coach's
   * tick for a manual capture, the act of filling the form for a QR self-fill — and the
   * timestamp is stamped here, server-side.
   */
  consentGiven?: boolean;
};

/**
 * Creates a prospect, or returns the existing one when the offline queue replays.
 *
 * D6's `unique(coachId, clientId)` is now the document id (D35), so idempotency is
 * enforced by the primary key rather than by a lookup-then-insert that two racing
 * syncs could both pass. `duplicate: true` is what the client uses to distinguish
 * "saved" from "already had this one" — a coach on a weak signal must never turn
 * into three rows for one person.
 */
export async function createProspect(
  input: NewProspect
): Promise<{ prospect: AppProspect; duplicate: boolean }> {
  const docId = prospectDocId(input.coachId, input.clientId ?? null);
  const coach = await getUserById(input.coachId);
  if (!coach?.workspaceId || !(await db.collection("workspaces").doc(coach.workspaceId).get()).exists) {
    throw new Error("COACH_WORKSPACE_REQUIRED");
  }
  const links = await db.collection("integrationLinks").where("growlineAuthUid", "==", coach.id)
    .where("workspaceId", "==", coach.workspaceId).where("status", "==", "active").limit(33).get();
  if (links.size > 32) throw new Error("COACH_LINK_LIMIT_REQUIRES_REVIEW");
  const clubLinks = links.docs.filter((link) => link.get("clubProject") === process.env.CLUB_FIREBASE_PROJECT_ID && link.get("growlineProject") === process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)
    .map((link) => ({ linkId: link.id, clubId: String(link.get("clubId")), clubProject: String(link.get("clubProject")) }));
  const capturePayloadHash = createHash("sha256").update(JSON.stringify({
    name: input.name, phone: input.phone, age: input.age ?? null, gender: input.gender ?? null,
    heightCm: input.heightCm ?? null, weightKg: input.weightKg ?? null, consentGiven: input.consentGiven === true,
  })).digest("hex");

  const data = {
    coachId: input.coachId,
    workspaceId: coach.workspaceId,
    capturePayloadHash,
    acquisition: { schemaVersion: 1, kind: input.source === "qr" ? "coach_qr" : "coach_manual", coachId: coach.id, workspaceId: coach.workspaceId, clubLinks },
    coachUplinePath: coach?.uplinePath ?? [],
    clientId: input.clientId ?? null,
    name: input.name,
    phone: input.phone,
    age: input.age ?? null,
    gender: input.gender ?? null,
    heightCm: input.heightCm ?? null,
    weightKg: input.weightKg ?? null,
    stage: input.stage ?? "spoken",
    nextFollowupAt: input.nextFollowupAt ? Timestamp.fromDate(input.nextFollowupAt) : null,
    source: input.source ?? "manual",
    notes: input.notes ?? null,
    // Stamped server-side from the coach's tick, or from the prospect filling the QR
    // form themselves. Never taken as a date from the client: a consent date the client
    // chooses is worth nothing as evidence.
    consentAt: input.consentGiven ? Timestamp.now() : null,
    consentVersion: "capture-confirmation-v1",
    consentSource: input.source === "qr" ? "prospect_self_capture" : "coach_confirmed_capture",
    createdAt: Timestamp.now(),
    /**
     * Seeded at creation so the retention purge (RULES P5) has something to measure from
     * day one. Capture IS the first activity, and a row that starts without this field
     * would sit outside the purge until the backfill reached it.
     */
    lastActivityAt: Timestamp.now(),
  };

  if (!docId) {
    // QR self-fills have no clientId — created online in one request, auto-id.
    const ref = await prospects().add(data);
    return { prospect: (await getProspectById(ref.id))!, duplicate: false };
  }

  const ref = prospects().doc(docId);
  const existing = await ref.get();
  if (existing.exists) {
    if (existing.get("workspaceId") && existing.get("workspaceId") !== coach.workspaceId) throw new Error("COACH_WORKSPACE_REQUIRED");
    if (existing.get("capturePayloadHash") && existing.get("source") !== (input.source ?? "manual")) throw new Error("CAPTURE_IDEMPOTENCY_CONFLICT");
    if (existing.get("capturePayloadHash") && existing.get("capturePayloadHash") !== capturePayloadHash) throw new Error("CAPTURE_IDEMPOTENCY_CONFLICT");
    return { prospect: toAppProspect(existing)!, duplicate: true };
  }
  // `create()` rather than `set()`: if a concurrent replay won the race between
  // the read above and this write, this throws instead of overwriting the row the
  // coach may already have edited.
  try {
    await ref.create(data);
  } catch {
    const now = await ref.get();
    if (now.exists) {
      if (now.get("workspaceId") && now.get("workspaceId") !== coach.workspaceId) throw new Error("COACH_WORKSPACE_REQUIRED");
      if (now.get("capturePayloadHash") && now.get("source") !== (input.source ?? "manual")) throw new Error("CAPTURE_IDEMPOTENCY_CONFLICT");
      if (now.get("capturePayloadHash") && now.get("capturePayloadHash") !== capturePayloadHash) throw new Error("CAPTURE_IDEMPOTENCY_CONFLICT");
      return { prospect: toAppProspect(now)!, duplicate: true };
    }
    throw new Error("Could not save this person. Please try again.");
  }
  return { prospect: (await getProspectById(docId))!, duplicate: false };
}

export async function updateProspect(
  id: string,
  data: Partial<{
    name: string;
    phone: string;
    age: number | null;
    gender: string | null;
    heightCm: number | null;
    weightKg: number | null;
    stage: string;
    nextFollowupAt: Date | null;
    notes: string | null;
  }>
): Promise<AppProspect | null> {
  const patch: Record<string, unknown> = { ...data };
  if ("nextFollowupAt" in data) {
    patch.nextFollowupAt = data.nextFollowupAt
      ? Timestamp.fromDate(data.nextFollowupAt)
      : null;
  }
  await prospects().doc(id).update(patch);
  return getProspectById(id);
}

export async function deleteProspect(id: string): Promise<void> {
  await prospects().doc(id).delete();
}
