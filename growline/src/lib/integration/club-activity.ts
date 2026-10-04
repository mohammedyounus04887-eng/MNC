import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { startOfDayInZone, APP_TIMEZONE } from "../day";
import { activeApprovedRelationship, summarizeApprovedLogs, type ClubActivityRequest, type CoachActivity } from "./activity-contract";

export async function getClubCoachActivity(db: Firestore, request: ClubActivityRequest, clubProject: string, growlineProject: string): Promise<CoachActivity[]> {
  const start = Timestamp.fromDate(startOfDayInZone(request.from, APP_TIMEZONE));
  const endKey = new Date(Date.parse(`${request.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const end = Timestamp.fromDate(startOfDayInZone(endKey, APP_TIMEZONE));
  const result: CoachActivity[] = [];
  // Bound fan-out at 25 coaches and 31 deterministic log documents per coach.
  for (const coach of request.coaches) {
    const linkRef = db.collection("integrationLinks").doc(coach.linkId);
    const userRef = db.collection("users").doc(coach.growlineAuthUid);
    const [link, user] = await Promise.all([linkRef.get(), userRef.get()]);
    if (!link.exists || link.get("clubId") !== request.clubId || link.get("clubProject") !== clubProject || link.get("growlineProject") !== growlineProject ||
        link.get("growlineAuthUid") !== coach.growlineAuthUid || link.get("workspaceId") !== coach.workspaceId) throw new Error("CLUB_RELATIONSHIP_SCOPE_MISMATCH");
    if (!activeApprovedRelationship(link.data(), user.data(), coach, request.clubId, clubProject, growlineProject)) continue;
    const refs = [];
    for (let time = Date.parse(`${request.from}T00:00:00Z`); time <= Date.parse(`${request.to}T00:00:00Z`); time += 86_400_000) {
      refs.push(db.doc(`dailyLogs/${coach.growlineAuthUid}__${new Date(time).toISOString().slice(0, 10)}`));
    }
    const logs = await db.getAll(...refs, { fieldMask: ["userId", "workspaceId", "dayKey", "memberships"] });
    const people = await db.collection("prospects").where("coachId", "==", coach.growlineAuthUid).where("workspaceId", "==", coach.workspaceId)
      .where("createdAt", ">=", start).where("createdAt", "<", end).count().get();
    // Opt-out, revocation or a workspace move during a query drops the row.
    const [currentLink, currentUser] = await Promise.all([linkRef.get(), userRef.get()]);
    if (!activeApprovedRelationship(currentLink.data(), currentUser.data(), coach, request.clubId, clubProject, growlineProject)) continue;
    const counts = summarizeApprovedLogs(logs.filter((log) => log.exists).map((log) => log.data() ?? {}), coach.growlineAuthUid, coach.workspaceId, request.from, request.to);
    result.push({ linkId: coach.linkId, displayName: String(currentLink.get("activityDisplayName")).trim(), ...counts, peopleMet: people.data().count });
  }
  return result;
}

export async function setClubActivitySharing(db: Firestore, uid: string, linkId: string, enabled: boolean) {
  const linkRef = db.collection("integrationLinks").doc(linkId);
  const userRef = db.collection("users").doc(uid);
  const auditRef = db.collection("integrationActivityConsentAudit").doc();
  return db.runTransaction(async (tx) => {
    const [link, user] = await Promise.all([tx.get(linkRef), tx.get(userRef)]);
    const data = link.data();
    if (!data || data.growlineAuthUid !== uid) throw new Error("ACTIVITY_LINK_NOT_FOUND");
    if (data.status !== "active" || data.clubProject !== process.env.CLUB_FIREBASE_PROJECT_ID || data.growlineProject !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || !user.exists || user.get("workspaceId") !== data.workspaceId) throw new Error("ACTIVITY_LINK_UNAVAILABLE");
    const name = user.get("name");
    if (enabled && (typeof name !== "string" || !name.trim() || name.length > 100)) throw new Error("ACTIVITY_PROFILE_REQUIRED");
    tx.update(linkRef, { activitySharingEnabled: enabled, activityDisplayName: enabled ? name.trim() : null, activitySharingUpdatedAt: FieldValue.serverTimestamp() });
    tx.create(auditRef, { actorUid: uid, linkId, clubId: data.clubId, workspaceId: data.workspaceId, action: enabled ? "activity-sharing-approved" : "activity-sharing-withdrawn", metricsVersion: "daily-log-v1", createdAt: FieldValue.serverTimestamp() });
    return { linkId, activitySharingEnabled: enabled, ...(enabled ? { approvedDisplayName: String(name).trim() } : {}) };
  });
}
