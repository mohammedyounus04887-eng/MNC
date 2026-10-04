import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { todayKey } from "@/lib/daily-log";
import { getTierRecord, tiers } from "@/modules/tiers/queries";
import { effectiveTier } from "@/modules/tiers/model";
import {
  checkMint,
  checkRedeemable,
  extendedEndKey,
  normaliseCode,
  type MintInput,
  type PromoCode,
} from "./model";

/**
 * Server side of promo codes (v2 §8, Phase 9b).
 *
 * ## Collections
 *
 *   promoCodes/{CODE}                 the code IS the document id, so minting the same
 *                                     code twice is a failed create() rather than two
 *                                     codes with different terms and the same name.
 *   promoRedemptions/{CODE}__{uid}    one per coach per code. Its EXISTENCE is "already
 *                                     redeemed" — the same structural shape as claps
 *                                     and referral codes, for the same reason.
 *
 * ## Why the whole redemption is one transaction
 *
 * Three things have to move together or not at all: the redemption marker, the code's
 * use count, and the coach's tier. Two taps on a weak signal — which is the normal way
 * this feature is used, standing in a room at a club launch — would otherwise be able to
 * grant the days twice, or burn a use without granting anything.
 *
 * `txn.create()` on the redemption document is the guard that cannot race: if the marker
 * exists the transaction aborts, and a retry of the same tap aborts too. A read-then-
 * write on a `redeemed: true` field would have a window exactly as wide as the round
 * trip.
 *
 * ## No Security Rules block — same as tiers, portfolios, subscriptions
 *
 * Every read and write here is server-side through the admin SDK, so the default deny
 * stands. A client-readable `promoCodes` would let anyone enumerate live codes; a
 * client-writable one would let a coach mint their own free year.
 */

export const PROMO_CODES = "promoCodes";
export const PROMO_REDEMPTIONS = "promoRedemptions";
export const promoCodes = () => db.collection(PROMO_CODES);
export const promoRedemptions = () => db.collection(PROMO_REDEMPTIONS);

/** The redemption id. Two ids joined by a separator that cannot occur in either half. */
export const redemptionId = (code: string, userId: string) => `${code}__${userId}`;

function toPromo(snap: DocumentSnapshot): PromoCode | null {
  const d = snap.data();
  if (!d) return null;
  return {
    code: snap.id,
    leaderDays: Number(d.leaderDays ?? 0),
    lockedPlan: (d.lockedPlan as string | null) ?? null,
    maxUses: Number(d.maxUses ?? 0),
    uses: Number(d.uses ?? 0),
    expiresKey: String(d.expiresKey ?? ""),
    createdBy: String(d.createdBy ?? ""),
    note: (d.note as string | null) ?? null,
  };
}

export async function getPromoCode(code: string): Promise<PromoCode | null> {
  return toPromo(await promoCodes().doc(normaliseCode(code)).get());
}

/** Newest first, for the admin table. Small collection; a full scan is correct here. */
export async function listPromoCodes(limit = 100): Promise<PromoCode[]> {
  const snap = await promoCodes().orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map(toPromo).filter((p): p is PromoCode => p !== null);
}

export type MintResult = { ok: true; code: PromoCode } | { ok: false; error: string };

/**
 * Mints a code. Admin only — the caller checks, and this takes the actor's id so the
 * document records who created it.
 *
 * `create()` rather than `set()`: reusing a live code name with different terms would
 * mean two rooms of people holding the same string and being given different things.
 */
export async function mintPromoCode(
  input: Partial<MintInput>,
  actorId: string,
  today = todayKey()
): Promise<MintResult> {
  const checked = checkMint(input, today);
  if (!checked.ok) return { ok: false, error: checked.error };
  const v = checked.value;

  try {
    await promoCodes().doc(v.code).create({
      leaderDays: v.leaderDays,
      lockedPlan: v.lockedPlan,
      maxUses: v.maxUses,
      uses: 0,
      expiresKey: v.expiresKey,
      note: v.note,
      createdBy: actorId,
      createdAt: Timestamp.now(),
    });
  } catch (e) {
    if (/ALREADY_EXISTS|already exists/i.test((e as Error).message)) {
      return { ok: false, error: `${v.code} already exists.` };
    }
    throw e;
  }

  const created = await getPromoCode(v.code);
  return created ? { ok: true, code: created } : { ok: false, error: "Could not read it back." };
}

export type RedeemResult =
  | { ok: true; endKey: string; leaderDays: number }
  | { ok: false; error: string };

/**
 * A coach redeems a code.
 *
 * Never touches Razorpay, never records a payment, never sets a price. It moves a day
 * key and writes `source: "granted"` — which is what makes the admin funnel able to say
 * this coach is a Leader who is not revenue (D75).
 *
 * A coach who is ALREADY a paying Leader is refused rather than silently given days that
 * do nothing: their tier record is `source: "paid"` and overwriting it with a grant would
 * lose the subscription's own state. Telling them plainly beats a success message that
 * changed nothing.
 */
export async function redeemPromoCode(
  userId: string,
  rawCode: string,
  today = todayKey()
): Promise<RedeemResult> {
  const code = normaliseCode(rawCode);
  if (!code) return { ok: false, error: "Enter a code." };

  const existingTier = await getTierRecord(userId);
  if (existingTier?.source === "paid" && effectiveTier(existingTier, today) === "leader") {
    return {
      ok: false,
      error: "You are already on a paid Leader plan. A code cannot be added to it.",
    };
  }

  const codeRef = promoCodes().doc(code);
  const markerRef = promoRedemptions().doc(redemptionId(code, userId));
  const tierRef = tiers().doc(userId);

  try {
    return await db.runTransaction(async (txn) => {
      // Every read before every write — Firestore requires it, and it also means the
      // use count we check is the one we increment.
      const [codeSnap, markerSnap, tierSnap] = await Promise.all([
        txn.get(codeRef),
        txn.get(markerRef),
        txn.get(tierRef),
      ]);

      const promo = toPromo(codeSnap);
      const usable = checkRedeemable(promo, today);
      if (!usable.ok || !promo) {
        return { ok: false as const, error: usable.ok ? "That code is not valid." : usable.error };
      }
      if (markerSnap.exists) {
        return { ok: false as const, error: "You have already used that code." };
      }

      // The coach's current run, if it is still live. A lapsed date extends nothing —
      // extendedEndKey treats it as no date and starts the grant today.
      const currentEndKey =
        typeof tierSnap.data()?.trialEndsKey === "string"
          ? (tierSnap.data()!.trialEndsKey as string)
          : null;
      const endKey = extendedEndKey({
        todayKey: today,
        currentEndKey,
        leaderDays: promo.leaderDays,
      });

      // create(), not set(): a racing retry of the same tap aborts the transaction here
      // rather than granting the days a second time.
      txn.create(markerRef, {
        code,
        userId,
        leaderDays: promo.leaderDays,
        endKey,
        redeemedKey: today,
        redeemedAt: Timestamp.now(),
      });
      txn.update(codeRef, { uses: FieldValue.increment(1) });
      txn.set(
        tierRef,
        {
          tier: "leader",
          source: "granted",
          trialEndsKey: endKey,
          // The qualification card must not reappear for somebody who already has
          // Leader in hand; stamping it here is the same thing accepting the offer does.
          offerSeenKey: tierSnap.data()?.offerSeenKey ?? today,
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );

      return { ok: true as const, endKey, leaderDays: promo.leaderDays };
    });
  } catch (e) {
    if (/ALREADY_EXISTS|already exists/i.test((e as Error).message)) {
      return { ok: false, error: "You have already used that code." };
    }
    throw e;
  }
}
