"use client";

/**
 * The streak flame (v2 §4, dopamine map #1) — the one mechanic pointed at daily
 * logging, which F6 calls the heart of the app.
 *
 * ## Two rules this component exists to hold
 *
 * **Glow only when the streak is live.** v2 §4 allows a soft outer glow on exactly
 * two things, and this is one. A dead streak must not glow: the glow IS the signal.
 *
 * **Losing a streak must never feel like punishment.** The Streak Shield absorbs
 * one missed day per month. The copy says the shield caught it — the app is on the
 * coach's side, and streak forgiveness is the 2026 baseline for a reason.
 *
 * The 3D flame from the Jewel Asset Pack drops in here later; this is the CSS
 * stand-in, and it is deliberately cheap — Lottie under 100KB and 60fps on a ₹10K
 * Android is the budget (G5), so the everyday state is a gradient and a transform,
 * not a render.
 */

/** Sizes step at 7/30/100 days — noticeable, never loud. */
function scaleFor(days: number): number {
  if (days >= 100) return 1.35;
  if (days >= 30) return 1.2;
  if (days >= 7) return 1.1;
  return 1;
}

export default function StreakFlame({
  days,
  shieldUsed = false,
  live = true,
}: {
  days: number;
  /** True when the shield already absorbed a miss this month. */
  shieldUsed?: boolean;
  /** False once a whole day has passed unlogged (D27 anchors on yesterday). */
  live?: boolean;
}) {
  const scale = scaleFor(days);

  return (
    <div className="flex items-center gap-3" data-testid="streak" data-days={days}>
      <span
        aria-hidden
        // The scale goes in as a CSS variable rather than a transform: the flicker
        // keyframe needs to multiply it, and an inline `transform` would win the
        // cascade and freeze the animation at the milestone size.
        style={{ "--flame-scale": scale, transformOrigin: "bottom center" } as React.CSSProperties}
        className={`inline-block text-3xl leading-none ${
          live ? "glow-gold animate-flicker" : "opacity-40 grayscale"
        }`}
      >
        🔥
      </span>
      <div className="min-w-0">
        <p className="numeral text-2xl text-text">
          {days}
          <span className="ml-1 font-sans text-sm font-medium text-text-dim">
            {days === 1 ? "day" : "days"}
          </span>
        </p>
        <p className="text-sm text-text-dim">
          {!live
            ? "Log today to start again"
            : shieldUsed
              ? "Shield used this month — keep going"
              : days >= 100
                ? "Hundred days. Remarkable."
                : days >= 30
                  ? "A month straight"
                  : days >= 7
                    ? "A week straight"
                    : "Logged today"}
        </p>
      </div>
    </div>
  );
}
