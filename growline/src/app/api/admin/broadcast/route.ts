import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { recordAdminAction } from "@/lib/admin-audit";
import { createPlatformThread } from "@/lib/threads-queries";
import { checkBody, checkLinkUrl } from "@/lib/threads";
import { users } from "@/lib/collections";

/**
 * A Real V announcement to every coach (F12).
 *
 * Re-checks `isAdmin` rather than trusting that the caller came from the gated layout:
 * this is a route, and a route is reachable directly. 404 for a non-admin, matching the
 * panel — a 403 would confirm the endpoint exists.
 *
 * Audited before the response returns, and deliberately AFTER the write: an audit entry
 * for a broadcast that failed would be worse than none, because somebody reading the log
 * would believe it went out.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const body = (raw ?? {}) as Record<string, unknown>;

  const bodyCheck = checkBody(body.body);
  if (!bodyCheck.ok) {
    return NextResponse.json({ error: bodyCheck.error }, { status: 400 });
  }
  const linkCheck = checkLinkUrl(body.linkUrl);
  if (!linkCheck.ok) {
    return NextResponse.json({ error: linkCheck.error }, { status: 400 });
  }

  /**
   * A typed confirmation, because this is the one action in the app with no undo and the
   * widest possible audience. There is no "unsend": it lands in every coach's inbox the
   * moment it is written.
   */
  if (body.confirm !== "SEND TO EVERYONE") {
    return NextResponse.json({ error: "Confirmation text does not match." }, { status: 400 });
  }

  const thread = await createPlatformThread({
    sender: user,
    body: bodyCheck.body,
    linkUrl: linkCheck.linkUrl,
  });

  const reach = (await users().count().get()).data().count;
  await recordAdminAction({
    actorId: user.id,
    actorName: user.name,
    action: "broadcast",
    // The message itself, so the log answers "what did we say" without a second lookup.
    detail: `To all ${reach} coaches: ${bodyCheck.body}`,
  });

  return NextResponse.json({ ok: true, id: thread.id, reach });
}
