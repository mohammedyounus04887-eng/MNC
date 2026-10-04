import { FieldPath, FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

export const HEALTH_RETENTION_DAYS = 180;
const REPORT_PAGE_SIZE = 200;
const MAX_PROSPECTS_PER_RUN = 50;

/** Bounded, resumable scan. Missing activity/workspace evidence never authorizes deletion. */
export async function purgeHealthRetention(
  db: Firestore,
  now = new Date(),
  options: { dryRun?: boolean; limit?: number } = {},
) {
  const limit = Math.max(1, Math.min(MAX_PROSPECTS_PER_RUN, options.limit ?? MAX_PROSPECTS_PER_RUN));
  const cutoff = Timestamp.fromMillis(now.getTime() - HEALTH_RETENTION_DAYS * 86_400_000);
  const checkpointRef = db.doc("jobState/healthRetention");
  const checkpoint = options.dryRun ? null : (await checkpointRef.get()).data();
  const baseQuery = db.collection("prospects").where("lastActivityAt", "<=", cutoff)
    .orderBy("lastActivityAt").orderBy(FieldPath.documentId());
  const query = checkpoint?.lastActivityAt instanceof Timestamp && typeof checkpoint?.lastId === "string"
    ? baseQuery.startAfter(checkpoint.lastActivityAt, checkpoint.lastId) : baseQuery;
  let page = await query.limit(limit).get();
  if (page.empty && checkpoint) page = await baseQuery.limit(limit).get();
  let purged = 0;
  let skipped = 0;
  let reportsDeleted = 0;
  let pending = 0;
  for (const candidate of page.docs) {
    const outcome = await db.runTransaction(async (tx) => {
      const current = await tx.get(candidate.ref);
      const data = current.data();
      if (!data || !(data.lastActivityAt instanceof Timestamp) || data.lastActivityAt.toMillis() > cutoff.toMillis() ||
          typeof data.coachId !== "string" || typeof data.workspaceId !== "string" || !data.workspaceId) return null;
      const coach = await tx.get(db.doc(`users/${data.coachId}`));
      if (coach.data()?.workspaceId !== data.workspaceId || coach.get("disabled") === true) return null;
      // A transaction retry rechecks activity and ownership before deleting any report.
      const reports = await tx.get(db.collection("reports").where("prospectId", "==", current.id).limit(REPORT_PAGE_SIZE));
      if (reports.docs.some((report) => report.data().workspaceId !== data.workspaceId || report.data().coachId !== data.coachId)) return null;
      const hasHealth = [data.heightCm, data.weightKg, data.age, data.gender].some((value) => value != null);
      if (!hasHealth && reports.empty) return { changed: false, reports: 0, pending: false };
      if (!options.dryRun) {
        for (const report of reports.docs) tx.delete(report.ref);
        tx.update(current.ref, {
          heightCm: null, weightKg: null, age: null, gender: null,
          healthPurgedAt: FieldValue.serverTimestamp(),
          healthPurgePending: reports.size === REPORT_PAGE_SIZE,
        });
      }
      return { changed: true, reports: reports.size, pending: reports.size === REPORT_PAGE_SIZE };
    });
    if (!outcome) { skipped++; continue; }
    if (outcome.changed) purged++;
    reportsDeleted += outcome.reports;
    if (outcome.pending) pending++;
  }
  if (!options.dryRun) {
    const last = page.docs.at(-1);
    await checkpointRef.set({
      lastId: page.size === limit && last ? last.id : null,
      lastActivityAt: page.size === limit && last ? last.get("lastActivityAt") : null,
      scanned: page.size, purged, skipped, reportsDeleted, pending,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  return { dryRun: options.dryRun === true, scanned: page.size, purged, skipped, reportsDeleted, pending };
}
