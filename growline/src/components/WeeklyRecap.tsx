"use client";

import { useState } from "react";

export type RecapData = {
  peopleMet: number;
  invites: number;
  memberships: number;
  sessions: number;
  streak: number;
  shareText: string;
};

/**
 * The Weekly Recap card (v2 §4, dopamine map #6) — the brag loop.
 *
 * ## Sharing to WhatsApp Status
 *
 * v2 asks for "one-tap share to WhatsApp Status". `wa.me` cannot do that — it
 * opens a chat with a specific number, and Status is not addressable by URL. The
 * Web Share API can: on Android the system sheet lists WhatsApp, and from there
 * Status is one more tap.
 *
 * So: `navigator.share` where it exists, `wa.me` as the fallback. That keeps
 * RULES S4 (wa.me only, no paid Business API) while actually reaching Status on
 * the devices this audience uses.
 *
 * ## What it must never say
 *
 * Counts and a streak. No currency, no rank names, no company (L1, L4). This
 * string is the most forwarded text the app produces, which makes it the most
 * likely to be read by someone who did not install it.
 */
export default function WeeklyRecap({ data }: { data: RecapData }) {
  const [shared, setShared] = useState(false);

  const share = async () => {
    const text = data.shareText;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text });
        setShared(true);
        return;
      } catch {
        // Cancelled or unsupported — fall through to WhatsApp.
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    setShared(true);
  };

  const stats = [
    { label: "met", value: data.peopleMet },
    { label: "invited", value: data.invites },
    { label: "joined", value: data.memberships },
    { label: "sessions", value: data.sessions },
  ].filter((s) => s.value > 0);

  return (
    <section
      className="rounded-2xl border border-hairline bg-surface p-5"
      data-testid="weekly-recap"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-text">Your week</h2>
        {data.streak > 0 && (
          <span className="text-sm text-text-dim">streak {data.streak} 🔥</span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-elevated px-4 py-3">
            <dd className="numeral text-3xl text-text">{s.value}</dd>
            <dt className="mt-0.5 text-sm text-text-dim">{s.label}</dt>
          </div>
        ))}
      </dl>

      <button
        onClick={share}
        data-testid="recap-share"
        className="neopop metal-gold mt-4 h-12 w-full font-semibold"
      >
        {shared ? "Shared" : "Share my week"}
      </button>
    </section>
  );
}
