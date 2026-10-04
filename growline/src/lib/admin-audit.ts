import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase-admin";

/**
 * Every admin action that changes anything, recorded (F12).
 *
 * The panel is read-only almost everywhere, which is what makes this cheap: there are
 * only a handful of writes, so logging all of them is a few lines rather than a framework.
 *
 * ## Why it records the actor's name as well as their id
 *
 * A uid is unreadable six months later, and the user document it points at can change or —
 * once accounts can be closed — stop existing. An audit entry has to stay legible without
 * a join to anything, so it carries the name as it was at the time. Same reasoning as the
 * denormalised `senderName` on threads.
 *
 * ## Denied to clients, including admins
 *
 * `firestore.rules` refuses this collection to every browser. An audit trail the audited
 * party can read is one they can learn to work around. The panel renders it server-side.
 */

export const ADMIN_ACTIONS = ["broadcast", "mint-promo-code"] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export type AuditEntry = {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  detail: string;
  createdAt: Date;
};

const AUDIT = "adminAudit";
const DETAIL_MAX = 500;

export async function recordAdminAction(params: {
  actorId: string;
  actorName: string;
  action: AdminAction;
  /** Human-readable, and it is what somebody reads in six months. Be specific. */
  detail: string;
}): Promise<void> {
  await db.collection(AUDIT).add({
    actorId: params.actorId,
    actorName: params.actorName,
    action: params.action,
    // Truncated rather than rejected: an over-long detail must never be the reason an
    // action fails to be logged.
    detail: params.detail.slice(0, DETAIL_MAX),
    createdAt: Timestamp.now(),
  });
}

export async function listAuditEntries(limit = 100): Promise<AuditEntry[]> {
  const snap = await db
    .collection(AUDIT)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      actorId: d.actorId ?? "",
      actorName: d.actorName ?? "",
      action: d.action ?? "",
      detail: d.detail ?? "",
      createdAt: d.createdAt?.toDate?.() ?? new Date(0),
    };
  });
}
