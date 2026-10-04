import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { TIERS_ENFORCED } from "@/modules/tiers/model";
import { getTierState, markOfferSeen, startLeaderTrial } from "@/modules/tiers/queries";

/**
 * A coach's own tier (v2 §8). No userId anywhere in the API — a tier you can name a
 * user into is a price somebody else set for them.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  return NextResponse.json({ state: await getTierState(user) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  switch (b.action) {
    case "offer-seen":
      await markOfferSeen(user.id);
      return NextResponse.json({ ok: true });

    case "start-trial": {
      /**
       * Refused while enforcement is off, and the message says why.
       *
       * Every Leader tool is currently open to everyone ("don't gate anything yet"),
       * so starting the 30-day clock now would burn a coach's whole trial on tools
       * they already have — they would reach the flip with nothing left. The
       * qualification is theirs and keeps; the clock starts when it buys something.
       */
      if (!TIERS_ENFORCED) {
        return NextResponse.json(
          {
            error:
              "Every Leader tool is open to everyone during launch — your free 30 days start when payments begin, so you lose nothing.",
          },
          { status: 409 }
        );
      }
      const result = await startLeaderTrial(user.id);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true, record: result.record });
    }

    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
