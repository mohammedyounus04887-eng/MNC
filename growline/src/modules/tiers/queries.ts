import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { shiftKey, todayKey } from "@/lib/daily-log";
import { getUserById, type AppUser } from "@/lib/users";
import {
  LEADER_TRIAL_DAYS,
  TIERS_ENFORCED,
  canUseLeaderTool,
  effectiveTier,
  isQualifiedForLeaderTrial,
  isTier,
  shouldOfferLeaderTrial,
  trialDaysLeft,
  type LeaderTool,
  type Tier,
  type TierRecord,
} from "./model";

/**
 * Server side of tiers (v2 §8).
 *
 * ## One document per coach, absent means Starter
 *
 *   tiers/{userId}   tier, source, trialEndsKey, offerSeenKey
 *
 * Absence being a valid state is the point: Starter is free forever and needs no row,
 * so the collection only ever holds the coaches who moved — trials, grants, and later
 * paid Leaders. Every read of a missing doc is a coach on Starter, not an error.
 *
 * ## No Security Rules block, deliberately
 *
 * Same shape as `portfolios` (see that file's note): every read goes through the admin
 * SDK in a server component or API route, no browser queries this collection, so the
 * default catch-all deny in firestore.rules is both the safest rule and the correct
 * one. A tier a client could write itself would be a price a client sets itself.
 */

export const TIERS_COLLECTION = "tiers";
export const tiers = () => db.collection(TIERS_COLLECTION);

function toRecord(snap: DocumentSnapshot): TierRecord | null {
  const d = snap.data();
  if (!d) return null;
  return {
    tier: isTier(d.tier) ? d.tier : "starter",
    source:
      d.source === "paid" || d.source === "granted"
        ? (d.source as "paid" | "granted")
        : "trial",
    trialEndsKey: typeof d.trialEndsKey === "string" ? d.trialEndsKey : null,
    offerSeenKey: typeof d.offerSeenKey === "string" ? d.offerSeenKey : null,
  };
}

export async function getTierRecord(userId: string): Promise<TierRecord | null> {
  return toRecord(await tiers().doc(userId).get());
}

export type TierState = {
  tier: Tier;
  /** Qualified by the 2nd direct downline — derived, never stored (see model.ts). */
  qualified: boolean;
  /** Show the one-time celebration card on Home. */
  showOffer: boolean;
  trialDaysLeft: number;
};

/**
 * Everything a screen needs about a coach's tier, in one read.
 *
 * Takes the already-loaded user rather than a userId — every caller has it from the
 * session, and taking the id would mean paying a second `users` read on the home page
 * for a fact the caller is holding.
 */
export async function getTierState(user: AppUser, today = todayKey()): Promise<TierState> {
  const record = await getTierRecord(user.id);
  return {
    tier: effectiveTier(record, today),
    qualified: isQualifiedForLeaderTrial(user.directDownlineCount),
    showOffer: shouldOfferLeaderTrial(user.directDownlineCount, record),
    trialDaysLeft: trialDaysLeft(record, today),
  };
}

/**
 * The coach saw the celebration card and closed it. It never shows again.
 *
 * `merge: true` because the card can appear for a coach with no tier document at all —
 * which is most coaches — and the acknowledgement must not invent a tier for them.
 */
export async function markOfferSeen(userId: string, today = todayKey()): Promise<void> {
  await tiers()
    .doc(userId)
    .set({ offerSeenKey: today, updatedAt: Timestamp.now() }, { merge: true });
}

export type TrialResult = { ok: true; record: TierRecord } | { ok: false; error: string };

/**
 * Starts the 30-day Leader trial (v2 §8's trigger, accepted).
 *
 * Qualification is re-derived from the user document on the server — a client that
 * says "start my trial" without two direct downlines gets a refusal, whatever its UI
 * showed. Idempotent for a coach already on a live trial: a double tap on a slow
 * connection is acceptance, not a second trial, and it must not move the end date.
 *
 * Not exposed over HTTP while `TIERS_ENFORCED` is false: starting a clock on a trial
 * whose tools are already free for everyone would burn a coach's 30 days on nothing.
 * The API route refuses it and says why; this function exists, tested, for the flip.
 */
export async function startLeaderTrial(
  userId: string,
  today = todayKey()
): Promise<TrialResult> {
  const user = await getUserById(userId);
  if (!user) return { ok: false, error: "Not found" };
  if (!isQualifiedForLeaderTrial(user.directDownlineCount)) {
    return {
      ok: false,
      error: "The Leader trial unlocks when your 2nd coach joins your line.",
    };
  }

  const existing = await getTierRecord(userId);
  if (existing && effectiveTier(existing, today) !== "starter") {
    return { ok: true, record: existing };
  }

  const record: TierRecord = {
    tier: "leader",
    source: "trial",
    // Inclusive last day: starting today, day 30 is the final live day.
    trialEndsKey: shiftKey(today, LEADER_TRIAL_DAYS - 1),
    offerSeenKey: existing?.offerSeenKey ?? today,
  };
  await tiers()
    .doc(userId)
    .set({ ...record, startedKey: today, updatedAt: Timestamp.now() }, { merge: true });
  return { ok: true, record };
}

/**
 * The gate the Leader routes stand behind (targets, threads, proofs).
 *
 * While `TIERS_ENFORCED` is false this returns "allowed" BEFORE any read — the whole
 * point of wiring the gates early is that they cost nothing until the flip: no extra
 * Firestore read per target set, no behaviour change, just the plumbing standing where
 * launch pressure will not have to find it.
 */
export async function gateLeaderTool(
  user: AppUser | string,
  tool: LeaderTool
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  // The short-circuit comes first so that today — gates standing, enforcement off —
  // this costs NOTHING: no user read, no tier read, no behaviour change. Accepting a
  // bare uid exists for the routes that never load the full user; it is only resolved
  // on the enforced path.
  if (!TIERS_ENFORCED) return { allowed: true };
  const userId = typeof user === "string" ? user : user.id;
  const record = await getTierRecord(userId);
  return canUseLeaderTool(effectiveTier(record, todayKey()), tool);
}

/**
 * Admin funnel numbers: how many coaches sit at each step toward paying.
 *
 * The three Leader counts are split by SOURCE and not lumped, because the question the
 * funnel screen answers is "how many people pay us". This used to count everything that
 * was not a trial as paying, which is right only for as long as `granted` is unused —
 * and `granted` is the promo-code source (v2 §8), whose entire purpose is a Leader who
 * is deliberately NOT paying. Folding the two together would overstate revenue on the
 * one screen an owner would use to decide whether this business works.
 */
export async function tierFunnel(): Promise<{
  qualified: number;
  onTrial: number;
  /** Leaders whose tier came from a Razorpay subscription. Revenue. */
  paid: number;
  /** Leaders on a promo code — a longer free run, not a sale. */
  granted: number;
}> {
  const today = todayKey();
  const [qualifiedSnap, tierSnap] = await Promise.all([
    db
      .collection("users")
      .where("directDownlineCount", ">=", 2)
      .count()
      .get(),
    tiers().get(),
  ]);
  let onTrial = 0;
  let paid = 0;
  let granted = 0;
  for (const doc of tierSnap.docs) {
    const record = toRecord(doc);
    if (effectiveTier(record, today) !== "leader") continue;
    if (record?.source === "trial") onTrial++;
    else if (record?.source === "granted") granted++;
    else paid++;
  }
  return { qualified: qualifiedSnap.data().count, onTrial, paid, granted };
}
