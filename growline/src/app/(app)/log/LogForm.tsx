"use client";

import { celebrate } from "@/lib/celebrate";
import CountUp from "@/components/CountUp";
import { haptic, HAPTIC } from "@/lib/haptic";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  EMPTY_LOG,
  LOG_FIELDS,
  MAX_COUNT,
  MAX_NOTE,
  milestoneMessage,
  totalActivity,
  type DailyLogValues,
  type LogFieldKey,
} from "@/lib/daily-log";
import { queueDailyLog, isQueueSupported } from "@/lib/offline-queue";
import { QUEUE_CHANGED } from "@/components/OfflineSync";

/**
 * The evening log (F6). Steppers rather than a keyboard: the numbers are small, the
 * coach is often standing, and tapping + four times beats opening a numeric keypad.
 * The middle value is still typable for the odd large count.
 */
export default function LogForm({
  dayKey,
  initial,
  alreadyLogged,
  initialStreak,
}: {
  dayKey: string;
  initial: DailyLogValues;
  alreadyLogged: boolean;
  initialStreak: number;
}) {
  const router = useRouter();
  const [values, setValues] = useState<DailyLogValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<"none" | "online" | "queued">("none");
  const [streak, setStreak] = useState(initialStreak);
  const [milestone, setMilestone] = useState<number | null>(null);

  const bump = (key: LogFieldKey, delta: number) =>
    setValues((v) => ({
      ...v,
      [key]: Math.min(MAX_COUNT, Math.max(0, (v[key] || 0) + delta)),
    }));

  const setExact = (key: LogFieldKey, raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 3);
    setValues((v) => ({ ...v, [key]: digits === "" ? 0 : Number(digits) }));
  };

  const save = async () => {
    if (busy) return;
    setError("");
    setBusy(true);

    const payload = { dayKey, ...values };

    const keepOnPhone = async () => {
      if (!isQueueSupported()) {
        setError("No connection. Please try again when you have network.");
        return;
      }
      try {
        await queueDailyLog({ ...payload, savedAt: Date.now() });
        window.dispatchEvent(new Event(QUEUE_CHANGED));
        setSaved("queued");
        // The one place a buzz carries real information: on a weak signal there is
        // no server round-trip to confirm anything, and the coach is looking at the
        // road, not the screen.
        haptic(HAPTIC.confirm);
      } catch {
        setError("Could not save on this phone. Please try again.");
      }
    };

    // Known-offline: don't wait on a request that cannot land (same reasoning as
    // prospect capture).
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await keepOnPhone();
      setBusy(false);
      return;
    }

    try {
      const res = await fetch("/api/logs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        setStreak(data.streak ?? streak);
        setMilestone(data.milestone ?? null);
        setSaved("online");
        // A landmark gets the engine (confetti + the three-pulse haptic it fires
        // itself); an ordinary day gets one tick and nothing else. Scarcity IS the
        // mechanic — if every save threw confetti, day 30 would feel like nothing
        // by week two (G6).
        if (data.milestone) celebrate();
        else haptic(HAPTIC.confirm);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save. Please try again.");
      }
    } catch {
      await keepOnPhone();
    }
    setBusy(false);
  };

  const total = totalActivity(values);

  return (
    <div className="flex flex-col gap-4">
      <StreakBanner streak={streak} milestone={milestone} />

      {saved === "queued" && (
        <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-gold-ink">
          Saved on this phone. It will upload by itself when you have network.
        </p>
      )}
      {saved === "online" && !milestone && (
        <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-gem-green">
          Today is logged. Your line can see it.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {LOG_FIELDS.map((field) => (
          <div
            key={field.key}
            className="flex items-center gap-3 rounded-2xl bg-surface p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{field.label}</p>
              <p className="text-xs text-text-dim">{field.hint}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                aria-label={`One less ${field.label}`}
                onClick={() => bump(field.key, -1)}
                disabled={values[field.key] === 0}
                className="h-12 w-12 rounded-xl border border-hairline text-2xl leading-none text-text disabled:opacity-30"
              >
                −
              </button>
              <label className="sr-only" htmlFor={`log-${field.key}`}>
                {field.label}
              </label>
              <input
                id={`log-${field.key}`}
                value={values[field.key]}
                onChange={(e) => setExact(field.key, e.target.value)}
                inputMode="numeric"
                className="h-12 w-14 rounded-xl border border-hairline bg-elevated text-center text-xl font-bold tabular-nums outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
              />
              <button
                type="button"
                aria-label={`One more ${field.label}`}
                onClick={() => bump(field.key, 1)}
                className="h-12 w-12 rounded-xl bg-elevated text-2xl leading-none text-text"
              >
                +
              </button>
            </div>
          </div>
        ))}

        <label className="flex flex-col gap-1.5">
          <span className="font-medium">
            Note <span className="font-normal text-text-dim">(optional)</span>
          </span>
          <input
            value={values.note ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))}
            maxLength={MAX_NOTE}
            placeholder="One line about today"
            className="h-12 w-full rounded-xl border border-hairline bg-elevated px-4 text-base outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
          />
        </label>
      </div>

      {error && (
        <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-heat">{error}</p>
      )}

      <button
        onClick={save}
        disabled={busy}
        className="h-14 neopop metal-gold text-lg font-semibold text-on-gold disabled:opacity-50"
      >
        {busy
          ? "Saving…"
          : alreadyLogged || saved !== "none"
            ? "Update today"
            : "Save today"}
      </button>

      <button
        type="button"
        onClick={() => setValues({ ...EMPTY_LOG, note: values.note })}
        className="h-12 rounded-xl text-text-dim underline"
      >
        Clear the numbers
      </button>

      <p className="text-center text-sm text-text-dim">
        {total === 0
          ? "A zero day is still worth logging — it keeps your streak honest."
          : `${total} things done today.`}
      </p>
    </div>
  );
}

/**
 * Streak and milestone. Celebration is a colour change and one short line — Section
 * 4.8 asks for recognition, Section 4.4 rules out anything heavy on a cheap phone.
 */
function StreakBanner({
  streak,
  milestone,
}: {
  streak: number;
  milestone: number | null;
}) {
  if (milestone) {
    /*
     * The milestone banner, in the palette's reserved rare-delight accent.
     *
     * `gem gem-pink` is defined in globals.css for exactly this and was used
     * nowhere: v2 §4 reserves pink for "milestone surprises only, never routine
     * UI", and a day-30 streak is the clearest such moment in the app. Everyday
     * saves keep the plain card below — the contrast is the point.
     *
     * The share sits HERE, at the emotional peak, rather than waiting for Sunday's
     * recap. Strava's per-activity sticker outperforms its annual review for
     * exactly this reason: pride is a perishable good.
     */
    const shareText = `${streak} days logged in a row on Growline 🔥`;
    return (
      <section className="gem gem-pink animate-rise p-5">
        <p className="text-sm font-semibold uppercase tracking-wide">
          {milestone}-day streak
        </p>
        <p className="mt-1 flex items-baseline gap-2 text-4xl">
          <span aria-hidden className="animate-flicker inline-block">🔥</span>
          <CountUp value={streak} className="numeral text-5xl text-text" />
        </p>
        <p className="mt-2 text-text">{milestoneMessage(milestone)}</p>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-4 flex h-12 items-center justify-center rounded-xl border border-hairline bg-surface font-semibold text-text"
        >
          Share this
        </a>
      </section>
    );
  }
  return (
    <section className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-5 py-4">
      <span>
        <CountUp value={streak} className="numeral block text-4xl text-text" />
        <span className="text-sm text-text-dim">
          {streak === 0
            ? "no streak yet — today can start one"
            : streak === 1
              ? "day in a row"
              : "days in a row"}
        </span>
      </span>
      {streak > 0 && <span className="text-3xl">🔥</span>}
    </section>
  );
}
