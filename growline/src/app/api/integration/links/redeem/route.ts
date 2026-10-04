import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { db } from "@/lib/firebase-admin";
import { getUserById } from "@/lib/users";
import { hashClubCodeRedemptionRequest, type ClubCodeRedemptionRequest } from "@/lib/integration/contract";
import { signPayloadAssertion } from "@/lib/integration/serverAssertion";
import { clubNavigationUrl } from "@/lib/integration/experience";

export async function GET() {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  const user = await getUserById(uid);
  if (!user?.workspaceId) return NextResponse.json({ error: "WORKSPACE_REQUIRED" }, { status: 403 });
  const snapshots = await db.collection("integrationLinks").where("growlineAuthUid", "==", uid).limit(33).get();
  const links = snapshots.docs
    .filter((snapshot) => snapshot.get("workspaceId") === user.workspaceId && ["active", "revoking", "revoked"].includes(snapshot.get("status")))
    .slice(0, 32).map((snapshot, index) => {
      const clubId = String(snapshot.get("clubId"));
      return { linkId: snapshot.id, clubId, clubName: typeof snapshot.get("clubName") === "string" && snapshot.get("clubName").trim() ? snapshot.get("clubName") : `Linked Club ${index + 1}`, status: snapshot.get("status"), activitySharingEnabled: snapshot.get("activitySharingEnabled") === true };
    });
  return NextResponse.json({ links, active: process.env.INTEGRATION_HANDOFF_ENABLED === "true", clubUrl: clubNavigationUrl(process.env.CLUB_WEB_ORIGIN) });
}

export async function POST(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  if (process.env.INTEGRATION_HANDOFF_ENABLED !== "true") return NextResponse.json({ error: "LINKING_DISABLED" }, { status: 404 });
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["clubId", "code", "idempotencyKey"].includes(key)) || typeof input.clubId !== "string" || typeof input.code !== "string" || typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.idempotencyKey)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const user = await getUserById(uid);
  if (!user?.workspaceId) return NextResponse.json({ error: "WORKSPACE_REQUIRED" }, { status: 403 });
  const clubProject = process.env.CLUB_FIREBASE_PROJECT_ID;
  const growlineProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const destinationUrl = process.env.GROWLINE_CLUB_REDEEM_URL;
  const secret = process.env.GROWLINE_CLUB_SERVICE_KEY;
  const keyId = process.env.GROWLINE_CLUB_SERVICE_KEY_ID;
  const audience = process.env.GROWLINE_CLUB_DESTINATION_AUDIENCE;
  if (!clubProject || !growlineProject || !destinationUrl || !secret || !keyId || !audience || secret.length < 32) {
    return NextResponse.json({ error: "LINKING_CONFIGURATION_UNAVAILABLE" }, { status: 503 });
  }

  const redemption: ClubCodeRedemptionRequest = {
    schemaVersion: 1,
    clubId: input.clubId,
    code: input.code,
    workspaceId: user.workspaceId,
    idempotencyKey: input.idempotencyKey,
  };
  const assertion = signPayloadAssertion(redemption, uid, {
    keyId, secret, audience, growlineProject, clubProject, lifetimeSeconds: 60,
  }, Math.floor(Date.now() / 1000), hashClubCodeRedemptionRequest(redemption));
  try {
    const response = await fetch(destinationUrl, {
      method: "POST", redirect: "error", headers: { "content-type": "application/json", authorization: `Bearer ${assertion}` },
      body: JSON.stringify(redemption), cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok || !result || typeof result !== "object") return NextResponse.json({ error: (result as Record<string, unknown> | null)?.error ?? "CODE_REDEMPTION_FAILED" }, { status: response.status || 502 });
    const link = result as Record<string, unknown>;
    if (typeof link.linkId !== "string" || link.status !== "active" || link.verificationMethod !== "dual_authenticated_consent" || link.growlineAuthUid !== uid || link.workspaceId !== user.workspaceId || link.clubId !== redemption.clubId || typeof link.clubAuthUid !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(link.clubAuthUid) || link.clubProject !== clubProject || link.growlineProject !== growlineProject) {
      return NextResponse.json({ error: "INVALID_CLUB_LINK_RESPONSE" }, { status: 502 });
    }
    const ref = db.collection("integrationLinks").doc(link.linkId);
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) {
        const data = existing.data();
        if (data?.clubId !== link.clubId || data?.workspaceId !== user.workspaceId || data?.growlineAuthUid !== uid || data?.status !== "active") throw new Error("IDENTITY_LINK_CONFLICT");
        return;
      }
      const now = new Date();
      tx.create(ref, {
        schemaVersion: 1, linkId: link.linkId, clubId: link.clubId, clubProject: link.clubProject,
        clubAuthUid: link.clubAuthUid, growlineProject, workspaceId: user.workspaceId,
        clubName: typeof link.clubName === "string" ? link.clubName.slice(0, 100) : "Linked Club",
        activitySharingEnabled: false,
        growlineAuthUid: uid, status: "active", verificationMethod: "dual_authenticated_consent",
        verifiedAt: link.verifiedAt, createdAt: now, updatedAt: now,
        auditEvents: [
          { action: "code_issued", actor: link.clubAuthUid, at: link.verifiedAt },
          { action: "code_redeemed", actor: uid, at: link.verifiedAt },
        ],
      });
    });
    return NextResponse.json({ status: "active", clubId: link.clubId, linkId: link.linkId, replay: link.replay === true });
  } catch {
    return NextResponse.json({ error: "CODE_REDEMPTION_PENDING_RETRY_SAME_KEY" }, { status: 202 });
  }
}
