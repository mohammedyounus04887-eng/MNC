import { NextResponse } from "next/server";
import { whatsappNumber } from "@/lib/prospect";
import { getUserById } from "@/lib/users";
import { getPublicPortfolio } from "@/modules/portfolio/queries";

/**
 * "Message me on WhatsApp", from a public portfolio.
 *
 * A redirect rather than a `wa.me` link rendered into the page, because the portfolio is
 * the one page in Growline we deliberately let search engines index (see `[slug]/page.tsx`).
 * A `wa.me/91XXXXXXXXXX` href would put the coach's personal mobile number in the HTML of
 * an indexed page, where number-scrapers find it in bulk. The coach chose to be findable;
 * they did not choose that.
 *
 * The number is still perfectly visible to a human who taps the button — this is not
 * secrecy, it is the difference between a person and a crawler.
 *
 * Unauthenticated on purpose: a prospect has no account and never will (v1 §3, P3).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const found = await getPublicPortfolio(slug);
  // Same 404 as the page itself. An unpublished coach is not reachable through a side
  // door that the page would not have shown.
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const coach = await getUserById(found.coach.id);
  if (!coach) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const first = coach.name.split(" ")[0];
  // Pre-filled from the PROSPECT's side, so the coach receives a message that says what
  // it is about. No claim, no offer, no number — v1 §5.2 and §5.3 apply to anything the
  // product puts in somebody's mouth, including a greeting.
  const text = encodeURIComponent(`Hi ${first}, I saw your Growline page.`);

  return NextResponse.redirect(
    `https://wa.me/${whatsappNumber(coach.phone)}?text=${text}`,
    // 307: this is not a permanent home for the URL, and the redirect must not be cached
    // by an intermediary that would then serve a stale number after a coach changes it.
    307
  );
}
