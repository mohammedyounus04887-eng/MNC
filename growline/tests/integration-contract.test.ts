import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  handoffOperationId,
  hashHandoffRequest,
  validateHandoffRequest,
  type HandoffRequest,
} from "@/lib/integration/contract";
import { signHandoffAssertion } from "@/lib/integration/serverAssertion";

const request: HandoffRequest = {
  schemaVersion: 2,
  handoffId: "handoff_01",
  idempotencyKey: "op_01",
  growlineMemberId: "member_01",
  workspaceId: "workspace_01",
  clubId: "club_01",
  destinationClubId: "club_01",
  linkId: "link_01",
  displayName: "Test member",
  phone: "+919876543210",
  phoneVerification: { status: "unverified", method: "growline_prospect", verifiedAt: null },
  email: null,
  emailVerification: null,
  sourceCoachId: "coach_01",
  sourceGrowLineProspectId: "prospect_01",
  consentTimestamp: "2026-09-30T12:00:00.000Z",
  consentVersion: "test-consent-v1",
};

describe("integration v2 handoff contract", () => {
  test("accepts the exact minimal envelope and hashes it stably", () => {
    const result = validateHandoffRequest(request);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.requestHash, hashHandoffRequest(request));
    assert.equal(handoffOperationId(request.idempotencyKey), "club-growline:op_01");
  });

  test("rejects unsupported versions and excessive fields", () => {
    assert.deepEqual(
      validateHandoffRequest({ ...request, schemaVersion: 99 }),
      { ok: false, reason: "unsupported_version" },
    );
    assert.deepEqual(
      validateHandoffRequest({ ...request, privateNotes: "must not cross boundary" }),
      { ok: false, reason: "uncontracted_fields" },
    );
  });

  test("rejects malformed identity, destination, and consent fields", () => {
    assert.equal(validateHandoffRequest({ ...request, clubId: "bad/club" }).ok, false);
    assert.equal(validateHandoffRequest({ ...request, consentTimestamp: "yesterday" }).ok, false);
    assert.equal(validateHandoffRequest({ ...request, linkId: "" }).ok, false);
  });

  test("signs a destination-bound, request-hash-bound short-lived assertion", () => {
    const token = signHandoffAssertion(request, "growline-auth-1", {
      keyId: "local-key-1",
      secret: "local-test-secret-with-at-least-32-characters",
      audience: "club-local",
      growlineProject: "growline-local",
      clubProject: "club-local-project",
      lifetimeSeconds: 60,
    }, 1_800_000_000);
    const [header, payload, signature] = token.split(".");
    assert.equal(JSON.parse(Buffer.from(header, "base64url").toString()).alg, "HS256");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    assert.equal(claims.aud, "club-local");
    assert.equal(claims.requestHash, hashHandoffRequest(request));
    assert.ok(signature.length > 20);
    assert.throws(() => signHandoffAssertion(request, "growline-auth-1", {
      keyId: "local-key-1", secret: "short", audience: "club-local", growlineProject: "growline-local", clubProject: "club-local-project", lifetimeSeconds: 60,
    }), /INVALID_SERVICE_SIGNING_CONFIGURATION/);
  });
});
