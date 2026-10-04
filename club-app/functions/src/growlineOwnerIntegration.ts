import { createHash, createHmac } from "node:crypto";
import { invalidateFederationLink } from "./federationLinkRevocation";
import { FieldPath, FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const OWNER_PAGE_SIZE = 25;
export type OwnerIdentity = { uid: string; token: Record<string, unknown> };
export type ActivityRequest = {
  schemaVersion: 1; clubId: string; from: string; to: string;
  coaches: Array<{ linkId: string; workspaceId: string; growlineAuthUid: string }>;
};
export type ActivityCounts = { logs: number; peopleMet: number; membersConverted: number };
export type ApprovedCoachActivity = ActivityCounts & { displayName: string };

export async function requireClubAdministrator(db: Firestore, actor: OwnerIdentity | undefined, clubId: string): Promise<OwnerIdentity> {
  const firebase = actor?.token.firebase;
  if (!id.test(clubId) || !actor || !id.test(actor.uid) || !firebase || typeof firebase !== "object" ||
      !("sign_in_provider" in firebase) || typeof firebase.sign_in_provider !== "string" || firebase.sign_in_provider === "anonymous" || actor.token.station === true ||
      actor.token.clubId !== clubId || !["owner", "admin"].includes(String(actor.token.role))) throw new Error("CLUB_ADMIN_REQUIRED");
  const grant = (await db.doc(`clubs/${clubId}/authorizations/${actor.uid}`).get()).data();
  if (!grant || grant.enabled !== true || grant.uid !== actor.uid || grant.clubId !== clubId || grant.role !== actor.token.role || grant.station === true) throw new Error("CLUB_ADMIN_REQUIRED");
  return actor;
}

export function activityWindow(from: unknown, to: unknown, now = new Date()): { from: string; to: string } {
  const valid = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const today = ["year", "month", "day"].map((part) => parts.find((entry) => entry.type === part)?.value).join("-");
  if (!valid(from) || !valid(to) || to < from || to > today || (Date.parse(to) - Date.parse(from)) / 86_400_000 >= 31) throw new Error("INVALID_ACTIVITY_WINDOW");
  return { from, to };
}

export function signClubActivityRequest(request: ActivityRequest, actorUid: string, config: {
  audience: string; clubProject: string; growlineProject: string; keyId: string; secret: string;
}, nowSeconds = Math.floor(Date.now() / 1000)): string {
  if (!id.test(actorUid) || !config.audience || !config.clubProject || !config.growlineProject || !id.test(config.keyId) || config.secret.length < 32) throw new Error("ACTIVITY_CONFIGURATION_UNAVAILABLE");
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "club-service", aud: config.audience, clubProject: config.clubProject, growlineProject: config.growlineProject,
    kid: config.keyId, clubAuthUid: actorUid, iat: nowSeconds, exp: nowSeconds + 60,
    requestHash: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
  })).toString("base64url");
  return `${header}.${payload}.${createHmac("sha256", config.secret).update(`${header}.${payload}`).digest("base64url")}`;
}

export function projectApprovedActivity(value: unknown, expectedLinkIds: ReadonlySet<string>): ApprovedCoachActivity[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["schemaVersion", "coaches"].includes(key)) || !("schemaVersion" in value) || value.schemaVersion !== 1 || !("coaches" in value) || !Array.isArray(value.coaches) || value.coaches.length > OWNER_PAGE_SIZE) throw new Error("INVALID_ACTIVITY_RESPONSE");
  const seen = new Set<string>();
  return value.coaches.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("INVALID_ACTIVITY_RESPONSE");
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["linkId", "displayName", "logs", "peopleMet", "membersConverted"].includes(key)) ||
        typeof row.linkId !== "string" || !expectedLinkIds.has(row.linkId) || seen.has(row.linkId) ||
        typeof row.displayName !== "string" || !row.displayName.trim() || row.displayName.length > 100 ||
        [row.logs, row.peopleMet, row.membersConverted].some((count) => typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)) throw new Error("INVALID_ACTIVITY_RESPONSE");
    seen.add(row.linkId);
    return { displayName: row.displayName.trim(), logs: Number(row.logs), peopleMet: Number(row.peopleMet), membersConverted: Number(row.membersConverted) };
  });
}

export async function activeCoachPage(db: Firestore, clubId: string, growlineProject: string, cursor?: string) {
  if (cursor && !id.test(cursor)) throw new Error("INVALID_PAGE_CURSOR");
  let query = db.collection(`clubs/${clubId}/integrationLinks`).where("status", "==", "active").orderBy(FieldPath.documentId()).limit(OWNER_PAGE_SIZE + 1);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const page = snapshot.docs.slice(0, OWNER_PAGE_SIZE);
  const coaches = page.flatMap((doc) => {
    const data = doc.data();
    return data.clubId === clubId && data.growlineProject === growlineProject && data.linkId === doc.id &&
      id.test(String(data.workspaceId ?? "")) && id.test(String(data.growlineAuthUid ?? "")) && data.verificationMethod === "dual_authenticated_consent"
      ? [{ linkId: doc.id, workspaceId: String(data.workspaceId), growlineAuthUid: String(data.growlineAuthUid) }] : [];
  });
  return { coaches, nextCursor: snapshot.docs.length > OWNER_PAGE_SIZE ? page[page.length - 1].id : null };
}

export async function ownerLinkPage(db: Firestore, clubId: string, cursor?: string) {
  if (cursor && !id.test(cursor)) throw new Error("INVALID_PAGE_CURSOR");
  let query = db.collection(`clubs/${clubId}/integrationLinks`).orderBy(FieldPath.documentId()).limit(OWNER_PAGE_SIZE + 1);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const page = snapshot.docs.slice(0, OWNER_PAGE_SIZE);
  return {
    links: page.filter((doc) => doc.get("clubId") === clubId).map((doc) => ({
      linkId: doc.id, status: doc.get("status") === "active" ? "active" : "revoked",
      linkedAt: doc.get("verifiedAt") instanceof Timestamp ? doc.get("verifiedAt").toDate().toISOString() : null,
    })),
    nextCursor: snapshot.docs.length > OWNER_PAGE_SIZE ? page[page.length - 1].id : null,
  };
}

export async function revokeOwnerCodeOrLink(db: Firestore, clubId: string, actorUid: string, role: "owner" | "admin", kind: "code" | "link", targetId: string) {
  if (!id.test(targetId)) throw new Error("INVALID_REVOCATION_TARGET");
  const ref = db.doc(`clubs/${clubId}/${kind === "code" ? "integrationCodes" : "integrationLinks"}/${targetId}`);
  const auditRef = db.collection(`clubs/${clubId}/authorizationAudit`).doc();
  return db.runTransaction(async (tx) => {
    const grant = await tx.get(db.doc(`clubs/${clubId}/authorizations/${actorUid}`));
    if (!grant.exists || grant.get("enabled") !== true || grant.get("uid") !== actorUid || grant.get("clubId") !== clubId || grant.get("role") !== role || grant.get("station") === true) throw new Error("CLUB_ADMIN_REQUIRED");
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.get("clubId") !== clubId) throw new Error("REVOCATION_TARGET_NOT_FOUND");
    if (snapshot.get("status") === "revoked") return { status: "revoked" as const, replay: true };
    if (snapshot.get("status") !== "active") throw new Error("REVOCATION_TARGET_NOT_ACTIVE");
    if (kind === "link") await invalidateFederationLink(tx, db, clubId, targetId, actorUid);
    tx.update(ref, { status: "revoked", revokedAt: FieldValue.serverTimestamp(), revokedBy: actorUid, updatedAt: FieldValue.serverTimestamp() });
    tx.create(auditRef, { action: kind === "code" ? "owner-code-revoked" : "owner-link-revoked", actorUid, clubId, targetId, createdAt: FieldValue.serverTimestamp() });
    return { status: "revoked" as const, replay: false };
  });
}
