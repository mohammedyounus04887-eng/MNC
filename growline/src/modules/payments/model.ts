/**
 * Payments (v2 §8, Phase 9b) — Razorpay Subscriptions for the Leader tier.
 *
 * ## What this module is, and what it refuses to be
 *
 * It turns a Razorpay subscription's lifecycle into ONE fact the rest of the app reads:
 * whether a coach is a paying Leader today. Everything else — card numbers, UPI handles,
 * bank details, the mandate itself — lives with Razorpay and never touches this codebase.
 * RULES L7 is not a guideline here; it is the shape of the data model. There is no field
 * in which a credential could be stored.
 *
 * ## The two things this must get right, and why they are hard
 *
 * **Idempotency.** Razorpay retries webhooks, sometimes for days, and delivers them out
 * of order. Every event carries a stable id, and processing is keyed on it: the same
 * event twice is one state change, and an `activated` arriving after a `cancelled` does
 * not resurrect a subscription somebody ended.
 *
 * **Never lock a user out of their business.** v2 §8: on cancel or failure, team features
 * freeze and everything individual continues. That is already how tiers work — the tier
 * is DERIVED from this record at read time (`effectiveTier`), so downgrade means the
 * derivation changes and not one document is deleted.
 *
 * ## The Trust Zone (RULES G1)
 *
 * Every screen this feeds is a money screen: flat, calm, no glow, no celebration, plain
 * language. The copy constants at the bottom of this file are the entire vocabulary those
 * screens may use for money, and the unit suite sweeps them.
 *
 * PURE ONLY — no database, no Razorpay SDK, no crypto (RULES E2; the checkout button and
 * the cancel flow are client components).
 */

/** Approved combined-product model: individual coaches are free. No env toggle enables charging. */
export const INDIVIDUAL_COACH_PAYMENTS_ENABLED = false;

/** Retained historical provider configuration; not offered to individual coaches. */
export const PLANS = {
  monthly: { key: "monthly", label: "Monthly", amountPaise: 99_900, period: "monthly", interval: 1 },
  annual: { key: "annual", label: "Annual", amountPaise: 999_900, period: "yearly", interval: 1 },
} as const;
export type PlanKey = keyof typeof PLANS;

export function isPlanKey(v: unknown): v is PlanKey {
  return v === "monthly" || v === "annual";
}

/** ₹ for display only — never for arithmetic the app then acts on. */
export function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * The Razorpay subscription statuses we act on. Anything else is recorded verbatim and
 * treated as "not active" — an unknown status must never grant access.
 * https://razorpay.com/docs/payments/subscriptions/states/
 */
export const ACTIVE_STATUSES = new Set(["active", "authenticated"]);
export const ENDED_STATUSES = new Set(["cancelled", "completed", "expired"]);
export const GRACE_STATUSES = new Set(["pending", "halted"]);

export type SubscriptionRecord = {
  userId: string;
  plan: PlanKey;
  razorpaySubscriptionId: string;
  razorpayCustomerId: string | null;
  /** Razorpay's own status string, stored verbatim so support can read what they see. */
  status: string;
  /**
   * When the current paid period ends. From Razorpay's `current_end` (unix seconds).
   * A coach is Leader through this instant even if the subscription is cancelled —
   * cancelling stops the NEXT charge, it does not claw back the one already paid.
   */
  currentEndAt: Date | null;
  /** The coach pressed cancel. Recorded separately from Razorpay's status because
   *  Razorpay keeps `active` until period end when cancel_at_cycle_end is set. */
  cancelledAt: Date | null;
  /** Failed-charge grace: 5 days from the first failure (v1 F10), then read-only. */
  graceUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * THE question: does this record make the coach a paying Leader at `now`?
 *
 * Deliberately conservative — every branch that is unsure answers false. A false
 * negative costs a coach a Leader tool until the next webhook lands; a false positive
 * gives away a paid tier. Those are not symmetric.
 */
export function isPaidLeader(rec: SubscriptionRecord | null, now: Date): boolean {
  if (!rec) return false;

  // Ended is ended — but a cancelled subscription is still paid-up until period end,
  // because cancelling stops the next charge, not the current one.
  if (ENDED_STATUSES.has(rec.status) || rec.cancelledAt) {
    return rec.currentEndAt !== null && now < rec.currentEndAt;
  }

  // A charge failed. Keep them on until the grace window closes (v1 F10: 5 days),
  // then read-only — never a hard lock, and never a deletion.
  if (GRACE_STATUSES.has(rec.status)) {
    return rec.graceUntil !== null && now < rec.graceUntil;
  }

  if (ACTIVE_STATUSES.has(rec.status)) {
    // `active` with a period end in the past means a webhook is late. Trust the date
    // over the word: the coach paid through then, and not past it.
    return rec.currentEndAt === null || now < rec.currentEndAt;
  }

  // "created", "authenticated"-but-unknown, anything new Razorpay invents: no.
  return false;
}

/** v1 F10: five days of grace after a failed charge before read-only. */
export const GRACE_DAYS = 5;

/**
 * Whether an incoming webhook event should be applied over the stored record.
 *
 * Razorpay delivers out of order and retries for days. Two guards:
 *   1. an event id already seen is a no-op (idempotency — the caller checks the store);
 *   2. a lifecycle event must not move the record BACKWARDS: once ended, an old
 *      `activated` that arrives late does not resurrect it.
 */
export function shouldApply(
  stored: Pick<SubscriptionRecord, "status"> | null,
  incomingStatus: string
): boolean {
  if (!stored) return true;
  if (ENDED_STATUSES.has(stored.status) && !ENDED_STATUSES.has(incomingStatus)) return false;
  return true;
}

/**
 * The webhook events we subscribe to, and what each means for the record.
 * https://razorpay.com/docs/webhooks/payloads/subscriptions/
 */
export const HANDLED_EVENTS = new Set([
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.completed",
  "subscription.paused",
  "subscription.resumed",
]);

/**
 * Trust-Zone copy. Calm, factual, no exclamation marks, and it says what happens to
 * the coach's data every time money is mentioned (v2 §8: never lock a user out).
 */
export const PAY_COPY = {
  mandateExplainer:
    "You set up a UPI autopay mandate once. Razorpay charges it on the plan date and you get a notification before every charge. Growline never sees or stores your UPI or bank details.",
  cancelExplainer:
    "Cancelling stops the next charge. You keep Leader until the end of what you have already paid for, then move to Starter. Nothing is deleted — your people, reports, log and team stay exactly as they are.",
  graceExplainer:
    "A charge did not go through. You have five days to fix it before Leader tools pause. Your data is not affected either way.",
  readOnlyExplainer:
    "Leader tools are paused because the last charge did not go through. Everything else works, and nothing has been deleted. Update your payment to switch them back on.",
} as const;

/**
 * What a coach who has cancelled reads. Takes the end date because the sentence is
 * useless without it — "you keep Leader for a while" is the vagueness a Trust Zone
 * screen exists to avoid.
 *
 * A function rather than a constant, and here rather than in either screen, because
 * /plans and Settings both say this. Two copies of a money sentence drift, and the
 * version that drifts is the one somebody reads on the day they are charged.
 *
 * `accessEndsKey` is an IST day key from `getPaymentState`, or null when Razorpay has
 * not told us the period end yet. Never computed here — RULES E1 keeps day boundaries
 * in day.ts, and this file must stay pure enough for a "use client" import (E2).
 */
export function cancelledExplainer(accessEndsKey: string | null): string {
  const until = accessEndsKey ?? "the end of this period";
  return `Cancelled. Leader stays on until ${until}, then you move to Starter. Nothing is deleted.`;
}
