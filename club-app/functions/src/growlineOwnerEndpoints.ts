import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { activeCoachPage, activityWindow, ownerLinkPage, projectApprovedActivity, requireClubAdministrator, revokeOwnerCodeOrLink, signClubActivityRequest, type ActivityRequest } from "./growlineOwnerIntegration";

const serviceKeys = defineSecret("CLUB_GROWLINE_SERVICE_KEYS");
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpsError("invalid-argument", "An integration request is required.");
  return value as Record<string, unknown>;
};
const validateFields = (data: Record<string, unknown>, fields: string[]) => {
  if (Object.keys(data).some((key) => !fields.includes(key))) throw new HttpsError("invalid-argument", "Unsupported integration field.");
};
function readableError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  const code = error instanceof Error ? error.message : "INTEGRATION_UNAVAILABLE";
  if (code === "CLUB_ADMIN_REQUIRED") throw new HttpsError("permission-denied", "A verified Club owner or administrator is required.");
  if (["INVALID_ACTIVITY_WINDOW", "INVALID_PAGE_CURSOR", "INVALID_REVOCATION_TARGET"].includes(code)) throw new HttpsError("invalid-argument", "Check the requested period or selection.");
  if (code === "REVOCATION_TARGET_NOT_FOUND") throw new HttpsError("not-found", "The selected Club relationship was not found.");
  if (code === "REVOCATION_TARGET_NOT_ACTIVE") throw new HttpsError("failed-precondition", "The selected code or relationship is no longer active.");
  throw new HttpsError("unavailable", "GrowLine integration is unavailable. Please try again.");
}

export const getGrowlineOwnerActivity = onCall({ secrets: [serviceKeys], maxInstances: 5 }, async (request) => {
  try {
    const data = object(request.data);
    validateFields(data, ["clubId", "from", "to", "cursor"]);
    const clubId = typeof data.clubId === "string" ? data.clubId : "";
    const actor = await requireClubAdministrator(admin.firestore(), request.auth, clubId);
    if (process.env.INTEGRATION_ACTIVITY_ENABLED !== "true") throw new HttpsError("unavailable", "Coach activity is not enabled for this environment.");
    const window = activityWindow(data.from, data.to);
    const growlineProject = process.env.GROWLINE_PROJECT_ID ?? "";
    const clubProject = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "";
    const page = await activeCoachPage(admin.firestore(), clubId, growlineProject, typeof data.cursor === "string" ? data.cursor : undefined);
    const payload: ActivityRequest = { schemaVersion: 1, clubId, ...window, coaches: page.coaches };
    if (!page.coaches.length) return { coaches: [], totals: { logs: 0, peopleMet: 0, membersConverted: 0 }, nextCursor: page.nextCursor, ...window };
    const rawKeys: unknown = JSON.parse(serviceKeys.value());
    const keyId = process.env.CLUB_GROWLINE_SERVICE_KEY_ID ?? "";
    const secret = rawKeys && typeof rawKeys === "object" && keyId in rawKeys ? Reflect.get(rawKeys, keyId) : null;
    if (typeof secret !== "string") throw new Error("ACTIVITY_CONFIGURATION_UNAVAILABLE");
    const url = new URL(process.env.GROWLINE_ACTIVITY_URL ?? "");
    const local = process.env.FUNCTIONS_EMULATOR === "true" && clubProject.startsWith("demo-") && growlineProject.startsWith("demo-") && ["127.0.0.1", "localhost"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.hash || url.search) throw new Error("ACTIVITY_CONFIGURATION_UNAVAILABLE");
    const assertion = signClubActivityRequest(payload, actor.uid, { audience: process.env.GROWLINE_INTEGRATION_AUDIENCE ?? "", clubProject, growlineProject, keyId, secret });
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${assertion}` }, body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("ACTIVITY_UNAVAILABLE");
    const received: unknown = await response.json();
    // Re-check both the owner grant and local relationship state after the peer
    // request so a revoke during a slow fetch never displays that coach's counts.
    await requireClubAdministrator(admin.firestore(), request.auth, clubId);
    const active = await Promise.all(page.coaches.map(async (coach) => ({ ...coach, active: (await admin.firestore().doc(`clubs/${clubId}/integrationLinks/${coach.linkId}`).get()).get("status") === "active" })));
    const coaches = projectApprovedActivity(received, new Set(page.coaches.map((coach) => coach.linkId)));
    const approved = received && typeof received === "object" && "coaches" in received && Array.isArray(received.coaches) ? received.coaches : [];
    const rows = coaches.filter((_row, index) => {
      const raw: unknown = approved[index];
      return raw !== null && typeof raw === "object" && "linkId" in raw && active.some((coach) => coach.active && coach.linkId === raw.linkId);
    });
    return { coaches: rows, totals: rows.reduce((total, coach) => ({ logs: total.logs + coach.logs, peopleMet: total.peopleMet + coach.peopleMet, membersConverted: total.membersConverted + coach.membersConverted }), { logs: 0, peopleMet: 0, membersConverted: 0 }), nextCursor: page.nextCursor, ...window };
  } catch (error) { return readableError(error); }
});

export const listGrowlineClubLinks = onCall({ maxInstances: 5 }, async (request) => {
  try {
    const data = object(request.data);
    validateFields(data, ["clubId", "cursor"]);
    const clubId = typeof data.clubId === "string" ? data.clubId : "";
    await requireClubAdministrator(admin.firestore(), request.auth, clubId);
    return await ownerLinkPage(admin.firestore(), clubId, typeof data.cursor === "string" ? data.cursor : undefined);
  } catch (error) { return readableError(error); }
});

export const revokeGrowlineOwnerLinkOrCode = onCall({ maxInstances: 5 }, async (request) => {
  try {
    const data = object(request.data);
    validateFields(data, ["clubId", "kind", "targetId"]);
    const clubId = typeof data.clubId === "string" ? data.clubId : "";
    const actor = await requireClubAdministrator(admin.firestore(), request.auth, clubId);
    if ((data.kind !== "code" && data.kind !== "link") || typeof data.targetId !== "string") throw new HttpsError("invalid-argument", "Choose a code or relationship to revoke.");
    return await revokeOwnerCodeOrLink(admin.firestore(), clubId, actor.uid, actor.token.role === "owner" ? "owner" : "admin", data.kind, data.targetId);
  } catch (error) { return readableError(error); }
});
