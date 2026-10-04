import { NextResponse } from "next/server";
import { HANDLED_EVENTS } from "@/modules/payments/model";
import { applySubscription } from "@/modules/payments/queries";
import { isConfigured, verifyWebhookSignature, type RzpSubscription } from "@/modules/payments/razorpay";

/**
 * Razorpay → Growline. The source of truth for every subscription state change.
 *
 * ## Unauthenticated on purpose, and gated by signature instead
 *
 * Razorpay has no Growline session. The proxy already skips `/api/*`, so this route is
 * reachable; what keeps it from being an open door is the HMAC over the RAW body with the
 * webhook secret, checked in constant time, BEFORE anything is parsed. A body that does
 * not verify is a 400 and nothing else happens.
 *
 * ## Read the raw text first
 *
 * `req.text()`, then verify, then `JSON.parse`. The signature is over the exact bytes
 * Razorpay sent, and `JSON.parse` + `JSON.stringify` does not round-trip byte-for-byte —
 * key order, whitespace and number formatting all move. Verifying a re-serialised body
 * would fail on every real event and pass on nothing.
 *
 * ## Always 200 once verified
 *
 * Razorpay retries anything that is not a 2xx, for days, with backoff. Once the signature
 * checks out we return 200 whatever `applySubscription` decides — a duplicate event, an
 * out-of-order event, an unknown subscription — because none of those is fixed by
 * Razorpay sending it again. Idempotency lives in `webhookEvents/{id}`, so a retry of an
 * event that DID apply is a no-op, not a second application.
 */
export async function POST(req: Request) {
  if (!isConfigured()) return NextResponse.json({ error: "Payments are disabled." }, { status: 503 });
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  let event: {
    event?: string;
    payload?: { subscription?: { entity?: RzpSubscription } };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }

  const name = event.event ?? "";
  const eventId = req.headers.get("x-razorpay-event-id");
  const sub = event.payload?.subscription?.entity;

  if (!HANDLED_EVENTS.has(name) || !sub || !eventId) {
    // Not ours to act on (a payment.* event, say). Acknowledge so Razorpay stops.
    return NextResponse.json({ ok: true, ignored: name || "unknown" });
  }

  const result = await applySubscription({ eventId, eventName: name, sub });
  return NextResponse.json({ ok: true, ...result });
}
