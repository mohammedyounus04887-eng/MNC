import Link from "next/link";
import MiniRing from "./MiniRing";

/**
 * Today's Mission (v2 §4, dopamine map #3) — the first thing on app open, and what
 * v2 calls "the recommendation engine of v2". Three items at most, each generated
 * from the coach's own data, each one tap from the action.
 *
 * ## A conflict in the spec, resolved toward the hard rule
 *
 * v2 §4's example copy for this card reads:
 *
 *     "🎯 ₹-equivalent: 400 VP to cross 75%"
 *
 * That breaks v1 §5.3 and D30 — no income promises, and a target is a count of
 * points with no currency, conversion or projection. RULES L4 is a legal line, and
 * an illustrative example in a design section does not outrank it. So the item
 * says points and stops. See DECISIONS.md D40.
 *
 * ## Why three, and why in this order
 *
 * The order is fixed by what is closest to being lost: the streak resets at
 * midnight, a follow-up is already someone waiting, the target has all month. One
 * item is not a list; four is a to-do app.
 *
 * ## Why only some items carry an arc
 *
 * The delight plan asks for "each item a depleting arc". An arc is only honest
 * where there is a real denominator, and there is exactly one: the target, whose
 * next mark is a fixed number of points the coach is walking towards. That row
 * gets a ring that empties as points come in.
 *
 * The follow-up row does NOT get one, deliberately. A "3 of 6 done today" arc
 * needs a count of follow-ups COMPLETED today, and nothing in the data layer
 * records that — completing one simply moves `nextFollowupAt` forward and it
 * leaves the due set. The available shortcut was to bank the morning's count in
 * localStorage and treat it as the denominator, and it was rejected: a coach who
 * reschedules two people would watch the arc jump backwards for reasons the app
 * could not explain. A number a coach cannot trust is worse than no picture, on
 * the one screen whose whole job is to be believed. What the row gets instead is
 * the overdue split, which IS known, and which changes what they do first.
 *
 * The honest version of the arc needs a `followupsCompletedAt` write on stage and
 * date changes. That is a data-layer task, not a delight one.
 *
 * The streak row gets no arc either: its question is "did you log today", which is
 * yes or no. A ring counting towards the next milestone would answer a question
 * the row is not asking.
 */

export type Mission = {
  key: string;
  icon: string;
  text: string;
  href: string;
  /** A second line, only where it changes what the coach does first. */
  hint?: string;
  /** Drawn as a depleting ring. Only set where a real denominator exists. */
  progress?: { done: number; total: number };
};

export function buildMissions(input: {
  streak: number;
  loggedToday: boolean;
  followupsDue: number;
  /** How many of `followupsDue` are from earlier days. */
  followupsOverdue?: number;
  targetPoints: number | null;
  progressPoints: number | null;
}): Mission[] {
  const missions: Mission[] = [];

  // 1. The streak, because it is the only one with a deadline tonight.
  if (!input.loggedToday) {
    missions.push({
      key: "log",
      icon: "🔥",
      text:
        input.streak > 0
          ? `Log today to keep your ${input.streak}-day streak`
          : "Log today's work — takes 30 seconds",
      href: "/log",
    });
  }

  // 2. Follow-ups, because each one is a person already waiting.
  if (input.followupsDue > 0) {
    const late = input.followupsOverdue ?? 0;
    missions.push({
      key: "followups",
      icon: "📞",
      text: `${input.followupsDue} follow-up${input.followupsDue === 1 ? "" : "s"} waiting`,
      // Named rather than folded into the total, for the same reason
      // followupCounts separates them: a list where some people have been waiting
      // since last week is not the same list, and the coach should open it
      // knowing that. Silent when nothing is late — a zero is not news.
      hint:
        late > 0
          ? `${late} from earlier day${late === 1 ? "" : "s"} — start there`
          : undefined,
      href: "/prospects?due=1",
    });
  }

  // 3. The target. Points only — no rupee figure, no conversion (D40).
  if (input.targetPoints && input.progressPoints !== null) {
    const pct = Math.round((input.progressPoints / input.targetPoints) * 100);
    const nextMark = [25, 50, 75, 100].find((m) => pct < m);
    if (nextMark) {
      const markPoints = Math.ceil((nextMark / 100) * input.targetPoints);
      const needed = markPoints - input.progressPoints;
      missions.push({
        key: "target",
        icon: "🎯",
        text: `${needed.toLocaleString("en-IN")} points to cross ${nextMark}%`,
        // The arc runs to the NEXT MARK, not to the month's target — it is the
        // distance the row is actually talking about, and a ring that visibly
        // closes this week beats one that barely moves all month.
        progress: { done: input.progressPoints, total: markPoints },
        href: "/targets",
      });
    }
  }

  return missions.slice(0, 3);
}

export default function TodaysMission({ missions }: { missions: Mission[] }) {
  if (missions.length === 0) {
    return (
      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <h2 className="font-display text-lg font-semibold text-text">
          Nothing waiting
        </h2>
        <p className="mt-1 text-sm text-text-dim">
          Logged, followed up, on target. Go and meet someone new.
        </p>
        <Link
          href="/prospects/new"
          className="neopop metal-gold mt-4 inline-flex h-12 items-center px-5 font-semibold"
        >
          Add a new person
        </Link>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-hairline bg-surface p-5"
      data-testid="todays-mission"
    >
      <h2 className="font-display text-lg font-semibold text-text">Today&apos;s Mission</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {missions.map((m, i) => (
          <li key={m.key}>
            <Link
              href={m.href}
              data-testid={`mission-${m.key}`}
              // 48px minimum tap target (v1 §9), one tap to the action.
              // Staggered so the three items land one after another rather than
              // all at once — the card assembles itself, which is what makes a
              // list read as arriving. 45ms apart: perceptible, still well inside
              // G5's budget for the whole sequence.
              style={{ animationDelay: `${i * 45}ms` }}
              className="animate-rise flex min-h-12 items-center gap-3 rounded-xl bg-elevated px-4 py-3 text-text"
            >
              <span aria-hidden className="text-xl leading-none">
                {m.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{m.text}</span>
                {m.hint ? (
                  <span className="block text-xs text-text-dim">{m.hint}</span>
                ) : null}
              </span>
              {m.progress ? (
                <MiniRing
                  progress={m.progress.done}
                  target={m.progress.total}
                  size={26}
                  stroke={3}
                  testId={`mission-ring-${m.key}`}
                />
              ) : null}
              <span aria-hidden className="text-text-dim">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
