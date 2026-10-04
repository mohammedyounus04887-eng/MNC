/** Current server-owned workspace membership is the authority for job audiences. */
export function scopedJobPeople<T extends { id: string; workspaceId: string; uplineId: string | null; uplinePath: string[] }>(rows: T[]): T[] {
  const people = rows.filter((row) => typeof row.workspaceId === "string" && row.workspaceId.length > 0);
  const workspaces = new Map(people.map((row) => [row.id, row.workspaceId]));
  return people.map((row) => ({
    ...row,
    uplineId: row.uplineId && workspaces.get(row.uplineId) === row.workspaceId ? row.uplineId : null,
    uplinePath: row.uplinePath.filter((uid) => workspaces.get(uid) === row.workspaceId),
  }));
}

/** Stop rather than publish a silently truncated aggregate. Jobs stay off by default. */
export const JOB_SCAN_LIMIT = 10_000;
export function requireCompleteJobScan(snapshot: { size: number }): void {
  if (snapshot.size > JOB_SCAN_LIMIT) throw new Error("JOB_SCAN_BUDGET_EXCEEDED");
}

import type { DocumentData, Query, QuerySnapshot } from "firebase-admin/firestore";
export async function boundedJobRead<T extends DocumentData>(query: Query<T>): Promise<QuerySnapshot<T>> {
  const snapshot = await query.limit(JOB_SCAN_LIMIT + 1).get();
  requireCompleteJobScan(snapshot);
  return snapshot;
}
