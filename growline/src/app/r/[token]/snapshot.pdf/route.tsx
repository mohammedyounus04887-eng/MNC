import { ImageResponse } from "next/og";
import { PDFDocument } from "pdf-lib";
import { loadReportForRender } from "@/lib/report-render";
import { DISCLAIMER, REPORT_TITLE, nextStepLine } from "@/lib/report-copy";
import { cardFonts } from "@/lib/report-fonts";
import { CARD_HEIGHT, CARD_WIDTH, ReportCard } from "@/lib/report-card";

/**
 * The PDF (F3) wraps the same rendered card, so the printed artefact and the
 * shared image can never disagree. The page is sized to the image's own aspect
 * ratio, so nothing is stretched.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const report = await loadReportForRender(token);
  if (!report) return new Response("Not found", { status: 404 });

  // Same faces and the same substitution as card.png — the printed artefact and
  // the shared image must not disagree about how a name is spelled.
  const { fonts, safe, safeOrNull } = await cardFonts([
    report.firstName,
    report.coach.name,
    report.coach.city,
  ]);

  const draw = (photoUrl: string | null) =>
    new ImageResponse(
      (
        <ReportCard
          firstName={safe(report.firstName)}
          metrics={report.snapshot.metrics}
          coach={{
            ...report.coach,
            name: safe(report.coach.name),
            city: safeOrNull(report.coach.city),
            photoUrl,
          }}
          nextStep={nextStepLine(report.id)}
        />
      ),
      { width: CARD_WIDTH, height: CARD_HEIGHT, fonts }
    ).arrayBuffer();

  let png: ArrayBuffer;
  try {
    png = await draw(report.coach.photoUrl);
  } catch (err) {
    console.error("[growline] pdf card render failed, retrying without photo", err);
    try {
      png = await draw(null);
    } catch (err2) {
      console.error("[growline] pdf card render failed", err2);
      return new Response("Could not build this PDF", { status: 500 });
    }
  }

  const pdf = await PDFDocument.create();
  // The disclaimer goes into the document metadata too, so it survives even a
  // reader that only shows file properties.
  pdf.setTitle(`${REPORT_TITLE} — ${report.firstName}`);
  pdf.setSubject(DISCLAIMER);
  pdf.setProducer("Growline");
  pdf.setCreator("Growline");

  const image = await pdf.embedPng(png);
  // A4 width in points, height derived from the card's ratio: no distortion.
  const pageWidth = 595.28;
  const pageHeight = (CARD_HEIGHT / CARD_WIDTH) * pageWidth;
  const page = pdf.addPage([pageWidth, pageHeight]);
  page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });

  const bytes = await pdf.save();
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      // No name in the filename. HTTP headers are byte strings, so a Devanagari
      // or Kannada name throws outright — and the filename would follow the file
      // into the prospect's downloads and anywhere it got re-shared.
      "Content-Disposition": 'inline; filename="wellness-snapshot.pdf"',
      "Cache-Control": "private, no-store",
    },
  });
}
