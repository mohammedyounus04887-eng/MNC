import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getSubscription, markCancelled } from "@/modules/payments/queries";
import { cancelSubscription, isConfigured } from "@/modules/payments/razorpay";

/**
 * Cancel — the two-tap flow (v1 §4.7, v2 §8). Tap one is the button, tap two is the
 * confirm in the client; this route is what the second tap calls.
 *
 * Cancels at cycle end: the coach keeps Leader until the end of what they have already
 * paid for, then moves to Starter. Nothing is deleted. That is not a courtesy — v2 §8
 * says never lock a user out of their business, and RULES G1 says the screen that does
 * this is a Trust Zone. A cancel that clawed back a paid month would be a dark pattern in
 * reverse.
 *
 * The provider must confirm cancellation before the local record changes. Disabled
 * payments never alter a historical mandate or claim that it was cancelled.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  // A disabled provider cannot confirm cancellation; never mark a live mandate cancelled locally.
  if (!isConfigured()) return NextResponse.json({ error: "Payments are disabled. Contact the operator for any historical provider mandate." }, { status: 503 });

  const rec = await getSubscription(user.id);
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (rec.cancelledAt) return NextResponse.json({ ok: true, already: true });

  if (isConfigured()) {
    try {
      await cancelSubscription(rec.razorpaySubscriptionId);
    } catch (e) {
      return NextResponse.json(
        {
          error:
            "Cancellation was not confirmed by the provider. Nothing was marked cancelled here. Please try again in a moment.",
          detail: (e as Error).message,
        },
        { status: 502 }
      );
    }
  }
  await markCancelled(user.id);
  return NextResponse.json({ ok: true });
}
