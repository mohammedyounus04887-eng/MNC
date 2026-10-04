import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { hashClubLinkCode, matchesClubLinkCode, redeemClubLinkCode, type ClubLinkCode } from "@/lib/integration/clubCode";
import { matchVerifiedMember } from "@/lib/integration/matching";
import { activateIdentityLink, revokeIdentityLink, type IdentityLink } from "@/lib/integration/identity";

const code: ClubLinkCode = {
  schemaVersion: 1, codeId: "code_1", codeHash: hashClubLinkCode("secret", "pepper"),
  clubId: "club_1", issuedByAuthUid: "owner_1", purpose: "growline_coach_link",
  expiresAt: "2999-01-01T00:00:00.000Z", maxUses: 1, usedCount: 0,
  revokedAt: null, createdAt: "2026-09-30T00:00:00.000Z",
};

describe("identity and Club code domain", () => {
  test("written but not executed: only dual-authenticated evidence activates a link; unlink preserves audit", () => {
    const pending: IdentityLink = {
      schemaVersion: 1, linkId: "link_1", clubProject: "club-project", clubId: "club_1",
      growlineProject: "growline-project", workspaceId: "workspace_1", clubAuthUid: "club-auth-1",
      growlineAuthUid: "growline-auth-1", clubMemberId: "canonical-club-member", status: "pending",
      evidence: { method: "dual_authenticated_consent", reference: "proof-ref", verifiedAt: "2026-09-30T00:00:00.000Z", verifiedBy: "integration-review" },
      createdAt: "2026-09-30T00:00:00.000Z", updatedAt: "2026-09-30T00:00:00.000Z",
      revokedAt: null, revokedBy: null, audit: { actor: "creator", reason: "created" }, auditEvents: [],
    };
    assert.equal(activateIdentityLink(pending).status, "active");
    assert.throws(() => activateIdentityLink({ ...pending, evidence: { ...pending.evidence, method: "operator_review" } }), /DUAL_VERIFICATION_REQUIRED/);
    const revoked = revokeIdentityLink(activateIdentityLink(pending), "operator", "user requested unlink");
    assert.equal(revoked.status, "revoked");
    assert.equal(revoked.auditEvents.length, 2);
  });

  test("written but not executed: code is hashed, scoped, and single-use", () => {
    assert.notEqual(code.codeHash, "secret");
    assert.equal(matchesClubLinkCode("secret", code, "pepper"), true);
    assert.equal(matchesClubLinkCode("wrong", code, "pepper"), false);
    assert.equal(redeemClubLinkCode(code).usedCount, 1);
    assert.equal(matchesClubLinkCode("secret", { ...code, usedCount: 1 }, "pepper"), false);
  });

  test("written but not executed: matching never accepts ambiguity or unverified evidence", () => {
    assert.deepEqual(matchVerifiedMember("club_1", []), { outcome: "NO_MATCH" });
    assert.deepEqual(matchVerifiedMember("club_1", [{ clubId: "club_1", clubMemberId: "m1", verifiedEvidence: [], activeLink: true }]), { outcome: "MANUAL_REVIEW_REQUIRED", reason: "unverified_evidence" });
    assert.deepEqual(matchVerifiedMember("club_1", [
      { clubId: "club_1", clubMemberId: "m1", verifiedEvidence: ["dual"], activeLink: true },
      { clubId: "club_1", clubMemberId: "m2", verifiedEvidence: ["dual"], activeLink: true },
    ]), { outcome: "MANUAL_REVIEW_REQUIRED", reason: "ambiguous_verified_candidates" });
  });

  test("written but not executed: wrong-club candidates cannot match", () => {
    assert.deepEqual(matchVerifiedMember("club_1", [{ clubId: "club_2", clubMemberId: "m2", verifiedEvidence: ["dual"], activeLink: true }]), { outcome: "NO_MATCH" });
  });
});
