export const IDENTITY_LINK_STATUSES = ["pending", "active", "revoked"] as const;
export type IdentityLinkStatus = (typeof IDENTITY_LINK_STATUSES)[number];

export type IdentityEvidence = {
  method: "dual_authenticated_consent" | "operator_review";
  reference: string;
  verifiedAt: string;
  verifiedBy: string;
};

export type IdentityLink = {
  schemaVersion: 1;
  linkId: string;
  clubProject: string;
  clubId: string;
  growlineProject: string;
  workspaceId: string;
  clubAuthUid: string;
  growlineAuthUid: string;
  clubMemberId: string | null;
  status: IdentityLinkStatus;
  evidence: IdentityEvidence;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  audit: { actor: string; reason: string };
  auditEvents: Array<{ action: "created" | "activated" | "revoked"; actor: string; reason: string; at: string }>;
};

export function activateIdentityLink(link: IdentityLink): IdentityLink {
  if (link.status === "revoked") throw new Error("REVOKED_LINK");
  if (link.status !== "pending") throw new Error("LINK_NOT_PENDING");
  if (!link.clubMemberId) throw new Error("CLUB_MEMBER_REQUIRED");
  if (link.evidence.method !== "dual_authenticated_consent" || !link.evidence.reference.trim() || !link.evidence.verifiedBy.trim() || Number.isNaN(Date.parse(link.evidence.verifiedAt))) {
    throw new Error("DUAL_VERIFICATION_REQUIRED");
  }
  const now = new Date().toISOString();
  return {
    ...link,
    status: "active",
    updatedAt: now,
    auditEvents: [...link.auditEvents, { action: "activated", actor: link.evidence.verifiedBy, reason: "dual_authenticated_consent", at: now }],
  };
}

export function revokeIdentityLink(link: IdentityLink, actor: string, reason: string): IdentityLink {
  if (!actor.trim() || !reason.trim()) throw new Error("REVOCATION_AUDIT_REQUIRED");
  const now = new Date().toISOString();
  return {
    ...link,
    status: "revoked",
    revokedAt: now,
    revokedBy: actor,
    updatedAt: now,
    audit: { actor, reason },
    auditEvents: [...link.auditEvents, { action: "revoked", actor, reason, at: now }],
  };
}
