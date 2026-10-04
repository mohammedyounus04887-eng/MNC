import { shiftKey } from "@/lib/daily-log";

/**
 * Promo codes for club launches (v2 §8, Phase 9b).
 *
 * ## What a promo code is, and the one thing it is not
 *
 * It is a LONGER FREE RUN of Leader, minted by an admin and typed in by a coach. It is
 * not a discount, not a locked price, and it never touches Razorpay. A code grants days;
 * the paid conversion afterwards is the ordinary path through `/api/payments/subscribe`,
 * on the ordinary mandate, at the ordinary price.
 *
 * That separation is deliberate. A code that could alter what somebody is charged would
 * put pricing logic in a string handed out at a club launch, and the failure mode is a
 * room full of people holding a price the system does not honour. Days are safe to give
 * away by hand; money is not.
 *
 * `lockedPlan` is recorded on the code because v2 §8 mentions founding pricing, but it
 * is carried as INFORMATION ONLY today — nothing reads it to decide an amount. When
 * founding prices exist they will be Razorpay plan ids, created in the dashboard like
 * every other plan, and this field will name one.
 *
 * ## Why a grant is not just a longer trial
 *
 * The tier record's `source` distinguishes them: `trial` is the 30 days a coach EARNS by
 * recruiting a 2nd downline, `granted` is days somebody was given. The admin funnel
 * counts them apart (D75) so a club launch cannot be read as revenue, and the
 * qualification trial stays a thing a coach earns exactly once.
 *
 * PURE ONLY — no database, no Firestore types (RULES E2; the redeem field is a client
 * component). Queries live in queries.ts.
 */

/** Longest run a single code may grant. A year of free Leader is a business decision,
 *  not a typo somebody makes at 11pm before a launch. */
export const MAX_LEADER_DAYS = 365;
export const MIN_LEADER_DAYS = 1;
export const MIN_CODE_LENGTH = 4;
export const MAX_CODE_LENGTH = 24;

export type PromoCode = {
  /** The normalised code, which is also the document id. */
  code: string;
  /** Days of Leader this grants. Added to any run the coach already has. */
  leaderDays: number;
  /** Informational only — see the note above. Null unless an admin set one. */
  lockedPlan: string | null;
  maxUses: number;
  uses: number;
  /** Last IST day (inclusive) the code may be redeemed. */
  expiresKey: string;
  createdBy: string;
  note: string | null;
};

/**
 * The canonical form of a code: upper case, no spaces or dashes.
 *
 * Codes are read off a poster and typed on a phone, usually one-handed, often by
 * somebody whose keyboard capitalises the first letter for them. "founding-50",
 * "FOUNDING 50" and "Founding50" are the same code, because to the person typing it they
 * obviously are, and a redemption that fails on punctuation reads as the app being
 * broken in front of a room.
 */
export function normaliseCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/** Shape only — says nothing about whether the code exists. */
export function isValidCodeShape(code: string): boolean {
  return (
    code.length >= MIN_CODE_LENGTH &&
    code.length <= MAX_CODE_LENGTH &&
    /^[A-Z0-9]+$/.test(code)
  );
}

export type MintInput = {
  code: string;
  leaderDays: number;
  maxUses: number;
  expiresKey: string;
  lockedPlan?: string | null;
  note?: string | null;
};

/**
 * Validates what an admin typed, before anything is written.
 *
 * Every bound is checked here rather than at the database, because the mistake this
 * guards against is a human one — a stray zero on `leaderDays`, an `expiresKey` in the
 * past that makes a code dead on arrival at the launch it was minted for.
 */
export function checkMint(
  input: Partial<MintInput>,
  todayKey: string
): { ok: true; value: MintInput } | { ok: false; error: string } {
  const code = normaliseCode(input.code);
  if (!isValidCodeShape(code)) {
    return {
      ok: false,
      error: `A code is ${MIN_CODE_LENGTH}–${MAX_CODE_LENGTH} letters and numbers.`,
    };
  }

  const leaderDays = Number(input.leaderDays);
  if (!Number.isInteger(leaderDays) || leaderDays < MIN_LEADER_DAYS || leaderDays > MAX_LEADER_DAYS) {
    return { ok: false, error: `Days must be a whole number from 1 to ${MAX_LEADER_DAYS}.` };
  }

  const maxUses = Number(input.maxUses);
  if (!Number.isInteger(maxUses) || maxUses < 1) {
    return { ok: false, error: "Uses must be a whole number, 1 or more." };
  }

  const expiresKey = typeof input.expiresKey === "string" ? input.expiresKey : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresKey)) {
    return { ok: false, error: "An expiry date is required." };
  }
  if (expiresKey < todayKey) {
    // Day keys compare lexicographically — see effectiveTier for the same trick.
    return { ok: false, error: "That expiry date has already passed." };
  }

  return {
    ok: true,
    value: {
      code,
      leaderDays,
      maxUses,
      expiresKey,
      lockedPlan: typeof input.lockedPlan === "string" && input.lockedPlan ? input.lockedPlan : null,
      note: typeof input.note === "string" && input.note.trim() ? input.note.trim() : null,
    },
  };
}

/**
 * Can this code be redeemed at all today, by anybody?
 *
 * Says nothing about the coach — "you already used this" is decided structurally by the
 * redemption document, not here, because a check-then-write cannot be made safe against
 * two taps on a slow connection.
 */
export function checkRedeemable(
  promo: Pick<PromoCode, "uses" | "maxUses" | "expiresKey"> | null,
  todayKey: string
): { ok: true } | { ok: false; error: string } {
  // Same sentence for "wrong code" and "expired code" on purpose: a code is a bearer
  // token, and distinguishing the two lets somebody probe which codes exist.
  if (!promo) return { ok: false, error: "That code is not valid." };
  if (todayKey > promo.expiresKey) return { ok: false, error: "That code is not valid." };
  if (promo.uses >= promo.maxUses) {
    // This one IS distinguished: the coach holds a real code and the honest answer is
    // that they were too late, not that they mistyped it.
    return { ok: false, error: "That code has been fully used." };
  }
  return { ok: true };
}

/**
 * The new last-live-day after granting `leaderDays`.
 *
 * The arithmetic that matters: days are ADDED to a run the coach already has rather than
 * replacing it. A coach eleven days into a 30-day qualification trial who redeems a
 * 90-day launch code gets 90 days on top of their remaining nineteen — not 90 days
 * instead of them, which would silently take nineteen days away from somebody being
 * given a present.
 *
 * `currentEndKey` is the coach's existing end date, or null. A LAPSED date is treated as
 * no date: the grant starts today rather than extending a run that already finished.
 *
 * Inclusive last day throughout, matching `startLeaderTrial` — so a 1-day grant starting
 * today ends today, and the coach has one day. Day keys only, through `shiftKey`
 * (RULES E1): IST is UTC+5:30 and a Date subtraction here would land a grant a day early
 * for anybody redeeming in the evening.
 */
export function extendedEndKey(params: {
  todayKey: string;
  currentEndKey: string | null;
  leaderDays: number;
}): string {
  const { todayKey, currentEndKey, leaderDays } = params;
  const live = currentEndKey !== null && currentEndKey >= todayKey;
  return live
    ? shiftKey(currentEndKey, leaderDays)
    : shiftKey(todayKey, leaderDays - 1);
}

/** What the coach is told after a successful redemption. Trust Zone: flat and factual. */
export function redeemedMessage(endKey: string): string {
  return `Leader is on until ${endKey}. Nothing was charged, and no payment method is connected.`;
}
