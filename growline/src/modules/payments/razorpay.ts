import { createHmac, timingSafeEqual } from "node:crypto";
import { INDIVIDUAL_COACH_PAYMENTS_ENABLED } from "./model";

/**
 * The thin Razorpay client — three REST calls and one signature check.
 *
 * ## Why not the SDK
 *
 * Razorpay's surface for subscriptions is small and its webhook signature is a plain
 * HMAC-SHA256 over the raw body. Adding a package for a `fetch` wrapper would give the
 * unit suite something to mock and give production a dependency whose upgrades this
 * team has to track. `fetch` and `node:crypto` are already here.
 *
 * ## What is and is not in the environment
 *
 *   RAZORPAY_KEY_ID          public — safe in the browser, it identifies the merchant
 *   RAZORPAY_KEY_SECRET      SERVER ONLY. Never in NEXT_PUBLIC_*, never logged.
 *   RAZORPAY_WEBHOOK_SECRET  SERVER ONLY. Set when you register the webhook URL.
 *   RAZORPAY_PLAN_MONTHLY    plan_xxx — created once in the dashboard at ₹999/month
 *   RAZORPAY_PLAN_ANNUAL     plan_xxx — created once in the dashboard at ₹9,999/year
 *
 * `isConfigured()` is the single switch every route checks. With any of these unset the
 * money paths refuse cleanly and say so, rather than throwing halfway through creating a
 * subscription somebody will then be charged for.
 */

const API = "https://api.razorpay.com/v1";

export function isConfigured(): boolean {
  return Boolean(
    INDIVIDUAL_COACH_PAYMENTS_ENABLED &&
    process.env.RAZORPAY_KEY_ID &&
      process.env.RAZORPAY_KEY_SECRET &&
      process.env.RAZORPAY_WEBHOOK_SECRET &&
      process.env.RAZORPAY_PLAN_MONTHLY &&
      process.env.RAZORPAY_PLAN_ANNUAL
  );
}

export function keyId(): string {
  return process.env.RAZORPAY_KEY_ID ?? "";
}

export function planId(plan: "monthly" | "annual"): string {
  return (plan === "monthly" ? process.env.RAZORPAY_PLAN_MONTHLY : process.env.RAZORPAY_PLAN_ANNUAL) ?? "";
}

function authHeader(): string {
  const token = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString("base64");
  return `Basic ${token}`;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (!isConfigured()) throw new Error("INDIVIDUAL_COACH_PAYMENTS_DISABLED");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // Razorpay's error body names the field. Surface the description, never the key.
    const detail = (await res.json().catch(() => ({}))) as {
      error?: { description?: string; code?: string };
    };
    throw new Error(
      `Razorpay ${method} ${path} → ${res.status}: ${detail.error?.description ?? detail.error?.code ?? "unknown"}`
    );
  }
  return (await res.json()) as T;
}

export type RzpSubscription = {
  id: string;
  plan_id: string;
  customer_id?: string | null;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  ended_at?: number | null;
  short_url?: string;
  notes?: Record<string, string>;
};

/**
 * Creates the subscription. Razorpay returns it in `created`; the mandate is
 * authenticated by the coach in Razorpay's own checkout, which is why NOTHING here ever
 * sees a UPI id or a card (RULES L7).
 *
 * `notes.userId` is how the webhook maps an event back to a coach without a lookup
 * table we would then have to keep consistent. Razorpay echoes notes on every event.
 */
export async function createSubscription(params: {
  plan: "monthly" | "annual";
  userId: string;
}): Promise<RzpSubscription> {
  return call<RzpSubscription>("POST", "/subscriptions", {
    plan_id: planId(params.plan),
    // 120 charges = 10 years monthly / 120 years annual; Razorpay requires a cap.
    total_count: 120,
    customer_notify: 1,
    notes: { userId: params.userId, plan: params.plan },
  });
}

/**
 * Cancels at cycle end: the coach keeps what they have paid for. v2 §8's cancel is two
 * taps and stops the NEXT charge; it does not claw back the current period.
 */
export async function cancelSubscription(subscriptionId: string): Promise<RzpSubscription> {
  return call<RzpSubscription>("POST", `/subscriptions/${subscriptionId}/cancel`, {
    cancel_at_cycle_end: 1,
  });
}

export async function fetchSubscription(subscriptionId: string): Promise<RzpSubscription> {
  return call<RzpSubscription>("GET", `/subscriptions/${subscriptionId}`);
}

/**
 * Verifies a webhook came from Razorpay.
 *
 * HMAC-SHA256 of the RAW request body with the webhook secret, compared in constant time.
 * The body must be the exact bytes received — parse it AFTER this, never before, because
 * `JSON.parse` + `JSON.stringify` does not round-trip byte-for-byte.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verifies the checkout-success callback (payment_id|subscription_id signed with the key
 * secret). This is what the client posts after Razorpay's checkout closes; the webhook is
 * the source of truth, but this lets the UI say "done" without waiting for it.
 */
export function verifyCheckoutSignature(params: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret)
    .update(`${params.paymentId}|${params.subscriptionId}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(params.signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
