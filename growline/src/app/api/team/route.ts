import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { buildTeamTree, isInDownline } from "@/lib/team";

export async function GET(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const url = new URL(req.url);
  const rootId = url.searchParams.get("root") ?? uid;
  // Re-rooting is only allowed within your own downline.
  if (rootId !== uid && !(await isInDownline(uid, rootId))) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const tree = await buildTeamTree(rootId);
  if (!tree) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ tree, isSelf: rootId === uid });
}
