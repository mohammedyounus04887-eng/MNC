import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { reportDocId, reports, prospects, users } from "./collections";
import { db } from "./firebase-admin";

/**
 * Report reads and writes against Firestore.
 *
 * D20's `unique(prospectId, inputsHash)` is now the document id (D35), which is
 * what keeps its guarantee intact: report creation runs during a GET page render,
 * so two tabs — or a save racing the refresh that follows it — would otherwise
 * mint two rows, meaning two live 90-day bearer tokens to the same person's
 * health data, only one of which the coach ever sees or can mark as sent.
 */

export type AppReport = {
  id: string;
  prospectId: string;
  coachId: string | null;
  token: string;
  metricsJson: string;
  inputsHash: string;
  sentAt: Date | null;
  createdAt: Date;
  workspaceId: string | null;
};

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

export function toAppReport(snap: DocumentSnapshot): AppReport | null {
  const d = snap.data();
  if (!d) return null;
  return {
    id: snap.id,
    prospectId: d.prospectId,
    coachId: d.coachId ?? null,
    token: d.token,
    metricsJson: d.metricsJson,
    inputsHash: d.inputsHash,
    sentAt: toDate(d.sentAt),
    createdAt: toDate(d.createdAt) ?? new Date(0),
    workspaceId: typeof d.workspaceId === "string" ? d.workspaceId : null,
  };
}

export async function getReportByToken(token: string): Promise<AppReport | null> {
  const snap = await reports().where("token", "==", token).limit(1).get();
  return snap.empty ? null : toAppReport(snap.docs[0]);
}

export async function getReportByInputs(
  prospectId: string,
  inputsHash: string
): Promise<AppReport | null> {
  return toAppReport(await reports().doc(reportDocId(prospectId, inputsHash)).get());
}

/**
 * Creates the report for this set of inputs, or refreshes an expired one in place.
 *
 * `set()` on the deterministic id is the upsert D20 needs: concurrent renders
 * converge on one document instead of creating two. A refresh keeps the same
 * identity but takes a new token and timestamp, and clears `sentAt` — the coach
 * has not sent the new link yet.
 */
export async function upsertReport(params: {
  prospectId: string;
  coachId: string | null;
  inputsHash: string;
  token: string;
  metricsJson: string;
}): Promise<AppReport> {
  const id = reportDocId(params.prospectId, params.inputsHash);
  if (!params.coachId) throw new Error("REPORT_OWNER_REQUIRED");
  const ref = reports().doc(id);
  await db.runTransaction(async (transaction) => {
    const [existing, prospect, coach] = await Promise.all([
      transaction.get(ref), transaction.get(prospects().doc(params.prospectId)), transaction.get(users().doc(params.coachId!)),
    ]);
    const workspaceId = coach.get("workspaceId");
    if (!prospect.exists || prospect.get("coachId") !== params.coachId || typeof workspaceId !== "string" || !workspaceId ||
        (prospect.get("workspaceId") && prospect.get("workspaceId") !== workspaceId) ||
        (existing.exists && ((existing.get("coachId") && existing.get("coachId") !== params.coachId) || (existing.get("workspaceId") && existing.get("workspaceId") !== workspaceId)))) {
      throw new Error("REPORT_SCOPE_INVALID");
    }
    const createdAt = existing.get("createdAt");
    if (existing.exists && createdAt instanceof Timestamp && Date.now() - createdAt.toMillis() <= 90 * 86_400_000) return;
    const data = {
      prospectId: params.prospectId, coachId: params.coachId, inputsHash: params.inputsHash,
      token: params.token, metricsJson: params.metricsJson, sentAt: null, createdAt: Timestamp.now(),
    };
    if (existing.exists) transaction.update(ref, data); // Historical scope is preserved, including missing legacy scope.
    else transaction.create(ref, { ...data, workspaceId });
  });
  return toAppReport(await ref.get())!;
}

/** F4 — drives the report → send rate metric in Section 13. */
export async function markReportSent(id: string): Promise<void> {
  await reports().doc(id).update({ sentAt: Timestamp.now() });
}

/**
 * Deletes every report for a prospect.
 *
 * Under Prisma this happened for free: `onDelete: Cascade` on the relation meant
 * deleting the prospect took their reports with it. **Firestore has no cascading
 * deletes.** Without this, erasure would remove the prospect row and leave live
 * report documents behind — each one still a working 90-day bearer token to that
 * person's health data (D17), reachable by anyone holding the link.
 *
 * That is the exact opposite of what the erasure control promises, so any future
 * code path that deletes a prospect must call this too.
 */
export async function deleteReportsForProspect(prospectId: string): Promise<void> {
  const snap = await reports().where("prospectId", "==", prospectId).get();
  if (snap.empty) return;
  const batch = reports().firestore.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
}
