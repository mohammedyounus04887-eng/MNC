"use client";

import { useState } from "react";
import {
  BLOCKERS,
  GOAL_STEPS,
  HOURS_OPTIONS,
  MAX_BLOCKER_NOTE,
  MAX_GOAL,
  MAX_NEEDS,
  MAX_WHY,
  completion,
  stepDone,
  type BlockerKey,
  type GoalStepKey,
  type HoursPerDay,
} from "./model";

/**
 * The Goal Sheet, as the coach fills it (A1).
 *
 * ## One step on screen at a time, and every one skippable
 *
 * The whole sheet is eleven fields. Shown at once it is a form nobody finishes, and it
 * would break RULES S2 outright. Shown three at a time it is three thirty-second jobs a
 * coach can do between two conversations, which is the only way this gets filled at all.
 *
 * Skipping is a first-class button, not a hidden escape. A coach who has not worked out
 * their long-term goal yet should move on rather than abandon the sheet, and the meter is
 * honest about what is left — an empty sheet belongs to somebody who has not got to it,
 * not to somebody who failed.
 *
 * ## The private panel is a Trust Zone
 *
 * The personal reason sits below the steps in the calm register RULES G1 requires: flat
 * surface, no gold, no celebration. It is the most exposing thing in the app and the
 * screen that asks for it should feel like a locked drawer, not a game. The sharing
 * switch states in plain words exactly who can see it, and it defaults off.
 */

type Sheet = {
  why: string;
  hoursPerDay: HoursPerDay | null;
  shortTermGoal: string;
  shortTermByKey: string | null;
  longTermGoal: string;
  blockers: BlockerKey[];
  blockerNote: string;
  needs: string;
  needsAmount: number | null;
  shareNeeds: boolean;
};

const FIELDS_BY_STEP: Record<GoalStepKey, (keyof Sheet)[]> = {
  why: ["why", "hoursPerDay"],
  goals: ["shortTermGoal", "shortTermByKey", "longTermGoal"],
  blockers: ["blockers", "blockerNote"],
};

export default function GoalSheetForm({ initial }: { initial: Sheet }) {
  const [sheet, setSheet] = useState<Sheet>(initial);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof Sheet>(key: K, value: Sheet[K]) => {
    setSheet((s) => ({ ...s, [key]: value }));
    setSaved(false);
  };

  const toggleBlocker = (key: BlockerKey) =>
    setSheet((s) => ({
      ...s,
      blockers: s.blockers.includes(key)
        ? s.blockers.filter((b) => b !== key)
        : [...s.blockers, key],
    }));

  const patch = async (keys: (keyof Sheet)[]) => {
    if (busy) return false;
    setError("");
    setBusy(true);
    const body: Record<string, unknown> = {};
    for (const k of keys) body[k] = sheet[k];

    try {
      const res = await fetch("/api/goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save. Please try again.");
        setBusy(false);
        return false;
      }
      setSaved(true);
    } catch {
      setError("No connection. Please try again when you have network.");
      setBusy(false);
      return false;
    }
    setBusy(false);
    return true;
  };

  const current = GOAL_STEPS[step];
  const isLast = step === GOAL_STEPS.length - 1;

  const saveAndAdvance = async () => {
    if (await patch(FIELDS_BY_STEP[current.key])) {
      if (!isLast) setStep(step + 1);
    }
  };

  const meter = completion(sheet);

  return (
    <div className="flex flex-col gap-5">
      {/* Progress across the three steps. Steps, not fields — a coach who did step 1 has
          genuinely made progress and the meter should say so. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-dim">
            {meter.done} of {meter.total} done
          </span>
          <span className="tabular-nums text-text-dim">{meter.pct}%</span>
        </div>
        <div className="flex gap-1.5" aria-hidden="true">
          {GOAL_STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`h-1.5 flex-1 rounded-full ${
                stepDone(sheet, s.key)
                  ? "bg-gold"
                  : i === step
                    ? "bg-text-dim"
                    : "bg-elevated"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl bg-surface p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-dim">
            Step {step + 1} of {GOAL_STEPS.length}
          </p>
          <h2 className="text-xl font-semibold">{current.title}</h2>
        </div>

        {current.key === "why" && (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Why did you start this?</span>
              <textarea
                value={sheet.why}
                onChange={(e) => set("why", e.target.value)}
                maxLength={MAX_WHY}
                rows={4}
                placeholder="In your own words"
                className="w-full rounded-xl border border-hairline bg-elevated px-4 py-3 text-base outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
              />
            </label>

            <fieldset className="flex flex-col gap-2">
              <legend className="font-medium">
                Hours you can give a day{" "}
                <span className="font-normal text-text-dim">(be honest)</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {HOURS_OPTIONS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    aria-pressed={sheet.hoursPerDay === h}
                    onClick={() => set("hoursPerDay", sheet.hoursPerDay === h ? null : h)}
                    className={`h-12 min-w-14 rounded-xl px-4 text-base font-semibold tabular-nums ${
                      sheet.hoursPerDay === h
                        ? "bg-gold text-on-gold"
                        : "border border-hairline bg-elevated text-text"
                    }`}
                  >
                    {h}h
                  </button>
                ))}
              </div>
            </fieldset>
          </>
        )}

        {current.key === "goals" && (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Next 90 days</span>
              <input
                value={sheet.shortTermGoal}
                onChange={(e) => set("shortTermGoal", e.target.value)}
                maxLength={MAX_GOAL}
                placeholder="Something you can finish"
                className="h-12 w-full rounded-xl border border-hairline bg-elevated px-4 text-base outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-medium">
                By when <span className="font-normal text-text-dim">(optional)</span>
              </span>
              <input
                type="date"
                value={sheet.shortTermByKey ?? ""}
                onChange={(e) => set("shortTermByKey", e.target.value || null)}
                className="h-12 w-full rounded-xl border border-hairline bg-elevated px-4 text-base outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-medium">The bigger one</span>
              <input
                value={sheet.longTermGoal}
                onChange={(e) => set("longTermGoal", e.target.value)}
                maxLength={MAX_GOAL}
                placeholder="Where you want to be"
                className="h-12 w-full rounded-xl border border-hairline bg-elevated px-4 text-base outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
              />
            </label>
          </>
        )}

        {current.key === "blockers" && (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="font-medium">Pick what applies</legend>
              <div className="flex flex-col gap-2">
                {BLOCKERS.map((b) => {
                  const on = sheet.blockers.includes(b.key);
                  return (
                    <button
                      key={b.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleBlocker(b.key)}
                      className={`flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-left text-base ${
                        on
                          ? "bg-gold text-on-gold"
                          : "border border-hairline bg-elevated text-text"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded ${
                          on ? "bg-on-gold/20" : "border border-hairline"
                        }`}
                      >
                        {on ? "✓" : ""}
                      </span>
                      {b.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className="flex flex-col gap-1.5">
              <span className="font-medium">
                Anything else <span className="font-normal text-text-dim">(optional)</span>
              </span>
              <input
                value={sheet.blockerNote}
                onChange={(e) => set("blockerNote", e.target.value)}
                maxLength={MAX_BLOCKER_NOTE}
                placeholder="One line"
                className="h-12 w-full rounded-xl border border-hairline bg-elevated px-4 text-base outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
              />
            </label>

            <p className="text-sm text-text-dim">
              Your upline sees this so they can help with it — not to judge you.
            </p>
          </>
        )}

        {error && (
          <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-heat">{error}</p>
        )}
        {saved && !error && (
          <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-gem-green">Saved.</p>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={saveAndAdvance}
            disabled={busy}
            className="h-14 neopop metal-gold text-lg font-semibold text-on-gold disabled:opacity-50"
          >
            {busy ? "Saving…" : isLast ? "Save" : "Save and continue"}
          </button>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep(Math.max(0, step - 1))}
              disabled={step === 0}
              className="h-12 px-2 text-text-dim underline disabled:opacity-30"
            >
              Back
            </button>
            {!isLast && (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                className="h-12 px-2 text-text-dim underline"
              >
                Skip for now
              </button>
            )}
          </div>
        </div>
      </div>

      <PrivatePanel sheet={sheet} set={set} patch={patch} busy={busy} />
    </div>
  );
}

/**
 * The real reason, and who may see it.
 *
 * Trust Zone (G1): flat surface, no gold, no animation, plain words. The switch says what
 * it does in the sentence next to it rather than in a help link, because a privacy control
 * somebody has to go and read about is one they will get wrong.
 */
function PrivatePanel({
  sheet,
  set,
  patch,
  busy,
}: {
  sheet: Sheet;
  set: <K extends keyof Sheet>(key: K, value: Sheet[K]) => void;
  patch: (keys: (keyof Sheet)[]) => Promise<boolean>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-hairline p-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-between gap-3 text-left"
      >
        <span>
          <span className="font-medium">The real reason</span>
          <span className="block text-sm text-text-dim">
            Private. Only you, unless you say otherwise.
          </span>
        </span>
        <span aria-hidden="true" className="text-text-dim">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">What is this really for?</span>
            <textarea
              value={sheet.needs}
              onChange={(e) => set("needs", e.target.value)}
              maxLength={MAX_NEEDS}
              rows={3}
              placeholder="School fees, a loan, a vehicle — whatever it is"
              className="w-full rounded-xl border border-hairline bg-elevated px-4 py-3 text-base outline-none focus:border-info focus:ring-2 focus:ring-info/30"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-medium">
              Amount <span className="font-normal text-text-dim">(optional)</span>
            </span>
            <input
              value={sheet.needsAmount ?? ""}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 9);
                set("needsAmount", digits === "" ? null : Number(digits));
              }}
              inputMode="numeric"
              className="h-12 w-full rounded-xl border border-hairline bg-elevated px-4 text-base tabular-nums outline-none focus:border-info focus:ring-2 focus:ring-info/30"
            />
            {/* Recorded, never calculated with. The app does not turn this into a target,
                a projection or a promise — see the compliance note in model.ts. */}
            <span className="text-sm text-text-dim">
              Just a note to yourself. Growline never turns this into a target or a
              prediction.
            </span>
          </label>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={sheet.shareNeeds}
              onChange={(e) => set("shareNeeds", e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0"
            />
            <span>
              <span className="font-medium">Let my upline read this</span>
              <span className="block text-sm text-text-dim">
                Off means only you can see it. Your goals, hours and blockers are shared
                with your direct upline either way — this switch covers this box only.
              </span>
            </span>
          </label>

          <button
            type="button"
            onClick={() => patch(["needs", "needsAmount", "shareNeeds"])}
            disabled={busy}
            className="h-12 rounded-xl border border-hairline text-base font-medium text-text disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save this part"}
          </button>
        </div>
      )}
    </div>
  );
}
