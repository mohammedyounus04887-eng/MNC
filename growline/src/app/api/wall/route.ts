import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { clap, getWall, isOptedOut, setOptOut } from "@/modules/wall/queries";

/**
 * The Recognition Wall (Feature B).
 *
 * No workspaceId in any signature — the viewer's workspace comes from their own user
 * document. A wall you can name a workspace into is a wall you can read somebody else's
 * organisation through.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  return NextResponse.json({
    cards: await getWall(user),
    optedOut: await isOptedOut(user.id),
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  switch (b.action) {
    case "clap": {
      const cardId = typeof b.cardId === "string" ? b.cardId : "";
      if (!cardId) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const result = await clap(user, cardId);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
      return NextResponse.json({ ok: true, claps: result.claps });
    }

    case "opt-out": {
      // Strict boolean, never a coercion — `Boolean("false")` is true, and putting a
      // coach back ON the wall when they asked to leave is the one mistake this field
      // must not be able to make. Same rule as the F11 prospect toggle (D50).
      if (typeof b.optOut !== "boolean") {
        return NextResponse.json({ error: "Could not save that setting." }, { status: 400 });
      }
      await setOptOut(user.id, b.optOut);
      return NextResponse.json({ ok: true, optedOut: b.optOut });
    }

    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
