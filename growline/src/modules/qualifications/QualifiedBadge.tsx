"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The badge a coach gets for qualifying, and the one celebration in this feature.
 *
 * ## Pink diamond, and only here
 *
 * v2 §4 reserves the pink gem for milestone surprises — never routine UI — so it
 * appears on exactly one card in this module, in exactly one state. A tracker that
 * has not been cleared has no pink on it at all, which is what keeps the colour worth
 * something when it does show up.
 *
 * ## The motion budget (RULES G5), honoured three ways
 *
 *   under 1.5s   the burst runs for 1200ms and then the card is simply a card.
 *   skippable    one tap anywhere on it ends the animation immediately.
 *   reduced      `prefers-reduced-motion` skips the burst entirely and shows the
 *                finished state. Nothing is lost but the movement.
 *
 * It never blocks input: the share button works during the celebration, and the burst
 * is `pointer-events-none` so a tap lands on whatever is underneath it.
 *
 * ## Once per device, not once per render
 *
 * The celebration fires the first time this coach opens the badge and not on every
 * visit afterwards — a party that happens every time you look at something stops
 * being a party by the third time. "Have they seen it" is a localStorage key rather
 * than a stored field, deliberately: it is a display preference for this browser, it
 * needs no write path, and a coach who opens the app on a second phone getting the
 * moment once more is a better failure than a server round trip to suppress it.
 *
 * ## What the share text may not say (RULES L4, L1)
 *
 * This is the most forwarded string this feature produces, and the most likely to be
 * read by somebody who has never installed the app. It names the qualification and
 * the date. No earnings, no "what this is worth", no rank name we invented — the
 * title is whatever the upline typed (D29).
 */

const CELEBRATION_MS = 1200;

export default function QualifiedBadge({
  qualificationId,
  title,
  coachName,
  qualifiedOn,
}: {
  qualificationId: string;
  title: string;
  coachName: string;
  /** Already formatted server-side — the client never decides what day it is (E1). */
  qualifiedOn: string | null;
}) {
  const [celebrating, setCelebrating] = useState(false);
  const [shared, setShared] = useState(false);
  const dismissed = useRef(false);

  useEffect(() => {
    const key = `gl_qualified_seen_${qualificationId}`;
    let seen = true;
    try {
      seen = window.localStorage.getItem(key) === "1";
      if (!seen) window.localStorage.setItem(key, "1");
    } catch {
      // Private mode, or storage full. Skipping the celebration is the right
      // failure — showing it on every single load would be the wrong one.
      return;
    }
    if (seen) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Started on the next frame rather than in the effect body, so mounting does not
    // cascade a second render on the one interaction that has to feel instant.
    const raf = requestAnimationFrame(() => setCelebrating(true));
    const id = setTimeout(() => setCelebrating(false), CELEBRATION_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(id);
    };
  }, [qualificationId]);

  const shareText = qualifiedOn
    ? `I'm in — ${title}. Qualified on ${qualifiedOn}.`
    : `I'm in — ${title}.`;

  const share = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text: shareText });
        setShared(true);
        return;
      } catch {
        // Cancelled, or unsupported despite being present — fall through.
      }
    }
    // `wa.me` with no number opens the chooser, which is RULES S4's only sanctioned
    // route to WhatsApp. WeeklyRecap makes the same fallback for the same reason.
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank");
    setShared(true);
  };

  return (
    <section
      data-testid="qualified-badge"
      onClick={() => {
        if (celebrating && !dismissed.current) {
          dismissed.current = true;
          setCelebrating(false);
        }
      }}
      className="gem gem-pink relative overflow-hidden p-6 text-center"
    >
      {celebrating && (
        <span
          aria-hidden
          className="animate-rise pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 50% 0%, var(--gem-pink-line), transparent 65%)",
          }}
        />
      )}

      <p className="relative text-sm font-semibold uppercase tracking-wide">
        Qualified
      </p>
      <h2 className="relative mt-2 font-display text-2xl font-bold text-text">
        {title}
      </h2>
      <p className="relative mt-1 text-text">{coachName}</p>
      {qualifiedOn && (
        <p className="relative mt-0.5 text-sm text-text-dim">{qualifiedOn}</p>
      )}

      <button
        onClick={() => void share()}
        data-testid="qualified-share"
        className="neopop metal-gold relative mt-5 h-12 w-full font-semibold"
      >
        {shared ? "Shared" : "Share this"}
      </button>
    </section>
  );
}
