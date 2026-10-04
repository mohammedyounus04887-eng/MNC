import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { hashHandoffRequest, validateHandoffRequest, type HandoffRequest } from "./contract";
import { signHandoffAssertion, type ServiceSigningConfig } from "./serverAssertion";
import { MAX_HANDOFF_ATTEMPTS } from "./experience";

export type HandoffDeliveryResult = { httpStatus: number; body: Record<string, unknown> };
type HandoffOperation = { requestHash: string; intentHash: string; request: HandoffRequest; status: string; attempt: number; canonicalClubMemberId: string | null; [key: string]: unknown };

const operationId = (key: string) => createHash("sha256").update(`growline-club:${key}`).digest("hex");
const intentHash = (request: HandoffRequest) => {
  const intent = Object.fromEntries(Object.entries(request).filter(([key]) => key !== "handoffId" && key !== "consentTimestamp"));
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
};

export async function deliverHandoff(params: {
  db: Firestore;
  request: HandoffRequest;
  actorUid: string;
  clubProject: string;
  destinationUrl: string;
  signing: ServiceSigningConfig;
  fetcher?: typeof fetch;
}): Promise<HandoffDeliveryResult> {
  const { db, request, actorUid, clubProject, destinationUrl, signing } = params;
  const validated = validateHandoffRequest(request);
  if (!validated.ok) return { httpStatus: 422, body: { error: "PROSPECT_DATA_NOT_TRANSFERABLE", reason: validated.reason } };
  if (request.sourceCoachId !== actorUid) return { httpStatus: 403, body: { error: "SOURCE_COACH_MISMATCH" } };

  const hash = hashHandoffRequest(request);
  const logicalHash = intentHash(request);
  const opId = operationId(request.idempotencyKey);
  const opRef = db.collection("integrationHandoffs").doc(opId);
  const claim = await db.runTransaction(async (tx) => {
    const current = await tx.get(opRef);
    if (current.exists) {
      const existing = current.data() as HandoffOperation | undefined;
      if (existing?.intentHash !== logicalHash || !existing.request) return { kind: "CONFLICT" as const };
      if (existing.status === "SUCCEEDED") return { kind: "REPLAY" as const, result: existing };
      if (existing.status !== "PENDING" || existing.attempt >= MAX_HANDOFF_ATTEMPTS) return { kind: "TERMINAL" as const, result: existing };
      const now = Timestamp.now();
      const attempt = existing.attempt + 1;
      tx.update(opRef, { attempt, updatedAt: now, history: FieldValue.arrayUnion({ status: "PENDING", actor: actorUid, reasonCode: "same_key_retry", attempt, at: now }) });
      return { kind: "RETRY" as const, result: { ...existing, attempt } };
    }
    const prospectRef = db.collection("prospects").doc(request.sourceGrowLineProspectId);
    const linkRef = db.collection("integrationLinks").doc(request.linkId);
    const userRef = db.collection("users").doc(actorUid);
    const [prospect, link, user] = await Promise.all([tx.get(prospectRef), tx.get(linkRef), tx.get(userRef)]);
    if (!prospect.exists || prospect.get("coachId") !== actorUid || user.get("workspaceId") !== request.workspaceId ||
        (prospect.get("workspaceId") && prospect.get("workspaceId") !== request.workspaceId)) return { kind: "DENIED" as const, error: "SOURCE_LINK_CHANGED" };
    if (prospect.get("stage") !== "member") return { kind: "DENIED" as const, error: "MEMBER_STAGE_REQUIRED" };
    if (!link.exists || link.get("status") !== "active" || link.get("growlineAuthUid") !== actorUid ||
        link.get("workspaceId") !== request.workspaceId || link.get("clubId") !== request.destinationClubId || link.get("clubProject") !== clubProject ||
        link.get("growlineProject") !== signing.growlineProject || link.get("verificationMethod") !== "dual_authenticated_consent") {
      return { kind: "DENIED" as const, error: "ACTIVE_DUAL_VERIFIED_LINK_REQUIRED" };
    }
    const now = Timestamp.now();
    tx.create(opRef, {
      schemaVersion: 2, operationId: opId, idempotencyKey: request.idempotencyKey,
      requestHash: hash, intentHash: logicalHash, status: "PENDING", request,
      canonicalClubMemberId: null, attempt: 1, createdAt: now, updatedAt: now,
      history: [{ status: "PENDING", actor: actorUid, reasonCode: "explicit_add_to_club_submitted", attempt: 1, at: now }],
    });
    tx.update(prospectRef, { integrationHandoffOperationId: opId });
    return { kind: "CLAIMED" as const };
  });
  if (claim.kind === "CONFLICT") return { httpStatus: 409, body: { error: "IDEMPOTENCY_CONFLICT" } };
  if (claim.kind === "DENIED") return { httpStatus: claim.error === "MEMBER_STAGE_REQUIRED" ? 409 : 403, body: { error: claim.error } };
  if (claim.kind === "REPLAY") return { httpStatus: 200, body: { status: "SUCCEEDED", canonicalClubMemberId: claim.result.canonicalClubMemberId, operationId: opId, replay: true } };
  if (claim.kind === "TERMINAL") return { httpStatus: 409, body: { status: claim.result.status, canonicalClubMemberId: claim.result.canonicalClubMemberId ?? null, operationId: opId, reasonCode: claim.result.lastErrorCode ?? null, attempts: claim.result.attempt, canRetry: false } };
  const requestToSend = claim.kind === "CLAIMED" ? request : claim.result.request;
  const requestHashToSend = claim.kind === "CLAIMED" ? hash : claim.result.requestHash;

  try {
    const assertion = signHandoffAssertion(requestToSend, actorUid, { ...signing, clubProject });
    const destination = await (params.fetcher ?? fetch)(destinationUrl, {
      method: "POST", redirect: "error", headers: { "content-type": "application/json", authorization: `Bearer ${assertion}` },
      body: JSON.stringify(requestToSend), cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const result: unknown = await destination.json().catch(() => null);
    const resultObject = result && typeof result === "object" ? result as Record<string, unknown> : null;
    const canonicalId = typeof resultObject?.canonicalClubMemberId === "string" ? resultObject.canonicalClubMemberId : null;
    const succeeded = destination.ok && canonicalId !== null;
    const destinationStatus = resultObject?.status;
    const status = succeeded ? "SUCCEEDED"
      : destinationStatus === "MANUAL_REVIEW_REQUIRED" ? "MANUAL_REVIEW_REQUIRED"
      : destinationStatus === "FAILED_FINAL" || destinationStatus === "REJECTED" ? "FAILED_FINAL"
      : "PENDING";
    const reasonCode = String(resultObject?.reasonCode ?? resultObject?.code ?? `destination_http_${destination.status}`);
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(opRef);
      if (!fresh.exists || fresh.data()?.requestHash !== requestHashToSend) throw new Error("HANDOFF_STATE_CHANGED");
      const current = fresh.data();
      if (current?.status === "SUCCEEDED") {
        if (current.canonicalClubMemberId !== canonicalId) throw new Error("CANONICAL_MEMBER_CONFLICT");
        return;
      }
      const prospectRef = db.collection("prospects").doc(requestToSend.sourceGrowLineProspectId);
      const linkRef = db.collection("integrationLinks").doc(requestToSend.linkId);
      const sourceMemberMapRef = db.collection("integrationMemberLinks").doc(createHash("sha256").update(`${requestToSend.linkId}:${requestToSend.growlineMemberId}`).digest("hex"));
      const [prospectSnapshot, linkSnapshot, sourceMemberMapSnapshot] = await Promise.all([tx.get(prospectRef), tx.get(linkRef), tx.get(sourceMemberMapRef)]);
      if (!prospectSnapshot.exists || prospectSnapshot.data()?.coachId !== actorUid || !linkSnapshot.exists || linkSnapshot.data()?.growlineAuthUid !== actorUid || linkSnapshot.data()?.workspaceId !== requestToSend.workspaceId) throw new Error("SOURCE_LINK_CHANGED");
      if (sourceMemberMapSnapshot.exists && sourceMemberMapSnapshot.data()?.canonicalClubMemberId !== canonicalId) throw new Error("SOURCE_MEMBER_MAPPING_CONFLICT");
      const now = Timestamp.now();
      tx.update(opRef, {
        status, canonicalClubMemberId: succeeded ? canonicalId : null,
        lastErrorCode: succeeded ? null : reasonCode, updatedAt: now,
        history: FieldValue.arrayUnion({ status, actor: "growline-service", reasonCode: succeeded ? "club_confirmed" : reasonCode, attempt: Number(fresh.data()?.attempt ?? 1), at: now }),
      });
      if (succeeded) {
        tx.update(prospectRef, { stage: "member", clubId: requestToSend.destinationClubId, clubMemberId: canonicalId, integrationLinkId: requestToSend.linkId, updatedAt: now });
        if (!sourceMemberMapSnapshot.exists) tx.create(sourceMemberMapRef, {
          schemaVersion: 1, linkId: requestToSend.linkId, growlineMemberId: requestToSend.growlineMemberId,
          sourceGrowLineProspectId: requestToSend.sourceGrowLineProspectId, clubId: requestToSend.destinationClubId,
          canonicalClubMemberId: canonicalId, createdAt: now,
        });
      }
    });
    return succeeded
      ? { httpStatus: 200, body: { status: "SUCCEEDED", canonicalClubMemberId: canonicalId, operationId: opId } }
      : { httpStatus: status === "PENDING" ? 202 : 409, body: { status, operationId: opId, reasonCode } };
  } catch {
    // Keep the durable operation PENDING: Club may have committed before a timeout.
    return { httpStatus: 202, body: { status: "PENDING", operationId: opId } };
  }
}
