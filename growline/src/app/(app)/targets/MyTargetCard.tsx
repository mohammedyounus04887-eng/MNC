"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProgressBar from "@/components/ProgressBar";
import { MAX_TARGET_POINTS, isAchieved, targetReachedMessage } from "@/lib/targets";
import ProofToAnswer, { type ProofRow } from "./ProofToAnswer";

export type MyTarget = {
  id: string;
  targetPoints: number;
  progressPoints: number;
  status: string;
  setByName: string;
  proofs: ProofRow[];
};

/**
 * The downline's side of F7: a progress bar they move themselves, and any proof
 * requests waiting on them.
 *
 * Steppers plus a typable field, like the daily log — a coach adding a few points in
 * the evening should not have to fight a keyboard.
 */
export default function MyTargetCard({
  target,
  levelName,
}: {
  target: MyTarget | null;
  levelName: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(target?.progressPoints ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [celebrate, setCelebrate] = useState(false);

  if (!target) {
    return (
      <section className="rounded-2xl bg-surface p-5">
        <h2 className="font-semibold">No target set for this month</h2>
        <p className="mt-2 text-sm leading-snug text-text-dim">
          Your upline sets your monthly target. Ask them to add one, and your progress
          bar will appear here.
        </p>
      </section>
    );
  }

  // From the numbers, not the stored status — see isAchieved().
  const achieved = isAchieved(target.progressPoints, target.targetPoints);
  const dirty = draft !== target.progressPoints;

  const save = async () => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/targets/${target.id}/progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progressPoints: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save. Please try again.");
        return;
      }
      if (data.justAchieved) setCelebrate(true);
      router.refresh();
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  };

  const bump = (delta: number) =>
    setDraft((v) => Math.max(0, Math.min(MAX_TARGET_POINTS, v + delta)));

  return (
    <>
      {celebrate && (
        // Recognition without animation weight (Section 4.8 vs 4.4).
        <section className="rounded-2xl bg-elevated p-5">
          <p className="text-2xl font-bold text-gem-green">🎉 Target reached</p>
          <p className="mt-1 text-text/80">{targetReachedMessage(levelName)}</p>
        </section>
      )}

      <section className="flex flex-col gap-4 rounded-2xl bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">
              {levelName ? levelName : "This month"}
            </h2>
            <p className="text-sm text-text-dim">Set by {target.setByName}</p>
          </div>
          {achieved && (
            <span className="shrink-0 rounded-full bg-elevated px-3 py-1 text-xs font-semibold text-gem-green">
              Reached
            </span>
          )}
        </div>

        <ProgressBar
          progress={target.progressPoints}
          target={target.targetPoints}
          achieved={achieved}
        />

        <div className="border-t border-hairline pt-4">
          <h3 className="font-medium">Update my progress</h3>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              aria-label="Ten less"
              onClick={() => bump(-10)}
              disabled={draft === 0}
              className="h-12 w-14 rounded-xl border border-hairline font-semibold disabled:opacity-30"
            >
              −10
            </button>
            <button
              type="button"
              aria-label="One less"
              onClick={() => bump(-1)}
              disabled={draft === 0}
              className="h-12 w-12 rounded-xl border border-hairline text-2xl leading-none disabled:opacity-30"
            >
              −
            </button>
            <label className="sr-only" htmlFor="progress-points">
              Points so far
            </label>
            <input
              id="progress-points"
              value={draft}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                setDraft(digits === "" ? 0 : Number(digits));
              }}
              inputMode="numeric"
              className="h-12 min-w-0 flex-1 rounded-xl border border-hairline bg-elevated text-center text-xl font-bold tabular-nums outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
            />
            <button
              type="button"
              aria-label="One more"
              onClick={() => bump(1)}
              className="h-12 w-12 rounded-xl bg-elevated text-2xl leading-none text-text"
            >
              +
            </button>
            <button
              type="button"
              aria-label="Ten more"
              onClick={() => bump(10)}
              className="h-12 w-14 rounded-xl bg-elevated font-semibold text-text"
            >
              +10
            </button>
          </div>

          {error && (
            <p className="mt-3 rounded-xl bg-elevated px-4 py-3 text-sm text-heat">
              {error}
            </p>
          )}

          <button
            onClick={save}
            disabled={busy || !dirty}
            className="mt-3 h-14 w-full neopop metal-gold text-lg font-semibold text-on-gold disabled:opacity-40"
          >
            {busy ? "Saving…" : dirty ? "Save progress" : "Saved"}
          </button>
        </div>
      </section>

      {target.proofs.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Proof your upline asked for</h2>
          {target.proofs.map((p) => (
            <ProofToAnswer key={p.id} proof={p} />
          ))}
        </section>
      )}
    </>
  );
}
