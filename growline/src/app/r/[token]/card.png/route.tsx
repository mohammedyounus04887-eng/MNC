import { ImageResponse } from "next/og";
import { loadReportForRender } from "@/lib/report-render";
import { nextStepLine } from "@/lib/report-copy";
import { cardFonts } from "@/lib/report-fonts";
import { CARD_HEIGHT, CARD_WIDTH, ReportCard } from "@/lib/report-card";

/** The shareable card (F3). Contains the metrics, so it is never cached publicly. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const report = await loadReportForRender(token);
  if (!report) return new Response("Not found", { status: 404 });

  // Every string on this card that comes from data rather than from report-copy.
  // Anything outside the shipped faces is replaced here, so satori is never handed
  // a glyph it would go and fetch from Google along with the name (D66).
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

  // Buffered rather than streamed: ImageResponse renders lazily as its body is
  // consumed, so a try/catch around the constructor alone would never fire and a
  // failed render would go out as a 200 with a truncated image.
  let png: ArrayBuffer;
  try {
    png = await draw(report.coach.photoUrl);
  } catch (err) {
    console.error("[growline] card render failed, retrying without photo", err);
    try {
      // A malformed or unsupported coach photo is the likeliest cause, and the
      // card has an initials fallback that is worth reaching.
      png = await draw(null);
    } catch (err2) {
      console.error("[growline] card render failed", err2);
      return new Response("Could not draw this image", { status: 500 });
    }
  }

  return new Response(png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
  });
}
