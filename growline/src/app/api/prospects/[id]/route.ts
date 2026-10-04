import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { parseProspectInput } from "@/lib/prospect";
import { ensureCurrentReport } from "@/lib/report";
import { getProspectForCoach, updateProspect } from "@/lib/prospects";

/**
 * Updating a prospect's details is how a coach fills in the age/height/weight
 * they didn't have on the road, which is what unlocks the full report.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  // Same 404 for "not yours" as for "not found" — never confirm that another
  // coach's prospect id exists.
  const existing = await getProspectForCoach(id, uid);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = parseProspectInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const prospect = await updateProspect(id, parsed.value);
  if (!prospect) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Details changed, so the report may need reissuing (new link, old one intact).
  const report = await ensureCurrentReport(prospect);
  return NextResponse.json({ ok: true, reportToken: report?.token ?? null });
}
