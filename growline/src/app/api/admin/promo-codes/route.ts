import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { recordAdminAction } from "@/lib/admin-audit";
import { mintPromoCode } from "@/modules/promo/queries";

/**
 * Minting a promo code (F12, v2 §8).
 *
 * Re-checks `isAdmin` rather than trusting the gated layout — this is a route and a
 * route is reachable directly. 404 for a non-admin, matching the panel: a 403 would
 * confirm the endpoint exists.
 *
 * Audited AFTER the write and only on success, for the same reason as the broadcast
 * route: a log entry for a code that was never minted is worse than no entry, because
 * somebody reading the log would believe the code works and hand it out.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const result = await mintPromoCode(
    {
      code: body.code as string,
      leaderDays: Number(body.leaderDays),
      maxUses: Number(body.maxUses),
      expiresKey: body.expiresKey as string,
      lockedPlan: (body.lockedPlan as string) ?? null,
      note: (body.note as string) ?? null,
    },
    user.id
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  await recordAdminAction({
    actorId: user.id,
    actorName: user.name,
    action: "mint-promo-code",
    detail: `${result.code.code}: ${result.code.leaderDays} Leader days, max ${result.code.maxUses} uses, expires ${result.code.expiresKey}`,
  });

  return NextResponse.json({ ok: true, code: result.code });
}
