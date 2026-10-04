import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { redeemPromoCode } from "@/modules/promo/queries";

/**
 * A coach redeems a promo code (v2 §8, Phase 9b).
 *
 * Signed in only, and the coach is taken from the SESSION — never from the body. A route
 * that accepted a userId would let anybody spend anybody else's one redemption.
 *
 * No rate limit beyond the structural one, deliberately: a code is `[A-Z0-9]{4,24}` and
 * guessing one is not the attack worth engineering against here — the worst outcome of a
 * guess is a free trial extension, and every code has a use cap and an expiry that bound
 * the damage. What IS enforced is one redemption per coach per code, structurally.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const result = await redeemPromoCode(user.id, String(body.code ?? ""));

  // 400 for every refusal, including "already used" — the coach's next action is the
  // same in each case (check the code, or ask whoever gave it to them), and a status
  // code that varied by reason would tell a prober which codes exist.
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, endKey: result.endKey, leaderDays: result.leaderDays });
}
