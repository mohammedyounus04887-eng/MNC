import { CRITERION_SPECS, formatAmount, type CriterionType } from "./criteria";
import type { CriterionDropOff } from "./docs";

/**
 * Per-criterion drop-off — which condition is actually blocking people.
 *
 * This is the point of the creator's dashboard. "14 qualified, 9 close" is a
 * scoreboard; it cannot tell an upline what to say at Thursday's meeting. This can:
 * it names the one condition that, if it moved, would put the most people over the
 * line today.
 *
 * ## Why `soleBlocker` leads, and the rows are ordered by it
 *
 * A criterion with 30 people blocked and 2 sole-blocked is not the bottleneck —
 * those 28 are stuck on several things and fixing this one changes nothing for them.
 * A criterion with 6 blocked and 6 sole-blocked is six phone calls and six
 * qualifiers. So the list is ordered by the number that can actually be acted on, and
 * the top row is named as the bottleneck rather than left for the reader to work out.
 *
 * ## The typical gap is a median (progress.ts)
 *
 * And it is here because "blocking 9 people" reads very differently when the typical
 * gap is 1 member than when it is 400 points. Without it the dashboard would push an
 * upline at whichever condition has the most names under it, which is the padded
 * version of this screen.
 *
 * Counts only, no money (L4). Server-rendered — no JavaScript ships for it.
 */
export default function DropOff({
  rows,
  audienceSize,
}: {
  rows: { type: CriterionType; drop: CriterionDropOff }[];
  audienceSize: number;
}) {
  const ordered = [...rows].sort(
    (a, b) => b.drop.soleBlocker - a.drop.soleBlocker || b.drop.blocked - a.drop.blocked
  );
  const bottleneck = ordered[0]?.drop.soleBlocker > 0 ? ordered[0].type : null;

  return (
    <section className="rounded-2xl bg-surface p-5" data-testid="dropoff">
      <h2 className="font-display text-xl font-bold">What is holding people up</h2>
      <p className="mt-1 text-sm text-text-dim">
        Condition by condition, across everyone this applies to.
      </p>

      <ul className="mt-4 flex flex-col gap-4">
        {ordered.map(({ type, drop }) => {
          const spec = CRITERION_SPECS[type];
          return (
            <li key={type} data-testid={`dropoff-${type}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{spec.title}</span>
                <span className="text-sm text-text-dim tabular-nums">
                  {drop.met} of {audienceSize} done
                </span>
              </div>

              {drop.blocked === 0 ? (
                <p className="mt-1 text-sm text-text-dim">
                  Nobody is short on this one.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-text-dim">
                    {drop.blocked === 1
                      ? "1 coach is short"
                      : `${drop.blocked} coaches are short`}
                    {drop.soleBlocker > 0 && (
                      <>
                        {" · "}
                        <span
                          data-testid={`dropoff-${type}-sole`}
                          className="font-semibold text-text"
                        >
                          {drop.soleBlocker === 1
                            ? "the only thing left for 1 of them"
                            : `the only thing left for ${drop.soleBlocker} of them`}
                        </span>
                      </>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-text-dim">
                    Typical gap: {formatAmount(spec, drop.medianRemaining)}.
                  </p>
                </>
              )}

              {bottleneck === type && (
                <p className="mt-2 text-sm font-semibold text-gold-ink">
                  Move this one and the most people get in.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
