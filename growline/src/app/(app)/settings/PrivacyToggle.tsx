"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The F11 privacy switch (Section 5.4) — the only thing in the app that can set
 * `shareProspects`, the field the prospects Security Rule resolves on every read.
 *
 * Turning it ON asks a second time and names what leaves the coach's hands;
 * turning it OFF is one tap. That asymmetry is the design: withdrawing consent
 * must never cost more taps than giving it. "Share my prospect details" is
 * exactly the kind of phrase a person agrees to without picturing the names and
 * phone numbers it covers, so the confirm pictures them out loud.
 *
 * Nothing here is gold and nothing animates. Privacy is a Trust Zone (v2 §4, G1)
 * — an accent on "share my prospects" would read as the app leaning on the coach
 * to say yes, and this screen has no opinion about their answer.
 *
 * The state is written out in words rather than drawn as a slider, because a
 * slider's position is the one thing a coach must not have to guess at.
 */
export default function PrivacyToggle({
  sharing,
  hasUpline,
}: {
  sharing: boolean;
  hasUpline: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (next: boolean) => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareProspects: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save. Please try again.");
        return;
      }
      setConfirming(false);
      // Re-read instead of keeping the new value in local state: what this section
      // shows has to be the user document the Security Rules will actually consult,
      // never an optimistic guess about it.
      router.refresh();
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl bg-surface p-5">
      <h2 className="font-semibold">Who can see my prospects</h2>

      {!hasUpline ? (
        /* A coach who signed up without a referral code has an empty `uplinePath`,
           so the rule's allow branch can never match them — `uid in []` is false
           for everyone — and `uplineId` is only ever written at signup, so that
           does not change later. Offering a switch that would do nothing is its
           own small dishonesty on a privacy screen. */
        <p className="mt-1 text-sm text-text-dim">
          Nobody is above you in your line, so your prospects are yours alone —
          their names and numbers stay on your account.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-text-dim">
            {sharing
              ? "On. Your upline — and the coaches above them — can see the names and phone numbers of everyone in your list. Stop any time and they lose access straight away."
              : "Off. Your upline sees only your numbers: how many people you spoke to, invited and signed up. Never their names or phone numbers."}
          </p>

          {confirming ? (
            <div className="mt-4 rounded-xl border border-hairline p-4">
              <p className="font-medium">Share my prospect details with my upline?</p>
              <p className="mt-1 text-sm text-text-dim">
                Your upline — and the coaches above them — will be able to see the
                name and phone number of every person in your list, including the
                ones you saved before today. Your numbers reach them either way.
                You can stop sharing whenever you like, and they lose access the
                moment you do.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  data-testid="share-prospects-confirm"
                  onClick={() => void save(true)}
                  disabled={busy}
                  className="min-h-12 rounded-xl border border-hairline bg-elevated px-5 py-3 font-semibold disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Yes, share with my upline"}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="min-h-12 rounded-xl px-4 py-3 font-medium text-text-dim disabled:opacity-50"
                >
                  Keep it off
                </button>
              </div>
            </div>
          ) : (
            <button
              data-testid="share-prospects-toggle"
              onClick={() => (sharing ? void save(false) : setConfirming(true))}
              disabled={busy}
              className="mt-3 min-h-12 rounded-xl border border-hairline px-4 py-3 text-left font-medium disabled:opacity-50"
            >
              {sharing
                ? busy
                  ? "Stopping…"
                  : "Stop sharing"
                : "Share my prospect details with my upline"}
            </button>
          )}
        </>
      )}

      {error && <p className="mt-3 text-sm text-heat">{error}</p>}
    </section>
  );
}
