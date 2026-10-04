"use client";

import { useState } from "react";

/**
 * The prospect's own erasure control (DPDP). Anyone holding the link can trigger
 * it, which is the safe direction to fail: the worst case is that data is deleted
 * that someone wanted kept, never that it is exposed.
 */
export default function RemoveMyDetails({ token }: { token: string }) {
  const [step, setStep] = useState<"idle" | "confirm" | "done">("idle");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/public/report/${token}/remove`, { method: "POST" });
      if (res.ok) setStep("done");
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (step === "done") {
    return (
      <p className="rounded-xl bg-elevated px-4 py-3 text-gem-green">
        Your details have been deleted. This link will stop working.
      </p>
    );
  }

  if (step === "confirm") {
    return (
      <div className="flex flex-col gap-2 rounded-xl bg-surface px-4 py-3">
        <p className="text-text">
          Delete your name, number and these numbers from your coach&apos;s list? This
          cannot be undone.
        </p>
        {failed && (
          <p className="text-heat">Could not delete just now. Please try again.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={remove}
            disabled={busy}
            className="h-12 rounded-xl border border-error px-4 font-semibold text-heat disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Yes, delete my details"}
          </button>
          <button
            onClick={() => setStep("idle")}
            className="h-12 rounded-xl border border-hairline px-4 font-medium"
          >
            Keep them
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setStep("confirm")}
      className="h-12 self-start text-left font-medium text-text-dim underline"
    >
      Not you, or want this removed?
    </button>
  );
}
