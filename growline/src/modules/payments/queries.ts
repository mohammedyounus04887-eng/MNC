import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { todayKey } from "@/lib/daily-log";
import { tiers } from "@/modules/tiers/queries";
import {
  ENDED_STATUSES,
  GRACE_DAYS,
  GRACE_STATUSES,
  isPaidLeader,
  isPlanKey,
  shouldApply,
  type PlanKey,
  type SubscriptionRecord,
} from "./model";
import type { RzpSubscription } from "./razorpay";

/**
 * Server side of payments (Phase 9b).
 *
 * ## Collections
 *
 *   subscriptions/{userId}          one per coach. Keyed by uid so a coach cannot hold two.
 *   webhookEvents/{eventId}         one per Razorpay event id. Its EXISTENCE is "already
 *                                   processed" — idempotency is structural, not a flag.
 *
 * ## The one write that matters
 *
 * `applySubscription` is the only function that decides what a Razorpay state means for a
 * coach, and it ends by writing `tiers/{userId}` — the document `effectiveTier` already
 * reads. That is deliberate: there is one place that answers "is this coach a paying
 * Leader", it is the tier record, and payments FEEDS it rather than being a second answer
 * the app has to reconcile. Downgrade is the tier record changing, never a deletion.
 *
 * ## No Security Rules block — same as tiers, portfolios, the wall
 *
 * Every read is server-side; the catch-all deny stands. A client-readable subscription
 * document would expose Razorpay ids for no reason, and a client-WRITABLE one would be
 * a coach setting their own tier.
 */

export const SUBSCRIPTIONS = "subscriptions";
export const WEBHOOK_EVENTS = "webhookEvents";
export const subscriptions = () => db.collection(SUBSCRIPTIONS);
export const webhookEvents = () => db.collection(WEBHOOK_EVENTS);

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);
const fromUnix = (s: number | null | undefined): Timestamp | null =>
  typeof s === "number" && s > 0 ? Timestamp.fromMillis(s * 1000) : null;

function toRecord(snap: DocumentSnapshot): SubscriptionRecord | null {
  const d = snap.data();
  if (!d || !isPlanKey(d.plan)) return null;
  return {
    userId: snap.id,
    plan: d.plan,
    razorpaySubscriptionId: String(d.razorpaySubscriptionId ?? ""),
    razorpayCustomerId: (d.razorpayCustomerId as string | null) ?? null,
    status: String(d.status ?? ""),
    currentEndAt: toDate(d.currentEndAt),
    cancelledAt: toDate(d.cancelledAt),
    graceUntil: toDate(d.graceUntil),
    createdAt: toDate(d.createdAt) ?? new Date(0),
    updatedAt: toDate(d.updatedAt) ?? new Date(0),
  };
}

export async function getSubscription(userId: string): Promise<SubscriptionRecord | null> {
  return toRecord(await subscriptions().doc(userId).get());
}

/** Find the coach a Razorpay subscription belongs to. Notes first (no read), then a scan. */
export async function userIdForSubscription(sub: RzpSubscription): Promise<string | null> {
  const fromNotes = sub.notes?.userId;
  if (typeof fromNotes === "string" && fromNotes) return fromNotes;
  const snap = await subscriptions()
    .where("razorpaySubscriptionId", "==", sub.id)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

/**
 * Records a subscription the coach just created (status "created"). Nothing is granted
 * yet — the mandate is not authenticated until Razorpay says so via webhook or the
 * checkout callback. Recording it now is what lets the webhook find the coach.
 */
export async function recordCreated(params: {
  userId: string;
  plan: PlanKey;
  sub: RzpSubscription;
}): Promise<void> {
  const now = Timestamp.now();
  await subscriptions().doc(params.userId).set(
    {
      plan: params.plan,
      razorpaySubscriptionId: params.sub.id,
      razorpayCustomerId: params.sub.customer_id ?? null,
      status: params.sub.status,
      currentEndAt: fromUnix(params.sub.current_end),
      cancelledAt: null,
      graceUntil: null,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );
}

/**
 * Applies a Razorpay subscription state to the coach's record AND to their tier.
 *
 * Idempotent per event: the caller passes the event id, and if `webhookEvents/{id}`
 * already exists this returns without touching anything. Out-of-order safe: an event that
 * would move an ended subscription back to active is refused by `shouldApply`.
 *
 * `eventId` is null for the checkout callback (which has no event id) — that path is
 * naturally idempotent because it only ever moves toward "active".
 */
export async function applySubscription(params: {
  eventId: string | null;
  eventName: string;
  sub: RzpSubscription;
  now?: Date;
}): Promise<{ applied: boolean; reason: string }> {
  const { sub } = params;
  const now = params.now ?? new Date();

  // Idempotency: seen this event, done. Written FIRST with create(), so a retry that
  // races the original cannot both pass this check — one of the two creates fails.
  if (params.eventId) {
    const marker = webhookEvents().doc(params.eventId);
    try {
      await marker.create({
        eventName: params.eventName,
        subscriptionId: sub.id,
        at: Timestamp.now(),
      });
    } catch (e) {
      if (/ALREADY_EXISTS|already exists/i.test((e as Error).message)) {
        return { applied: false, reason: "duplicate event" };
      }
      throw e;
    }
  }

  const userId = await userIdForSubscription(sub);
  if (!userId) return { applied: false, reason: "no coach for this subscription" };

  const stored = await getSubscription(userId);
  if (!shouldApply(stored, sub.status)) {
    return { applied: false, reason: `would move ${stored?.status} back to ${sub.status}` };
  }

  const isCancel = params.eventName === "subscription.cancelled" || sub.status === "cancelled";
  const isGrace = GRACE_STATUSES.has(sub.status);

  const patch: Record<string, unknown> = {
    status: sub.status,
    razorpayCustomerId: sub.customer_id ?? stored?.razorpayCustomerId ?? null,
    currentEndAt:
      fromUnix(sub.current_end) ??
      (stored?.currentEndAt ? Timestamp.fromDate(stored.currentEndAt) : null),
    updatedAt: Timestamp.now(),
  };
  if (isCancel && !stored?.cancelledAt) patch.cancelledAt = Timestamp.now();
  // First entry into grace stamps the window; a repeated `pending` does not extend it.
  if (isGrace && !stored?.graceUntil) {
    patch.graceUntil = Timestamp.fromMillis(now.getTime() + GRACE_DAYS * 86_400_000);
  }
  // Leaving grace (a charge succeeded) clears it.
  if (!isGrace && !ENDED_STATUSES.has(sub.status)) patch.graceUntil = null;

  const notedPlan = sub.notes?.plan;
  const plan: PlanKey = stored?.plan ?? (isPlanKey(notedPlan) ? notedPlan : "monthly");
  await subscriptions()
    .doc(userId)
    .set(
      {
        plan,
        razorpaySubscriptionId: sub.id,
        createdAt: stored?.createdAt ? Timestamp.fromDate(stored.createdAt) : Timestamp.now(),
        ...patch,
      },
      { merge: true }
    );

  // THE tier write. One place answers "paying Leader?", and it is tiers/{uid}.
  const fresh = await getSubscription(userId);
  const paid = isPaidLeader(fresh, now);
  await tiers()
    .doc(userId)
    .set(
      paid
        ? { tier: "leader", source: "paid", trialEndsKey: null, updatedAt: Timestamp.now() }
        : // Downgrade: DERIVED. The tier doc says starter; nothing else changes anywhere.
          { tier: "starter", source: "paid", trialEndsKey: null, updatedAt: Timestamp.now() },
      { merge: true }
    );

  return { applied: true, reason: paid ? "leader" : "starter" };
}

/**
 * The coach cancelled. Marks it locally the instant they tap so the UI is honest even
 * before Razorpay's webhook confirms; the webhook then agrees. Cancel is at cycle end —
 * they keep what they paid for — so this does NOT touch the tier.
 */
export async function markCancelled(userId: string): Promise<void> {
  await subscriptions()
    .doc(userId)
    .set({ cancelledAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
}

/** For the plans / settings screens: the coach's own view of their money state. */
export type PaymentState = {
  hasSubscription: boolean;
  plan: PlanKey | null;
  status: string | null;
  paidLeader: boolean;
  cancelled: boolean;
  /** IST day key of when access ends. Null when not applicable. */
  accessEndsKey: string | null;
  inGrace: boolean;
};

export async function getPaymentState(userId: string, now = new Date()): Promise<PaymentState> {
  const rec = await getSubscription(userId);
  if (!rec) {
    return {
      hasSubscription: false,
      plan: null,
      status: null,
      paidLeader: false,
      cancelled: false,
      accessEndsKey: null,
      inGrace: false,
    };
  }
  return {
    hasSubscription: true,
    plan: rec.plan,
    status: rec.status,
    paidLeader: isPaidLeader(rec, now),
    cancelled: rec.cancelledAt !== null,
    accessEndsKey: rec.currentEndAt ? todayKey("Asia/Kolkata", rec.currentEndAt) : null,
    inGrace: rec.graceUntil !== null && now < rec.graceUntil,
  };
}
