import { NextResponse } from "next/server";
import { getProspectForCoach } from "@/lib/prospects";
import { getSessionUserId } from "@/lib/session";
import { eligibilityMessage, ensureCurrentReport, reportBlocker } from "@/lib/report";

/** Creates (or returns) the report for a prospect the signed-in coach owns. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { id } = await params;
  const prospect = await getProspectForCoach(id, uid);
  if (!prospect) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const report = await ensureCurrentReport(prospect);
  if (!report) {
    // Say which detail is actually missing — telling a coach to add a height they
    // already entered sends them looking for a problem that isn't there.
    const reason = eligibilityMessage(reportBlocker(prospect));
    return NextResponse.json(
      { error: reason?.body ?? "Could not make a snapshot for this person." },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, token: report.token });
}
