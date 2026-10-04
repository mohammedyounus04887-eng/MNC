"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BLOCKERS } from "./model";
import { MAX_CHANGE_NOTE, type BlockerAction, type ConversationStatus } from "./conversation-types";

/**
 * The downline's half of the target conversation (A3).
 *
 * ## Why this sits on the home screen
 *
 * A target nobody agreed to is the thing this feature exists to end, and an accept button
 * buried on the targets tab is one a coach discovers in March. So the nudge and the action
 * are the same card, on the first screen they open.
 *
 * It disappears the moment there is nothing to do — accepted, with every action ticked,
 * renders nothing. A permanent card is a card people stop seeing.
 *
 * ## "Ask to talk again" is not "reject"
 *
 * Without it, an unaccepted target is indistinguishable from one nobody has looked at, and
 * the coach who most needs the conversation is exactly the one who will say nothing and
 * quietly stop logging. Reopening is framed as asking, because that is what it is.
 *
 * No celebration on accept. Agreeing to a month of work is a commitment, not a win —
 * confetti here would be the app congratulating somebody for taking on a target, which is
 * the register RULES G1 keeps out of anything that resembles pressure.
 */

const blockerLabel = (key: string) =>
  BLOCKERS.find((b) => b.key === key)?.label ?? "Also";

export default function TargetToAccept({
  targetId,
  uplineName,
  status,
  proposedPoints,
  changeNote,
  actions,
}: {
  targetId: string;
  uplineName: string;
  status: ConversationStatus;
  proposedPoints: number;
  changeNote: string;
  actions: BlockerAction[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  const post = async (body: Record<string, unknown>) => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/goals/conversations/${targetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save. Please try again.");
        return;
      }
      setAsking(false);
      router.refresh();
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  };

  const first = uplineName.split(" ")[0];

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-surface p-5">
      <div>
        <h2 className="text-sm text-text-dim">
          {status === "accepted" ? "Your target this month" : `${first} suggested a target`}
        </h2>
        <p className="text-3xl font-bold tabular-nums">
          {proposedPoints.toLocaleString("en-IN")}
          <span className="ml-1 text-base font-medium text-text-dim">points</span>
        </p>
      </div>

      {status === "change-requested" && (
        <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-text/80">
          You asked to talk about this{changeNote.trim() ? `: “${changeNote}”` : "."} {first}{" "}
          can see that.
        </p>
      )}

      {actions.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-dim">
            {status === "accepted"
              ? "What you agreed to work on"
              : `What ${first} will help with`}
          </p>
          {actions.map((a, i) => (
            <button
              key={`${a.blocker}-${i}`}
              type="button"
              onClick={() => post({ action: "set-action-done", index: i, done: !a.done })}
              disabled={busy}
              aria-pressed={a.done}
              className="flex min-h-12 items-start gap-3 rounded-xl bg-elevated px-4 py-3 text-left disabled:opacity-60"
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded ${
                  a.done ? "bg-gem-green text-text" : "border border-hairline"
                }`}
              >
                {a.done ? "✓" : ""}
              </span>
              <span className="min-w-0">
                <span className="block text-xs text-text-dim">
                  {blockerLabel(a.blocker)}
                </span>
                <span className={a.done ? "text-text-dim line-through" : ""}>
                  {a.action}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-heat">{error}</p>
      )}

      {status !== "accepted" &&
        (asking ? (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor={`change-${targetId}`}>
              What would you like to change?
            </label>
            <input
              id={`change-${targetId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={MAX_CHANGE_NOTE}
              placeholder="One line is enough"
              className="h-12 w-full rounded-xl border border-hairline bg-elevated px-4 outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => post({ action: "request-change", note })}
                disabled={busy}
                className="h-12 neopop metal-gold px-5 font-semibold text-on-gold disabled:opacity-50"
              >
                {busy ? "Sending…" : `Send to ${first}`}
              </button>
              <button
                onClick={() => setAsking(false)}
                className="h-12 rounded-xl border border-hairline px-4 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => post({ action: "accept" })}
              disabled={busy}
              className="h-14 flex-1 neopop metal-gold text-lg font-semibold text-on-gold disabled:opacity-50"
            >
              {busy ? "Saving…" : "I accept this target"}
            </button>
            <button
              onClick={() => setAsking(true)}
              className="h-14 rounded-xl border border-hairline px-4 font-medium"
            >
              Ask to talk
            </button>
          </div>
        ))}
    </section>
  );
}
