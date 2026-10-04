"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fileToProofDataUrl } from "@/lib/image-client";
import { MAX_NOTE, PROOF_STATUS_LABELS, type ProofStatus } from "@/lib/targets";

export type ProofRow = {
  id: string;
  status: string;
  requestNote: string | null;
  submitNote: string | null;
  comment: string | null;
  mediaUrl: string | null;
  createdAt: string;
};

const statusStyle: Record<string, string> = {
  pending: "bg-elevated text-gold-ink",
  submitted: "bg-hairline text-text",
  approved: "bg-elevated text-gem-green",
  rejected: "bg-elevated text-gold-ink",
};

/** The downline attaching evidence to a request (F7). */
export default function ProofToAnswer({ proof }: { proof: ProofRow }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const needsAnswer = proof.status === "pending" || proof.status === "rejected";
  const label = PROOF_STATUS_LABELS[proof.status as ProofStatus] ?? proof.status;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      setPhoto(await fileToProofDataUrl(file));
    } catch {
      setError("Could not use that photo. Try another one.");
    }
  };

  const send = async () => {
    if (busy) return;
    if (!photo && note.trim() === "") {
      setError("Add a photo or a short note.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/proofs/${proof.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl: photo, submitNote: note.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not send. Please try again.");
        return;
      }
      setPhoto(null);
      setNote("");
      router.refresh();
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-text/80">
          {proof.requestNote ?? "Your upline asked for proof of your progress."}
        </p>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            statusStyle[proof.status] ?? "bg-hairline text-text"
          }`}
        >
          {label}
        </span>
      </div>

      {proof.comment && (
        <p className="rounded-xl bg-elevated px-3 py-2 text-sm">
          <span className="font-medium">They said:</span> {proof.comment}
        </p>
      )}

      {proof.mediaUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL cannot be optimized by next/image
        <img
          src={proof.mediaUrl}
          alt="The proof you sent"
          className="max-h-48 w-full rounded-xl object-cover"
        />
      )}
      {proof.submitNote && (
        <p className="text-sm text-text-dim">You wrote: {proof.submitNote}</p>
      )}

      {needsAnswer && (
        <div className="flex flex-col gap-2 border-t border-hairline pt-3">
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element -- same as above
            <img
              src={photo}
              alt="Photo you are about to send"
              className="max-h-48 w-full rounded-xl object-cover"
            />
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="h-12 rounded-xl border border-hairline font-medium"
          >
            {photo ? "Choose a different photo" : "Add a photo"}
          </button>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MAX_NOTE}
            placeholder="Say a line about it (optional)"
            className="h-12 w-full rounded-xl border border-hairline bg-elevated px-4 outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
          />
          {error && <p className="text-sm text-heat">{error}</p>}
          <button
            onClick={send}
            disabled={busy}
            className="h-14 rounded-xl bg-gold text-lg font-semibold text-on-gold disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send to my upline"}
          </button>
          <p className="text-xs text-text-dim">
            Photos are shrunk on your phone before sending, and location details are
            removed.
          </p>
        </div>
      )}
    </div>
  );
}
