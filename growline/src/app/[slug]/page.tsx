import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { siteUrl } from "@/lib/site-url";
import { getPublicPortfolio } from "@/modules/portfolio/queries";

/**
 * A coach's public page (F9) — `growline.in/<their name>`.
 *
 * ## Why this sits at the root and not under a prefix
 *
 * Every other public route here is prefixed: `/c/<code>`, `/r/<token>`, `/join/<code>`.
 * This one is not, because the URL is the product. It is printed on a QR poster on a club
 * wall, it rides on every wellness report, and coaches read it out loud down a phone.
 * `growline.in/priyasharma` survives that; `growline.in/p/priyasharma` loses a word of it
 * every time.
 *
 * The cost is that a route added later could shadow a coach whose printed link already
 * exists. That is handled where it can actually be handled — `RESERVED_SLUGS` in
 * `model.ts` blocks every current route plus the words a growing product reaches for, at
 * the moment the name is claimed. Blocking a name today costs a coach nothing; discovering
 * the clash later costs them a reprint.
 *
 * The second cost is that every stray URL in the app now reaches this segment. That is
 * why `getPublicPortfolio` validates the slug's SHAPE before it reads anything: a request
 * for `/favicon.png` or `/.well-known/foo` fails the format check and never touches
 * Firestore.
 *
 * ## What is deliberately not here
 *
 * No prospect data, no metrics, no health information of any kind — this page is about
 * the coach. And nothing a coach types reaches a wellness report from here; the report's
 * words live in `report-copy.ts` and stay there (v1 §5.2).
 */

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const found = await getPublicPortfolio(slug);
  if (!found) return { title: "Page not found", robots: { index: false, follow: false } };

  const { coach, portfolio } = found;
  const title = coach.city ? `${coach.name} · ${coach.city}` : coach.name;
  const description = portfolio.headline || portfolio.story.slice(0, 160);

  return {
    title,
    description,
    // Unlike a report link, this page is MEANT to be found — it is the coach's shopfront
    // and the one thing in Growline that benefits from being indexed. Report pages stay
    // noindex (D17); this is the deliberate opposite, and it is safe because there is
    // nothing here about any prospect.
    robots: { index: true, follow: true },
    openGraph: { title, description, type: "profile" },
  };
}

export default async function PortfolioPage({ params }: Params) {
  const { slug } = await params;
  const found = await getPublicPortfolio(slug);
  // An unclaimed slug and an unpublished one give the same 404, on purpose: telling a
  // stranger "not published yet" says something about somebody who chose not to be seen.
  if (!found) notFound();

  const { coach, portfolio } = found;
  const base = await siteUrl();
  const joinUrl = `${base}/join/${coach.referralCode}`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-6 px-5 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <Avatar name={coach.name} photoUrl={coach.photoUrl} size={96} />
        <div>
          <h1 className="font-display text-3xl font-bold text-text">{coach.name}</h1>
          {portfolio.headline && (
            <p className="mt-1 text-text/80">{portfolio.headline}</p>
          )}
          {coach.city && <p className="mt-1 text-sm text-text-dim">{coach.city}</p>}
        </div>
      </header>

      {portfolio.story && (
        <section className="rounded-2xl bg-surface p-5">
          {/* Their own words, rendered as written. `whitespace-pre-line` keeps the
              paragraph breaks a coach typed; nothing here is parsed as markup. */}
          <p className="whitespace-pre-line text-text/90">{portfolio.story}</p>
        </section>
      )}

      <div className="flex flex-col gap-3">
        {/*
         * The two things a prospect can do, and nothing else.
         *
         * WhatsApp goes through the app's own contact route rather than a `wa.me` link
         * built here, because that would put the coach's personal phone number in the
         * page source of a page we just asked search engines to index. The coach chose to
         * be findable; they did not choose to have their number scraped.
         */}
        <a
          href={`/api/public/contact/${slug}`}
          className="flex h-14 items-center justify-center rounded-xl bg-gold text-lg font-semibold text-on-gold"
        >
          Message me on WhatsApp
        </a>
        <a
          href={joinUrl}
          className="flex h-14 items-center justify-center rounded-xl border border-hairline text-lg font-medium text-text"
        >
          Join my club
        </a>
      </div>

      <footer className="mt-auto pt-6 text-center text-xs text-text-dim">
        {/* The free-tier watermark (v2 §8). Small and tasteful, and it is also how a
            prospect learns the product exists — this page is the top of the funnel. */}
        {!portfolio.isPro && <p>Made with Growline</p>}
      </footer>
    </main>
  );
}
