import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { getOwnPortfolio } from "@/modules/portfolio/queries";
import PortfolioEditor from "@/modules/portfolio/PortfolioEditor";

/**
 * "My page" — the coach's editor for their public portfolio (F9).
 *
 * The site URL is resolved on the server and passed down. The editor shows it beside the
 * link field and puts it on the clipboard, and a client component guessing it from
 * `window.location` would be wrong on exactly the deployment where it matters — behind a
 * proxy, where the browser's host is not the public origin (`site-url.ts`).
 */
export default async function PortfolioPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [portfolio, base] = await Promise.all([getOwnPortfolio(user.id), siteUrl()]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-3xl font-bold text-text">My Page</h1>
        <p className="mt-1 text-text-dim">
          What a new person sees when they want to know who you are.
        </p>
      </div>

      <PortfolioEditor
        initial={{
          slug: portfolio.slug,
          headline: portfolio.headline,
          story: portfolio.story,
          published: portfolio.published,
        }}
        coachName={user.name}
        siteUrl={base}
      />
    </div>
  );
}
