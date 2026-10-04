import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { relativeTime } from "@/lib/threads";
import { dayLabel } from "@/modules/shared-new/window";
import LevelBars from "@/modules/duplication/LevelBars";
import ScoreNumber from "@/modules/duplication/ScoreNumber";
import { getDuplicationFor, hasLine } from "@/modules/duplication/queries";
import {
  WHAT_IT_IS_NOT,
  WHAT_IT_MEANS,
  WHY_THE_BARS_DIFFER,
  anyoneActive,
  nextLevelCopy,
  noScoreCopy,
  readingOf,
  whereItStops,
} from "@/modules/duplication/reading";

/**
 * Duplication (F20).
 *
 * One number answering one question — is the work happening only at the top, or
 * genuinely three levels deep — and directly beneath it the per-level breakdown that
 * produced it. The pair is the feature: the number says whether there is a problem
 * and the breakdown says which level to ring tonight.
 *
 * ## A glance, not an interaction
 *
 * Nothing on this screen is operable. There is no filter, no switcher and no button,
 * so it ships no JavaScript beyond the count-up, loads in one server render, and
 * passes the 30-second rule by having nothing to operate (the boards screen makes
 * the same argument for the same reason).
 *
 * ## Zero data teaches, three different ways
 *
 * The three empty states are genuinely different and are worded as such: a coach
 * with no line has not started, a coach whose line all joined this week is waiting
 * for evidence, and a coach whose reading has never been computed is looking at a
 * scheduler that has not run. None of the three renders a zero — a zero is a verdict
 * on a line, and in all three cases there is no line to pass a verdict on yet.
 *
 * ## No money (L4)
 *
 * Counts of people and counts of days. Nothing on this page multiplies, converts,
 * projects or says "at this rate" — a duplication score beside a trajectory is an
 * income promise with the arithmetic left to the reader.
 */

function Teach({ headline, body }: { headline: string; body: string }) {
  return (
    <section
      className="rounded-2xl bg-surface p-5"
      data-testid="duplication-empty"
    >
      <h2 className="font-display text-xl font-bold">{headline}</h2>
      <p className="mt-2 text-text-dim">{body}</p>
    </section>
  );
}

export default async function DuplicationPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const view = await getDuplicationFor(user);

  const header = (
    <div>
      <h1 className="font-display text-3xl font-bold text-text">Duplication</h1>
      <p className="mt-1 text-text-dim">
        Is the work happening only at the top, or all the way down your line?
      </p>
    </div>
  );

  // Nothing has ever been computed for this coach.
  if (!view) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        {hasLine(user) ? (
          <Teach
            headline="Nothing has been counted yet."
            body={
              "This is worked out on a schedule rather than when you open the screen — " +
              "counting a whole line on every page open would make the app slow on the " +
              "phones it has to run on. Your first reading appears after the next run."
            }
          />
        ) : (
          <Teach {...noScoreCopy("noLine")} />
        )}
        <p className="text-sm text-text-dim">{WHAT_IT_MEANS}</p>
      </div>
    );
  }

  const windowLine = `Counted over the ${view.windowDays} days to ${dayLabel(view.toKey)}.`;
  const built = view.generatedAt ? `Worked out ${relativeTime(view.generatedAt)}.` : null;

  // There are people, but nobody has been here long enough to be counted.
  if (view.score === null) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <Teach {...noScoreCopy(view.reason)} />
        {view.levels.length > 0 && (
          <section className="rounded-2xl bg-surface p-5">
            <LevelBars levels={view.levels} />
          </section>
        )}
        <p className="text-sm text-text-dim">{WHAT_IT_MEANS}</p>
        <p className="text-xs text-text-dim">
          {windowLine} {built}
        </p>
      </div>
    );
  }

  // The headline's "nobody logged" band is driven by the LEVELS, not by the rounded
  // score — a big, nearly-dormant line rounds to 0 with people still logging, and the
  // headline would then contradict the bars printed directly beneath it.
  const reading = readingOf(view.score, anyoneActive(view.levels));
  const stop = whereItStops(view.levels);
  const next = nextLevelCopy(view.deepestLevel);

  return (
    <div className="flex flex-col gap-5">
      {header}

      <section className="rounded-2xl bg-surface p-5" data-testid="duplication-card">
        <ScoreNumber score={view.score} />
        <p className="mt-3 text-text" data-testid="duplication-reading">
          {reading.headline}
        </p>
        <p className="mt-1 text-sm text-text-dim">
          {view.lineSize} {view.lineSize === 1 ? "person" : "people"} counted, across{" "}
          {view.deepestLevel} {view.deepestLevel === 1 ? "level" : "levels"}.
        </p>
      </section>

      {/* The breakdown is not a detail view — a score with no breakdown is a number
          nobody can act on, so it sits directly under the number, never behind a tap. */}
      <section className="rounded-2xl bg-surface p-5">
        <h2 className="font-display text-xl font-bold">Level by level</h2>
        <p className="mt-1 mb-4 text-sm text-text-dim">
          Deeper levels count for more. Work three levels down is work you are not
          doing yourself.
        </p>
        <LevelBars levels={view.levels} />
        {/* The bars show each level's plain share; the number above is built from the
            shrunk share. On a small line those differ, and an unexplained gap between
            the number and the picture under it is how a coach decides the screen is
            wrong — so it is stated rather than left to be discovered. */}
        <p className="mt-4 text-sm text-text-dim" data-testid="duplication-why-bars">
          {WHY_THE_BARS_DIFFER}
        </p>
      </section>

      {stop && (
        <section className="rounded-2xl border border-hairline p-5" data-testid="duplication-stop">
          <h2 className="font-display text-lg font-bold">Where to look</h2>
          <p className="mt-1 text-text-dim">{stop.sentence}</p>
        </section>
      )}

      {next && (
        <p className="text-sm text-text-dim" data-testid="duplication-next-level">
          {next}
        </p>
      )}

      {/*
        Stated plainly, because it is the most common misreading of this screen: a
        coach who logs every single day and whose line does nothing scores zero, and
        that is correct. Their own effort belongs to the streak and the boards.
      */}
      <section className="rounded-2xl border border-hairline p-5">
        <h2 className="font-display text-lg font-bold">Your own logging</h2>
        <p className="mt-1 text-text-dim">
          You logged {view.own.daysLogged}{" "}
          {view.own.daysLogged === 1 ? "day" : "days"} of the last {view.windowDays}.
          This is not part of the number above — that one is only about the people
          below you.
        </p>
      </section>

      <p className="text-sm text-text-dim">{WHAT_IT_MEANS}</p>
      <p className="text-xs text-text-dim">
        {WHAT_IT_IS_NOT} {windowLine} {built}
      </p>
    </div>
  );
}
