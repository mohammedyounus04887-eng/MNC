import { ImageResponse } from "next/og";
import { loadReportForRender } from "@/lib/report-render";
import { cardFonts } from "@/lib/report-fonts";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, ReportPreview } from "@/lib/report-card";

/**
 * The link-preview image. Neutral branding, no metrics — this is what renders when
 * the snapshot link is forwarded into a group chat.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const report = await loadReportForRender(token);
  if (!report) return new Response("Not found", { status: 404 });

  // The coach's name is the only variable string in the preview.
  const { fonts, safe } = await cardFonts([report.coach.name]);

  // Buffered so a render failure is catchable — see the note in card.png.
  try {
    const png = await new ImageResponse(
      <ReportPreview coachName={safe(report.coach.name)} />,
      { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, fonts }
    ).arrayBuffer();
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  } catch (err) {
    console.error("[growline] preview render failed", err);
    return new Response("Could not draw this image", { status: 500 });
  }
}
