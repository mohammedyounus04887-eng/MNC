import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { EmptyState } from "@/components/EmptyState";
import { TeamIcon } from "@/components/icons";
import { relativeTime } from "@/lib/threads";
import { dayLabel } from "@/modules/shared-new/window";
import { STALE_AFTER_MS } from "@/modules/qualifications/evaluate";
import { listForCoach, type ListedQualification } from "@/modules/qualifications/queries";

/**
 * Qualifications (F14) — everything this coach is in, and everything they run.
 *
 * ## Both halves on one screen
 *
 * Most coaches are simultaneously somebody's downline and somebody's upline, which is
 * the reason Targets and Threads each put both sides together, and the reason this
 * does too. Splitting them would mean two screens to do one round of evening work.
 *
 * Server-rendered, no JavaScript: a card is a glance, and the 30-second rule is
 * satisfied by there being nothing to operate.
 *
 * ## Zero data teaches
 *
 * A coach with nothing here is the normal first-day state, not an error, and the
 * empty state says what a qualification IS — because the word arrives from an upline
 * who has not explained it yet.
 */

function daysLabel(daysLeft: number, open: boolean): string {
  if (!open) return "Closed";
  if (daysLeft <= 1) return "Last day";
  return `${daysLeft} days left`;
}

/**
 * How old this card's standing is, or null while it is fresh enough to state plainly.
 *
 * Silent inside the app's own staleness window (`STALE_AFTER_MS`) so the normal case
 * carries no chrome, and explicit outside it. The threshold is imported rather than
 * retyped: the number that decides whether the detail page recomputes is the same
 * number that decides whether this card admits it has not.
 */
function staleNote(countedAt: Date | null, now = new Date()): string | null {
  if (!countedAt) return "Not counted yet — open to work it out.";
  if (now.getTime() - countedAt.getTime() < STALE_AFTER_MS) return null;
  return `Counted ${relativeTime(countedAt, now)} — open to refresh.`;
}

function Card({ q }: { q: ListedQualification }) {
  const total = q.criteria.length;
  return (
    <li>
      <Link
        href={`/qualifications/${q.id}`}
        data-testid={`qualification-${q.id}`}
        className="block rounded-2xl bg-surface p-5 transition-transform duration-150 active:translate-y-px"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-xl font-bold">{q.title}</span>
          <span
            className={`shrink-0 text-sm ${
              q.open && q.daysLeft <= 3 ? "font-semibold text-gold-ink" : "text-text-dim"
            }`}
          >
            {daysLabel(q.daysLeft, q.open)}
          </span>
        </div>

        <p className="mt-1 text-sm text-text-dim">
          {q.role === "creator"
            ? `You set this · closes ${dayLabel(q.window.toKey)}`
            : `${q.creatorName} · closes ${dayLabel(q.window.toKey)}`}
        </p>

        {q.standing && (
          <>
            <p className="mt-3 text-sm">
              <span className="font-semibold">
                {q.standing.metCount} of {total} conditions met
              </span>
              {/* The gap always travels with the standing — see progress.ts. */}
              {q.nudge && <span className="text-text-dim"> · {q.nudge.headline}</span>}
            </p>
            {/*
              A card does not refresh its own numbers — one list must not cost one
              whole-line read per row (N21a) — so a figure that has aged past the
              app's own staleness window says how old it is instead of presenting
              itself as this minute's. Opening the card refreshes it.
            */}
            {staleNote(q.countedAt) && (
              <p className="mt-1 text-xs text-text-dim" data-testid="counted-at">
                {staleNote(q.countedAt)}
              </p>
            )}
          </>
        )}
      </Link>
    </li>
  );
}

export default async function QualificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const all = await listForCoach(user);
  const mine = all.filter((q) => q.role === "participant");
  const run = all.filter((q) => q.role === "creator");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl font-bold text-text">Qualifications</h1>
        <p className="mt-1 text-text-dim">
          Conditions your upline set, with a closing date.
        </p>
      </div>

      {mine.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">What you are in</h2>
          <ul className="flex flex-col gap-3">
            {mine.map((q) => (
              <Card key={q.id} q={q} />
            ))}
          </ul>
        </section>
      )}

      {run.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">What you set</h2>
          <ul className="flex flex-col gap-3">
            {run.map((q) => (
              <Card key={q.id} q={q} />
            ))}
          </ul>
        </section>
      )}

      {all.length === 0 && (
        <EmptyState
          icon={<TeamIcon className="h-7 w-7" />}
          title="Nothing to qualify for yet"
          body={
            user.directDownlineCount > 0
              ? "A qualification is a few conditions and a closing date — meet them all and you are in. Set one for your line, or wait for your upline to."
              : "A qualification is a few conditions and a closing date — meet them all and you are in. One from your upline will appear here."
          }
        />
      )}

      {/* Always offered: a coach with no line yet is told why it would reach nobody
          on the form itself, rather than finding a link missing and wondering. */}
      <Link
        href="/qualifications/new"
        data-testid="qualification-new"
        className="neopop metal-gold flex h-14 w-full items-center justify-center text-lg font-semibold"
      >
        Set one for my line
      </Link>
    </div>
  );
}
