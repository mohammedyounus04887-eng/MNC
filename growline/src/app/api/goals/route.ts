import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getOwnSheet, saveOwnSheet } from "@/modules/goals/queries";

/**
 * A coach's own Goal Sheet.
 *
 * There is no `userId` in either signature — both operate on the caller's own sheet,
 * resolved from the session. A sheet id in a request body is a sheet somebody can change,
 * and this one holds the most personal thing in the app.
 *
 * PATCH is partial by design: A1 requires three short skippable steps, so every save is a
 * fragment and an absent key means "unchanged", never "cleared".
 */
export async function GET() {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  return NextResponse.json({ sheet: await getOwnSheet(uid) });
}

export async function PATCH(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const result = await saveOwnSheet(uid, (raw ?? {}) as Record<string, unknown>);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, sheet: result.sheet });
}
