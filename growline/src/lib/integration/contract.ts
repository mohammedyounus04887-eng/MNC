import { createHash } from "crypto";

export const INTEGRATION_NAME = "club-growline";
export const SCHEMA_VERSION = 2;

export type HandoffRequest = {
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

export type HandoffValidation =
  | { ok: true; request: HandoffRequest; requestHash: string }
  | { ok: false; reason: string };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function validContactVerification(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proof = value as Record<string, unknown>;
  if (Object.keys(proof).some((key) => !["status", "method", "verifiedAt"].includes(key))) return false;
  if ((proof.status !== "verified" && proof.status !== "unverified") || typeof proof.method !== "string" || !proof.method.trim()) return false;
  if (proof.verifiedAt !== null && (typeof proof.verifiedAt !== "string" || Number.isNaN(Date.parse(proof.verifiedAt)))) return false;
  return proof.status !== "verified" || (typeof proof.verifiedAt === "string" && Date.parse(proof.verifiedAt) <= Date.now());
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

/** Validate the minimum-provisioning v2 envelope before authorization or delivery. */
export function validateHandoffRequest(value: unknown): HandoffValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "malformed_request" };
  }
  const body = value as Record<string, unknown>;
  const keys = [
    "schemaVersion", "handoffId", "idempotencyKey", "growlineMemberId",
    "workspaceId", "clubId", "destinationClubId", "linkId", "displayName", "phone", "phoneVerification",
    "email", "emailVerification", "sourceCoachId", "sourceGrowLineProspectId",
    "consentTimestamp", "consentVersion",
  ] as const;
  if (!hasOnlyKeys(body, keys)) return { ok: false, reason: "uncontracted_fields" };
  if (body.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: "unsupported_version" };
  for (const key of ["handoffId", "idempotencyKey", "growlineMemberId", "workspaceId", "clubId", "destinationClubId", "linkId", "sourceCoachId", "sourceGrowLineProspectId"] as const) {
    if (typeof body[key] !== "string" || !ID.test(body[key])) {
      return { ok: false, reason: `invalid_${key}` };
    }
  }
  if (body.destinationClubId !== body.clubId) return { ok: false, reason: "destination_club_mismatch" };
  if (typeof body.displayName !== "string" || !body.displayName.trim() || body.displayName.length > 100) return { ok: false, reason: "invalid_display_name" };
  if (typeof body.phone !== "string" || !/^\+?[0-9]{7,15}$/.test(body.phone)) return { ok: false, reason: "invalid_phone" };
  if (!validContactVerification(body.phoneVerification)) return { ok: false, reason: "invalid_phone_provenance" };
  if (body.email !== null && (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))) return { ok: false, reason: "invalid_email" };
  if (body.email === null ? body.emailVerification !== null : !validContactVerification(body.emailVerification)) return { ok: false, reason: "invalid_email_provenance" };
  if (!isIsoTimestamp(body.consentTimestamp) || Date.parse(body.consentTimestamp) > Date.now() || typeof body.consentVersion !== "string" || !ID.test(body.consentVersion)) return { ok: false, reason: "invalid_consent_timestamp" };

  const request = body as HandoffRequest;
  return { ok: true, request, requestHash: hashHandoffRequest(request) };
}

/** Stable hash used to reject reuse of one idempotency key for another request. */
export function hashHandoffRequest(request: HandoffRequest): string {
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
    phone: request.phone.replace(/[^0-9+]/g, ""),
    phoneVerification: request.phoneVerification,
    email: request.email?.trim().toLowerCase() ?? null,
    emailVerification: request.emailVerification,
    sourceCoachId: request.sourceCoachId,
    sourceGrowLineProspectId: request.sourceGrowLineProspectId,
    consentTimestamp: request.consentTimestamp,
    consentVersion: request.consentVersion,
  })).digest("hex");
}

/** Durable operation identity. The request key is never confused with a prospect identity. */
export function handoffOperationId(idempotencyKey: string): string {
  return `${INTEGRATION_NAME}:${idempotencyKey}`;
}

export type ClubCodeRedemptionRequest = {
  schemaVersion: 1;
  clubId: string;
  code: string;
  workspaceId: string;
  idempotencyKey: string;
};

export function hashClubCodeRedemptionRequest(request: ClubCodeRedemptionRequest): string {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: request.schemaVersion,
    clubId: request.clubId,
    code: request.code,
    workspaceId: request.workspaceId,
    idempotencyKey: request.idempotencyKey,
  })).digest("hex");
}

export type ClubLinkRevocationRequest = {
  schemaVersion: 1;
  clubId: string;
  linkId: string;
  workspaceId: string;
  idempotencyKey: string;
};

export function hashClubLinkRevocationRequest(request: ClubLinkRevocationRequest): string {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: request.schemaVersion,
    clubId: request.clubId,
    linkId: request.linkId,
    workspaceId: request.workspaceId,
    idempotencyKey: request.idempotencyKey,
  })).digest("hex");
}
