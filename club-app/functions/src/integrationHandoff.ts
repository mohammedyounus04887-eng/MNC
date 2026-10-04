import { createHash } from "node:crypto";
import { createHmac, timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

const verifiedCallerBrand: unique symbol = Symbol("verifiedCaller");
export type VerifiedDestinationCaller = {
  readonly caller: "growline-service";
  readonly audience: string;
  readonly keyId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly requestHash: string;
  readonly growlineAuthUid: string;
  readonly growlineProject: string;
  readonly clubProject: string;
  readonly [verifiedCallerBrand]: true;
};

export type ServerAuthConfig = {
  audience: string;
  growlineProject: string;
  clubProject: string;
  activeKeys: ReadonlyMap<string, string>;
  maxTokenAgeSeconds: number;
};

export type ServerAuthResult =
  | { ok: true; caller: VerifiedDestinationCaller }
  | { ok: false; code: "MISSING_BEARER" | "MALFORMED_ASSERTION" | "UNKNOWN_KEY" | "INVALID_SIGNATURE" | "WRONG_AUDIENCE" | "WRONG_PROJECT" | "EXPIRED_ASSERTION" | "INVALID_ASSERTION_TIME" };

/** Verify a short-lived server assertion. Secrets are supplied only by server config. */
export function verifyServerAssertion(
  authorization: string | null,
  config: ServerAuthConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): ServerAuthResult {
  if (!authorization?.startsWith("Bearer ")) return { ok: false, code: "MISSING_BEARER" };
  const token = authorization.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, code: "MALFORMED_ASSERTION" };
  let header: { alg?: unknown; typ?: unknown };
  let claims: { iss?: unknown; aud?: unknown; kid?: unknown; iat?: unknown; exp?: unknown; requestHash?: unknown; growlineAuthUid?: unknown; growlineProject?: unknown; clubProject?: unknown };
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as typeof header;
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as typeof claims;
  } catch {
    return { ok: false, code: "MALFORMED_ASSERTION" };
  }
  if (header.alg !== "HS256" || header.typ !== "JWT" || claims.iss !== "growline-service" || typeof claims.kid !== "string" || typeof claims.requestHash !== "string" || !/^[a-f0-9]{64}$/.test(claims.requestHash) || typeof claims.growlineAuthUid !== "string" || !ID.test(claims.growlineAuthUid) || typeof claims.growlineProject !== "string" || typeof claims.clubProject !== "string") return { ok: false, code: "MALFORMED_ASSERTION" };
  const key = config.activeKeys.get(claims.kid);
  if (!key) return { ok: false, code: "UNKNOWN_KEY" };
  const signed = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", key).update(signed).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(parts[2], "base64url"); } catch { return { ok: false, code: "MALFORMED_ASSERTION" }; }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return { ok: false, code: "INVALID_SIGNATURE" };
  if (claims.aud !== config.audience) return { ok: false, code: "WRONG_AUDIENCE" };
  if (claims.growlineProject !== config.growlineProject || claims.clubProject !== config.clubProject) return { ok: false, code: "WRONG_PROJECT" };
  if (typeof claims.iat !== "number" || typeof claims.exp !== "number" || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > nowSeconds || claims.exp <= nowSeconds || claims.exp - claims.iat > config.maxTokenAgeSeconds) {
    return { ok: false, code: "INVALID_ASSERTION_TIME" };
  }
  return { ok: true, caller: { caller: "growline-service", audience: config.audience, growlineProject: claims.growlineProject, clubProject: claims.clubProject, keyId: claims.kid, issuedAt: claims.iat, expiresAt: claims.exp, requestHash: claims.requestHash, growlineAuthUid: claims.growlineAuthUid, [verifiedCallerBrand]: true } };
}

export type DestinationRequest = {
  schemaVersion: 2;
  handoffId: string;
  idempotencyKey: string;
  growlineMemberId: string;
  workspaceId: string;
  clubId: string;
  destinationClubId: string;
  linkId: string;
  displayName: string;
  phone: string;
  phoneVerification: { status: "verified" | "unverified"; method: string; verifiedAt: string | null };
  email: string | null;
  emailVerification: { status: "verified" | "unverified"; method: string; verifiedAt: string | null } | null;
  sourceCoachId: string;
  sourceGrowLineProspectId: string;
  consentTimestamp: string;
  consentVersion: string;
};

export type DestinationDecision =
  | { ok: true; request: DestinationRequest; requestHash: string }
  | { ok: false; code: string };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FIELDS = [
  "schemaVersion", "handoffId", "idempotencyKey", "growlineMemberId",
  "workspaceId", "clubId", "destinationClubId", "linkId", "displayName", "phone", "phoneVerification",
  "email", "emailVerification", "sourceCoachId", "sourceGrowLineProspectId",
  "consentTimestamp", "consentVersion",
] as const;

export function validateDestinationRequest(
  auth: VerifiedDestinationCaller,
  value: unknown,
  expectedAudience: string,
): DestinationDecision {
  if (auth.audience !== expectedAudience) return { ok: false, code: "WRONG_AUDIENCE" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "MALFORMED_REQUEST" };
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !FIELDS.includes(key as (typeof FIELDS)[number]))) return { ok: false, code: "UNCONTRACTED_FIELDS" };
  if (body.schemaVersion !== 2) return { ok: false, code: "UNSUPPORTED_VERSION" };
  for (const field of ["handoffId", "idempotencyKey", "growlineMemberId", "workspaceId", "clubId", "destinationClubId", "linkId", "sourceCoachId", "sourceGrowLineProspectId"] as const) {
    if (typeof body[field] !== "string" || !ID.test(body[field])) return { ok: false, code: `INVALID_${field.toUpperCase()}` };
  }
  if (body.destinationClubId !== body.clubId) return { ok: false, code: "DESTINATION_CLUB_MISMATCH" };
  if (body.sourceCoachId !== auth.growlineAuthUid) return { ok: false, code: "SOURCE_COACH_MISMATCH" };
  if (typeof body.displayName !== "string" || !body.displayName.trim() || body.displayName.length > 100) return { ok: false, code: "INVALID_DISPLAY_NAME" };
  if (typeof body.phone !== "string" || !/^\+?[0-9]{7,15}$/.test(body.phone)) return { ok: false, code: "INVALID_PHONE" };
  if (!validVerification(body.phoneVerification, true)) return { ok: false, code: "INVALID_PHONE_PROVENANCE" };
  if (body.email !== null && (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))) return { ok: false, code: "INVALID_EMAIL" };
  if (body.email === null ? body.emailVerification !== null : !validVerification(body.emailVerification, false)) return { ok: false, code: "INVALID_EMAIL_PROVENANCE" };
  if (typeof body.consentTimestamp !== "string" || Number.isNaN(Date.parse(body.consentTimestamp)) || Date.parse(body.consentTimestamp) > Date.now() || typeof body.consentVersion !== "string" || !ID.test(body.consentVersion)) return { ok: false, code: "INVALID_CONSENT" };
  const request = body as DestinationRequest;
  const requestHash = normalizedRequestHash(request);
  if (auth.requestHash !== requestHash) return { ok: false, code: "REQUEST_HASH_MISMATCH" };
  return { ok: true, request, requestHash };
}

export function normalizedRequestHash(request: DestinationRequest): string {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: request.schemaVersion,
    handoffId: request.handoffId,
    idempotencyKey: request.idempotencyKey,
    growlineMemberId: request.growlineMemberId,
    workspaceId: request.workspaceId,
    clubId: request.clubId,
    destinationClubId: request.destinationClubId,
    linkId: request.linkId,
    displayName: request.displayName.trim(),
    phone: normalizePhone(request.phone),
    phoneVerification: request.phoneVerification,
    email: request.email?.trim().toLowerCase() ?? null,
    emailVerification: request.emailVerification,
    sourceCoachId: request.sourceCoachId,
    sourceGrowLineProspectId: request.sourceGrowLineProspectId,
    consentTimestamp: request.consentTimestamp,
    consentVersion: request.consentVersion,
  })).digest("hex");
}

function validVerification(value: unknown, required: boolean): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return !required && value === null;
  const proof = value as Record<string, unknown>;
  if (Object.keys(proof).some((key) => !["status", "method", "verifiedAt"].includes(key))) return false;
  return (proof.status === "verified" || proof.status === "unverified") && typeof proof.method === "string" && proof.method.length > 0 &&
    (proof.verifiedAt === null || (typeof proof.verifiedAt === "string" && !Number.isNaN(Date.parse(proof.verifiedAt)))) &&
    (proof.status !== "verified" || (typeof proof.verifiedAt === "string" && Date.parse(proof.verifiedAt) <= Date.now()));
}

function normalizePhone(value: string): string {
  return value.replace(/[^0-9+]/g, "");
}

function contactClaimId(kind: "phone" | "email", value: string): string {
  return createHash("sha256").update(`${kind}:${kind === "phone" ? normalizePhone(value) : value.trim().toLowerCase()}`).digest("hex");
}

function sourceMemberMapId(request: DestinationRequest, growlineProject: string): string {
  return createHash("sha256").update(`${growlineProject}:${request.workspaceId}:${request.growlineMemberId}`).digest("hex");
}

export function operationDocumentId(idempotencyKey: string): string {
  return createHash("sha256").update(`club-growline:${idempotencyKey}`).digest("hex");
}

export type MemberCandidate = { clubId: string; memberId: string; verified: boolean; active: boolean };
export type MemberResolution =
  | { outcome: "EXISTING_VERIFIED_MEMBER"; memberId: string }
  | { outcome: "NO_ACCEPTABLE_MATCH" }
  | { outcome: "MANUAL_REVIEW_REQUIRED"; reason: string };

export function resolveClubMember(clubId: string, candidates: MemberCandidate[]): MemberResolution {
  const eligible = candidates.filter((candidate) => candidate.clubId === clubId && candidate.active && candidate.verified);
  if (eligible.length === 0) return { outcome: "NO_ACCEPTABLE_MATCH" };
  if (eligible.length > 1) return { outcome: "MANUAL_REVIEW_REQUIRED", reason: "ambiguous_members" };
  return { outcome: "EXISTING_VERIFIED_MEMBER", memberId: eligible[0].memberId };
}

export type HandoffResponse =
  | { status: "SUCCEEDED"; outcome: "MATCHED" | "already_exists"; operationId: string; canonicalClubMemberId: string }
  | { status: "PENDING" | "FAILED_RETRYABLE" | "FAILED_FINAL" | "MANUAL_REVIEW_REQUIRED"; outcome: "pending" | "rejected" | "manual_review_required"; operationId: string; canonicalClubMemberId: null; reasonCode: string };

/**
 * Club-owned, server-only destination handler. It resolves or creates the canonical Club member using the approved v2
 * allowlist. All creation and contact-claim writes are Club-owned and atomic.
 */
export async function processHandoff(
  db: Firestore,
  caller: VerifiedDestinationCaller,
  request: DestinationRequest,
  expectedAudience: string,
): Promise<HandoffResponse | { status: "REJECTED"; code: string }> {
  const validation = validateDestinationRequest(caller, request, expectedAudience);
  if (!validation.ok) return { status: "REJECTED", code: validation.code };

  const operationId = operationDocumentId(request.idempotencyKey);
  const operationRef = db.collection("integrationHandoffs").doc(operationId);
  const clubRef = db.doc(`clubs/${request.clubId}`);
  const configRef = db.doc(`clubs/${request.clubId}/integrationConfig/growline`);
  const linkRef = db.doc(`clubs/${request.clubId}/integrationLinks/${request.linkId}`);
  const memberMapRef = db.doc(`clubs/${request.clubId}/integrationMembers/${sourceMemberMapId(request, caller.growlineProject)}`);

  return db.runTransaction(async (tx) => {
    // Complete every read before the first write, as required by Firestore.
    const operationSnap = await tx.get(operationRef);
    const clubSnap = await tx.get(clubRef);
    const configSnap = await tx.get(configRef);
    const linkSnap = await tx.get(linkRef);
    const memberMapSnap = await tx.get(memberMapRef);

    const existingOperation = operationSnap.exists ? operationSnap.data() : null;
    if (existingOperation) {
      const operation = existingOperation;
      if (operation?.requestHash !== validation.requestHash) return { status: "REJECTED", code: "IDEMPOTENCY_CONFLICT" };
      if (operation?.status === "SUCCEEDED" && typeof operation.canonicalClubMemberId === "string") {
        return { status: "SUCCEEDED", outcome: "already_exists", operationId, canonicalClubMemberId: operation.canonicalClubMemberId };
      }
      if (operation?.status === "MANUAL_REVIEW_REQUIRED") {
        return { status: "MANUAL_REVIEW_REQUIRED", outcome: "manual_review_required", operationId, canonicalClubMemberId: null, reasonCode: operation.lastErrorCode ?? "manual_review" };
      }
      if (operation?.status === "FAILED_FINAL") return { status: "FAILED_FINAL", outcome: "rejected", operationId, canonicalClubMemberId: null, reasonCode: operation.lastErrorCode ?? "failed_final" };
      if (operation?.status !== "PENDING" && operation?.status !== "FAILED_RETRYABLE") {
        return { status: "REJECTED", code: "INVALID_OPERATION_STATE" };
      }
      if (operation.status === "FAILED_RETRYABLE" && operation.attempt >= 8) {
        return { status: "FAILED_FINAL", outcome: "rejected", operationId, canonicalClubMemberId: null, reasonCode: "retry_budget_exhausted" };
      }
    }

    if (!clubSnap.exists || clubSnap.data()?.status === "disabled") return { status: "REJECTED", code: "INVALID_DESTINATION_CLUB" };
    if (!configSnap.exists || configSnap.data()?.enabled !== true || configSnap.data()?.schemaVersion !== 1) return { status: "REJECTED", code: "INTEGRATION_NOT_ACTIVE" };
    const link = linkSnap.data();
    if (!linkSnap.exists || link?.status !== "active" || link?.schemaVersion !== 1 || link?.verificationMethod !== "dual_authenticated_consent" || !link?.verifiedAt || link?.growlineProject !== caller.growlineProject || link?.clubProject !== caller.clubProject || link?.workspaceId !== request.workspaceId || link?.growlineAuthUid !== caller.growlineAuthUid || link?.linkId !== request.linkId) {
      return { status: "REJECTED", code: "ACTIVE_IDENTITY_LINK_REQUIRED" };
    }

    const now = Timestamp.now();
    const hash = validation.requestHash;
    const attempt = existingOperation
      ? existingOperation.attempt + (existingOperation.status === "FAILED_RETRYABLE" ? 1 : 0)
      : 1;
    const history = existingOperation?.history ?? [{ status: "PENDING", actor: caller.caller, reasonCode: "request_accepted", requestHash: hash, attempt: 1, at: now }];
    const baseRecord = {
      operationId, requestHash: hash, schemaVersion: 2, clubId: request.clubId,
      source: { workspaceId: request.workspaceId, growlineMemberId: request.growlineMemberId, handoffId: request.handoffId },
      attempt, history, createdAt: existingOperation?.createdAt ?? now, updatedAt: now,
    };
    const writeOperation = (record: Record<string, unknown>): void => {
      if (operationSnap.exists) tx.update(operationRef, record);
      else tx.create(operationRef, record);
    };
    let canonicalClubMemberId: string | null = null;
    let memberToCreate: Record<string, unknown> | null = null;
    let claimsToCreate: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];
    if (memberMapSnap.exists) {
      const mapping = memberMapSnap.data();
      if (mapping?.growlineMemberId !== request.growlineMemberId || mapping?.workspaceId !== request.workspaceId || mapping?.growlineProject !== caller.growlineProject || mapping?.sourceCoachId !== request.sourceCoachId || mapping?.sourceGrowLineProspectId !== request.sourceGrowLineProspectId) {
        const reasonCode = "source_identity_mapping_conflict";
        writeOperation({ ...baseRecord, status: "MANUAL_REVIEW_REQUIRED", canonicalClubMemberId: null, lastErrorCode: reasonCode, history: [...history, { status: "MANUAL_REVIEW_REQUIRED", actor: caller.caller, reasonCode, requestHash: hash, attempt, at: now }] });
        return { status: "MANUAL_REVIEW_REQUIRED", outcome: "manual_review_required", operationId, canonicalClubMemberId: null, reasonCode };
      }
      canonicalClubMemberId = typeof mapping.canonicalClubMemberId === "string" ? mapping.canonicalClubMemberId : null;
    }
    if (!canonicalClubMemberId) {
      const phoneClaimRef = db.doc(`clubs/${request.clubId}/integrationContactClaims/${contactClaimId("phone", request.phone)}`);
      const emailClaimRef = request.email && request.emailVerification?.status === "verified"
        ? db.doc(`clubs/${request.clubId}/integrationContactClaims/${contactClaimId("email", request.email)}`)
        : null;
      const phoneQuery = request.phoneVerification.status === "verified"
        ? db.collection(`clubs/${request.clubId}/members`).where("phone", "==", normalizePhone(request.phone))
        : null;
      const emailQuery = emailClaimRef
        ? db.collection(`clubs/${request.clubId}/members`).where("email", "==", request.email!.trim().toLowerCase())
        : null;
      const phoneClaim = await tx.get(phoneClaimRef);
      const emailClaim = emailClaimRef ? await tx.get(emailClaimRef) : null;
      const phoneMatches = phoneQuery ? await tx.get(phoneQuery) : null;
      const emailMatches = emailQuery ? await tx.get(emailQuery) : null;
      const candidates = new Set<string>();
      if (phoneClaim.exists) candidates.add(String(phoneClaim.data()?.memberId ?? ""));
      if (emailClaim?.exists) candidates.add(String(emailClaim.data()?.memberId ?? ""));
      for (const candidate of phoneMatches?.docs ?? []) if (candidate.data().phoneVerification?.status === "verified") candidates.add(candidate.id);
      for (const candidate of emailMatches?.docs ?? []) if (candidate.data().emailVerification?.status === "verified") candidates.add(candidate.id);
      candidates.delete("");
      if (candidates.size > 1) {
        const reasonCode = "conflicting_verified_contact_evidence";
        writeOperation({ ...baseRecord, status: "MANUAL_REVIEW_REQUIRED", canonicalClubMemberId: null, lastErrorCode: reasonCode, history: [...history, { status: "MANUAL_REVIEW_REQUIRED", actor: caller.caller, reasonCode, requestHash: hash, attempt, at: now }] });
        return { status: "MANUAL_REVIEW_REQUIRED", outcome: "manual_review_required", operationId, canonicalClubMemberId: null, reasonCode };
      }
      canonicalClubMemberId = [...candidates][0] ?? null;
      if (!canonicalClubMemberId) {
        if ((phoneClaim.exists && phoneClaim.data()?.memberId) || (emailClaim?.exists && emailClaim.data()?.memberId)) {
          const reasonCode = "verified_contact_claim_conflict";
          writeOperation({ ...baseRecord, status: "MANUAL_REVIEW_REQUIRED", canonicalClubMemberId: null, lastErrorCode: reasonCode, history: [...history, { status: "MANUAL_REVIEW_REQUIRED", actor: caller.caller, reasonCode, requestHash: hash, attempt, at: now }] });
          return { status: "MANUAL_REVIEW_REQUIRED", outcome: "manual_review_required", operationId, canonicalClubMemberId: null, reasonCode };
        }
        canonicalClubMemberId = db.collection(`clubs/${request.clubId}/members`).doc().id;
        memberToCreate = {
          id: canonicalClubMemberId,
          clubId: request.clubId,
          originalClubId: request.clubId,
          role: "member",
          name: request.displayName.trim(),
          phone: normalizePhone(request.phone),
          phoneVerification: request.phoneVerification,
          email: request.email?.trim().toLowerCase() ?? "",
          emailVerification: request.email ? request.emailVerification : { status: "unverified", method: "not_provided", verifiedAt: null },
          status: "active",
          memberId: canonicalClubMemberId,
          qrCode: canonicalClubMemberId,
          isPermanent: true,
          isActiveMember: true,
          memberType: "permanent",
          isClubOwner: false,
          ownedClubId: null,
          parentUserId: null,
          referredBy: null,
          referredByMemberId: null,
          treePath: canonicalClubMemberId,
          shakeCredits: 0,
          shakeCreditsPlanTotal: 0,
          createdAt: now,
          updatedAt: now,
          joinedAt: now,
          activatedAt: now,
          source: { kind: "growline", coachId: request.sourceCoachId, prospectId: request.sourceGrowLineProspectId },
        };
      }
      if (request.phoneVerification.status === "verified") {
        if (phoneClaim.exists && phoneClaim.data()?.memberId !== canonicalClubMemberId) {
          const reasonCode = "verified_phone_claim_conflict";
          writeOperation({ ...baseRecord, status: "MANUAL_REVIEW_REQUIRED", canonicalClubMemberId: null, lastErrorCode: reasonCode, history: [...history, { status: "MANUAL_REVIEW_REQUIRED", actor: caller.caller, reasonCode, requestHash: hash, attempt, at: now }] });
          return { status: "MANUAL_REVIEW_REQUIRED", outcome: "manual_review_required", operationId, canonicalClubMemberId: null, reasonCode };
        }
        if (!phoneClaim.exists) claimsToCreate.push({ ref: phoneClaimRef, data: { memberId: canonicalClubMemberId, createdAt: now, evidence: "verified_phone" } });
      }
      if (emailClaimRef) {
        if (emailClaim?.exists && emailClaim.data()?.memberId !== canonicalClubMemberId) {
          const reasonCode = "verified_email_claim_conflict";
          writeOperation({ ...baseRecord, status: "MANUAL_REVIEW_REQUIRED", canonicalClubMemberId: null, lastErrorCode: reasonCode, history: [...history, { status: "MANUAL_REVIEW_REQUIRED", actor: caller.caller, reasonCode, requestHash: hash, attempt, at: now }] });
          return { status: "MANUAL_REVIEW_REQUIRED", outcome: "manual_review_required", operationId, canonicalClubMemberId: null, reasonCode };
        }
        if (!emailClaim?.exists) claimsToCreate.push({ ref: emailClaimRef, data: { memberId: canonicalClubMemberId, createdAt: now, evidence: "verified_email" } });
      }
    }

    const memberRef = db.doc(`clubs/${request.clubId}/members/${canonicalClubMemberId}`);
    const memberSnap = memberToCreate ? null : await tx.get(memberRef);
    if (!memberToCreate && (!memberSnap?.exists || memberSnap.data()?.clubId !== request.clubId || memberSnap.data()?.role !== "member")) {
      const reasonCode = memberMapSnap.exists ? "source_member_mapping_missing_or_conflicting" : "matched_member_missing_or_conflicting";
      writeOperation({ ...baseRecord, status: "MANUAL_REVIEW_REQUIRED", canonicalClubMemberId: null, lastErrorCode: reasonCode, history: [...history, { status: "MANUAL_REVIEW_REQUIRED", actor: caller.caller, reasonCode, requestHash: hash, attempt, at: now }] });
      return { status: "MANUAL_REVIEW_REQUIRED", outcome: "manual_review_required", operationId, canonicalClubMemberId: null, reasonCode };
    }

    // All transaction reads, including contact queries and canonical lookup,
    // are complete before the first write below.
    if (memberToCreate) tx.create(memberRef, memberToCreate);
    for (const claim of claimsToCreate) tx.create(claim.ref, claim.data);
    if (!memberMapSnap.exists) tx.create(memberMapRef, {
      schemaVersion: 1,
      growlineProject: caller.growlineProject,
      workspaceId: request.workspaceId,
      growlineMemberId: request.growlineMemberId,
      sourceCoachId: request.sourceCoachId,
      sourceGrowLineProspectId: request.sourceGrowLineProspectId,
      linkId: request.linkId,
      canonicalClubMemberId,
      createdAt: now,
    });

    const succeeded = { status: "SUCCEEDED", actor: caller.caller, reasonCode: "canonical_member_resolved_or_created", requestHash: hash, attempt, at: now };
    writeOperation({ ...baseRecord, status: "SUCCEEDED", canonicalClubMemberId, lastErrorCode: null, history: [...history, succeeded], updatedAt: FieldValue.serverTimestamp() });
    // Touch only a minimal integration receipt; never alter wallet, credits, plan, or payment.
    tx.set(db.doc(`clubs/${request.clubId}/members/${canonicalClubMemberId}/integrationReceipts/${operationId}`), {
      schemaVersion: 1, operationId, growlineMemberId: request.growlineMemberId,
      linkId: request.linkId, consentTimestamp: Timestamp.fromDate(new Date(request.consentTimestamp)), consentVersion: request.consentVersion, createdAt: now,
    });
    return { status: "SUCCEEDED", outcome: "MATCHED", operationId, canonicalClubMemberId };
  });
}
