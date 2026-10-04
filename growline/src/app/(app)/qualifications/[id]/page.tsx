import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { APP_TIMEZONE } from "@/lib/day";
import { relativeTime } from "@/lib/threads";
import { dayLabel } from "@/modules/shared-new/window";
import { AUDIENCE_LABELS } from "@/modules/qualifications/model";
import {
  getQualificationFor,
  type CreatorView,
  type ParticipantView,
} from "@/modules/qualifications/queries";
import CriteriaProgress from "@/modules/qualifications/CriteriaProgress";
import DropOff from "@/modules/qualifications/DropOff";
import QualifiedBadge from "@/modules/qualifications/QualifiedBadge";

/**
 * One qualification (F14) — the live tracker, or the creator's dashboard.
 *
 * ## One route, two views
 *
 * Which one you get is decided by who you are, not by the URL. A creator is never in
 * their own audience (a qualification runs DOWN a line), so the two seats never
 * overlap and a second route would only be a second thing to remember. A coach who is
 * neither gets `notFound()` — the same answer as a qualification that does not exist,
 * so this page cannot be used to discover what an upline in another line is running.
 *
 * ## What a participant is shown about other people
 *
 * The names of everyone who has QUALIFIED, and a COUNT of how many are one condition
 * away. Never that second group by name: being in is good news and an event list is
 * public by nature, but being nearly-in is somebody's shortfall, and publishing a
 * named list of shortfalls to their peers is the leaderboard leak N2 exists to
 * prevent. The creator does see those names, because they are the person who calls
 * them — and because every one of them is already in their own team tree.
 *
 * Server-rendered. The only JavaScript on this page is the badge, and only once a
 * coach has qualified.
 */

function Header({
  view,
}: {
  view: ParticipantView | CreatorView;
}) {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold text-text">{view.title}</h1>
      <p className="mt-1 text-text-dim">
        {view.role === "creator"
          ? `You set this · ${AUDIENCE_LABELS[view.audience].toLowerCase()}`
          : `Set by ${view.creatorName}`}
      </p>
      <p className="mt-1 text-text-dim">
        {view.open ? (
          <>
            <span
              data-testid="days-left"
              className={view.daysLeft <= 3 ? "font-semibold text-gold-ink" : ""}
            >
              {view.daysLeft <= 1 ? "Last day" : `${view.daysLeft} days left`}
            </span>{" "}
            · closes {dayLabel(view.window.toKey)}
          </>
        ) : (
          <>Closed {dayLabel(view.window.toKey)}</>
        )}
      </p>
    </div>
  );
}

function UpdatedAt({ at }: { at: Date | null }) {
  if (!at) return null;
  // A stale figure says it is stale rather than presenting itself as this minute's.
  return <p className="text-xs text-text-dim">Counted {relativeTime(at)}.</p>;
}

function Participant({ view, name }: { view: ParticipantView; name: string }) {
  // Read off the reader's OWN row rather than found by name in the public list: two
  // coaches in one line can share a first name, and the list is capped anyway.
  const qualifiedOn = view.qualifiedAt;

  return (
    <div className="flex flex-col gap-5">
      <Header view={view} />

      {view.standing.qualified ? (
        <QualifiedBadge
          qualificationId={view.id}
          title={view.title}
          coachName={name}
          qualifiedOn={
            qualifiedOn
              ? qualifiedOn.toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: APP_TIMEZONE,
                })
              : null
          }
        />
      ) : (
        <section className="rounded-2xl bg-surface p-5" data-testid="nudge">
          <p className="font-display text-xl font-bold">{view.nudge.headline}</p>
          {view.nudge.hint && (
            <p className="mt-1 text-sm text-text-dim">{view.nudge.hint}</p>
          )}
        </section>
      )}

      <section className="rounded-2xl bg-surface p-5">
        <h2 className="font-semibold">Where you are</h2>
        <p className="mt-1 mb-4 text-sm text-text-dim">
          {view.standing.metCount} of {view.standing.states.length} conditions met.
          Every one of them has to be met.
        </p>
        <CriteriaProgress states={view.standing.states} />
      </section>

      <section className="rounded-2xl bg-surface p-5" data-testid="qualifier-list">
        <h2 className="font-semibold">Who is in</h2>
        {view.qualifiedCount === 0 ? (
          /* Zero data teaches rather than rendering an empty box. */
          <p className="mt-1 text-sm text-text-dim">
            Nobody yet. The first names appear here as soon as somebody meets every
            condition.
          </p>
        ) : (
          <>
            <p className="numeral mt-2 text-4xl text-text">{view.qualifiedCount}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {view.qualified.map((q) => (
                <li key={q.userId} className="gem px-3 py-1 text-sm font-medium">
                  {q.name}
                </li>
              ))}
            </ul>
            {view.qualifiedCount > view.qualified.length && (
              <p className="mt-2 text-sm text-text-dim">
                and {view.qualifiedCount - view.qualified.length} more.
              </p>
            )}
          </>
        )}

        {/*
          A COUNT, deliberately, and never the names. Nearly-in is somebody's
          shortfall and it is not this screen's to publish to their peers.
        */}
        {view.oneStepCount > 0 && (
          <p className="mt-4 text-sm text-text-dim" data-testid="one-step-count">
            {view.oneStepCount === 1
              ? "1 coach has one condition left."
              : `${view.oneStepCount} coaches have one condition left.`}
          </p>
        )}
      </section>

      <UpdatedAt at={view.evaluatedAt} />
    </div>
  );
}

function Creator({ view }: { view: CreatorView }) {
  return (
    <div className="flex flex-col gap-5">
      <Header view={view} />

      <section className="rounded-2xl bg-surface p-5">
        <dl className="grid grid-cols-3 gap-3">
          <div>
            <dd className="numeral text-3xl text-text" data-testid="creator-qualified">
              {view.qualifiedCount}
            </dd>
            <dt className="mt-0.5 text-sm text-text-dim">in</dt>
          </div>
          <div>
            <dd className="numeral text-3xl text-text" data-testid="creator-onestep">
              {view.oneStepCount}
            </dd>
            <dt className="mt-0.5 text-sm text-text-dim">one condition left</dt>
          </div>
          <div>
            <dd className="numeral text-3xl text-text">{view.audienceSize}</dd>
            <dt className="mt-0.5 text-sm text-text-dim">
              {view.audience === "direct" ? "in your direct line" : "in your line"}
            </dt>
          </div>
        </dl>
      </section>

      {view.audienceSize === 0 ? (
        <p className="rounded-2xl bg-surface p-5 text-sm text-text-dim">
          Nobody is in this yet. As coaches join your line they are added
          automatically, and their tracker starts from the day they arrive.
        </p>
      ) : (
        <DropOff rows={view.dropOff} audienceSize={view.audienceSize} />
      )}

      <section className="rounded-2xl bg-surface p-5">
        <h2 className="font-semibold">One condition away</h2>
        {view.close.length === 0 ? (
          <p className="mt-1 text-sm text-text-dim">
            Nobody is one condition away yet. When somebody is, they appear here with
            exactly what is left.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2" data-testid="close-list">
            {view.close.map((c) => (
              <li
                key={c.userId}
                className="flex items-baseline justify-between gap-3 rounded-xl bg-elevated px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                {/* The gap always travels with the label — "one away" without a
                    number is the padded version of this list. */}
                <span className="shrink-0 text-sm text-text-dim">{c.remaining}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-surface p-5">
        <h2 className="font-semibold">Who is in</h2>
        {view.qualified.length === 0 ? (
          <p className="mt-1 text-sm text-text-dim">
            Nobody yet. Names appear the moment somebody meets every condition.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {view.qualified.map((q) => (
              <li key={q.userId} className="gem px-3 py-1 text-sm font-medium">
                {q.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-text-dim">
        Counts only. Nothing here shows anyone&apos;s prospects — the people your line
        meets are counted, never named.
      </p>
      <UpdatedAt at={view.evaluatedAt} />
    </div>
  );
}

export default async function QualificationPage({
  params,
}: {
  // Next 16: params is async (AGENTS.md, D4).
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const view = await getQualificationFor(id, user);
  if (!view) notFound();

  return (
    <div className="flex flex-col gap-5">
      {view.role === "creator" ? (
        <Creator view={view} />
      ) : (
        <Participant view={view} name={user.name} />
      )}

      <Link
        href="/qualifications"
        className="min-h-12 px-1 py-3 font-medium text-text-dim"
      >
        All qualifications
      </Link>
    </div>
  );
}
