import { NextResponse } from "next/server";
import { deleteReportsForProspect, getReportByToken } from "@/lib/reports";
import { deleteProspect } from "@/lib/prospects";
import { isValidReportToken } from "@/lib/report-token";
import { isReportExpired } from "@/lib/report";

/**
 * Erasure at the request of the person the data is about. Holding the snapshot
 * link is the authorisation — the same bearer secret that grants read access.
 *
 * Deletes the prospect AND their reports. Prisma cascaded this via the relation;
 * Firestore does not cascade, so leaving the reports would keep live bearer
 * tokens to the health data this request is asking us to erase.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!isValidReportToken(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const report = await getReportByToken(token);
  if (!report || isReportExpired(report.createdAt)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Reports first: if the second delete fails, a prospect with no reports is a
  // recoverable state, whereas reports with no prospect are unreachable orphans
  // still serving health data.
  //
  // Firestore deletes are idempotent — removing an absent document succeeds — so
  // the double-tap case the old deleteMany guarded against still cannot 500 and
  // tell someone their erasure failed when it had already succeeded.
  await deleteReportsForProspect(report.prospectId);
  await deleteProspect(report.prospectId);
  return NextResponse.json({ ok: true });
}
