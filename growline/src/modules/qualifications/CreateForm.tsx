"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { APP_TIMEZONE } from "@/lib/day";
import {
  CRITERION_LIST,
  type Criterion,
  type CriterionType,
} from "./criteria";
import {
  AUDIENCE_HELP,
  AUDIENCE_LABELS,
  AUDIENCES,
  MAX_TITLE,
  checkDefinition,
  type Audience,
} from "./model";

/**
 * Announcing a qualification (F14). The one screen in this module a creator types on.
 *
 * ## Two steps, because of RULES S2
 *
 * Six input fields per screen is the ceiling. Naming it takes three (name, who,
 * closing date) and the conditions take up to five number boxes, so they are two
 * steps rather than one long form. Nothing is lost by splitting: the two halves are
 * different questions — what is this, and what does it take.
 *
 * ## The 30-second rule, honestly applied
 *
 * S1 governs DAILY actions done standing on a road. This is not one: an upline
 * announces a qualification a handful of times a year, sitting down. The 30-second
 * screen in this feature is the tracker, which is a glance and carries no
 * JavaScript at all. What this form owes instead is that nothing here is guessable —
 * every choice states its consequence before it is taken, because there is no edit
 * screen and no unsend.
 *
 * ## No suggestions, ever (RULES L1/L8, D29)
 *
 * The name field has a label and NO placeholder. An example in grey text is a
 * suggestion, and a suggestion is a default with better manners — which is exactly
 * what D29 forbids for anything that could carry a company's rank names. The
 * conditions are the five this app can count, and their titles are ours, not any
 * organisation's vocabulary.
 *
 * ## No money (RULES L4)
 *
 * A creator sets counts. There is no field for what a qualification is worth, no
 * currency anywhere on this screen, and nothing that would let one be typed in.
 */
export default function CreateForm({
  todayKey,
  maxKey,
  directCount,
  allCount,
}: {
  /** Both computed on the server: the client never decides what day it is (E1). */
  todayKey: string;
  maxKey: string;
  directCount: number;
  allCount: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState<Audience>("direct");
  const [deadlineKey, setDeadlineKey] = useState("");
  const [targets, setTargets] = useState<Partial<Record<CriterionType, number>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reachOf = (a: Audience) => (a === "direct" ? directCount : allCount);
  const reach = reachOf(audience);

  const criteria: Criterion[] = CRITERION_LIST.filter(
    (spec) => targets[spec.id] !== undefined
  ).map((spec) => ({ type: spec.id, target: targets[spec.id]! }));

  const toggle = (type: CriterionType, on: boolean) =>
    setTargets((prev) => {
      const next = { ...prev };
      if (on) next[type] = next[type] ?? 1;
      else delete next[type];
      return next;
    });

  const stepOneReady =
    title.trim().length > 0 && deadlineKey !== "" && reach > 0;

  const submit = async () => {
    if (busy) return;
    setError("");
    // The same check the route runs, so a coach is told before they tap rather than
    // after a round trip. The server runs it again because this is one client.
    const checked = checkDefinition(
      { title, criteria, audience, deadlineKey },
      APP_TIMEZONE
    );
    if (!checked.ok) {
      setError(checked.error);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/qualifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, criteria, audience, deadlineKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not create it. Please try again.");
        return;
      }
      router.push(`/qualifications/${data.id}`);
      router.refresh();
    } catch {
      setError("No connection. Nothing has been created.");
    } finally {
      setBusy(false);
    }
  };

  if (step === 1) {
    return (
      <section className="flex flex-col gap-5">
        <div>
          <label htmlFor="qual-title" className="font-medium">
            What is it called?
          </label>
          <input
            id="qual-title"
            data-testid="qual-title"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
            className="mt-2 min-h-12 w-full rounded-xl border border-hairline bg-elevated px-3 py-3 text-base"
          />
          <p className="mt-1 text-sm text-text-dim">
            Your line sees this name. Nothing is suggested — the words are yours.
          </p>
        </div>

        <div>
          <span className="font-medium">Who is it for?</span>
          <div className="mt-2 flex flex-col gap-2">
            {AUDIENCES.map((a) => {
              const active = audience === a;
              const count = reachOf(a);
              return (
                <button
                  key={a}
                  type="button"
                  data-testid={`qual-audience-${a}`}
                  onClick={() => setAudience(a)}
                  aria-pressed={active}
                  className={`min-h-12 rounded-xl border px-4 py-3 text-left ${
                    active ? "border-gold bg-elevated" : "border-hairline"
                  }`}
                >
                  <span className="font-medium">{AUDIENCE_LABELS[a]}</span>
                  <span className="block text-sm text-text-dim">
                    {AUDIENCE_HELP[a]}{" "}
                    {/* The number under each choice turns an abstract decision into
                        a concrete one BEFORE it is irreversible — there is no edit
                        and no unsend, the same reason ThreadComposer does it. */}
                    {count === 0
                      ? "Nobody yet."
                      : count === 1
                        ? "1 coach."
                        : `${count} coaches.`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="qual-deadline" className="font-medium">
            Last day to qualify
          </label>
          <input
            id="qual-deadline"
            data-testid="qual-deadline"
            type="date"
            value={deadlineKey}
            min={todayKey}
            max={maxKey}
            onChange={(e) => setDeadlineKey(e.target.value)}
            className="mt-2 min-h-12 w-full rounded-xl border border-hairline bg-elevated px-3 py-3 text-base"
          />
          <p className="mt-1 text-sm text-text-dim">
            Work done on that day still counts. Counting starts today.
          </p>
        </div>

        {reach === 0 && (
          <p className="rounded-xl border border-hairline px-4 py-3 text-sm text-text-dim">
            Nobody is in your line yet, so this would reach no one. Share your invite
            link first.
          </p>
        )}

        <button
          type="button"
          data-testid="qual-next"
          disabled={!stepOneReady}
          onClick={() => setStep(2)}
          className="neopop metal-gold h-14 w-full text-lg font-semibold disabled:opacity-50"
        >
          Next: the conditions
        </button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-xl font-bold">What does it take?</h2>
        <p className="mt-1 text-sm text-text-dim">
          Pick any combination. Each one needs its own number, and every one of them
          has to be met.
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {CRITERION_LIST.map((spec) => {
          const on = targets[spec.id] !== undefined;
          return (
            <li
              key={spec.id}
              className={`rounded-xl border px-4 py-3 ${
                on ? "border-gold bg-elevated" : "border-hairline"
              }`}
            >
              <button
                type="button"
                data-testid={`qual-criterion-${spec.id}`}
                aria-pressed={on}
                onClick={() => toggle(spec.id, !on)}
                className="min-h-12 w-full text-left"
              >
                <span className="font-medium">{spec.title}</span>
                <span className="block text-sm text-text-dim">{spec.blurb}</span>
              </button>

              {on && (
                <label className="mt-2 flex items-center gap-3">
                  <span className="text-sm text-text-dim">How many?</span>
                  <input
                    data-testid={`qual-target-${spec.id}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={spec.max}
                    value={targets[spec.id]}
                    onChange={(e) =>
                      setTargets((prev) => ({
                        ...prev,
                        [spec.id]: Math.max(
                          0,
                          Math.min(spec.max, Math.floor(Number(e.target.value) || 0))
                        ),
                      }))
                    }
                    className="min-h-12 w-32 rounded-xl border border-hairline bg-bg px-3 py-2 text-base tabular-nums"
                  />
                  <span className="text-sm text-text-dim">{spec.unit.many}</span>
                </label>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p data-testid="qual-error" className="text-sm text-heat">
          {error}
        </p>
      )}

      <button
        type="button"
        data-testid="qual-create"
        disabled={busy || criteria.length === 0}
        onClick={() => void submit()}
        className="neopop metal-gold h-14 w-full text-lg font-semibold disabled:opacity-50"
      >
        {busy ? "Creating…" : "Announce it"}
      </button>

      <button
        type="button"
        onClick={() => setStep(1)}
        className="min-h-12 px-1 py-3 text-left font-medium text-text-dim"
      >
        Back
      </button>
    </section>
  );
}
