import { formatAmount } from "./criteria";
import type { CriterionState } from "./progress";

/**
 * One coach's conditions, one row each. Server-rendered — no JavaScript ships for it.
 *
 * ## One accent (G3)
 *
 * Gold on the bars, and a green gem chip on a condition that is DONE — the brief's
 * own rule for `.gem`, and it is a state mark rather than a second brand colour: it
 * appears only on cleared rows and disappears from a screen where nothing is cleared.
 * Everything else is surface and dimmed text.
 *
 * ## What a row must always carry
 *
 * The gap, in the criterion's own words. This module says "one step away" in several
 * places, and a coach with four conditions met and zero of two thousand points is one
 * step away by that definition and is not close. The number is what stops the label
 * being a lie, so it is rendered beside every unmet row — see progress.ts.
 *
 * ## No money (RULES L4)
 *
 * Counts and units from the registry. Nothing here multiplies, converts, or projects.
 */
export default function CriteriaProgress({ states }: { states: CriterionState[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {states.map((s) => {
        const pct = Math.round(s.fraction * 100);
        return (
          <li key={s.spec.id} data-testid={`criterion-${s.spec.id}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{s.spec.title}</span>
              {s.met ? (
                <span className="gem px-2.5 py-0.5 text-xs font-semibold">Done</span>
              ) : (
                <span
                  data-testid={`criterion-${s.spec.id}-remaining`}
                  className="text-sm text-text-dim"
                >
                  {s.spec.remaining(s.remaining)}
                </span>
              )}
            </div>

            <div className="mt-1 flex items-baseline gap-2">
              <span className="numeral text-2xl text-text">
                {s.done.toLocaleString("en-IN")}
              </span>
              <span className="text-sm text-text-dim">
                of {formatAmount(s.spec, s.target)}
              </span>
            </div>

            <div
              className="mt-2 h-2.5 overflow-hidden rounded-full bg-hairline"
              role="progressbar"
              aria-label={s.spec.title}
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`h-full rounded-full ${s.met ? "bg-gem-green" : "bg-gold"}`}
                style={{ width: `${pct}%` }}
              />
            </div>

            {/*
              An unchecked figure is shown dimmed and never added to the bar (N4).
              A coach sitting on claimed points is not behind on the work, and a
              tracker that showed zero with no explanation would read as the app
              having lost it.
            */}
            {s.unchecked > 0 && (
              <p className="mt-1.5 text-sm text-text-dim">
                {formatAmount(s.spec, s.unchecked)} of yours are waiting to be checked.
              </p>
            )}
            {!s.met && s.unchecked === 0 && (
              <p className="mt-1.5 text-sm text-text-dim">{s.spec.source}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
