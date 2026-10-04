import { FieldValue, Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { operationDocumentId, type DestinationRequest } from "./integrationHandoff";

export type HandoffStatus = "PENDING" | "SUCCEEDED" | "FAILED_RETRYABLE" | "FAILED_FINAL" | "MANUAL_REVIEW_REQUIRED";
export const MAX_HANDOFF_ATTEMPTS = 8;
export type HandoffRecord = {
  operationId: string;
  requestHash: string;
  schemaVersion: 2;
  clubId: string;
  source: { workspaceId: string; growlineMemberId: string; handoffId: string };
  status: HandoffStatus;
  canonicalClubMemberId: string | null;
  attempt: number;
  lastErrorCode: string | null;
  history: Array<{ status: HandoffStatus; actor: string; reasonCode: string; requestHash: string; attempt: number; at: Timestamp }>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type ClaimResult =
  | { kind: "CLAIMED"; operationId: string }
  | { kind: "REPLAY"; record: HandoffRecord }
  | { kind: "IDEMPOTENCY_CONFLICT" };

const collection = (db: Firestore) => db.collection("integrationHandoffs");

/** Claiming is atomic: the operation document is the idempotency boundary. */
export async function claimHandoff(
  db: Firestore,
  tx: Transaction,
  request: DestinationRequest,
  requestHash: string,
): Promise<ClaimResult> {
  const operationId = operationDocumentId(request.idempotencyKey);
  const ref = collection(db).doc(operationId);
  const existing = await tx.get(ref);
  if (existing.exists) {
    const record = existing.data() as HandoffRecord;
    return record.requestHash === requestHash
      ? { kind: "REPLAY", record }
      : { kind: "IDEMPOTENCY_CONFLICT" };
  }
  const now = Timestamp.now();
  tx.create(ref, {
    operationId, requestHash, schemaVersion: 2, clubId: request.clubId,
    source: { workspaceId: request.workspaceId, growlineMemberId: request.growlineMemberId, handoffId: request.handoffId },
    status: "PENDING", canonicalClubMemberId: null, attempt: 1,
    lastErrorCode: null,
    history: [{ status: "PENDING", actor: "growline-service", reasonCode: "request_accepted", requestHash, attempt: 1, at: now }],
    createdAt: now, updatedAt: now,
  } satisfies HandoffRecord);
  return { kind: "CLAIMED", operationId };
}

export async function readHandoff(db: Firestore, idempotencyKey: string): Promise<HandoffRecord | null> {
  const snapshot = await collection(db).doc(operationDocumentId(idempotencyKey)).get();
  return snapshot.exists ? snapshot.data() as HandoffRecord : null;
}

const allowedTransitions: Readonly<Record<HandoffStatus, readonly HandoffStatus[]>> = {
  PENDING: ["SUCCEEDED", "FAILED_RETRYABLE", "FAILED_FINAL", "MANUAL_REVIEW_REQUIRED"],
  FAILED_RETRYABLE: ["PENDING", "SUCCEEDED", "FAILED_FINAL", "MANUAL_REVIEW_REQUIRED"],
  SUCCEEDED: [],
  FAILED_FINAL: [],
  MANUAL_REVIEW_REQUIRED: [],
};

/** A timeout leaves PENDING untouched; callers reconcile by reading this durable record. */
export async function transitionHandoff(
  db: Firestore,
  operationId: string,
  status: HandoffStatus,
  canonicalClubMemberId: string | null,
  actor: string,
  reasonCode: string,
  errorCode: string | null = null,
): Promise<HandoffRecord> {
  const ref = collection(db).doc(operationId);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error("HANDOFF_NOT_FOUND");
    const current = snapshot.data() as HandoffRecord;
    if (current.status === status) return current;
    if (!allowedTransitions[current.status].includes(status)) throw new Error("INVALID_HANDOFF_TRANSITION");
    if (!actor.trim() || !reasonCode.trim()) throw new Error("AUDIT_METADATA_REQUIRED");
    if (status === "PENDING" && current.status === "FAILED_RETRYABLE" && current.attempt >= MAX_HANDOFF_ATTEMPTS) {
      throw new Error("RETRY_BUDGET_EXHAUSTED");
    }
    if (status === "SUCCEEDED" && !canonicalClubMemberId) throw new Error("CANONICAL_MEMBER_REQUIRED");
    const nextAttempt = current.attempt + (status === "PENDING" ? 1 : 0);
    const updatedAt = Timestamp.now();
    const historyEntry = { status, actor, reasonCode, requestHash: current.requestHash, attempt: nextAttempt, at: updatedAt };
    tx.update(ref, {
      status,
      canonicalClubMemberId,
      attempt: nextAttempt,
      lastErrorCode: errorCode,
      history: FieldValue.arrayUnion(historyEntry),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ...current, status, canonicalClubMemberId, attempt: nextAttempt, lastErrorCode: errorCode, history: [...current.history, historyEntry] };
  });
}
