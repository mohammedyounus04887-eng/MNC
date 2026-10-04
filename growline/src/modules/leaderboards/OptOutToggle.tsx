"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Show my name on the boards" (v1 §8 asks for leaderboards WITH opt-out).
 *
 * Calm register, like the privacy switch it sits next to in spirit: no gold, no
 * animation, no celebration. Being listed among your peers is exposure, and a screen
 * that leans on somebody to accept it — a gold button, a "join the race!" — is the
 * app arguing with an answer that is theirs to give (G1's reasoning, applied to the
 * one control on this screen that is not a game).
 *
 * The state is written out in words rather than drawn as a slider, matching
 * PrivacyToggle: a slider's position is the one thing a coach must not have to guess
 * at. And it says plainly that opting out changes the listings, not what they can
 * see — leaving is not being locked out.
 */
export default function OptOutToggle({ optedOut }: { optedOut: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (next: boolean) => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/leaderboards/opt-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optedOut: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save. Please try again.");
        return;
      }
      // Re-read rather than keeping the answer in local state: what this section
      // shows must be what the next rebuild will actually act on.
      router.refresh();
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl bg-surface p-5">
      <h2 className="font-semibold">My name on the boards</h2>
      <p className="mt-1 text-sm text-text-dim">
        {optedOut
          ? "Off. Your name is not listed on any board. You still see all of them, and your work still rolls up to your upline exactly as before."
          : "On. Coaches in the same group can see your name and your numbers on these boards. Never the names or numbers of the people you meet."}
      </p>

      <button
        data-testid="leaderboard-optout-toggle"
        onClick={() => void save(!optedOut)}
        disabled={busy}
        className="mt-3 min-h-12 rounded-xl border border-hairline px-4 py-3 text-left font-medium disabled:opacity-50"
      >
        {busy
          ? "Saving…"
          : optedOut
            ? "Show my name on the boards"
            : "Take my name off the boards"}
      </button>

      <p className="mt-2 text-xs text-text-dim">
        Boards are rebuilt a few times a day, so a change here shows up at the next
        rebuild.
      </p>

      {error && <p className="mt-3 text-sm text-heat">{error}</p>}
    </section>
  );
}
