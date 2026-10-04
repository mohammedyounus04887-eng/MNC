import { createHash } from "node:crypto";
import * as admin from "firebase-admin";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { issueClubLinkCode, redeemClubLinkCode, revokeClubGrowlineLink, type RedeemLinkInput, type RevokeLinkInput } from "./clubLinking";
import { verifyServerAssertion } from "./integrationHandoff";

const codePepper = defineSecret("CLUB_LINK_CODE_PEPPER");
const serviceKeys = defineSecret("CLUB_GROWLINE_SERVICE_KEYS");

function keys(value: string): Map<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed);
    if (!entries.length || entries.some(([key, secret]) => !key || typeof secret !== "string" || secret.length < 32)) return null;
    return new Map(entries as Array<[string, string]>);
  } catch { return null; }
}

export const issueGrowlineClubCode = onCall({ secrets: [codePepper], maxInstances: 5 }, async (request) => {
  if (!request.auth || request.auth.token.firebase.sign_in_provider === "anonymous") throw new HttpsError("unauthenticated", "A signed-in Club administrator is required");
  const clubId = typeof request.data?.clubId === "string" ? request.data.clubId : "";
  const uid = request.auth.uid;
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "";
  const userIsPlatformAdmin = (await admin.firestore().doc(`superAdmins/${uid}`).get()).data()?.enabled === true;
  if (!clubId || (!userIsPlatformAdmin && request.auth.token.clubId !== clubId)) throw new HttpsError("permission-denied", "Club administrator authorization is required");
  try {
    const issued = await issueClubLinkCode(admin.firestore(), clubId, uid, codePepper.value(), Date.now(), userIsPlatformAdmin, true);
    return { code: issued.code, codeId: issued.codeId, expiresAt: issued.expiresAt.toDate().toISOString(), clubProject: projectId };
  } catch (error) {
    const code = error instanceof Error ? error.message : "CODE_ISSUANCE_FAILED";
    throw new HttpsError(code === "CLUB_ADMIN_REQUIRED" ? "permission-denied" : "failed-precondition", code);
  }
});

export const redeemGrowlineClubCode = onRequest(
  { secrets: [codePepper, serviceKeys], cors: false, maxInstances: 5 },
  async (request, response) => {
    if (request.method !== "POST") { response.set("Allow", "POST").status(405).json({ error: "METHOD_NOT_ALLOWED" }); return; }
    if (process.env.INTEGRATION_HANDOFF_ENABLED !== "true") { response.status(404).json({ error: "NOT_FOUND" }); return; }
    const body = request.body as Record<string, unknown> | null;
    if (!body || Object.keys(body).some((key) => !["schemaVersion", "clubId", "code", "workspaceId", "idempotencyKey"].includes(key)) || body.schemaVersion !== 1 || [body.clubId, body.code, body.workspaceId, body.idempotencyKey].some((value) => typeof value !== "string" || !value) || String(body.code).length > 128) {
      response.status(400).json({ error: "INVALID_REDEMPTION_REQUEST" }); return;
    }
    const canonicalBody = JSON.stringify({ schemaVersion: 1, clubId: body.clubId, code: body.code, workspaceId: body.workspaceId, idempotencyKey: body.idempotencyKey });
    const requestHash = createHash("sha256").update(canonicalBody).digest("hex");
    const audience = process.env.CLUB_INTEGRATION_AUDIENCE;
    const growlineProject = process.env.GROWLINE_PROJECT_ID;
    const clubProject = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
    const activeKeys = keys(serviceKeys.value());
    if (!audience || !growlineProject || !clubProject || !activeKeys) { response.status(503).json({ error: "INTEGRATION_CONFIGURATION_UNAVAILABLE" }); return; }
    const verified = verifyServerAssertion(request.get("authorization") ?? null, { audience, growlineProject, clubProject, activeKeys, maxTokenAgeSeconds: 120 });
    if (!verified.ok) { response.status(401).json({ error: verified.code }); return; }
    if (verified.caller.requestHash !== requestHash) { response.status(401).json({ error: "REQUEST_HASH_MISMATCH" }); return; }
    try {
      const result = await redeemClubLinkCode(admin.firestore(), {
        clubId: String(body.clubId),
        code: String(body.code),
        workspaceId: String(body.workspaceId),
        idempotencyKey: String(body.idempotencyKey),
        growlineAuthUid: verified.caller.growlineAuthUid,
        growlineProject: verified.caller.growlineProject,
      } satisfies RedeemLinkInput, codePepper.value(), clubProject);
      response.status(200).json({ ...result, verifiedAt: result.verifiedAt.toDate().toISOString() });
    } catch (error) {
      const code = error instanceof Error ? error.message : "CODE_REDEMPTION_FAILED";
      response.status(409).json({ error: code });
    }
  },
);

export const revokeGrowlineClubLink = onRequest(
  { secrets: [serviceKeys], cors: false, maxInstances: 5 },
  async (request, response) => {
    if (request.method !== "POST") { response.set("Allow", "POST").status(405).json({ error: "METHOD_NOT_ALLOWED" }); return; }
    if (process.env.INTEGRATION_HANDOFF_ENABLED !== "true") { response.status(404).json({ error: "NOT_FOUND" }); return; }
    const body = request.body as Record<string, unknown> | null;
    const fields = ["schemaVersion", "clubId", "linkId", "workspaceId", "idempotencyKey"];
    if (!body || Object.keys(body).some((key) => !fields.includes(key)) || body.schemaVersion !== 1 || fields.slice(1).some((key) => typeof body[key] !== "string" || !body[key])) {
      response.status(400).json({ error: "INVALID_REVOCATION_REQUEST" }); return;
    }
    const normalized = JSON.stringify({ schemaVersion: 1, clubId: body.clubId, linkId: body.linkId, workspaceId: body.workspaceId, idempotencyKey: body.idempotencyKey });
    const requestHash = createHash("sha256").update(normalized).digest("hex");
    const audience = process.env.CLUB_INTEGRATION_AUDIENCE;
    const growlineProject = process.env.GROWLINE_PROJECT_ID;
    const clubProject = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
    const activeKeys = keys(serviceKeys.value());
    if (!audience || !growlineProject || !clubProject || !activeKeys) { response.status(503).json({ error: "INTEGRATION_CONFIGURATION_UNAVAILABLE" }); return; }
    const verified = verifyServerAssertion(request.get("authorization") ?? null, { audience, growlineProject, clubProject, activeKeys, maxTokenAgeSeconds: 120 });
    if (!verified.ok) { response.status(401).json({ error: verified.code }); return; }
    if (verified.caller.requestHash !== requestHash) { response.status(401).json({ error: "REQUEST_HASH_MISMATCH" }); return; }
    try {
      const input: RevokeLinkInput = {
        clubId: String(body.clubId), linkId: String(body.linkId), workspaceId: String(body.workspaceId),
        idempotencyKey: String(body.idempotencyKey), growlineAuthUid: verified.caller.growlineAuthUid,
        growlineProject: verified.caller.growlineProject,
      };
      const result = await revokeClubGrowlineLink(admin.firestore(), input, verified.caller);
      response.status(200).json({ ...result, revokedAt: result.revokedAt.toDate().toISOString() });
    } catch (error) {
      response.status(409).json({ error: error instanceof Error ? error.message : "LINK_REVOCATION_FAILED" });
    }
  },
);
