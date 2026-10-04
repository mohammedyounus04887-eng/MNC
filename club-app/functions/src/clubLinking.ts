import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { invalidateFederationLink } from "./federationLinkRevocation";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

export type IssuedClubCode = { code: string; codeId: string; expiresAt: Timestamp };
export type RedeemLinkInput = { clubId: string; code: string; workspaceId: string; idempotencyKey: string; growlineAuthUid: string; growlineProject: string };
export type RedeemLinkResult = { linkId: string; clubId: string; clubName: string; clubAuthUid: string; workspaceId: string; growlineAuthUid: string; growlineProject: string; clubProject: string; status: "active"; verificationMethod: "dual_authenticated_consent"; verifiedAt: Timestamp; replay: boolean };
export type RevokeLinkInput = { clubId: string; linkId: string; workspaceId: string; idempotencyKey: string; growlineAuthUid: string; growlineProject: string };

const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const codeHash = (code: string, pepper: string) => createHmac("sha256", pepper).update(code).digest("hex");

export async function issueClubLinkCode(
  db: Firestore,
  clubId: string,
  issuerUid: string,
  pepper: string,
  now = Date.now(),
  platformAdmin = false,
  rotateActiveCodes = false,
): Promise<IssuedClubCode> {
  if (!id.test(clubId) || !id.test(issuerUid) || pepper.length < 32) throw new Error("INVALID_CODE_ISSUANCE");
  const code = randomBytes(24).toString("base64url");
  const codeId = digest(code);
  const expiresAt = Timestamp.fromMillis(now + 15 * 60_000);
  const clubRef = db.doc(`clubs/${clubId}`);
  const authorizationRef = db.doc(`clubs/${clubId}/authorizations/${issuerUid}`);
  const codeRef = db.doc(`clubs/${clubId}/integrationCodes/${codeId}`);
  const configRef = db.doc(`clubs/${clubId}/integrationConfig/growline`);
  await db.runTransaction(async (tx) => {
    const club = await tx.get(clubRef);
    const auth = platformAdmin ? null : await tx.get(authorizationRef);
    if (!club.exists || club.data()?.status !== "active" || (!platformAdmin && (!auth?.exists || auth.data()?.enabled !== true || auth.data()?.clubId !== clubId || !["owner", "admin"].includes(String(auth.data()?.role))))) {
      throw new Error("CLUB_ADMIN_REQUIRED");
    }
    const outstanding = rotateActiveCodes
      ? await tx.get(db.collection(`clubs/${clubId}/integrationCodes`).where("status", "==", "active").limit(101)) : null;
    if (outstanding && outstanding.size > 100) throw new Error("CODE_ROTATION_LIMIT_REACHED");
    for (const prior of outstanding?.docs ?? []) tx.update(prior.ref, { status: "revoked", revokedAt: Timestamp.fromMillis(now), revokedBy: issuerUid });
    tx.create(codeRef, {
      schemaVersion: 1,
      codeHash: codeHash(code, pepper),
      clubId,
      issuedByAuthUid: issuerUid,
      issuerRole: platformAdmin ? "platform_admin" : "club_admin",
      purpose: "growline_coach_link",
      status: "active",
      expiresAt,
      maxUses: 1,
      usedCount: 0,
      createdAt: Timestamp.fromMillis(now),
      revokedAt: null,
    });
    tx.set(configRef, { schemaVersion: 1, enabled: true, enabledByAuthUid: issuerUid, enabledAt: Timestamp.fromMillis(now), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(db.collection(`clubs/${clubId}/authorizationAudit`).doc(), { action: "owner-code-issued", actorUid: issuerUid, codeId, rotatedCodes: outstanding?.size ?? 0, createdAt: Timestamp.fromMillis(now) });
  });
  return { code, codeId, expiresAt };
}

export async function redeemClubLinkCode(
  db: Firestore,
  input: RedeemLinkInput,
  pepper: string,
  clubProject: string,
  now = Date.now(),
): Promise<RedeemLinkResult> {
  if (!id.test(input.clubId) || !id.test(input.workspaceId) || !id.test(input.idempotencyKey) || !id.test(input.growlineAuthUid) || !id.test(input.growlineProject) || input.code.length < 20 || input.code.length > 128 || pepper.length < 32 || !clubProject) {
    throw new Error("INVALID_CODE_REDEMPTION");
  }
  const codeId = digest(input.code);
  const codeRef = db.doc(`clubs/${input.clubId}/integrationCodes/${codeId}`);
  const linkId = digest(`club-growline-link:${input.clubId}:${input.growlineProject}:${input.workspaceId}:${input.growlineAuthUid}`);
  const linkRef = db.doc(`clubs/${input.clubId}/integrationLinks/${linkId}`);
  const clubRef = db.doc(`clubs/${input.clubId}`);
  return db.runTransaction(async (tx) => {
    const [codeSnap, linkSnap, clubSnap] = await Promise.all([tx.get(codeRef), tx.get(linkRef), tx.get(clubRef)]);
    if (!clubSnap.exists || clubSnap.data()?.status !== "active") throw new Error("INVALID_DESTINATION_CLUB");
    if (!codeSnap.exists) throw new Error("CODE_UNAVAILABLE");
    const record = codeSnap.data();
    const supplied = Buffer.from(codeHash(input.code, pepper), "hex");
    const expected = Buffer.from(String(record?.codeHash ?? ""), "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("CODE_UNAVAILABLE");
    if (record?.purpose !== "growline_coach_link" || record?.revokedAt) throw new Error("CODE_UNAVAILABLE");
    const expiresAt = record.expiresAt instanceof Timestamp ? record.expiresAt.toMillis() : Date.parse(String(record?.expiresAt));
    if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error("CODE_EXPIRED");
    const priorRedemption = record?.redemption;
    if (linkSnap.exists) {
      const link = linkSnap.data();
      if (link?.status !== "active" || link?.workspaceId !== input.workspaceId || link?.growlineAuthUid !== input.growlineAuthUid || link?.growlineProject !== input.growlineProject) throw new Error("IDENTITY_LINK_CONFLICT");
      if (typeof link.clubAuthUid !== "string" || !id.test(link.clubAuthUid)) throw new Error("IDENTITY_LINK_CONFLICT");
      if (priorRedemption?.idempotencyKey !== input.idempotencyKey) throw new Error("CODE_ALREADY_REDEEMED");
      return { linkId, clubId: input.clubId, clubName: String(clubSnap.get("name") ?? "Club"), clubAuthUid: link.clubAuthUid, workspaceId: input.workspaceId, growlineAuthUid: input.growlineAuthUid, growlineProject: input.growlineProject, clubProject, status: "active", verificationMethod: "dual_authenticated_consent", verifiedAt: link.verifiedAt as Timestamp, replay: true };
    }
    if (record?.status !== "active" || Number(record?.usedCount) >= Number(record?.maxUses) || record?.usedCount !== 0 || record?.maxUses !== 1) throw new Error("CODE_UNAVAILABLE");
    if (typeof record.issuedByAuthUid !== "string" || !id.test(record.issuedByAuthUid)) throw new Error("CODE_UNAVAILABLE");
    const verifiedAt = Timestamp.fromMillis(now);
    const link = {
      schemaVersion: 1,
      linkId,
      clubId: input.clubId,
      clubProject,
      clubAuthUid: String(record.issuedByAuthUid),
      growlineProject: input.growlineProject,
      workspaceId: input.workspaceId,
      growlineAuthUid: input.growlineAuthUid,
      clubMemberId: null,
      status: "active",
      verificationMethod: "dual_authenticated_consent",
      verifiedAt,
      createdAt: verifiedAt,
      updatedAt: verifiedAt,
      auditEvents: [
        { action: "code_issued", actor: String(record.issuedByAuthUid), at: record.createdAt },
        { action: "code_redeemed", actor: input.growlineAuthUid, at: verifiedAt },
      ],
    };
    tx.create(linkRef, link);
    tx.update(codeRef, {
      status: "redeemed", usedCount: 1, redeemedAt: verifiedAt,
      redemption: { idempotencyKey: input.idempotencyKey, growlineAuthUid: input.growlineAuthUid, workspaceId: input.workspaceId, linkId },
    });
    return { linkId, clubId: input.clubId, clubName: String(clubSnap.get("name") ?? "Club"), clubAuthUid: link.clubAuthUid, workspaceId: input.workspaceId, growlineAuthUid: input.growlineAuthUid, growlineProject: input.growlineProject, clubProject, status: "active", verificationMethod: "dual_authenticated_consent", verifiedAt, replay: false };
  });
}

export async function revokeClubGrowlineLink(
  db: Firestore,
  input: RevokeLinkInput,
  caller: { growlineAuthUid: string; growlineProject: string },
  now = Date.now(),
): Promise<{ status: "revoked"; linkId: string; revokedAt: Timestamp; replay: boolean }> {
  if (![input.clubId, input.linkId, input.workspaceId, input.idempotencyKey, input.growlineAuthUid, input.growlineProject].every((value) => id.test(value)) || input.growlineAuthUid !== caller.growlineAuthUid || input.growlineProject !== caller.growlineProject) {
    throw new Error("INVALID_LINK_REVOCATION");
  }
  const ref = db.doc(`clubs/${input.clubId}/integrationLinks/${input.linkId}`);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const link = snapshot.data();
    if (!snapshot.exists || link?.linkId !== input.linkId || link?.workspaceId !== input.workspaceId || link?.growlineAuthUid !== caller.growlineAuthUid || link?.growlineProject !== caller.growlineProject) throw new Error("IDENTITY_LINK_NOT_FOUND");
    if (link.status === "revoked" && link.revocationIdempotencyKey === input.idempotencyKey) {
      return { status: "revoked", linkId: input.linkId, revokedAt: link.revokedAt as Timestamp, replay: true };
    }
    if (link.status !== "active") throw new Error("IDENTITY_LINK_NOT_ACTIVE");
    await invalidateFederationLink(tx, db, input.clubId, input.linkId, caller.growlineAuthUid);
    const revokedAt = Timestamp.fromMillis(now);
    tx.update(ref, {
      status: "revoked", revokedAt, revokedByGrowlineAuthUid: caller.growlineAuthUid,
      revocationIdempotencyKey: input.idempotencyKey, updatedAt: revokedAt,
      auditEvents: FieldValue.arrayUnion({ action: "revoked", actor: caller.growlineAuthUid, reason: "user_requested", at: revokedAt }),
    });
    return { status: "revoked", linkId: input.linkId, revokedAt, replay: false };
  });
}
