import { formatValue, type MetricSpec } from "./metrics";
import { MIN_PARTICIPANTS, type RankedEntry, type ViewerBoard } from "./ranking";

/**
 * One board (F13). Four of these stack on the screen — see metrics.ts for why there
 * is no metric switcher.
 *
 * ## What this component may never render
 *
 * A full list. It is given a `ViewerBoard`, which by construction holds a podium,
 * the coaches directly AHEAD of the reader, and the reader — never anybody behind
 * them, and never a participant count. Do not add "you are 14th of 41" here: the
 * two numbers together are a bottom-of-the-board reveal, and the roster this is
 * sliced from is server-only precisely so that reveal is not one prop away.
 *
 * ## One accent
 *
 * Gold, and only on the first-place badge and the reader's own row (G3). Validated
 * and unvalidated volume are told apart by weight and words rather than by a second
 * colour — a green "checked" chip would read as money on a screen that must never
 * mention any (L4), and would put two accents on one card.
 */

function RankBadge({ rank, isMe }: { rank: number; isMe: boolean }) {
  const gold = rank === 1;
  return (
    <span
      className={[
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums",
        gold ? "metal-gold" : "border border-hairline text-text-dim",
        !gold && isMe ? "text-text" : "",
      ].join(" ")}
      aria-hidden
    >
      {rank}
    </span>
  );
}

function Row({ entry, isMe }: { entry: RankedEntry; isMe: boolean }) {
  const unchecked = entry.unvalidated ?? 0;
  return (
    <li
      data-testid={isMe ? "board-row-me" : "board-row"}
      className={[
        "flex items-center gap-3 rounded-xl px-3 py-2",
        isMe ? "bg-elevated" : "",
      ].join(" ")}
    >
      <RankBadge rank={entry.rank} isMe={isMe} />
      <span className="min-w-0 flex-1 truncate font-medium">
        {entry.name}
        {isMe && (
          <span className="metal-gold ml-2 rounded-full px-2 py-0.5 text-xs font-bold">
            You
          </span>
        )}
      </span>
      <span className="shrink-0 text-right">
        <span className="numeral text-lg">{entry.value.toLocaleString("en-IN")}</span>
        {unchecked > 0 && (
          <span className="block text-xs text-text-dim">
            +{unchecked.toLocaleString("en-IN")} not checked yet
          </span>
        )}
      </span>
    </li>
  );
}

export default function BoardCard({
  spec,
  view,
  unavailableReason,
  optedOut,
}: {
  spec: MetricSpec;
  view: ViewerBoard | null;
  unavailableReason: string | null;
  optedOut: boolean;
}) {
  return (
    <section
      data-testid={`board-${spec.id}`}
      className="rounded-2xl bg-surface p-5"
      aria-labelledby={`board-${spec.id}-title`}
    >
      <h2 id={`board-${spec.id}-title`} className="font-display text-xl font-bold">
        {spec.title}
      </h2>
      <p className="mt-1 text-sm text-text-dim">{spec.blurb}</p>

      {unavailableReason ? (
        <p className="mt-4 rounded-xl border border-hairline px-4 py-3 text-sm text-text-dim">
          {unavailableReason}
        </p>
      ) : !view ? (
        /* Zero data teaches instead of showing an empty box. */
        <div className="mt-4 rounded-xl border border-hairline px-4 py-4">
          <p className="text-sm font-medium">Nothing here yet.</p>
          <p className="mt-1 text-sm text-text-dim">
            {/* The number comes from the constant, never from prose. It is derived
                from the podium and window sizes (see ranking.ts), so a copy string
                spelling it out in words goes stale the moment either one moves. */}
            This board appears once {MIN_PARTICIPANTS} coaches in this group have
            something on it. {spec.howToJoin}
          </p>
        </div>
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-1">
            {view.podium.map((e) => (
              <Row
                key={e.userId}
                entry={e}
                isMe={!!view.me && e.userId === view.me.userId}
              />
            ))}
          </ul>

          {view.me ? (
            <>
              {view.above.length > 0 && (
                <>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-text-dim">
                    Just ahead of you
                  </p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {view.above.map((e) => (
                      <Row key={e.userId} entry={e} isMe={false} />
                    ))}
                  </ul>
                </>
              )}

              {/* The reader's own row is repeated below the window unless the
                  podium already shows it — the point of the window is that you can
                  see yourself and the person you can pass. */}
              {!view.podium.some((p) => p.userId === view.me!.userId) && (
                <ul className="mt-1 flex flex-col gap-1">
                  <Row entry={view.me} isMe />
                </ul>
              )}

              <p className="mt-3 text-sm text-text-dim">
                {view.gap
                  ? `${formatValue(spec, view.gap.points)} behind #${view.gap.rank}.`
                  : view.me.rank === 1
                    ? "You are top of this board."
                    : "You are level with the coach above you."}
              </p>
            </>
          ) : (
            <p className="mt-4 rounded-xl border border-hairline px-4 py-3 text-sm text-text-dim">
              {optedOut
                ? "You are not listed on the boards. You can change that below."
                : `You are not on this board yet. ${spec.howToJoin}`}
            </p>
          )}
        </>
      )}
    </section>
  );
}
