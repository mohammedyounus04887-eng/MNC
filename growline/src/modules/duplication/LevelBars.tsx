import type { LevelResult } from "./score";
import { levelLabel, levelSentence, peopleWord } from "./reading";

/**
 * The breakdown that produced the score. Server-rendered — no JavaScript ships.
 *
 * ## Why this is not optional
 *
 * A duplication score on its own is a number nobody can act on: "41" names no
 * person, no level and no next move. The whole feature is the pair — the number
 * says whether there is a problem, the breakdown says where it is. So this renders
 * beside the score always, including when the score is null, because "two people at
 * level 1, both joined this week" is exactly the explanation a coach with no score
 * needs.
 *
 * ## One accent (G3), and no gems
 *
 * Gold on the bars and nothing else. A green gem on a fully-active level was
 * tempting and is wrong: `.gem` is for money, gains and completed conditions, and a
 * level at 100% this fortnight is a reading that will be different next fortnight,
 * not a thing anybody completed. Two accent colours on a screen whose whole content
 * is one number would also break the 90% rule on the only screen where the number is
 * supposed to be the loudest thing.
 *
 * ## What is never here
 *
 * Names. A level is a count of people and a count is what flows up a line (P1); who
 * specifically has gone quiet is a different disclosure with a different rule, and
 * the coach can already see their team, person by person, on the team tree.
 */
export default function LevelBars({ levels }: { levels: LevelResult[] }) {
  return (
    <ul className="flex flex-col gap-4" data-testid="duplication-levels">
      {levels.map((level) => {
        const pct = Math.round(level.rate * 100);
        const counted = level.people > 0;
        return (
          <li key={level.depth} data-testid={`duplication-level-${level.depth}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{levelLabel(level.depth)}</span>
              <span className="text-sm text-text-dim">{levelSentence(level)}</span>
            </div>

            <div
              className="mt-2 h-2.5 overflow-hidden rounded-full bg-hairline"
              role="progressbar"
              aria-label={`${levelLabel(level.depth)} — people logging`}
              aria-valuenow={counted ? pct : 0}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full rounded-full bg-gold" style={{ width: `${counted ? pct : 0}%` }} />
            </div>

            {/*
              Waiting people are stated, never silently dropped. A coach who brought
              in three people this week should see that the number has not judged
              them yet — otherwise the level looks smaller than their team is and the
              score looks like it ignored their best fortnight.
            */}
            {level.pending > 0 && counted && (
              <p className="mt-1.5 text-sm text-text-dim">
                {level.pending} more {peopleWord(level.pending)} here joined in the last
                week — not counted yet.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
