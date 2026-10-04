import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { applySubscription, getSubscription } from "@/modules/payments/queries";
import { fetchSubscription, isConfigured, verifyCheckoutSignature } from "@/modules/payments/razorpay";

/**
 * The browser reports that Razorpay's checkout closed successfully.
 *
 * The webhook is the source of truth and will arrive regardless. This exists so the coach
 * sees "You are a Leader" the moment they come back from checkout rather than whenever
 * the webhook lands — which is usually seconds, occasionally minutes.
 *
 * The signature is verified (payment_id|subscription_id, HMAC with the key secret), then
 * the subscription is RE-FETCHED from Razorpay rather than trusting anything the browser
 * said about its status. A client that could post "status: active" would be a client
 * granting itself a paid tier.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  if (!isConfigured()) return NextResponse.json({ error: "Individual coaches are free. Payments are disabled." }, { status: 503 });

  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const paymentId = typeof b.razorpay_payment_id === "string" ? b.razorpay_payment_id : "";
  const subscriptionId = typeof b.razorpay_subscription_id === "string" ? b.razorpay_subscription_id : "";
  const signature = typeof b.razorpay_signature === "string" ? b.razorpay_signature : "";

  if (!paymentId || !subscriptionId || !signature) {
    return NextResponse.json({ error: "Missing payment details." }, { status: 400 });
  }
  if (!verifyCheckoutSignature({ paymentId, subscriptionId, signature })) {
    return NextResponse.json({ error: "Could not verify that payment." }, { status: 400 });
  }

  // The subscription must be THIS coach's. A valid signature for somebody else's
  // subscription is still somebody else's subscription.
  const mine = await getSubscription(user.id);
  if (!mine || mine.razorpaySubscriptionId !== subscriptionId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sub = await fetchSubscription(subscriptionId);
  const result = await applySubscription({ eventId: null, eventName: "checkout.confirm", sub });
  return NextResponse.json({ ok: true, ...result });
}
