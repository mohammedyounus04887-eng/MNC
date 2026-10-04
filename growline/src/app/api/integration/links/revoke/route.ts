import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getSessionUserId } from "@/lib/session";
import { db } from "@/lib/firebase-admin";
import { getUserById } from "@/lib/users";
import { hashClubLinkRevocationRequest, type ClubLinkRevocationRequest } from "@/lib/integration/contract";
import { signPayloadAssertion } from "@/lib/integration/serverAssertion";

const operationId = (linkId: string, key: string) => createHash("sha256").update(`growline-link-revoke:${linkId}:${key}`).digest("hex");

export async function POST(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  if (process.env.INTEGRATION_HANDOFF_ENABLED !== "true") return NextResponse.json({ error: "LINKING_DISABLED" }, { status: 404 });
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["linkId", "idempotencyKey"].includes(key)) || typeof input.linkId !== "string" || typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.idempotencyKey)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const user = await getUserById(uid);
  if (!user?.workspaceId) return NextResponse.json({ error: "WORKSPACE_REQUIRED" }, { status: 403 });
  const linkRef = db.collection("integrationLinks").doc(input.linkId);
  const linkSnapshot = await linkRef.get();
  const link = linkSnapshot.data();
  if (!linkSnapshot.exists || link?.growlineAuthUid !== uid || link?.workspaceId !== user.workspaceId) return NextResponse.json({ error: "IDENTITY_LINK_NOT_FOUND" }, { status: 404 });
  if (link.status === "revoked") return NextResponse.json({ status: "revoked", linkId: linkSnapshot.id, replay: true });

  const clubProject = process.env.CLUB_FIREBASE_PROJECT_ID;
  const growlineProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const destinationUrl = process.env.GROWLINE_CLUB_REVOKE_URL;
  const secret = process.env.GROWLINE_CLUB_SERVICE_KEY;
  const keyId = process.env.GROWLINE_CLUB_SERVICE_KEY_ID;
  const audience = process.env.GROWLINE_CLUB_DESTINATION_AUDIENCE;
  if (!clubProject || !growlineProject || !destinationUrl || !secret || !keyId || !audience || secret.length < 32) return NextResponse.json({ error: "LINKING_CONFIGURATION_UNAVAILABLE" }, { status: 503 });

  const revocation: ClubLinkRevocationRequest = { schemaVersion: 1, clubId: String(link.clubId), linkId: linkSnapshot.id, workspaceId: user.workspaceId, idempotencyKey: input.idempotencyKey };
  const opId = operationId(revocation.linkId, revocation.idempotencyKey);
  const opRef = db.collection("integrationLinkOperations").doc(opId);
  const claim = await db.runTransaction(async (tx) => {
    const [operationSnapshot, currentLinkSnapshot] = await Promise.all([tx.get(opRef), tx.get(linkRef)]);
    if (!currentLinkSnapshot.exists) return { kind: "NOT_FOUND" as const };
    const currentLink = currentLinkSnapshot.data();
    if (currentLink?.growlineAuthUid !== uid || currentLink?.workspaceId !== user.workspaceId) return { kind: "NOT_FOUND" as const };
    if (currentLink?.status === "revoked") return { kind: "DONE" as const };
    if (operationSnapshot.exists) {
      const operation = operationSnapshot.data();
      if (operation?.linkId !== revocation.linkId || operation?.idempotencyKey !== revocation.idempotencyKey) return { kind: "CONFLICT" as const };
      if (operation?.status === "SUCCEEDED") return { kind: "DONE" as const };
      if (currentLink?.status !== "revoking") return { kind: "CONFLICT" as const };
      return { kind: "RETRY" as const };
    }
    if (currentLink?.status !== "active") return { kind: "CONFLICT" as const };
    const now = Timestamp.now();
    tx.update(linkRef, { status: "revoking", updatedAt: now });
    tx.create(opRef, { schemaVersion: 1, operationId: opId, idempotencyKey: revocation.idempotencyKey, linkId: revocation.linkId, clubId: revocation.clubId, status: "PENDING", createdAt: now, updatedAt: now });
    return { kind: "CLAIMED" as const };
  });
  if (claim.kind === "NOT_FOUND") return NextResponse.json({ error: "IDENTITY_LINK_NOT_FOUND" }, { status: 404 });
  if (claim.kind === "CONFLICT") return NextResponse.json({ error: "LINK_REVOCATION_CONFLICT" }, { status: 409 });
  if (claim.kind === "DONE") return NextResponse.json({ status: "revoked", linkId: revocation.linkId, replay: true });

  const assertion = signPayloadAssertion(revocation, uid, { keyId, secret, audience, growlineProject, clubProject, lifetimeSeconds: 60 }, undefined, hashClubLinkRevocationRequest(revocation));
  try {
    const response = await fetch(destinationUrl, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${assertion}` },
      body: JSON.stringify(revocation), cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok || !result || typeof result !== "object" || (result as Record<string, unknown>).status !== "revoked") {
      return NextResponse.json({ status: "revoking", operationId: opId }, { status: 202 });
    }
    await db.runTransaction(async (tx) => {
      const [operationSnapshot, currentLinkSnapshot] = await Promise.all([tx.get(opRef), tx.get(linkRef)]);
      if (!operationSnapshot.exists || !currentLinkSnapshot.exists || currentLinkSnapshot.data()?.growlineAuthUid !== uid) throw new Error("LINK_REVOCATION_STATE_CHANGED");
      const now = Timestamp.now();
      tx.update(linkRef, { status: "revoked", revokedAt: now, revokedByGrowlineAuthUid: uid, updatedAt: now, auditEvents: FieldValue.arrayUnion({ action: "revoked", actor: uid, reason: "user_requested", at: now }) });
      tx.update(opRef, { status: "SUCCEEDED", completedAt: now, updatedAt: now });
    });
    return NextResponse.json({ status: "revoked", linkId: revocation.linkId, replay: false });
  } catch {
    return NextResponse.json({ status: "revoking", operationId: opId }, { status: 202 });
  }
}
