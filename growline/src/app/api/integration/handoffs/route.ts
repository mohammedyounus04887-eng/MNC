import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { db } from "@/lib/firebase-admin";
import { getUserById } from "@/lib/users";
import { getProspectForCoach } from "@/lib/prospects";
import { type HandoffRequest } from "@/lib/integration/contract";
import { deliverHandoff } from "@/lib/integration/handoffService";
import { clubNavigationUrl, INTEGRATION_ID, MAX_HANDOFF_ATTEMPTS, mayStartHandoff } from "@/lib/integration/experience";

const operationId = (key: string) => createHash("sha256").update(`growline-club:${key}`).digest("hex");
const memberIdentity = (workspaceId: string, prospectId: string) => `member_${createHash("sha256").update(`${workspaceId}:${prospectId}`).digest("hex").slice(0, 32)}`;
const intentHash = (request: HandoffRequest) => {
  const intent = Object.fromEntries(Object.entries(request).filter(([key]) => key !== "handoffId" && key !== "consentTimestamp"));
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
};
type HandoffOperation = { requestHash: string; intentHash: string; request: HandoffRequest; status: string; attempt: number; canonicalClubMemberId: string | null; [key: string]: unknown };

/** Explicit, authenticated Add-to-Club initiation. Server owns source reads, consent time and retry state. */
export async function POST(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  if (process.env.INTEGRATION_HANDOFF_ENABLED !== "true") return NextResponse.json({ error: "HANDOFF_DISABLED" }, { status: 404 });
  const consentText = process.env.GROWLINE_CLUB_CONSENT_TEXT?.trim();
  const consentVersion = process.env.GROWLINE_CLUB_CONSENT_VERSION?.trim();
  if (!consentText || !consentVersion) return NextResponse.json({ error: "APPROVED_CONSENT_CONFIGURATION_REQUIRED" }, { status: 503 });

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["prospectId", "clubId", "linkId", "consentGiven", "consentVersion", "idempotencyKey"].includes(key)) ||
      [input.prospectId, input.clubId, input.linkId, input.idempotencyKey].some((value) => typeof value !== "string" || !INTEGRATION_ID.test(value))) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  if (input.consentGiven !== true || input.consentVersion !== consentVersion || typeof input.prospectId !== "string" || typeof input.clubId !== "string" || typeof input.linkId !== "string" || typeof input.idempotencyKey !== "string") {
    return NextResponse.json({ error: "CONSENT_OR_REQUEST_REQUIRED" }, { status: 400 });
  }
  const user = await getUserById(uid);
  if (!user?.workspaceId) return NextResponse.json({ error: "WORKSPACE_REQUIRED" }, { status: 403 });
  const prospect = await getProspectForCoach(input.prospectId, uid);
  if (!prospect || (prospect.workspaceId && prospect.workspaceId !== user.workspaceId)) return NextResponse.json({ error: "PROSPECT_NOT_FOUND" }, { status: 404 });

  const opId = operationId(input.idempotencyKey);
  const opRef = db.collection("integrationHandoffs").doc(opId);
  const operationSnapshot = await opRef.get();
  const prior = operationSnapshot.data() as HandoffOperation | undefined;
  if (!mayStartHandoff(prospect.stage, prior?.status)) return NextResponse.json({ error: "MEMBER_STAGE_REQUIRED" }, { status: 409 });
  const linkRef = db.collection("integrationLinks").doc(input.linkId);
  const linkSnap = await linkRef.get();
  const link = linkSnap.data();
  const growlineMemberId = memberIdentity(user.workspaceId, prospect.id);
  if (!linkSnap.exists || (link?.status !== "active" && prior?.status !== "PENDING" && prior?.status !== "SUCCEEDED") || link?.workspaceId !== user.workspaceId || link?.growlineAuthUid !== uid || link?.clubId !== input.clubId || link?.clubProject !== process.env.CLUB_FIREBASE_PROJECT_ID || link?.growlineProject !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || link?.verificationMethod !== "dual_authenticated_consent") {
    return NextResponse.json({ error: "ACTIVE_DUAL_VERIFIED_LINK_REQUIRED" }, { status: 403 });
  }

  const proposedRequest: HandoffRequest = {
    schemaVersion: 2,
    handoffId: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    growlineMemberId,
    workspaceId: user.workspaceId,
    clubId: link.clubId as string,
    destinationClubId: link.clubId as string,
    linkId: linkSnap.id,
    displayName: prospect.name,
    phone: prospect.phone,
    phoneVerification: { status: "unverified", method: "growline_prospect_entry", verifiedAt: null },
    email: null,
    emailVerification: null,
    sourceCoachId: uid,
    sourceGrowLineProspectId: prospect.id,
    consentTimestamp: new Date().toISOString(),
    consentVersion,
  };
  if (prior && prior.intentHash !== intentHash(proposedRequest)) return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
  if (prior?.status === "SUCCEEDED") return NextResponse.json({ status: "SUCCEEDED", canonicalClubMemberId: prior.canonicalClubMemberId, operationId: opId, replay: true });
  if (prior && prior.status !== "PENDING") return NextResponse.json({ status: prior.status, canonicalClubMemberId: prior.canonicalClubMemberId ?? null, operationId: opId, reasonCode: prior.lastErrorCode ?? null }, { status: 409 });
  const request: HandoffRequest = prior?.request ?? proposedRequest;
  const destinationUrl = process.env.GROWLINE_CLUB_DESTINATION_URL;
  const secret = process.env.GROWLINE_CLUB_SERVICE_KEY;
  const keyId = process.env.GROWLINE_CLUB_SERVICE_KEY_ID;
  const audience = process.env.GROWLINE_CLUB_DESTINATION_AUDIENCE;
  const growlineProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!destinationUrl || !secret || !keyId || !audience || !growlineProject || secret.length < 32) {
    return NextResponse.json({ status: "PENDING", operationId: opId, error: "DESTINATION_CONFIGURATION_UNAVAILABLE" }, { status: 202 });
  }
  const result = await deliverHandoff({
    db, request, actorUid: uid, clubProject: link.clubProject as string, destinationUrl,
    signing: { keyId, secret, audience, growlineProject, clubProject: link.clubProject as string, lifetimeSeconds: 60 },
  });
  return NextResponse.json(result.body, { status: result.httpStatus });
}

/** Minimal Add-to-Club choices and the approved consent copy configured by the operator. */
export async function GET(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  const user = await getUserById(uid);
  if (!user?.workspaceId) return NextResponse.json({ error: "WORKSPACE_REQUIRED" }, { status: 403 });
  const parameters = new URL(req.url).searchParams;
  const key = parameters.get("idempotencyKey");
  if (key) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)) return NextResponse.json({ error: "INVALID_IDEMPOTENCY_KEY" }, { status: 400 });
    const snapshot = await db.collection("integrationHandoffs").doc(operationId(key)).get();
    const operation = snapshot.data();
    if (!operation || operation.request?.sourceCoachId !== uid || operation.request?.workspaceId !== user.workspaceId) return NextResponse.json({ error: "HANDOFF_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ status: operation.status, operationId: operation.operationId, canonicalClubMemberId: operation.canonicalClubMemberId ?? null, attempts: operation.attempt, canRetry: operation.status === "PENDING" && operation.attempt < MAX_HANDOFF_ATTEMPTS });
  }
  const prospectId = parameters.get("prospectId");
  if (prospectId && !INTEGRATION_ID.test(prospectId)) return NextResponse.json({ error: "INVALID_PROSPECT" }, { status: 400 });
  const prospect = prospectId ? await getProspectForCoach(prospectId, uid) : null;
  if (prospectId && (!prospect || (prospect.workspaceId && prospect.workspaceId !== user.workspaceId))) return NextResponse.json({ error: "PROSPECT_NOT_FOUND" }, { status: 404 });
  const operationSnapshot = prospect?.integrationHandoffOperationId ? await db.collection("integrationHandoffs").doc(prospect.integrationHandoffOperationId).get() : null;
  const saved = operationSnapshot?.data();
  const current = saved?.request?.sourceCoachId === uid && saved?.request?.workspaceId === user.workspaceId ? {
    status: saved.status, linkId: saved.request.linkId, clubId: saved.request.clubId, idempotencyKey: saved.idempotencyKey,
    attempts: saved.attempt, canRetry: saved.status === "PENDING" && saved.attempt < MAX_HANDOFF_ATTEMPTS,
  } : prospect?.clubMemberId ? { status: "SUCCEEDED", canRetry: false } : null;
  const consentText = process.env.GROWLINE_CLUB_CONSENT_TEXT?.trim() ?? "";
  const consentVersion = process.env.GROWLINE_CLUB_CONSENT_VERSION?.trim() ?? "";
  const active = process.env.INTEGRATION_HANDOFF_ENABLED === "true" && Boolean(consentText && consentVersion);
  if (!active) return NextResponse.json({ active: false, consentText: "", consentVersion: "", clubs: [], current, memberEligible: prospect?.stage === "member" });
  const links = await db.collection("integrationLinks")
    .where("growlineAuthUid", "==", uid)
    .where("workspaceId", "==", user.workspaceId)
    .limit(33)
    .get();
  return NextResponse.json({
    active: true, consentText, consentVersion, current, memberEligible: prospect?.stage === "member", clubUrl: clubNavigationUrl(process.env.CLUB_WEB_ORIGIN),
    clubs: links.docs.filter((doc) => doc.get("status") === "active" && doc.get("clubProject") === process.env.CLUB_FIREBASE_PROJECT_ID && doc.get("growlineProject") === process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && doc.get("verificationMethod") === "dual_authenticated_consent").slice(0, 32).map((doc, index) => ({ linkId: doc.id, clubId: String(doc.get("clubId")), clubName: typeof doc.get("clubName") === "string" && doc.get("clubName").trim() ? doc.get("clubName") : `Linked Club ${index + 1}` })),
  });
}
