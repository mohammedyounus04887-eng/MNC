import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getOwnPortfolio, isSlugFree, saveOwnPortfolio } from "@/modules/portfolio/queries";

/**
 * A coach's own portfolio (F9).
 *
 * No userId in either signature — both operate on the caller's own page, resolved from
 * the session. Same reasoning as the goal sheet: an id in the body is a page somebody
 * else can edit, and this one is publicly visible under a name that gets printed.
 */
export async function GET(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  // `?check=<slug>` powers the editor's live availability hint. Deliberately a HINT: the
  // answer can be stale by the time they press save, which is exactly why the claim
  // itself is transactional (D41) and never trusts this.
  const check = new URL(req.url).searchParams.get("check");
  if (check !== null) {
    return NextResponse.json({ free: await isSlugFree(check, uid) });
  }

  return NextResponse.json({ portfolio: await getOwnPortfolio(uid) });
}

export async function PATCH(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const result = await saveOwnPortfolio(uid, (raw ?? {}) as Record<string, unknown>);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, portfolio: result.portfolio });
}
