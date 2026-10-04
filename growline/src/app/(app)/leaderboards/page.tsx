import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { relativeTime } from "@/lib/threads";
import { isWindowId, resetsLabel, type WindowId } from "@/modules/shared-new/period";
import { isScopeType, type ScopeType } from "@/modules/shared-new/scopes";
import BoardCard from "@/modules/leaderboards/BoardCard";
import OptOutToggle from "@/modules/leaderboards/OptOutToggle";
import {
  getBoardsForViewer,
  isOptedOut,
  scopeOptions,
} from "@/modules/leaderboards/queries";

/**
 * Boards (F13).
 *
 * ## Why everything on this screen is a link
 *
 * The scope and window controls are plain `<Link>`s with query parameters, so the
 * page ships no JavaScript for its filters and works on a cheap phone with a bad
 * connection. Reading a board is a glance, not an interaction — the 30-second rule
 * is satisfied by there being nothing to operate.
 *
 * ## Four boards, all visible
 *
 * All four render on one screen, stacked. The window and the scope are FILTERS and
 * get controls; the metric does not, because a metric switcher would make three of
 * the four something you must already know about to go and find. See metrics.ts.
 *
 * ## Nobody sees the bottom
 *
 * This page reads the private roster documents through the Admin SDK and hands the
 * browser only each board's podium plus the coaches directly ahead of the reader. No
 * participant count, no full ordering, nothing below the reader — see ranking.ts.
 */

export default async function LeaderboardsPage({
  searchParams,
}: {
  // Next 16: searchParams is async (AGENTS.md, D4).
  searchParams: Promise<{ scope?: string; window?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const window: WindowId =
    params.window && isWindowId(params.window) ? params.window : "monthly";
  const requested: ScopeType =
    params.scope && isScopeType(params.scope) ? params.scope : "org";

  const options = scopeOptions(user);
  const chosen = options.find((o) => o.type === requested) ?? options[0];
  // A coach can ask for a group they do not belong to by editing the URL. They fall
  // back to the organisation board and are told why, rather than being shown an
  // error or, worse, a group they are not in.
  const active = chosen.scope ? chosen : options[0];
  const scope = active.scope!;

  const [{ period, boards }, optedOut] = await Promise.all([
    getBoardsForViewer(user, scope, window),
    isOptedOut(user.id),
  ]);

  const builtAt = boards
    .map((b) => b.generatedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const href = (next: { scope?: ScopeType; window?: WindowId }) => ({
    pathname: "/leaderboards",
    query: { scope: next.scope ?? active.type, window: next.window ?? window },
  });

  const pill = (on: boolean) =>
    [
      "min-h-12 rounded-xl px-4 py-3 text-sm font-semibold",
      on ? "metal-gold" : "border border-hairline text-text-dim",
    ].join(" ");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl font-bold text-text">Boards</h1>
        <p className="mt-1 text-text-dim">
          {period.label} · {resetsLabel(window)}
        </p>
      </div>

      <nav aria-label="Week or month" className="flex flex-wrap gap-2">
        <Link href={href({ window: "weekly" })} className={pill(window === "weekly")}>
          This week
        </Link>
        <Link href={href({ window: "monthly" })} className={pill(window === "monthly")}>
          This month
        </Link>
      </nav>

      <nav aria-label="Which group" className="flex flex-wrap gap-2">
        {options
          .filter((o) => o.scope)
          .map((o) => (
            <Link
              key={o.type}
              href={href({ scope: o.type })}
              data-testid={`scope-${o.type}`}
              className={pill(o.type === active.type)}
            >
              {o.label}
            </Link>
          ))}
      </nav>

      {/* A group this coach does not have yet is explained, never shown as a dead
          option — and no level name is ever suggested (RULES L8, D29). */}
      {options
        .filter((o) => !o.scope)
        .map((o) => (
          <p
            key={o.type}
            data-testid={`scope-missing-${o.type}`}
            className="rounded-xl border border-hairline px-4 py-3 text-sm text-text-dim"
          >
            {o.missingHint}
          </p>
        ))}

      {builtAt && (
        <p className="text-xs text-text-dim">Built {relativeTime(builtAt)}.</p>
      )}

      {boards.map((b) => (
        <BoardCard
          key={b.spec.id}
          spec={b.spec}
          view={b.view}
          unavailableReason={b.unavailableReason}
          optedOut={optedOut}
        />
      ))}

      <OptOutToggle optedOut={optedOut} />

      <p className="text-xs text-text-dim">
        Boards count your own activity only. The people you meet are counted, never
        named — nobody on a board can see anything about them.
      </p>
    </div>
  );
}
