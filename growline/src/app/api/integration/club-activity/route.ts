import { NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import { getSessionUserId } from "@/lib/session";
import { todayKey } from "@/lib/daily-log";
import { validateClubActivityRequest, verifyClubActivityAssertion } from "@/lib/integration/activity-contract";
import { getClubCoachActivity, setClubActivitySharing } from "@/lib/integration/club-activity";

/** Only an authenticated Club server can request approved aggregate counts. */
export async function POST(req: Request) {
  if (process.env.INTEGRATION_ACTIVITY_ENABLED !== "true") return NextResponse.json({ error: "ACTIVITY_DISABLED" }, { status: 404 });
  try {
    const request = validateClubActivityRequest(await req.json(), todayKey());
    const clubProject = process.env.CLUB_FIREBASE_PROJECT_ID ?? "";
    const growlineProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";
    verifyClubActivityAssertion(req.headers.get("authorization"), request, {
      audience: process.env.GROWLINE_INTEGRATION_AUDIENCE ?? "", clubProject, growlineProject,
      keyId: process.env.GROWLINE_CLUB_SERVICE_KEY_ID ?? "", secret: process.env.GROWLINE_CLUB_SERVICE_KEY ?? "",
    });
    return NextResponse.json({ schemaVersion: 1, coaches: await getClubCoachActivity(db, request, clubProject, growlineProject) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ACTIVITY_UNAVAILABLE";
    const status = code === "UNAUTHORIZED_CLUB_SERVICE" ? 401 : code === "CLUB_RELATIONSHIP_SCOPE_MISMATCH" ? 403 : code === "INVALID_ACTIVITY_REQUEST" ? 400 : 503;
    return NextResponse.json({ error: status === 503 ? "ACTIVITY_UNAVAILABLE" : code }, { status });
  }
}

/** A coach approves only their own authenticated profile name and counts. */
export async function PATCH(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  const origin = req.headers.get("origin");
  let expectedOrigin: string;
  try { expectedOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").origin; }
  catch { return NextResponse.json({ error: "ACTIVITY_SHARING_UNAVAILABLE" }, { status: 503 }); }
  if (origin && origin !== expectedOrigin) return NextResponse.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID_ACTIVITY_SHARING_REQUEST" }, { status: 400 });
  const data = body as Record<string, unknown>;
  if (Object.keys(data).some((key) => !["linkId", "activitySharingEnabled"].includes(key)) || typeof data.linkId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(data.linkId) || typeof data.activitySharingEnabled !== "boolean") return NextResponse.json({ error: "INVALID_ACTIVITY_SHARING_REQUEST" }, { status: 400 });
  try { return NextResponse.json(await setClubActivitySharing(db, uid, data.linkId, data.activitySharingEnabled)); }
  catch (error) {
    const code = error instanceof Error ? error.message : "ACTIVITY_SHARING_UNAVAILABLE";
    return NextResponse.json({ error: code }, { status: code === "ACTIVITY_LINK_NOT_FOUND" ? 404 : code === "ACTIVITY_LINK_UNAVAILABLE" ? 409 : 503 });
  }
}
