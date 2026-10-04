import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { isPlanKey } from "@/modules/payments/model";
import { getSubscription, recordCreated } from "@/modules/payments/queries";
import { createSubscription, isConfigured, keyId } from "@/modules/payments/razorpay";
import { getTierState } from "@/modules/tiers/queries";

/**
 * Starts a Leader subscription (v2 §8, Phase 9b).
 *
 * Creates the Razorpay subscription in `created` state and hands the browser what it
 * needs to open Razorpay's own checkout: the key id (public) and the subscription id.
 * The coach authenticates the UPI mandate INSIDE Razorpay's checkout — this server never
 * sees a UPI id, a card, or a bank detail (RULES L7).
 *
 * Nothing is granted here. The tier moves when Razorpay says the mandate is
 * authenticated, via the webhook or the checkout callback.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  if (!isConfigured()) {
    // 503, and it says so: a payments button that fails with a stack trace is worse than
    // one that says payments are not switched on yet.
    return NextResponse.json(
      { error: "Payments are not switched on for this server yet." },
      { status: 503 }
    );
  }

  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (!isPlanKey(b.plan)) {
    return NextResponse.json({ error: "Choose monthly or annual." }, { status: 400 });
  }

  // Already a paying Leader — do not stack a second mandate on top. Send them to
  // manage the one they have.
  const [tier, existing] = await Promise.all([getTierState(user), getSubscription(user.id)]);
  if (tier.tier === "leader" && existing && !existing.cancelledAt) {
    return NextResponse.json(
      { error: "You already have a Leader plan. Manage it from Plans." },
      { status: 409 }
    );
  }

  const sub = await createSubscription({ plan: b.plan, userId: user.id });
  await recordCreated({ userId: user.id, plan: b.plan, sub });

  return NextResponse.json({
    ok: true,
    keyId: keyId(),
    subscriptionId: sub.id,
    // Prefill is a convenience for the coach, not data we send anywhere else.
    prefill: { name: user.name, contact: user.phone },
  });
}
