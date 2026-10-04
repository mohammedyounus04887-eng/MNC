import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { todayKey } from "@/lib/daily-log";
import { todayHeading } from "@/lib/dates";
import Recorder from "@/modules/voice-log/Recorder";
import { getNoteSummary } from "@/modules/voice-log/queries";
import * as copy from "@/modules/voice-log/copy";

/**
 * Say today's work (session 4, feature 1) — a second door onto the daily log.
 *
 * ## A new door, not a new pipe
 *
 * The tap-in log at `/log` is untouched and remains the primary path. This screen ends
 * by calling the same `PUT /api/logs` that screen calls, so there is still exactly one
 * piece of code that writes a `dailyLogs` document. Two doors, one pipe — which is the
 * rule this codebase was rebuilt around.
 *
 * ## Why it is a separate route rather than a tab on the log screen
 *
 * The log screen is the one screen this audience opens every evening, and it already
 * passes the 30-second rule. Putting a recorder inside it would add a decision — tap or
 * speak — to the one interaction that must never acquire one. A coach who wants to
 * speak comes here from the hub; everyone else sees exactly what they saw yesterday.
 */
export default async function VoiceLogPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const today = todayKey();
  const existing = await getNoteSummary(user.id, today);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl font-bold text-text">{copy.TITLE}</h1>
        <p className="mt-1 text-text-dim">{todayHeading()}</p>
        <p className="mt-2 text-text-dim">{copy.SUBTITLE}</p>
      </div>

      {/*
       * A note already recorded today, but never confirmed. Surfaced rather than
       * silently replaced: it is the exact case this whole design exists for — the
       * coach spoke, the signal died, and nothing was counted. Saying so is what stops
       * "I logged it" and "your team saw nothing" from both being true.
       */}
      {existing?.status === "uncounted" && (
        <section className="rounded-2xl bg-elevated p-5" data-testid="voice-pending">
          <h2 className="font-display text-lg font-bold">
            You recorded today, but it was never counted
          </h2>
          <p className="mt-2 text-sm text-text-dim">
            Nothing has gone to your team and your streak has not moved. Record again
            below, or tap the numbers in — either one finishes it.
          </p>
          {existing.transcript && (
            <p className="mt-3 border-l-2 border-hairline pl-3 text-sm text-text-dim">
              &ldquo;{existing.transcript}&rdquo;
            </p>
          )}
        </section>
      )}

      {existing?.status === "counted" && (
        <section className="rounded-2xl bg-elevated p-5" data-testid="voice-done">
          <h2 className="font-display text-lg font-bold">Today is already logged</h2>
          <p className="mt-2 text-sm text-text-dim">
            You said it earlier and the numbers went in. Recording again replaces them.
          </p>
          <Link href="/log" className="mt-3 inline-flex min-h-12 items-center text-text-dim underline">
            See today&apos;s log
          </Link>
        </section>
      )}

      <Recorder dayKey={today} />
    </div>
  );
}
