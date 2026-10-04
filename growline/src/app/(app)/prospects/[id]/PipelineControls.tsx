"use client";

import { celebrate } from "@/lib/celebrate";
import { haptic, HAPTIC } from "@/lib/haptic";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  STAGES,
  STAGE_LABELS,
  nextStage,
  stageIndex,
  type Stage,
} from "@/lib/pipeline";
import { FOLLOWUP_PRESETS, presetToDate } from "@/lib/followup";

/**
 * Stage, follow-up date and notes (F5). Every one of these is a single tap or a
 * single field — kept out of the six-field capture form on purpose (Section 5.6),
 * and each saves on its own so nothing has to be filled in to move a stage.
 */
export default function PipelineControls({
  prospectId,
  stage,
  followupLabel,
  followupOverdue,
  notes,
}: {
  prospectId: string;
  stage: Stage;
  followupLabel: string | null;
  followupOverdue: boolean;
  notes: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [noteDraft, setNoteDraft] = useState(notes ?? "");
  const [noteOpen, setNoteOpen] = useState(false);
  /**
   * The stage that was just moved to, held for one animation.
   *
   * `snapped` drives a 180ms scale on the pill that just became active — the
   * "satisfying snap" v2 §4 dopamine map #4 assigns to this exact control, which
   * until now was the one screen in the app with a named mechanic and none of it
   * built. `converted` is the bigger moment: reaching Member is the conversion the
   * whole pipeline exists for, so it also washes the card green and fires the
   * engine.
   */
  const [snapped, setSnapped] = useState<string | null>(null);
  const [converted, setConverted] = useState(false);
  const dismissed = useRef(false);

  const save = async (
    patch: Record<string, unknown>,
    label: string
  ): Promise<boolean> => {
    setError("");
    setBusy(label);
    try {
      const res = await fetch(`/api/prospects/${prospectId}/pipeline`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save. Please try again.");
        return false;
      }
      const movedTo = typeof patch.stage === "string" ? patch.stage : null;
      if (movedTo) {
        setSnapped(movedTo);
        window.setTimeout(() => setSnapped(null), 220);
      }
      if (movedTo === "member") {
        // The engine handles the confetti, the haptic and the 1.4s cap; the green
        // wash below is this card's own part of the moment. Green is the sanctioned
        // colour here — a Member is the gain the pipeline exists to produce — and
        // it is the one stage that gets it (G6: scarcity is the mechanic).
        dismissed.current = false;
        setConverted(true);
        celebrate();
        window.setTimeout(() => setConverted(false), 1400);
      } else {
        haptic(HAPTIC.confirm);
      }
      router.refresh();
      return true;
    } catch {
      setError("No connection. Check your network and try again.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const advance = nextStage(stage);
  const currentIndex = stageIndex(stage);

  return (
    <section
      className="relative flex flex-col gap-4 overflow-hidden rounded-2xl bg-surface p-5"
      onClick={() => {
        // Skippable (G5), the same gesture the engine's canvas honours.
        if (converted && !dismissed.current) {
          dismissed.current = true;
          setConverted(false);
        }
      }}
    >
      {converted && (
        <span
          aria-hidden
          data-testid="member-wash"
          className="animate-rise pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 50% 0%, var(--gem-green-line), transparent 68%)",
          }}
        />
      )}
      <div>
        <h2 className="font-semibold">Where they are</h2>
        {/* Full stage list so a coach can correct a wrong tap, not just go forward */}
        <div className="mt-3 flex flex-wrap gap-2">
          {STAGES.map((s, i) => {
            const active = s === stage;
            const passed = i < currentIndex;
            return (
              <button
                key={s}
                onClick={() => !active && void save({ stage: s }, `stage-${s}`)}
                disabled={busy !== null}
                aria-pressed={active}
                className={`relative h-12 rounded-xl px-4 font-medium transition-transform duration-200 disabled:opacity-60 ${
                  snapped === s ? "scale-105" : ""
                } ${
                  active
                    ? "bg-elevated text-text"
                    : passed
                      ? "border border-hairline bg-hairline text-text"
                      : "border border-hairline text-text-dim"
                }`}
              >
                {STAGE_LABELS[s]}
              </button>
            );
          })}
        </div>
        {advance && (
          <button
            onClick={() => void save({ stage: advance }, "advance")}
            disabled={busy !== null}
            className="mt-3 h-14 w-full neopop metal-gold text-lg font-semibold text-on-gold disabled:opacity-50"
          >
            {busy === "advance" ? "Saving…" : `Move to ${STAGE_LABELS[advance]}`}
          </button>
        )}
      </div>

      <div className="border-t border-hairline pt-4">
        <h2 className="font-semibold">Next follow-up</h2>
        {/* The label already reads as a sentence on its own ("Tomorrow", "In 3
            days", "3 days late"), so it is shown directly rather than wrapped in
            a phrase that would produce "Set for in 3 days". */}
        <p
          className={`mt-1 ${
            followupOverdue ? "font-semibold text-gold-ink" : "text-sm text-text-dim"
          }`}
        >
          {followupLabel ?? "Not set yet"}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {FOLLOWUP_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() =>
                void save(
                  { nextFollowupAt: presetToDate(p.days).toISOString() },
                  `fu-${p.key}`
                )
              }
              disabled={busy !== null}
              className="h-12 rounded-xl border border-hairline px-4 font-medium disabled:opacity-60"
            >
              {busy === `fu-${p.key}` ? "Saving…" : p.label}
            </button>
          ))}
          {followupLabel && (
            <button
              onClick={() => void save({ nextFollowupAt: null }, "fu-clear")}
              disabled={busy !== null}
              className="h-12 rounded-xl px-4 font-medium text-text-dim underline disabled:opacity-60"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-hairline pt-4">
        <h2 className="font-semibold">Notes</h2>
        {noteOpen ? (
          <div className="mt-3 flex flex-col gap-2">
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="What did you talk about?"
              className="w-full rounded-xl border border-hairline bg-elevated p-3 text-base outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={async () => {
                  if (await save({ notes: noteDraft }, "notes")) setNoteOpen(false);
                }}
                disabled={busy !== null}
                className="h-12 neopop metal-gold px-5 font-semibold text-on-gold disabled:opacity-50"
              >
                {busy === "notes" ? "Saving…" : "Save note"}
              </button>
              <button
                onClick={() => {
                  setNoteDraft(notes ?? "");
                  setNoteOpen(false);
                }}
                className="h-12 rounded-xl border border-hairline px-4 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {notes ? (
              <p className="mt-2 whitespace-pre-wrap text-text/80">{notes}</p>
            ) : (
              <p className="mt-1 text-sm text-text-dim">Nothing written down yet</p>
            )}
            <button
              onClick={() => setNoteOpen(true)}
              className="mt-3 h-12 rounded-xl border border-hairline px-4 font-medium"
            >
              {notes ? "Edit note" : "Add a note"}
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-heat">{error}</p>
      )}
    </section>
  );
}
