import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS, pushSubscriptionDocId } from "@/lib/collections";
import { db } from "@/lib/firebase-admin";
import { getSessionUserId } from "@/lib/session";
import { isPushConfigured } from "@/lib/push";

const MAX_FIELD = 512;

/** Stores (or re-points) one device's push subscription for the signed-in coach. */
export async function POST(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: "Reminders are not set up on this server yet." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const endpoint = String((body as Record<string, unknown>)?.endpoint ?? "");
  const keys = (body as Record<string, unknown>)?.keys as
    | { p256dh?: unknown; auth?: unknown }
    | undefined;
  const p256dh = String(keys?.p256dh ?? "");
  const auth = String(keys?.auth ?? "");
  const timezone = String((body as Record<string, unknown>)?.timezone ?? "");

  if (
    !endpoint.startsWith("https://") ||
    endpoint.length > MAX_FIELD ||
    !p256dh ||
    p256dh.length > MAX_FIELD ||
    !auth ||
    auth.length > MAX_FIELD
  ) {
    return NextResponse.json({ error: "That subscription is not valid." }, { status: 400 });
  }

  // Only accept a timezone the runtime actually recognises, since it is used to
  // decide when this coach's morning is.
  let safeTimezone = "Asia/Kolkata";
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      safeTimezone = timezone;
    } catch {
      // keep the default
    }
  }

  // Upsert on endpoint: a device that re-subscribes must replace its old row, and
  // an endpoint that moved to a different coach (shared phone) must follow them.
  // The endpoint hash IS the document id, so `set` is the upsert: a device that
  // re-subscribes replaces its own row rather than accumulating duplicates and
  // sending twice, and an endpoint that moved to a different coach (shared phone)
  // follows them.
  await db
    .collection(COLLECTIONS.pushSubscriptions)
    .doc(pushSubscriptionDocId(endpoint))
    .set({
      userId: uid,
      endpoint,
      p256dh,
      auth,
      timezone: safeTimezone,
      // The daily job orders by this to pick one timezone per coach — the most
      // recently registered device wins. Without it that ordering is undefined.
      createdAt: Timestamp.now(),
    });

  return NextResponse.json({ ok: true });
}
