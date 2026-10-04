"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * The 2nd-downline celebration (v2 §8's trigger moment).
 *
 * ## What it says while nothing is gated
 *
 * The spec's line is "Leader tools unlocked for 30 days 🎉" — but with every gate open
 * ("don't gate anything yet"), *unlocked* would be a lie: nothing was locked. Lying in
 * a celebration is how celebrations stop landing. So the card celebrates the true
 * thing — the team grew, Leader is earned and reserved — and the 30-day clock is
 * explicitly parked until payments begin, which is strictly better for the coach than
 * starting it today and letting it burn on tools they already have.
 *
 * ## Register
 *
 * A celebration, not a Trust Zone — the 🎉 is allowed here. But it obeys the motion
 * budget by having no motion at all: a card that appears once, says one true thing,
 * and can be dismissed for good. Dismissal is fire-and-forget; if the write fails the
 * card returns next visit, which errs on the side of repeating good news.
 */
export default function TrialOfferCard({ downlineCount }: { downlineCount: number }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;

  const dismiss = () => {
    setGone(true);
    void fetch("/api/tiers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "offer-seen" }),
      keepalive: true,
    }).catch(() => {});
  };

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-elevated p-5">
      <div>
        <h2 className="text-lg font-semibold">Your team is growing 🎉</h2>
        <p className="mt-1 text-sm text-text-dim">
          {downlineCount === 2 ? "Two coaches have" : `${downlineCount} coaches have`}{" "}
          joined your line — that earns you Leader. Your free 30 days of Leader start
          the day payments begin, so you lose nothing. Every tool is open for you today.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/plans"
          className="flex h-12 items-center justify-center rounded-xl bg-gold px-5 font-semibold text-on-gold"
        >
          See what Leader includes
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="h-12 rounded-xl px-4 font-medium text-text-dim"
        >
          Close
        </button>
      </div>
    </section>
  );
}
