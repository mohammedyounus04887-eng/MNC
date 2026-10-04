import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { isOptedOut, setOptedOut } from "@/modules/leaderboards/queries";

/**
 * The per-coach opt-out (v1 §8: leaderboards "with opt-out").
 *
 * A coach acts only on themselves — the uid comes from the session cookie and the
 * body is never allowed to name a user. Otherwise this route would be a way to
 * quietly remove a rival from every board they are winning.
 *
 * Opting out removes a coach from the LISTINGS. It does not hide the boards from
 * them: they keep seeing where everyone else is, they simply are not one of the
 * names. That asymmetry is deliberate — the reason people opt out of a leaderboard
 * is exposure, not curiosity.
 */

export async function GET() {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  return NextResponse.json({ optedOut: await isOptedOut(uid) });
}

export async function POST(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (typeof body?.optedOut !== "boolean") {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  await setOptedOut(uid, body.optedOut);
  return NextResponse.json({ ok: true, optedOut: body.optedOut });
}
