"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import ProgressBar from "@/components/ProgressBar";
import {
  MAX_NOTE,
  PROOF_STATUS_LABELS,
  isAchieved,
  type ProofStatus,
} from "@/lib/targets";
import TargetGate from "@/modules/goals/TargetGate";
import type { ProofRow } from "./ProofToAnswer";

type Row = {
  coach: {
    id: string;
    name: string;
    photoUrl: string | null;
    city: string | null;
    levelName: string | null;
  };
  target: {
    id: string;
    targetPoints: number;
    progressPoints: number;
    status: string;
    proofs: ProofRow[];
  } | null;
};

/**
 * The upline's side of F7: set a target for each direct downline, ask for proof, and
 * approve or comment.
 *
 * Only direct downlines appear. F7 scopes target-setting to the direct line, and
 * reaching past it would let someone override the target a coach's own upline set.
 */
export default function LineTargets({
  month,
  rows,
}: {
  month: string;
  rows: Row[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">Targets I set for my line</h2>
      {rows.map((row) => (
        <LineRow key={row.coach.id} row={row} month={month} />
      ))}
    </section>
  );
}

function LineRow({ row, month }: { row: Row; month: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const [askNote, setAskNote] = useState("");

  // From the numbers, not the stored status — see isAchieved().
  const achieved = row.target
    ? isAchieved(row.target.progressPoints, row.target.targetPoints)
    : false;

  const askForProof = async () => {
    if (!row.target || busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/targets/${row.target.id}/proofs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestNote: askNote.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not send. Please try again.");
        return;
      }
      setAsking(false);
      setAskNote("");
      router.refresh();
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
      <div className="flex items-center gap-3">
        <Avatar name={row.coach.name} photoUrl={row.coach.photoUrl} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{row.coach.name}</p>
          <p className="truncate text-xs text-text-dim">
            {/* Their own label if they set one — never a rank we supplied. */}
            {row.coach.levelName ?? row.coach.city ?? ""}
          </p>
        </div>
        {achieved && (
          <span className="shrink-0 rounded-full bg-elevated px-2.5 py-1 text-xs font-semibold text-gem-green">
            Reached
          </span>
        )}
      </div>

      {row.target ? (
        <ProgressBar
          progress={row.target.progressPoints}
          target={row.target.targetPoints}
          achieved={achieved}
        />
      ) : (
        <p className="text-sm text-text-dim">No target set for this month yet.</p>
      )}

      {editing ? (
        /*
         * The number field no longer lives here.
         *
         * A3 requires that an upline cannot open target-setting without first seeing
         * their downline's goal sheet, so the gate owns the whole exchange: read the
         * sheet, then the number, then what to do about the blockers. Keeping a second
         * input on this screen would be a way around the thing the gate exists to do.
         */
        <TargetGate
          coachId={row.coach.id}
          coachName={row.coach.name}
          month={month}
          initialPoints={row.target?.targetPoints ?? 0}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setEditing(true)}
            className="h-12 rounded-xl border border-hairline px-4 font-medium"
          >
            {row.target ? "Change target" : "Set a target"}
          </button>
          {row.target && (
            <button
              onClick={() => setAsking((v) => !v)}
              className="h-12 rounded-xl border border-hairline px-4 font-medium"
            >
              Ask for proof
            </button>
          )}
        </div>
      )}

      {asking && row.target && (
        <div className="flex flex-col gap-2 border-t border-hairline pt-3">
          <input
            value={askNote}
            onChange={(e) => setAskNote(e.target.value)}
            maxLength={MAX_NOTE}
            placeholder="What would you like to see? (optional)"
            className="h-12 w-full rounded-xl border border-hairline bg-elevated px-4 outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
          />
          <button
            onClick={askForProof}
            disabled={busy}
            className="h-12 rounded-xl bg-gold px-5 font-semibold text-on-gold disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send request"}
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-heat">{error}</p>
      )}

      {row.target && row.target.proofs.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-hairline pt-3">
          {row.target.proofs.map((p) => (
            <ProofToReview key={p.id} proof={p} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The upline reviewing what came back. A rejection requires a reason. */
function ProofToReview({ proof }: { proof: ProofRow }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState("");

  const decide = async (decision: "approved" | "rejected") => {
    if (busy) return;
    setError("");
    if (decision === "rejected" && comment.trim() === "") {
      setError("Add a short comment so they know what to send.");
      return;
    }
    setBusy(decision);
    try {
      const res = await fetch(`/api/proofs/${proof.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment: comment.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save. Please try again.");
        return;
      }
      setComment("");
      router.refresh();
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(null);
    }
  };

  const label = PROOF_STATUS_LABELS[proof.status as ProofStatus] ?? proof.status;
  const reviewable = proof.status === "submitted";

  return (
    <div className="rounded-xl bg-elevated p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm text-text/80">
          {proof.requestNote ?? "Proof requested"}
        </p>
        <span className="shrink-0 text-xs font-semibold text-text-dim">{label}</span>
      </div>

      {proof.mediaUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- data URL
        <img
          src={proof.mediaUrl}
          alt="Proof they sent"
          className="mt-2 max-h-56 w-full rounded-xl object-cover"
        />
      )}
      {proof.submitNote && (
        <p className="mt-2 text-sm text-text/80">They wrote: {proof.submitNote}</p>
      )}
      {proof.comment && (
        <p className="mt-2 text-sm text-text-dim">You said: {proof.comment}</p>
      )}

      {reviewable && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={MAX_NOTE}
            placeholder="Comment (needed if you send it back)"
            className="h-12 w-full rounded-xl border border-hairline px-4 outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => decide("approved")}
              disabled={busy !== null}
              className="h-12 flex-1 rounded-xl bg-gem-green px-4 font-semibold text-text disabled:opacity-50"
            >
              {busy === "approved" ? "Saving…" : "Approve"}
            </button>
            <button
              onClick={() => decide("rejected")}
              disabled={busy !== null}
              className="h-12 rounded-xl border border-hairline px-4 font-medium disabled:opacity-50"
            >
              {busy === "rejected" ? "Saving…" : "Send back"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-heat">{error}</p>}
    </div>
  );
}
