import { NextResponse } from "next/server";
import { getReportByToken, markReportSent } from "@/lib/reports";
import { getProspectById } from "@/lib/prospects";
import { getSessionUserId } from "@/lib/session";
import { isValidReportToken } from "@/lib/report-token";

/**
 * Marks a report as sent when the coach opens the WhatsApp share (F4). Feeds the
 * report -> send rate in Section 13, so it records the FIRST send only.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { token } = await params;
  if (!isValidReportToken(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const report = await getReportByToken(token);
  // coachId is denormalised onto the report, but fall back to the prospect for
  // rows written before that field existed.
  const coachId =
    report?.coachId ?? (report ? (await getProspectById(report.prospectId))?.coachId : null);
  if (!report || coachId !== uid) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!report.sentAt) await markReportSent(report.id);
  return NextResponse.json({ ok: true });
}
