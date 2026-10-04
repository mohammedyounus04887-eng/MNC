/**
 * Tiers (v2 §8) — Starter / Leader / Elite, built with every gate OPEN.
 *
 * ## The standing instruction this file is built under
 *
 * The owner's direction (2026-08-14): **"start tiers now, don't gate anything yet."**
 * So the tier system exists — the model, the qualification trigger, the trial machinery,
 * the pricing screen, the capability checks wired into the Leader routes — and
 * `TIERS_ENFORCED` below is `false`, which makes every one of those checks answer
 * "allowed". Nothing a coach can do today is taken away by this module shipping.
 *
 * That flag is the single flip. When payments exist and the owner says go, enforcement
 * is one constant — the gates are already standing in the routes, already tested for
 * both positions, and nothing else has to be found or wired under launch pressure.
 *
 * ## Why the v1 trial remnants die in the same change
 *
 * v2 §8 opens with: the v1 model (60-day trial + mandate at signup) "is CANCELLED.
 * Delete any remnants." The home screen and Settings still showed a ticking 60-day
 * countdown against which NOTHING happens on day 61 — no charge, no lock, nothing. A
 * countdown to nothing trains users that the app's numbers are decorative, which is
 * fatal for a product whose whole pitch is that its numbers can be trusted. Starter is
 * free forever and the UI now says exactly that.
 *
 * PURE ONLY — no database import (RULES E2; the pricing screen and offer card are
 * client-adjacent).
 */

export const TIERS = ["starter", "leader", "elite"] as const;
export type Tier = (typeof TIERS)[number];

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/**
 * THE FLIP. While false, `canUseLeaderTool` allows everything for everyone, the pricing
 * screen says so honestly, and no route behaves differently by tier.
 *
 * Flipping this to true is an OWNER decision, not an engineering one, and it has
 * prerequisites the constant cannot check: Razorpay keys in the environment, the paid
 * conversion flow live, and the launch-open promise on the pricing screen updated the
 * same day. The unit suite pins both positions, so the flip itself cannot rot.
 */
export const TIERS_ENFORCED = false;

/**
 * What Leader gates, when it gates (v2 §8's list, minus what cannot exist yet).
 *
 * "team-analytics" and "pro-portfolio" are listed for the pricing screen but have no
 * route to stand a gate in until those features ship — their gates arrive with them.
 */
export const LEADER_TOOLS = [
  "set-targets",
  "send-threads",
  "review-proofs",
] as const;
export type LeaderTool = (typeof LEADER_TOOLS)[number];

/**
 * The one capability question the routes ask.
 *
 * The `reason` is user-facing copy for the day the gate closes: calm, factual, no
 * exclamation mark — a denied action is a Trust Zone moment (RULES G1), and it names
 * what still works so a downgrade never reads as "your data is gone" (v2 §8: never lock
 * a user out of their own business).
 */
export function canUseLeaderTool(
  tier: Tier,
  tool: LeaderTool
): { allowed: true } | { allowed: false; reason: string } {
  if (!TIERS_ENFORCED) return { allowed: true };
  if (tier === "leader" || tier === "elite") return { allowed: true };
  return {
    allowed: false,
    reason: `${TOOL_LABEL[tool]} is a Leader tool. Your prospects, reports, daily log and team view all keep working on Starter — see Plans in Settings.`,
  };
}

/** Plain words for the refusal (RULES S6): what the coach was trying to do, named. */
const TOOL_LABEL: Record<LeaderTool, string> = {
  "set-targets": "Setting a target",
  "send-threads": "Sending a message to your line",
  "review-proofs": "Checking proof",
};

/**
 * Qualification: the 2nd direct downline (v2 §8's trigger).
 *
 * Counted from `directDownlineCount`, which the signup transaction maintains — so
 * qualification is DERIVED, never stored as its own flag that could drift. A coach who
 * already had two downlines the day this ships is qualified the moment they next open
 * the app, which is exactly what the lazy check is for.
 */
export const QUALIFYING_DOWNLINES = 2;

export function isQualifiedForLeaderTrial(directDownlineCount: number): boolean {
  return directDownlineCount >= QUALIFYING_DOWNLINES;
}

/** 30 days (v2 §8). Day-key arithmetic only — never a Date subtraction (RULES E1). */
export const LEADER_TRIAL_DAYS = 30;

/**
 * A coach's tier record as stored (absent = Starter, which is why absent is safe).
 * Day KEYS, not timestamps: a trial that ends "today" ends at the coach's IST midnight,
 * not 5½ hours into their evening.
 */
export type TierRecord = {
  tier: Tier;
  /**
   * How they got it. "trial" is the 30 days earned at the 2nd downline, "granted" is a
   * promo code (Phase 9b), "paid" is a Razorpay subscription and ends by cancellation.
   * The admin funnel counts all three apart so a club launch is never read as revenue.
   */
  source: "trial" | "paid" | "granted";
  /**
   * Last day (inclusive) this tier is live, or null for a tier that does not end on a
   * date. Trials and promo grants carry one; "paid" is always null, because a
   * subscription ends by cancellation and its own period end, not by a day key.
   */
  trialEndsKey: string | null;
  /** The celebration card was shown and acknowledged — never show it twice. */
  offerSeenKey: string | null;
};

/**
 * The tier that is actually in effect today.
 *
 * Expiry is computed at read time rather than by a scheduled job: day keys compare
 * lexicographically, there is no write to miss, and a coach whose trial lapsed at
 * midnight is Starter at 00:01 without any function having run. Downgrade means
 * DERIVED downgrade — nothing is deleted, which is the §8 promise.
 */
export function effectiveTier(record: TierRecord | null, todayKey: string): Tier {
  if (!record) return "starter";
  /*
   * Expiry keys on the DATE, not on the source.
   *
   * This used to read `if (record.source === "trial")`, which was correct while only
   * trials carried a date. Promo grants (Phase 9b) carry one too, and under the old
   * test a granted record with an end date never expired — a code handed out at one
   * club launch would have been permanent free Leader for everyone who typed it.
   *
   * Keying on the date is also the safer default for whatever source comes next: a new
   * source that forgets to be listed here expires on its date rather than lasting
   * forever. "paid" is unaffected because it always stores null (see applySubscription).
   */
  if (record.trialEndsKey !== null && todayKey > record.trialEndsKey) return "starter";
  // A source that is supposed to end on a date but has none is not a Leader. Trials are
  // the case that matters: a half-written trial record must not grant an endless one.
  if (record.source === "trial" && record.trialEndsKey === null) return "starter";
  return record.tier;
}

/**
 * Days of dated Leader remaining, inclusive of today. 0 when lapsed, or when the tier
 * does not end on a date.
 *
 * Counts promo grants as well as trials: a coach given 90 days should be able to see how
 * many are left, and the alternative — a countdown that works for earned days and reads
 * zero for given ones — would be the app appearing to have forgotten a present.
 */
export function trialDaysLeft(record: TierRecord | null, todayKey: string): number {
  if (!record || record.source === "paid" || !record.trialEndsKey) return 0;
  if (todayKey > record.trialEndsKey) return 0;
  const [y1, m1, d1] = todayKey.split("-").map(Number);
  const [y2, m2, d2] = record.trialEndsKey.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Whether to show the celebration card on the home screen.
 *
 * Only for a qualified coach who has never seen it and holds no tier yet. Once
 * acknowledged it never returns — a recognition moment repeated is nagging, and v2 §4
 * bans decoration without behaviour.
 */
export function shouldOfferLeaderTrial(
  directDownlineCount: number,
  record: TierRecord | null
): boolean {
  if (!isQualifiedForLeaderTrial(directDownlineCount)) return false;
  if (record?.offerSeenKey) return false;
  if (record && record.tier !== "starter") return false;
  return true;
}

/**
 * The pricing screen's content (v2 §8), in one place so the screen stays copy-free.
 *
 * These are prices the COACH pays — RULES L4 bans rupees near *earnings*, not near a
 * price tag; a Trust Zone screen that hid its own price would be the dark pattern. The
 * UI favours annual ("2 months free") as §8 asks. Elite is visible and not functional,
 * exactly as specified — visible so the ladder reads as a ladder, not functional
 * because selling a tier with no features would be a G2 violation in spirit.
 */
export const TIER_INFO: Record<
  Tier,
  {
    name: string;
    priceLine: string;
    subLine: string | null;
    features: string[];
    available: boolean;
  }
> = {
  starter: {
    name: "Starter",
    priceLine: "Free forever",
    subLine: null,
    features: [
      "Capture people, unlimited",
      "Wellness reports on WhatsApp",
      "Daily log and streaks",
      "Your team view",
      "Your public page",
    ],
    available: true,
  },
  leader: {
    name: "Leader",
    priceLine: "₹9,999/year",
    subLine: "2 months free — or ₹999/month",
    features: [
      "Everything in Starter",
      "Set targets with your line",
      "Send messages to your line",
      "Check and approve proof",
      "Pro page, no watermark",
    ],
    available: true,
  },
  elite: {
    name: "Elite",
    priceLine: "₹2,499/month",
    subLine: "Coming soon",
    features: ["Everything in Leader", "More, as it is built"],
    available: false,
  },
};
