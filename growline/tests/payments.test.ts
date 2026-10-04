import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import {
  ACTIVE_STATUSES,
  ENDED_STATUSES,
  GRACE_DAYS,
  GRACE_STATUSES,
  HANDLED_EVENTS,
  PAY_COPY,
  PLANS,
  cancelledExplainer,
  isPaidLeader,
  isPlanKey,
  rupees,
  shouldApply,
  type SubscriptionRecord,
} from "@/modules/payments/model";
import {
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "@/modules/payments/razorpay";

/**
 * Payments (Phase 9b). The state machine here decides who is a paying Leader, and being
 * wrong in one direction gives away a paid tier while being wrong in the other locks a
 * paying coach out. Both are tested at the boundary.
 */

const DAY = 86_400_000;
const NOW = new Date("2026-08-14T12:00:00Z");
const later = (d: number) => new Date(NOW.getTime() + d * DAY);
const earlier = (d: number) => new Date(NOW.getTime() - d * DAY);

const base: SubscriptionRecord = {
  userId: "u1",
  plan: "monthly",
  razorpaySubscriptionId: "sub_1",
  razorpayCustomerId: null,
  status: "active",
  currentEndAt: later(20),
  cancelledAt: null,
  graceUntil: null,
  createdAt: earlier(10),
  updatedAt: NOW,
};

describe("who is a paying Leader", () => {
  test("no record is not a Leader", () => {
    assert.equal(isPaidLeader(null, NOW), false);
  });

  test("active and inside the period is a Leader", () => {
    assert.equal(isPaidLeader(base, NOW), true);
  });

  test("active but the period end has passed is NOT — trust the date over the word", () => {
    // A late webhook leaves `active` on a subscription that lapsed. The coach paid
    // through currentEndAt and not past it.
    assert.equal(isPaidLeader({ ...base, currentEndAt: earlier(1) }, NOW), false);
  });

  test("MANDATORY: cancelled keeps Leader through the paid period, then stops", () => {
    // Cancel is at cycle end. Clawing back a paid month would be a dark pattern in
    // reverse, and v2 §8 says never lock a user out of what they have.
    const cancelled = { ...base, cancelledAt: earlier(2), status: "cancelled" };
    assert.equal(isPaidLeader(cancelled, NOW), true, "still inside the paid period");
    assert.equal(isPaidLeader(cancelled, later(21)), false, "period ended");
  });

  test("a failed charge gives five days of grace, then read-only", () => {
    const halted = { ...base, status: "halted", graceUntil: later(GRACE_DAYS) };
    assert.equal(GRACE_DAYS, 5);
    assert.equal(isPaidLeader(halted, NOW), true);
    assert.equal(isPaidLeader(halted, later(GRACE_DAYS)), false);
    // Grace with no window stamped is not Leader — fail closed.
    assert.equal(isPaidLeader({ ...base, status: "halted", graceUntil: null }, NOW), false);
  });

  test("MANDATORY: an unknown or new status never grants access", () => {
    for (const s of ["created", "something-razorpay-adds-later", "", "ACTIVE"]) {
      assert.equal(isPaidLeader({ ...base, status: s }, NOW), false, s);
    }
  });

  test("the status sets do not overlap", () => {
    for (const s of ACTIVE_STATUSES) {
      assert.ok(!ENDED_STATUSES.has(s) && !GRACE_STATUSES.has(s), s);
    }
    for (const s of GRACE_STATUSES) assert.ok(!ENDED_STATUSES.has(s), s);
  });
});

describe("out-of-order and duplicate webhooks", () => {
  test("a fresh record applies anything", () => {
    assert.equal(shouldApply(null, "activated"), true);
  });

  test("MANDATORY: an ended subscription is never resurrected by a late activated", () => {
    // Razorpay retries for days and delivers out of order. Once cancelled, an old
    // `activated` arriving late must not turn the mandate back on.
    assert.equal(shouldApply({ status: "cancelled" }, "active"), false);
    assert.equal(shouldApply({ status: "completed" }, "authenticated"), false);
  });

  test("ended → ended is fine (cancelled then completed)", () => {
    assert.equal(shouldApply({ status: "cancelled" }, "completed"), true);
  });

  test("active → anything applies", () => {
    for (const next of ["halted", "pending", "cancelled", "charged", "active"]) {
      assert.equal(shouldApply({ status: "active" }, next), true, next);
    }
  });

  test("the handled event list covers the whole lifecycle", () => {
    for (const e of ["subscription.activated", "subscription.charged", "subscription.halted", "subscription.cancelled", "subscription.completed"]) {
      assert.ok(HANDLED_EVENTS.has(e), e);
    }
    // payment.* events are NOT ours — they arrive too, and must be ignored not errored.
    assert.equal(HANDLED_EVENTS.has("payment.captured"), false);
  });
});

describe("signatures — the only thing standing between the internet and a free tier", () => {
  test("a webhook signed with the secret verifies; anything else does not", () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test";
    const body = JSON.stringify({ event: "subscription.activated", payload: {} });
    const good = createHmac("sha256", "whsec_test").update(body).digest("hex");
    assert.equal(verifyWebhookSignature(body, good), true);
    assert.equal(verifyWebhookSignature(body, good.replace(/^./, "0")), false, "one char off");
    assert.equal(verifyWebhookSignature(body + " ", good), false, "body altered");
    assert.equal(verifyWebhookSignature(body, null), false, "no signature");
    assert.equal(verifyWebhookSignature(body, ""), false, "empty signature");
  });

  test("MANDATORY: no webhook secret configured means NOTHING verifies", () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const body = "{}";
    const anySig = createHmac("sha256", "").update(body).digest("hex");
    assert.equal(verifyWebhookSignature(body, anySig), false);
  });

  test("the checkout callback signature is payment|subscription with the key secret", () => {
    process.env.RAZORPAY_KEY_SECRET = "ksec_test";
    const sig = createHmac("sha256", "ksec_test").update("pay_1|sub_1").digest("hex");
    assert.equal(verifyCheckoutSignature({ paymentId: "pay_1", subscriptionId: "sub_1", signature: sig }), true);
    assert.equal(verifyCheckoutSignature({ paymentId: "pay_1", subscriptionId: "sub_2", signature: sig }), false);
    delete process.env.RAZORPAY_KEY_SECRET;
    assert.equal(verifyCheckoutSignature({ paymentId: "pay_1", subscriptionId: "sub_1", signature: sig }), false);
  });
});

describe("plans and money display", () => {
  test("the two plans v2 §8 sells, in paise, annual = 2 months free", () => {
    assert.equal(PLANS.monthly.amountPaise, 99_900);
    assert.equal(PLANS.annual.amountPaise, 999_900);
    assert.equal(PLANS.annual.amountPaise, PLANS.monthly.amountPaise * 10 + 900);
    assert.equal(isPlanKey("annual"), true);
    assert.equal(isPlanKey("elite"), false);
  });

  test("rupees renders Indian grouping and no paise", () => {
    assert.equal(rupees(99_900), "₹999");
    assert.equal(rupees(999_900), "₹9,999");
  });
});

describe("Trust Zone copy (RULES G1) and RULES L7", () => {
  test("every money sentence says the data stays, and none celebrates", () => {
    for (const [k, v] of Object.entries(PAY_COPY)) {
      assert.doesNotMatch(v, /!/, `${k} has an exclamation mark`);
      assert.doesNotMatch(v, /🎉|🔥|congrat/i, `${k} celebrates on a money screen`);
    }
    assert.match(PAY_COPY.cancelExplainer, /nothing is deleted/i);
    assert.match(PAY_COPY.readOnlyExplainer, /nothing has been deleted/i);
    assert.match(PAY_COPY.mandateExplainer, /never sees or stores/i);
  });

  test("the cancelled sentence obeys the same rules as the constants", () => {
    // It is not a member of PAY_COPY (it takes a date), so the sweep above cannot see
    // it. /plans and Settings both render it, which is exactly why it is swept here:
    // an un-swept money sentence is the one that drifts.
    for (const v of [cancelledExplainer("2026-09-14"), cancelledExplainer(null)]) {
      assert.doesNotMatch(v, /!/);
      assert.doesNotMatch(v, /🎉|🔥|congrat/i);
      assert.match(v, /nothing is deleted/i);
      // v2 §8: the downgrade is to Starter, and the coach is told so, not left to guess.
      assert.match(v, /starter/i);
    }
  });

  test("the cancelled sentence names the date, and stays honest without one", () => {
    assert.match(cancelledExplainer("2026-09-14"), /until 2026-09-14/);
    // Razorpay has not sent current_end yet. Vague, but never invented — RULES E1 keeps
    // day arithmetic in day.ts and this must not guess a date it does not have.
    const noDate = cancelledExplainer(null);
    assert.match(noDate, /the end of this period/);
    assert.doesNotMatch(noDate, /\d{4}-\d{2}-\d{2}/);
  });

  test("MANDATORY: no field on the subscription record could hold a credential", () => {
    // RULES L7 as a type: there is nowhere to put a card, UPI id or bank detail.
    const keys: (keyof SubscriptionRecord)[] = Object.keys(base) as (keyof SubscriptionRecord)[];
    for (const k of keys) {
      assert.doesNotMatch(k, /card|upi|vpa|bank|account|ifsc|token|pan\b/i, k);
    }
  });

  test("the key secret and webhook secret are never NEXT_PUBLIC", () => {
    const rz = readFileSync("src/modules/payments/razorpay.ts", "utf8");
    assert.doesNotMatch(rz, /NEXT_PUBLIC_RAZORPAY_KEY_SECRET|NEXT_PUBLIC_RAZORPAY_WEBHOOK/);
    // And the client component never touches either.
    const ui = readFileSync("src/modules/payments/PaymentControls.tsx", "utf8");
    assert.doesNotMatch(ui, /KEY_SECRET|WEBHOOK_SECRET|process\.env/);
  });

  test("the webhook reads the RAW body before parsing", () => {
    const wh = readFileSync("src/app/api/payments/webhook/route.ts", "utf8");
    const t = wh.indexOf("req.text()");
    const v = wh.indexOf("verifyWebhookSignature(");
    const p = wh.indexOf("JSON.parse(");
    assert.ok(t > 0 && v > t && p > v, "must be text() → verify → parse, in that order");
  });

  test("the confirm route re-fetches from Razorpay rather than trusting the browser", () => {
    const c = readFileSync("src/app/api/payments/confirm/route.ts", "utf8");
    assert.match(c, /fetchSubscription\(/);
    assert.doesNotMatch(c, /status:\s*b\./, "must not read status from the request body");
  });

  test("cancel is at cycle end", () => {
    const rz = readFileSync("src/modules/payments/razorpay.ts", "utf8");
    assert.match(rz, /cancel_at_cycle_end: 1/);
  });
});
