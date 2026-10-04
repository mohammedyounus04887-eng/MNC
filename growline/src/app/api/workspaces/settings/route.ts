import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import {
  checkLevelGroups,
  checkWorkspaceName,
  isAccentKey,
} from "@/modules/workspaces/model";
import { updateWorkspaceSettings } from "@/modules/workspaces/queries";

/**
 * The organisation's own settings: display name, accent colour, level names.
 *
 * Owner-only, re-derived inside `updateWorkspaceSettings` from the workspace's own
 * `ownerId` rather than trusted from the caller — the route is reachable directly and a
 * hidden form proves nothing.
 *
 * The workspace id is NOT taken from the request. It comes from the caller's own user
 * document, so this endpoint cannot be pointed at another organisation even by an owner.
 * That is the multi-tenant boundary: a workspace id in a request body is a workspace id
 * somebody can change.
 */
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  if (!user.workspaceId) {
    // A coach the backfill never reached. Says what to do rather than failing blankly.
    return NextResponse.json(
      { error: "You are not in an organisation yet." },
      { status: 409 }
    );
  }

  const raw = await req.json().catch(() => null);
  const body = (raw ?? {}) as Record<string, unknown>;
  const update: Parameters<typeof updateWorkspaceSettings>[2] = {};

  if (body.name !== undefined) {
    const nameCheck = checkWorkspaceName(body.name);
    if (!nameCheck.ok) {
      return NextResponse.json({ error: nameCheck.error }, { status: 400 });
    }
    update.name = nameCheck.name;
  }

  if (body.accent !== undefined) {
    // Allow-list, not a colour value. A free colour could fail contrast on the dark base
    // or collide with the meanings the palette already assigns — green is money, heat is
    // an alert — and a workspace repainting those has broken the app's grammar for its
    // own coaches.
    if (!isAccentKey(body.accent)) {
      return NextResponse.json({ error: "Pick one of the colours offered." }, { status: 400 });
    }
    update.accent = body.accent;
  }

  if (body.levelGroups !== undefined) {
    const levelCheck = checkLevelGroups(body.levelGroups);
    if (!levelCheck.ok) {
      return NextResponse.json({ error: levelCheck.error }, { status: 400 });
    }
    update.levelGroups = levelCheck.levelGroups;
  }

  const saved = await updateWorkspaceSettings(user.workspaceId, user.id, update);
  // Null means not the owner. 404 rather than 403 so the endpoint cannot be used to
  // learn whether a workspace exists or who owns it.
  if (!saved) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true, workspace: { ...saved, createdAt: undefined } });
}
